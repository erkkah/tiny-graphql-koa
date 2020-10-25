import Koa from "koa";
import gql from "graphql-tag";

import { makeServerMiddleware, CachePlugin, TracePlugin, AuthPlugin } from "../src";

const app = new Koa();

const graphqlServer = makeServerMiddleware({
    typedefs: [
        gql`
            type Query {
                version: String! @cache(ttl: SHORT) @a11n(level: PUBLIC)
            }
        `,
    ],
    resolvers: [
        {
            Query: {
                version: () => "1.2.3"
            }
        }
    ],
    plugins: [new TracePlugin(), new CachePlugin(), new AuthPlugin(
        {
            levelExtractor: () => {
                // Today, everyone is admin!
                return "ADMIN";
            }
        }
    )],
    playgroundEndpoint: "/playground",
});

app.use(graphqlServer);
const server = app.listen(3000).on("listening", () => {
    console.log("Up and running at:", server.address());
});
