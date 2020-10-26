import { SchemaTransform, mapSchema, MapperKind } from "@graphql-tools/utils";
import { defaultFieldResolver, DocumentNode, GraphQLSchema } from "graphql";
import { Path } from "graphql/jsutils/Path";
import { Middleware, ParameterizedContext } from "koa";
import { GraphQLPlugin } from "./GraphQLPlugin";
import { ServiceContext } from "./GraphQLServer";


/**
 * Plugin implementing Apollo Tracing.
 */
export class TracePlugin implements GraphQLPlugin {
    directives(): (string | DocumentNode)[] {
        return [];
    }

    transforms(): SchemaTransform[] {
        return [
            (schema: GraphQLSchema) => mapSchema(schema, {
                [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
                    const { resolve = defaultFieldResolver } = fieldConfig;

                    fieldConfig.resolve = async (source, args, context: TracePluginContext, info) => {
                        const start = process.hrtime.bigint();
                        const path = buildPath(info.path);

                        const result = await resolve(source, args, context, info);

                        const end = process.hrtime.bigint();

                        const pluginContext = context.ctx.tracePlugin;
                        const trace: ResolverTrace = {
                            path,
                            parentType: info.parentType.name,
                            fieldName: info.fieldName,
                            returnType: info.returnType.toString(),
                            startOffset: Number(start - pluginContext.requestStart),
                            duration: Number(end - start),
                        };

                        const traces: ResolverTrace[] = pluginContext.traces;
                        traces.push(trace);
                        return result;
                    };
                    return fieldConfig;
                }
            }),
        ];
    }

    middleware: Middleware = async (ctx, next) => {
        const context = ctx as unknown as TraceContext;
        const traceContext = {
            requestStart: process.hrtime.bigint(),
            traces: [],
        };
        context.tracePlugin = traceContext;
        const startTime = new Date();
        await next();
        const requestEnd = process.hrtime.bigint();
        const endTime = new Date();
        const body = ctx.response.body;
        if (!body.extensions) {
            body.extensions = {};
        }
        const tracing: GraphQLTrace = {
            version: 1,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            duration: Number(requestEnd - traceContext.requestStart),
            execution: {
                resolvers: traceContext.traces,
            }
        };
        body.extensions.tracing = tracing;
    }
}

function buildPath(path: Path): string[] {
    const result: string[] = [];
    let here: Path | undefined = path;

    while (here) {
        result.unshift(path.key.toString());
        here = here.prev;
    }

    return result;
}

type TraceContext = ParameterizedContext & {
    tracePlugin: {
        requestStart: bigint;
        traces: ResolverTrace[];
    }
}

interface TracePluginContext extends ServiceContext {
    ctx: TraceContext;
}

interface ResolverTrace {
    path?: string[];
    parentType?: string;
    fieldName?: string;
    returnType?: string;
    startOffset: number;
    duration: number;
}

interface GraphQLTrace {
    version: number;
    startTime: string;
    endTime: string;
    duration: number;
    parsing?: {
        startOffset: number;
        duration: number;
    }
    validation?: {
        startOffset: number;
        duration: number;
    }
    execution?: {
        resolvers: ResolverTrace[];
    }
}

export default TracePlugin;
