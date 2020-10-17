# graphql-server-koa

A tiny GraphQL server middleware for Koa, built on the [graphql-api-koa](https://github.com/jaydenseric/graphql-api-koa) middleware.

Reduces the steps to get up and running, and provides plugin support to extend the GraphQL server functionality.

Includes two plugins, [TracePlugin](./src/TracePlugin.ts) &mdash; providing [Apollo Tracing](https://github.com/apollographql/apollo-tracing) support, and [CachePlugin](./src/CachePlugin.ts) &mdash; a full response cache.

Example using both plugins:

```typescript
import Koa from "koa";
import gql from "graphql-tag";

import { makeServerMiddleware } from "../src/GraphQLServer";
import { CachePlugin } from "../src/CachePlugin";
import { TracePlugin } from "../src/TracePlugin";

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
```
