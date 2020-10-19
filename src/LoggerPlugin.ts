import { DocumentNode, ExecutionArgs, OperationDefinitionNode } from "graphql";
import { SchemaTransform } from "@graphql-tools/utils";

import { GraphQLPlugin, Executable } from ".";

type LogFunction = (...msg: string[]) => void;
interface LeveledLogger {
    error?: LogFunction;
    info?: LogFunction;
    debug?: LogFunction;
}

interface LoggerPluginOptions {
    logger?: LogFunction;
    leveled?: LeveledLogger;
    logQueries?: boolean;
    debugLogFullQueries?: boolean;
}

/**
 * Logs errors that occur during query execution, including those that
 * are filtered by the `graphql-api-koa` errorHandler.
 */
export class LoggerPlugin implements GraphQLPlugin {
    constructor(private readonly options: LoggerPluginOptions = { logger: console.log }) {
        if (!options.leveled && !options.logger) {
            options.logger = console.log;
        }
    }

    directives(): (string | DocumentNode)[] {
        return [];
    }

    transforms(): SchemaTransform[] {
        return [];
    }

    wrapper = (next: Executable): Executable =>
        async (args: ExecutionArgs) => {
            try {
                let requestStart = BigInt(0);

                if (this.options.debugLogFullQueries) {
                    this.debug(args.document.loc?.source?.body || "");
                }

                if (this.options.logQueries) {
                    requestStart = process.hrtime.bigint();
                }

                const result = await next(args);
                if (result.errors) {
                    const messages = result.errors.map((error) => `Error at "${error.path?.join(".")}": ${error.stack || error.message}`);
                    this.error(...messages);
                }

                if (this.options.logQueries) {
                    const duration = Number(process.hrtime.bigint() - requestStart) / 1E6;
                    const operations = args.document.definitions
                        .filter((def): def is OperationDefinitionNode => def.kind === "OperationDefinition")
                        .map((opDef: OperationDefinitionNode) => opDef.operation)
                        .join(", ");
                    this.info(`Executed ${operations} with ${result.errors ? "errors" : "success"} in ${duration.toPrecision(4)}ms`);
                }
                return result;
            } catch (error) {
                this.error(error);
                throw error;
            }
        };

    private error(...messages: string[]): void {
        const logger = this.options.leveled?.error || this.options.logger;
        logger?.(...messages);
    }

    private info(...messages: string[]): void {
        const logger = this.options.leveled?.info || this.options.logger;
        logger?.(...messages);
    }

    private debug(...messages: string[]): void {
        const logger = this.options.leveled?.debug || this.options.logger;
        logger?.(...messages);
    }

}

export default LoggerPlugin;
