
import bodyParser from "koa-bodyparser";
import { errorHandler } from "graphql-api-koa";
import koaRouter, { RouterParamContext } from "@koa/router";
import koaPlayground from "graphql-playground-middleware-koa";

import { Middleware, ParameterizedContext, DefaultState, DefaultContext } from "koa";
import { ITypedef, IResolvers } from "@graphql-tools/utils";
import { Executable, GraphQLPlugin, Wrapper } from "./GraphQLPlugin";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { execute, ExecuteOptions } from "graphql-api-koa";
import { execute as graphqlExecute } from "graphql";

type Rec = Record<string, unknown>;
export interface ServiceContext<StateT = DefaultState, CustomT = DefaultContext> extends Rec {
    ctx: ParameterizedContext<StateT, CustomT>;
}

interface GraphQLServerOptions<ContextT extends ServiceContext<StateT, CustomT>, StateT, CustomT> {
    typedefs: ITypedef[];
    resolvers: IResolvers<Rec, ContextT>[];
    plugins?: GraphQLPlugin[];
    // Server endpoint path. Default is "/graphql".
    serverEndpoint?: string;
    // Playground endpoint path. Default is no playground.
    playgroundEndpoint?: string;
    // Per-request context setup hook. Default is passthrough of Koa context.
    context?: (ctx: ParameterizedContext<StateT, CustomT>) => ContextT;
}

export function makeServerMiddleware<ContextT extends ServiceContext<StateT, CustomT>, StateT = Rec, CustomT = Rec>(
    options: GraphQLServerOptions<ContextT, StateT, CustomT>
): Middleware<StateT, CustomT & RouterParamContext<StateT, CustomT>> {
    const schema = makeExecutableSchema(
        {
            typeDefs: [
                ...options.typedefs,
                ...(options.plugins ? options.plugins.map((plugin) => plugin.directives()).flat() : []),
            ],
            schemaTransforms: [
                ...(options.plugins ? options.plugins.map((plugin) => plugin.transforms()).flat() : []),
            ],
            resolvers: options.resolvers,
        }
    );

    const executor = options.plugins
        ?.map((plugin) => plugin.wrapper)
        .filter<Wrapper>((wrapper): wrapper is Wrapper => (wrapper != null))
        .reduce<Executable>((executable, wrapper) => wrapper(executable), graphqlExecute);

    const pluginMiddlewares = options.plugins
        ?.map((plugin) => plugin.middleware)
        .filter((middleware): middleware is Middleware => (middleware != null)) ?? [];

    const executeOptions: ExecuteOptions = {
        schema,
    };

    if (executor) {
        executeOptions.execute = executor;
    }

    const serverMiddleware = [
        ...pluginMiddlewares,
        execute({
            ...executeOptions,
            override: (ctx: ParameterizedContext<StateT, CustomT>): Partial<ExecuteOptions> => {
                let contextValue = {
                    ctx
                };
                if (options.context) {
                    contextValue = options.context(ctx);
                }
                return {
                    contextValue
                };
            },
        }),
    ];

    const graphqlRouter = new koaRouter<StateT, CustomT>();
    graphqlRouter
        .use(errorHandler())
        .use(bodyParser({
            extendTypes: {
                json: ["application/graphql+json"]
            }
        }));

    const serverEndpoint = options.serverEndpoint ?? "/graphql";

    if (options.playgroundEndpoint) {
        graphqlRouter.get(
            options.playgroundEndpoint,
            koaPlayground({
                endpoint: serverEndpoint
            }),
        );
    }

    graphqlRouter.all(
        serverEndpoint,
        ...serverMiddleware,
    );

    return graphqlRouter.middleware();
}
