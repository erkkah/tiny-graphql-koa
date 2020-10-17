
import bodyParser from "koa-bodyparser";
import { errorHandler } from "graphql-api-koa";
import koaRouter, { IRouterParamContext } from "koa-router";
import koaPlayground from "graphql-playground-middleware-koa";

import { Middleware, ParameterizedContext } from "koa";
import { ITypedef, IResolvers } from "@graphql-tools/utils";
import { Executable, GraphQLPlugin, Wrapper } from "./GraphQLPlugin";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { execute, ExecuteOptions } from "graphql-api-koa";
import { execute as graphqlExecute } from "graphql";

interface GraphQLServerOptions<ContextT, StateT, CustomT> {
    typedefs: ITypedef[];
    resolvers: IResolvers[];
    plugins?: GraphQLPlugin[];
    // Server endpoint path. Default is "/graphql".
    serverEndpoint?: string;
    // Playground endpoint path. Default is no playground.
    playgroundEndpoint?: string;
    // Per-request context setup hook. Default is passthrough of Koa context.
    context?: (ctx: ParameterizedContext<StateT, CustomT>) => ContextT;
}

export function makeServerMiddleware<ContextT, StateT, CustomT>(
    options: GraphQLServerOptions<ContextT, StateT, CustomT>
): Middleware<StateT, CustomT & IRouterParamContext<StateT, CustomT>> {
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
                if (options.context) {
                    return options.context(ctx);
                }
                return {
                    contextValue: ctx,
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
