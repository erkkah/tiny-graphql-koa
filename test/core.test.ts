import { strict as assert } from "assert";
import { Server } from "http";
import Koa, { Middleware } from "koa";
import gql from "graphql-tag";
import { DocumentNode } from "graphql";
import {
    AuthPlugin,
    GraphQLPlugin,
    LoggerPlugin,
    makeServerMiddleware,
} from "../src";

import { GraphQLClient } from "./client";
import { IResolvers, ITypedef } from "@graphql-tools/utils";

describe("GraphQLServer", () => {
    let server: Server | undefined;
    let koa: Koa | undefined;

    beforeEach(() => {
        koa = new Koa();
        koa.on("error", (err) => console.log(err));
        server = koa.listen();
        server.on("error", (err) => console.log(err));
    });

    afterEach(() => {
        server?.close();
    });

    function call<T>(
        q: DocumentNode,
        variables: Record<string, unknown> = {}
    ): Promise<T> {
        assert(server);

        const address = server.address();
        assert(address);
        assert(typeof address !== "string");

        const url = `http://localhost:${address.port}/graphql`;

        const client = new GraphQLClient(url);
        return client.request(q, variables);
    }

    function use<S, C>(middleware: Middleware<S, C>) {
        assert(koa);
        koa.use(middleware);
    }

    function make(
        typedef: ITypedef,
        resolver: IResolvers,
        plugins?: Array<GraphQLPlugin>
    ): ReturnType<typeof makeServerMiddleware> {
        return makeServerMiddleware({
            typedefs: [typedef],
            resolvers: [resolver],
            plugins,
        });
    }

    function setup(
        typedef: ITypedef,
        resolver: IResolvers,
        plugins?: GraphQLPlugin[]
    ) {
        use(make(typedef, resolver, plugins));
    }

    it("starts", async () => {
        setup(
            gql`
                type Query {
                    hello: String!
                }
            `,

            {
                Query: {
                    hello: () => "world",
                },
            }
        );

        const response = await call(gql`
            query {
                hello
            }
        `);
        expect(response).toEqual({ hello: "world" });
    });

    test("AuthPlugin default level", async () => {
        setup(
            gql`
                type Query {
                    no: String!
                    hello: String! @a11n(level: PUBLIC)
                }
            `,

            {
                Query: {
                    no: () => "access",
                    hello: () => "world",
                },
            },

            [
                new LoggerPlugin(),
                new AuthPlugin({
                    levelExtractor: () => "PUBLIC",
                    defaultLevel: "GOD",
                }),
            ]
        );

        await expect(
            call(gql`
                query {
                    no
                }
            `)
        ).rejects.toMatchObject(new Error("GraphQL Error: No access"));

        await expect(
            call(gql`
                query {
                    hello
                }
            `)
        ).resolves.toEqual({ hello: "world" });
    });

    test("AuthPlugin role argument", async () => {
        setup(
            gql`
                type Query {
                    no: String! @a11n(role: "king")
                    hello: String! @a11n(role: "pawn")
                }
            `,

            {
                Query: {
                    no: () => "access",
                    hello: () => "world",
                },
            },

            [
                new LoggerPlugin(),
                new AuthPlugin({
                    levelExtractor: () => "PUBLIC",
                    defaultLevel: "PUBLIC",
                    roles: {
                        pawn: "PUBLIC",
                        king: "GOD",
                    },
                }),
            ]
        );

        await expect(
            call(gql`
                query {
                    no
                }
            `)
        ).rejects.toMatchObject(new Error("GraphQL Error: No access"));

        await expect(
            call(gql`
                query {
                    hello
                }
            `)
        ).resolves.toEqual({ hello: "world" });
    });
});
