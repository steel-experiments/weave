import type { z } from "zod";
import type { Actor, ThreadEvent } from "./events.js";
import type { AgentPlanner } from "./runner.js";
import type { AnyToolContract, ToolCompletionOutput, ToolContract } from "./tool-contract.js";
import type { MaybePromise } from "./types.js";

export type ToolCallOptions = Record<string, unknown>;

export type AgentEventInput = {
  type: ThreadEvent["type"];
  payload: ThreadEvent["payload"];
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
};

export type AgentContext<
  Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
> = {
  readonly threadId: string;
  readonly actor: Actor;
  readonly signal: AbortSignal;
  tool<Input, Output extends ToolCompletionOutput>(
    key: string,
    tool: ToolContract<string, Input, Output>,
    input: Input,
    options?: ToolCallOptions,
  ): Promise<Output>;
  emit(key: string, event: AgentEventInput): Promise<void>;
  uuid(key: string): string;
};

export type AgentContract<
  Name extends string = string,
  Input = unknown,
  Output = unknown,
  Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
> = {
  name: Name;
  description?: string;
  input?: z.ZodType<Input>;
  output?: z.ZodType<Output>;
  tools?: Tools;
  run?: (context: AgentContext<Tools>, input: Input) => MaybePromise<Output>;
  planner?: AgentPlanner;
};

export type AnyAgentContract = AgentContract<string, any, any, readonly AnyToolContract[]>;

export function defineAgent<
  const Name extends string,
  Input,
  Output,
  const Tools extends readonly AnyToolContract[],
>(contract: AgentContract<Name, Input, Output, Tools>): AgentContract<Name, Input, Output, Tools> {
  if (!contract.run && !contract.planner) {
    throw new Error(`Agent must define either run or planner: ${contract.name}`);
  }
  return contract;
}

export const agent = defineAgent;

export type AgentToolName<Agent extends AnyAgentContract> = NonNullable<Agent["tools"]>[number]["name"];
