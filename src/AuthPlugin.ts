import { DocumentNode, ExecutionArgs, GraphQLSchema, defaultFieldResolver, DirectiveNode } from "graphql";
import { SchemaTransform, mapSchema, MapperKind, getDirectives } from "@graphql-tools/utils";

import { GraphQLPlugin, Executable, MaybePromise } from ".";
import gql from "graphql-tag";
import { AuthorizationError } from "./errors";
import { ServiceContext } from "./GraphQLServer";

export type AuthorizationLevelExtractor = (ctx: ServiceContext) => MaybePromise<AuthorizationLevel>;

export interface AuthPluginOptions {
    defaultLevel?: AuthorizationLevel;
    levelExtractor: AuthorizationLevelExtractor;
}

export type AuthorizationLevel = "PUBLIC" | "USER" | "ADMIN" | "GOD";

/**
 * Authorization plugin.
 * 
 * Declare required authorization levels directly in your schemas
 * using the @authorization(level: <level>) directive or the @a11n() alias.
 * 
 * The plugin supports a limited number of pre-defined levels. The current level
 * is set by a hook implementing the AuthorizationLevelExtractor interface.
 */
export class AuthPlugin implements GraphQLPlugin {
    constructor(private readonly options: AuthPluginOptions) {
        if (!options.defaultLevel) {
            options.defaultLevel = "PUBLIC";
        }
    }

    directives(): (string | DocumentNode)[] {
        return [gql`
        enum AuthorizationLevel {
            PUBLIC
            USER
            ADMIN
            GOD
        }
        directive @a11n(level: AuthorizationLevel) on FIELD_DEFINITION
        directive @authorization(level: AuthorizationLevel) on FIELD_DEFINITION
        `];
    }

    transforms(): SchemaTransform[] {
        return [
            (schema: GraphQLSchema) => mapSchema(schema, {
                [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
                    const directives = getDirectives(schema, fieldConfig);
                    if ("authorization" in directives || "a11n" in directives) {
                        const { resolve = defaultFieldResolver } = fieldConfig;

                        fieldConfig.resolve = async (source, args, context, info) => {
                            const authContext: AuthPluginContext = context;
                            const requiredLevel = levelFromDirectives(fieldConfig.astNode?.directives);
                            if (hasAccess(authContext, requiredLevel)) {
                                return resolve(source, args, context, info);
                            } else {
                                throw new AuthorizationError();
                            }
                        };
                    }
                    return fieldConfig;
                }
            })
        ];
    }

    wrapper = (next: Executable): Executable => {
        return async (args: ExecutionArgs) => {
            const context: AuthPluginContext = args.contextValue;
            const level = await this.options.levelExtractor(context);
            context.authPlugin = { level };
            return next(args);
        };
    };
}

const authorizationLevels: Record<AuthorizationLevel, number> = {
    PUBLIC: 0,
    USER: 1,
    ADMIN: 2,
    GOD: 99
};

interface AuthPluginContext extends ServiceContext {
    authPlugin: {
        level: AuthorizationLevel;
    }
}

function levelFromDirectives(
    directives: ReadonlyArray<DirectiveNode> | undefined,
): AuthorizationLevel {
    if (!directives) return "PUBLIC";

    const authLevelDirective = directives.find(
        (directive) => (
            directive.name.value === "authorization" ||
            directive.name.value === "a11n"
        )
    );
    if (!authLevelDirective?.arguments) return "PUBLIC";

    const levelArgument = authLevelDirective.arguments.find(
        argument => argument.name.value === "level",
    );

    const level = levelArgument?.value?.kind === "EnumValue"
        ? levelArgument.value.value ?? "PUBLIC"
        : "PUBLIC";

    if (!(isAuthorizationLevel(level))) {
        throw new Error();
    }
    return level;
}

function isAuthorizationLevel(maybe: string): maybe is AuthorizationLevel {
    return maybe in authorizationLevels;
}

function hasAccess(context: AuthPluginContext | undefined, required: AuthorizationLevel): boolean {
    const currentLevel = context?.authPlugin?.level ?? "PUBLIC";
    return authorizationLevels[currentLevel] >= authorizationLevels[required];
}

export default AuthPlugin;
