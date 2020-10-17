import Koa from "koa";
import gql from "graphql-tag";

import { makeServerMiddleware, CachePlugin, TracePlugin } from "../src";

const app = new Koa();

const graphqlServer = makeServerMiddleware({
    typedefs: [
        gql`
            type Query {
                version: String! @cache(ttl: SHORT)
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
    plugins: [new TracePlugin(), new CachePlugin()],
    playgroundEndpoint: "/playground",
});

app.use(graphqlServer);
const server = app.listen(3000).on("listening", () => {
    console.log("Up and running at:", server.address());
});
