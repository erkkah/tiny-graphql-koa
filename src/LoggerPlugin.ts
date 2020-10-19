import { DocumentNode, ExecutionArgs } from "graphql";
import { SchemaTransform } from "@graphql-tools/utils";

import { GraphQLPlugin, Executable } from ".";

type LogFunction = (...msg: string[]) => void;

export class LoggerPlugin implements GraphQLPlugin {
    constructor(private readonly logger: LogFunction = console.log) { }

    directives(): (string | DocumentNode)[] {
        return [];
    }

    transforms(): SchemaTransform[] {
        return [];
    }

    wrapper = (next: Executable): Executable =>
        async (args: ExecutionArgs) => {
            try {
                const result = await next(args);
                if (result.errors) {
                    const messages = result.errors.map((error) => `Error at "${error.path?.join(".")}": ${error.stack || error.message}`);
                    this.logger(...messages);
                }
                return result;
            } catch (error) {
                this.logger(error);
                throw error;
            }
        };
}

export default LoggerPlugin;
