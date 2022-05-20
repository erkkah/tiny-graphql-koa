import Koa from "koa";
import gql from "graphql-tag";

import {
    makeServerMiddleware,
    CachePlugin,
    TracePlugin,
    AuthPlugin,
    LoggerPlugin,
    LocalizationPlugin,
    LocalizedString,
    localized,
    localeFromContext
} from "../src";

const app = new Koa();

const graphqlServer = makeServerMiddleware({
    typedefs: [
        gql`
            type SecretObject @a11n(level: ADMIN2) {
                number: Int!
            }

            type Query {
                version: String! @cache(ttl: SHORT) @a11n(level: PUBLIC)
                secret: SecretObject!
                localizedString: String! @localized
            }
        `,
    ],
    resolvers: [
        {
            Query: {
                version: () => "1.2.3",
                secret: () => ({
                    number: 4711
                }),
                localizedString: (_parent, _args, ctx): string | LocalizedString => {
                    const locale = localeFromContext(ctx);
                    if (locale === "sv") {
                        return localized("Tjena!", "sv");
                    } else if (locale === "debug") {
                        return "Not a localized string";
                    } else {
                        return localized("Hi there!", "en");
                    }
                }
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
    ),
    new LocalizationPlugin({
        defaultLocale: "en",
        verifyLocalized: true
    }),
    new LoggerPlugin(),
    ],
    playgroundEndpoint: "/playground",
});

app.use(graphqlServer);
const server = app.listen(3030).on("listening", () => {
    console.log("Up and running at:", server.address());
});
