import { SchemaTransform } from "@graphql-tools/utils";
import { DocumentNode, ExecutionArgs, ExecutionResult } from "graphql";
import { Middleware } from "koa";

/**
 * A GraphQL server plugin.
 *
 * Provides new directives (or types) and `graphql-tools` style schema
 * transforms.
 *
 * Can optionally extend the GraphQL `execute` method by providing
 * a `wrapper`, and/or intercept the whole request by providing a
 * Koa middleware.
 * 
 * As with regular middleware, the execution order of plugins matter.
 */
export interface GraphQLPlugin {
    directives(): (DocumentNode | string)[];
    transforms(): SchemaTransform[];
    wrapper?: Wrapper;
    middleware?: Middleware;
}

export type MaybePromise<T> = Promise<T> | T;
export type ExecutableResult = MaybePromise<ExecutionResult>;
export type Executable = (args: ExecutionArgs) => ExecutableResult;
export type Wrapper = (next: Executable) => Executable;
