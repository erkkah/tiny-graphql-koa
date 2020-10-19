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

                    fieldConfig.resolve = async (source, args, context: TraceContext, info) => {
                        const start = process.hrtime.bigint();
                        const path = buildPath(info.path);

                        const result = resolve(source, args, context, info);

                        const end = process.hrtime.bigint();

                        const trace: ResolverTrace = {
                            path,
                            parentType: info.parentType.name,
                            fieldName: info.fieldName,
                            returnType: info.returnType.toString(),
                            startOffset: Number(start - context.ctx.requestStart),
                            duration: Number(end - start),
                        };

                        const traces: ResolverTrace[] = context.ctx.traces;
                        traces.push(trace);
                        return result;
                    };
                    return fieldConfig;
                }
            }),
        ];
    }

    middleware: Middleware = async (ctx, next) => {
        ctx.requestStart = process.hrtime.bigint();
        ctx.traces = [];
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
            duration: Number(requestEnd - ctx.requestStart),
            execution: {
                resolvers: ctx.traces,
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

interface TraceContext extends ServiceContext {
    ctx: ParameterizedContext & {
        requestStart: bigint;
        traces: ResolverTrace[];
    }
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
