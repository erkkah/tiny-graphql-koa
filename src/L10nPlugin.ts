import { defaultFieldResolver, DocumentNode, ExecutionArgs, GraphQLDirective, GraphQLSchema, OperationDefinitionNode } from "graphql";
import { SchemaTransform, mapSchema, MapperKind, getDirectives } from "@graphql-tools/utils";

import { GraphQLPlugin, Executable, ServiceContext, MaybePromise } from ".";
import gql from "graphql-tag";
import { getArgumentValues } from "graphql/execution/values";


export interface LocalizationPluginOptions {
    defaultLocale: string;
    verifyLocalized?: boolean;
    localeExtractor?: DefaultLocaleExtractor;
}

/**
 * Plugin providing @locale query directive for specifying the requested
 * locale for a query or mutation.
 * 
 * By using a query level directive, object fields can be kept clean from
 * locale arguments, and a service-wide default locale handling is easily
 * achieved.
 * 
 * Example:
 * ```graphql
 * query @locale(code: "sv") {
 *     message
 * }
 * ```
 * 
 * Use {@link localeFromContext} in resolvers to get the current locale.
 * 
 * The plugin is configured with a default locale, which will be used
 * when there is no @locale directive present.
 * 
 * The default locale can also be set dynamically by providing a
 * {@link LocalizationPluginOptions#localeExtractor}.
 * 
 * Localized fields can be tagged with a @localized directive, making
 * it clearer to the API user if a field is localized or not.
 * 
 * In addition, by setting {@link LocalizationPluginOptions#verifyLocalized}
 * to `true`, the plugin requires all @localized fields to return
 * {@link LocalizedString} instances. This is best achieved by calling
 * {@link localized} before returning string and helps implementing resolvers
 * that follow the schema directives.
 */
export class LocalizationPlugin implements GraphQLPlugin {
    private directive?: GraphQLDirective;

    constructor(private readonly options: LocalizationPluginOptions) {
    }

    directives(): (string | DocumentNode)[] {
        return [gql`
        directive @localized on FIELD_DEFINITION
        directive @locale(code: String!) on QUERY
        `];
    }

    transforms(): SchemaTransform[] {
        return [
            (schema: GraphQLSchema) => mapSchema(schema, {
                [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
                    this.directive = schema.getDirective("locale") || undefined;

                    const directives = getDirectives(schema, fieldConfig);
                    if ("localized" in directives) {
                        let fieldType = fieldConfig?.astNode?.type;

                        while (fieldType?.kind === "ListType" || fieldType?.kind === "NonNullType") {
                            fieldType = fieldType.type;
                        }

                        if (fieldType?.kind !== "NamedType" || fieldType.name.value !== "String") {
                            throw new Error(`Localized fields must be strings, got ${fieldConfig.type}`);
                        }
                        const { resolve = defaultFieldResolver } = fieldConfig;
                        fieldConfig.resolve = async (source, args, context: L10nPluginContext, info) => {
                            const localized: LocalizedString = await resolve(source, args, context, info);

                            if (localized && !localized.locale) {
                                if (this.options.verifyLocalized) {
                                    throw new Error(`Field "${fieldConfig?.astNode?.name.value}" is not localized`);
                                }
                            }
                            return localized?.str ?? localized;
                        };

                    }
                    return fieldConfig;
                }
            })
        ];
    }

    wrapper = (next: Executable): Executable =>
        async (args: ExecutionArgs) => {
            const operation: OperationDefinitionNode | undefined =
                args.document.definitions
                    .find((def): def is OperationDefinitionNode => def.kind === "OperationDefinition");

            let localeCode = "";

            const localeDirective = operation?.directives?.find((directive) => directive.name.value === "locale");

            if (localeDirective) {
                if (!this.directive) {
                    throw new Error("Unexpected state, locale directive not found");
                }
                const directiveArgs = getArgumentValues(this.directive, localeDirective, args.variableValues || undefined);
                localeCode = directiveArgs.code;
            } else if (this.options.localeExtractor) {
                localeCode = await this.options.localeExtractor(args.contextValue);
            }

            if (localeCode === "" || localeCode === undefined) {
                localeCode = this.options.defaultLocale;
            }

            const context: L10nPluginContext = args.contextValue;
            context.l10nPlugin = {
                locale: localeCode
            };

            return next(args);
        };

}

export type DefaultLocaleExtractor = (ctx: ServiceContext) => MaybePromise<string>;

export interface LocalizedString {
    str: string;
    locale: string;
}

export function localized(str: string, locale: string): LocalizedString {
    return new class implements LocalizedString {
        constructor(public readonly str: string, public readonly locale: string) { }
    }(str, locale);
}

export function localeFromContext(ctx: ServiceContext): string {
    const context = ctx as L10nPluginContext;
    return context.l10nPlugin.locale;
}

export default LocalizationPlugin;

interface L10nPluginContext extends ServiceContext {
    l10nPlugin: {
        locale: string;
    }
}
