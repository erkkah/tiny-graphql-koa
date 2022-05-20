import {
    DocumentNode,
    ExecutionArgs,
    GraphQLSchema,
    defaultFieldResolver,
    DirectiveNode,
} from "graphql";
import { SchemaTransform, mapSchema, MapperKind } from "@graphql-tools/utils";

import { GraphQLPlugin, Executable, MaybePromise } from ".";
import gql from "graphql-tag";
import { AuthorizationError } from "./errors";
import { ServiceContext } from "./GraphQLServer";

export type AuthorizationLevelExtractor = (
    ctx: ServiceContext
) => MaybePromise<AuthorizationLevel>;

export interface AuthPluginOptions {
    // The level set to all fields without explicit a11n directive.
    // Defaults to "PUBLIC".
    defaultLevel?: AuthorizationLevel;
    levelExtractor: AuthorizationLevelExtractor;
    // Optional mapping from named role to AuthorizationLevel.
    // Used with a11n "role" argument.
    roles?: {
        [role: string]: AuthorizationLevel;
    };
}

export type AuthorizationLevel =
    | "PUBLIC"
    | "USER"
    | "USER2"
    | "USER3"
    | "USER4"
    | "ADMIN"
    | "ADMIN2"
    | "ADMIN3"
    | "ADMIN4"
    | "GOD";

/**
 * Authorization plugin.
 *
 * Declare required authorization levels directly in your schemas
 * using the @authorization(level: <level>) directive or the @a11n() alias.
 * 
 * The directive can be set on individual fields, or on object types.
 * Field level directives override object level directives.
 *
 * The plugin supports a limited number of pre-defined levels. The current level
 * is set by a hook implementing the AuthorizationLevelExtractor interface.
 * 
 * An alternative to using the levels directly is to configure roles that
 * map to the pre-defined levels: @a11n(role: "editor"). The roles are configured
 * using the "roles" config property.
 */
export class AuthPlugin implements GraphQLPlugin {
    constructor(private readonly options: AuthPluginOptions) {}

    get defaultLevel(): AuthorizationLevel {
        return this.options.defaultLevel ?? "PUBLIC";
    }

    directives(): (string | DocumentNode)[] {
        return [
            gql`
                enum AuthorizationLevel {
                    PUBLIC
                    USER
                    USER2
                    USER3
                    USER4
                    ADMIN
                    ADMIN2
                    ADMIN3
                    ADMIN4
                    GOD
                }
                directive @a11n(
                    level: AuthorizationLevel
                    role: String
                ) on FIELD_DEFINITION | OBJECT
                directive @authorization(
                    level: AuthorizationLevel
                    role: String
                ) on FIELD_DEFINITION | OBJECT
            `,
        ];
    }

    transforms(): SchemaTransform[] {
        return [
            (schema: GraphQLSchema) =>
                mapSchema(schema, {
                    [MapperKind.OBJECT_FIELD]: (
                        fieldConfig,
                        _fieldName,
                        typeName,
                        schema
                    ) => {
                        {
                            const { resolve = defaultFieldResolver } =
                                fieldConfig;

                            const parentType = schema.getType(typeName);
                            const parentDirectives =
                                parentType?.astNode?.directives ?? [];
                            const directives =
                                fieldConfig.astNode?.directives ?? [];

                            const fieldLevel = this.levelFromDirectives([
                                ...directives,
                                ...parentDirectives,
                            ]);

                            fieldConfig.resolve = async (
                                source,
                                args,
                                context,
                                info
                            ) => {
                                const authContext: AuthPluginContext = context;

                                if (hasAccess(authContext, fieldLevel)) {
                                    return resolve(source, args, context, info);
                                } else {
                                    throw new AuthorizationError();
                                }
                            };
                        }
                        return fieldConfig;
                    },
                }),
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

    levelFromDirectives(
        directives: ReadonlyArray<DirectiveNode> | undefined
    ): AuthorizationLevel {
        if (!directives) return this.defaultLevel;

        const authLevelDirective = directives.find(
            (directive) =>
                directive.name.value === "authorization" ||
                directive.name.value === "a11n"
        );

        if (!authLevelDirective) return this.defaultLevel;

        if (!authLevelDirective.arguments) {
            throw new Error("missing argument");
        }

        const levelArgument = authLevelDirective.arguments.find(
            (argument) => argument.name.value === "level"
        );

        if (levelArgument) {
            if (
                levelArgument.value.kind !== "EnumValue" ||
                !isAuthorizationLevel(levelArgument.value.value)
            ) {
                throw new Error("invalid 'level' argument");
            }
            return levelArgument.value.value;
        }

        const roleArgument = authLevelDirective.arguments.find(
            (argument) => argument.name.value === "role"
        );

        if (roleArgument) {
            if (roleArgument.value.kind !== "StringValue") {
                throw new Error("invalid 'role' argument");
            }
            const role = roleArgument.value.value;
            if (this.options.roles && role in this.options.roles) {
                const level = this.options.roles[role];

                if (!isAuthorizationLevel(level)) {
                    throw new Error("invalid 'role' definition");
                }
                return level;
            }
            throw new Error(`invalid 'role' "${role}"`);
        }

        throw new Error("syntax error, expected 'level' or 'role' argument");
    }
}

const authorizationLevels: Record<AuthorizationLevel, number> = {
    PUBLIC: 0,
    USER: 10,
    USER2: 11,
    USER3: 12,
    USER4: 13,
    ADMIN: 20,
    ADMIN2: 21,
    ADMIN3: 22,
    ADMIN4: 23,
    GOD: 99,
};

interface AuthPluginContext extends ServiceContext {
    authPlugin: {
        level: AuthorizationLevel;
    };
}

function isAuthorizationLevel(maybe: string): maybe is AuthorizationLevel {
    return maybe in authorizationLevels;
}

function hasAccess(
    context: AuthPluginContext | undefined,
    required: AuthorizationLevel
): boolean {
    const currentLevel = context?.authPlugin?.level ?? "PUBLIC";
    return authorizationLevels[currentLevel] >= authorizationLevels[required];
}

export default AuthPlugin;
