import Koa from "koa";
import gql from "graphql-tag";

import { makeServerMiddleware } from "../src/GraphQLServer";
import { CachePlugin } from "../src/CachePlugin";
import { TracePlugin } from "../src/TracePlugin";

async function main() {

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
    app.listen(3000);
}

main().then(() => {
    console.log("Running!");
}).catch((error) => {
    console.log(`Error: ${error}`);
});
