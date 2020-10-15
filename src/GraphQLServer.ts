
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

interface GraphQLServerOptions {
    typedefs: ITypedef[];
    resolvers: IResolvers[];
    plugins?: GraphQLPlugin[];
    serverEndpoint?: string;
    playgroundEndpoint?: string;
}

export function makeServerMiddleware<C, T>(options: GraphQLServerOptions): Middleware<C, T & IRouterParamContext<C, T>> {
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
            override: (ctx: ParameterizedContext<C, T>): Partial<ExecuteOptions> => {
                return {
                    contextValue: ctx,
                };
            },
        }),
    ];

    const graphqlRouter = new koaRouter<C, T>();
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
