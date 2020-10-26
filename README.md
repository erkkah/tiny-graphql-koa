# tiny-graphql-koa

A tiny GraphQL-serving middleware for Koa, built on the great [graphql-api-koa](https://github.com/jaydenseric/graphql-api-koa) middleware.

Reduces the steps to get up and running, and provides plugin support to extend the GraphQL server functionality.

Included plugins:

- [TracePlugin](./src/TracePlugin.ts) -- provides [Apollo Tracing](https://github.com/apollographql/apollo-tracing) support
- [CachePlugin](./src/CachePlugin.ts) -- a full response cache
- [LoggerPlugin](./src/LoggerPlugin.ts) -- base level logging plugin
- [AuthPlugin](./src/AuthPlugin.ts) -- schema defined authorization levels
- [LocalizationPlugin](./src/L10nPlugin.ts) -- query level localization directive

You can turn on the included [GraphQL playground](https://github.com/graphql/graphql-playground) by setting the `playgroundEndpoint` in the startup options.

## Getting started

Install using npm:

```console
$ npm add tiny-graphql-koa
```

Example using plugins and the playground:

```typescript
import Koa from "koa";
import gql from "graphql-tag";

import { makeServerMiddleware, CachePlugin, TracePlugin } from "tiny-graphql-koa";

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
