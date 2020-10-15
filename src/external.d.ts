
declare module "graphql-api-koa" {
    import { Middleware, ParameterizedContext } from "koa";
    import { GraphQLSchema, ExecutionArgs, ExecutionResult } from "graphql";

    export function errorHandler(): Middleware;

    export interface ExecuteOptions {
        schema?: GraphQLSchema;
        rootValue?: unknown;
        contextValue?: unknown;
        fieldResolver?: unknown;
        execute?(args: ExecutionArgs): Promise<ExecutionResult> | ExecutionResult;
    }

    export function execute<StateT, CustomT = Record<string, unknown>>(
        options: ExecuteOptions & {
            override?: (ctx: ParameterizedContext<StateT, CustomT>) => Partial<ExecuteOptions>;
        }
    ): Middleware<StateT, CustomT>;

}

declare module "canonicalize" {
    export default function canonicalize(obj: Record<string, unknown>): string;
}
