import { SchemaTransform } from "@graphql-tools/utils";
import { DocumentNode, ExecutionArgs, ExecutionResult } from "graphql";
import { Middleware } from "koa";

type MaybePromise<T> = Promise<T> | T;

export type ExecutableResult = MaybePromise<ExecutionResult>;
export type Executable = (args: ExecutionArgs) => ExecutableResult;
export type Wrapper = (next: Executable) => Executable;

export interface GraphQLPlugin {
    directives(): (DocumentNode | string)[];
    transforms(): SchemaTransform[];
    wrapper?: Wrapper;
    middleware?: Middleware;
}
