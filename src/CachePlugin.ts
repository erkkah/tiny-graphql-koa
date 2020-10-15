import {
    defaultFieldResolver,
    DirectiveNode,
    DocumentNode,
    ExecutionArgs,
    getNamedType,
    GraphQLInterfaceType,
    GraphQLObjectType,
    GraphQLSchema,
    OperationDefinitionNode,
    ResponsePath
} from "graphql";

import { SchemaTransform, mapSchema, MapperKind, getDirectives } from "@graphql-tools/utils";
import gql from "graphql-tag";
import canonicalize from "canonicalize";
import { createHash } from "crypto";

import { Executable, ExecutableResult, GraphQLPlugin } from "./GraphQLPlugin";

type CacheScope = "PUBLIC" | "PRIVATE";
type CacheTTL = "SHORT" | "MID" | "LONG";

/**
 * Interface of the cache service used to back the plugin.
 */
export interface StringCache {
    get(key: string): string | undefined;
    put(key: string, value: string, ttl: number): void;
}

/**
 * Response cache plugin, adapted from the Apollo response cache.
 */
export class CachePlugin implements GraphQLPlugin {
    private readonly cache: StringCache;
    private readonly ttlToSeconds: { [key in CacheTTL]: number } = {
        SHORT: 30,
        MID: 300,
        LONG: 3600,
    }

    constructor(conf?: { cache?: StringCache, ttlConfig?: { [key in CacheTTL]: number } }) {
        this.ttlToSeconds = {
            ...this.ttlToSeconds,
            ...conf?.ttlConfig
        };
        this.cache = conf?.cache || new InMemoryCache();
    }

    directives(): (DocumentNode | string)[] {
        return [gql`
        enum CacheScope {
            PUBLIC,
            PRIVATE
        }

        enum CacheTTL {
            SHORT,
            MID,
            LONG
        }

        directive @cache(ttl: CacheTTL!, scope: CacheScope! = PUBLIC) on FIELD_DEFINITION
        directive @noCache on QUERY
        `];
    }

    transforms(): SchemaTransform[] {
        return [
            (schema: GraphQLSchema) => mapSchema(schema, {
                [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
                    const directives = getDirectives(schema, fieldConfig);
                    if ("cache" in directives) {
                        const { resolve = defaultFieldResolver } = fieldConfig;

                        fieldConfig.resolve = async (source, args, context, info) => {
                            const hints: MapResponsePathHints = context.hints;
                            let hint: CacheHint = {};
                            const ttlDefault = 0;

                            // If this field's resolver returns an object or interface, look for
                            // hints on that return type.
                            const targetType = getNamedType(info.returnType);
                            if (targetType.astNode &&
                                (
                                    targetType instanceof GraphQLObjectType ||
                                    targetType instanceof GraphQLInterfaceType
                                )) {
                                hint = mergeHints(
                                    hint,
                                    this.hintFromDirectives(targetType.astNode.directives)
                                );
                            }

                            // Look for hints on the field itself (on its parent type), taking
                            // precedence over previously calculated hints.
                            const fieldDef = info.parentType.getFields()[info.fieldName];
                            if (fieldDef.astNode) {
                                hint = mergeHints(
                                    hint,
                                    this.hintFromDirectives(fieldDef.astNode.directives),
                                );
                            }

                            // If this resolver returns an object or is a root field and we haven't
                            // seen an explicit ttl hint, set the ttl to 0 (uncached) or the
                            // default if specified in the constructor. (Non-object fields by
                            // default are assumed to inherit their cacheability from their parents.
                            // But on the other hand, while root non-object fields can get explicit
                            // hints from their definition on the Query/Mutation object, if that
                            // doesn't exist then there's no parent field that would assign the
                            // default ttl, so we do it here.)
                            if (
                                (targetType instanceof GraphQLObjectType ||
                                    targetType instanceof GraphQLInterfaceType ||
                                    !info.path.prev) &&
                                hint.ttl === undefined
                            ) {
                                hint.ttl = ttlDefault;
                            }

                            if (hint.ttl !== undefined || hint.scope !== undefined) {
                                addHint(hints, info.path, hint);
                            }

                            return resolve(source, args, context, info);
                        };
                    }
                    return fieldConfig;
                },
            }),
        ];
    }

    wrapper = (next: Executable): Executable => {

        return async (args: ExecutionArgs) => {
            const operation: OperationDefinitionNode | undefined =
                args.document.definitions
                    .find((def): def is OperationDefinitionNode => def.kind === "OperationDefinition");

            const isQuery = operation?.operation === "query";
            const shouldCache = !(operation?.directives?.find((directive) => directive.name.value === "noCache") != undefined);

            let key = "";
            let hints: MapResponsePathHints | undefined;

            if (isQuery) {
                const source = args.document.loc?.source.body;
                const variables = args.variableValues;
                const operationName = args.operationName;

                const keyData = {
                    source,
                    variables,
                    operationName,
                };

                const keyString = canonicalize(keyData);
                key = sha(keyString);

                if (shouldCache) {
                    const cached = this.cache.get(key);
                    if (cached) {
                        const unpacked = JSON.parse(cached);
                        return unpacked;
                    }
                }

                hints = new Map();
                args.contextValue.hints = hints;
            }

            const result = next(args);
            const resultValue: ExecutableResult = (result instanceof Promise) ? await result : result;

            if (!resultValue.errors && isQuery && hints) {
                const policy = computeOverallCachePolicy(hints);
                if (policy) {
                    const serialized = JSON.stringify(resultValue);
                    this.cache.put(key, serialized, policy.ttl);
                }
            }
            return resultValue;
        };
    }

    hintFromDirectives(
        directives: ReadonlyArray<DirectiveNode> | undefined,
    ): CacheHint | undefined {
        if (!directives) return undefined;

        const cacheControlDirective = directives.find(
            directive => directive.name.value === "cache",
        );
        if (!cacheControlDirective?.arguments) return undefined;

        const ttlArgument = cacheControlDirective.arguments.find(
            argument => argument.name.value === "ttl",
        );

        const scopeArgument = cacheControlDirective.arguments.find(
            argument => argument.name.value === "scope",
        );

        const ttl = ttlArgument?.value?.kind === "EnumValue"
            ? this.ttlToSeconds[ttlArgument.value.value as CacheTTL]
            : undefined;

        const scope = scopeArgument?.value?.kind === "EnumValue"
            ? (scopeArgument.value.value as CacheScope)
            : "PUBLIC";

        return {
            ttl,
            scope,
        };
    }

}

interface CacheHint {
    ttl?: number;
    scope?: CacheScope;
}

type MapResponsePathHints = Map<ResponsePath, CacheHint>;

function sha(s: string) {
    return createHash("sha256")
        .update(s)
        .digest("hex");
}

function mergeHints(
    hint: CacheHint,
    otherHint: CacheHint | undefined,
): CacheHint {
    if (!otherHint) return hint;

    return {
        ttl: otherHint.ttl !== undefined ? otherHint.ttl : hint.ttl,
        scope: otherHint.scope || hint.scope,
    };
}

function computeOverallCachePolicy(
    hints: MapResponsePathHints,
): Required<CacheHint> | undefined {
    let lowestMaxAge: number | undefined = undefined;
    let scope: CacheScope = "PUBLIC";

    for (const hint of hints.values()) {
        if (hint.ttl !== undefined) {
            lowestMaxAge =
                lowestMaxAge !== undefined
                    ? Math.min(lowestMaxAge, hint.ttl)
                    : hint.ttl;
        }
        if (hint.scope === "PRIVATE") {
            scope = "PRIVATE";
        }
    }

    return lowestMaxAge
        ? {
            ttl: lowestMaxAge,
            scope,
        }
        : undefined;
}

function addHint(hints: MapResponsePathHints, path: ResponsePath, hint: CacheHint) {
    const existingCacheHint = hints.get(path);
    if (existingCacheHint) {
        hints.set(path, mergeHints(existingCacheHint, hint));
    } else {
        hints.set(path, hint);
    }
}


interface CacheEntry {
    value: string;
    expiry: number;
}

class InMemoryCache implements StringCache {
    private entries = new Map<string, CacheEntry>();

    get(key: string): string | undefined {
        const found = this.entries.get(key);
        if (found) {
            const now = new Date();
            if (now.getTime() > found.expiry) {
                this.entries.delete(key);
                return undefined;
            }
            return found.value;
        }
        return undefined;
    }

    put(key: string, value: string, ttl: number) {
        this.entries.set(key, {
            value,
            expiry: new Date().getTime() + ttl * 1000,
        });
    }
}
