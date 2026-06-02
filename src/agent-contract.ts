import type { z } from "zod";
import type { Actor, SessionMetadata, SessionSource, ThreadEvent, ThreadStatus } from "./events.js";
import { WeaveError } from "./errors.js";
import type { AgentPlanner } from "./runner.js";
import type { AnyToolContract, ToolContract } from "./tool-contract.js";
import type { MaybePromise } from "./types.js";

export type ToolCallOptions = Record<string, unknown>;

type GateCreatedPayload = Extract<ThreadEvent, { type: "gate.created" }>["payload"];
type GateResolvedPayload = Extract<ThreadEvent, { type: "gate.resolved" }>["payload"];

export type GateRequest = {
  gateType?: GateCreatedPayload["gateType"];
  reason: GateCreatedPayload["reason"];
  relatedToolCallId?: string;
  proposedAction?: string;
};

export type GateResolution = GateResolvedPayload;

export type ThreadRef<Output = unknown> = {
  threadId: string;
  agentName: string;
  parentThreadId?: string;
  rootThreadId?: string;
  parentScopeKey?: string;
  parentStepKey?: string;
  status?: ThreadStatus;
  outputSchema?: z.ZodType<Output>;
  output?: Output;
};

export type SpawnOptions = {
  prompt?: string;
  source?: SessionSource;
  actor?: Actor;
  metadata?: SessionMetadata;
  detached?: boolean;
};

export type JoinOptions = {
  throwOnFailure?: boolean;
};

export type ChildrenOptions = {
  includeDetached?: boolean;
  agentName?: string | readonly string[];
  status?: ThreadStatus | readonly ThreadStatus[];
};

export type CancelChildOptions = {
  reason?: string;
  actor?: Actor;
};

export type AgentRun<Output = unknown> =
  | {
      status: "completed";
      thread: ThreadRef<Output>;
      output?: Output;
      outputSummary?: string;
    }
  | {
      status: "failed";
      thread: ThreadRef<Output>;
      errorCode: string;
      message: string;
    };

export type AgentEventMetadata = {
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
};

export type EventVisibility = "public" | "internal";

export type AgentEventInput<Type extends ThreadEvent["type"] = ThreadEvent["type"]> = Type extends ThreadEvent["type"]
  ? AgentEventMetadata & {
      type: Type;
      payload: Extract<ThreadEvent, { type: Type }>["payload"];
    }
  : never;

export type EventInstance<Type extends ThreadEvent["type"] = ThreadEvent["type"]> = AgentEventInput<Type>;

export type EventContract<Type extends ThreadEvent["type"] = ThreadEvent["type"]> = {
  type: Type;
  payload: z.ZodType<Extract<ThreadEvent, { type: Type }>["payload"]>;
  visibility?: EventVisibility;
  version?: number;
  description?: string;
};

export type EventFactory<Type extends ThreadEvent["type"] = ThreadEvent["type"]> = {
  readonly type: Type;
  readonly payload: z.ZodType<Extract<ThreadEvent, { type: Type }>["payload"]>;
  readonly visibility?: EventVisibility;
  readonly version?: number;
  readonly description?: string;
  (payload: Extract<ThreadEvent, { type: Type }>["payload"], metadata?: AgentEventMetadata): EventInstance<Type>;
};

export function defineEvent<const Type extends ThreadEvent["type"]>(contract: EventContract<Type>): EventFactory<Type>;
export function defineEvent<const Type extends ThreadEvent["type"]>(
  type: Type,
  payload: Extract<ThreadEvent, { type: Type }>["payload"],
  metadata?: AgentEventMetadata,
): AgentEventInput<Type>;
export function defineEvent<const Type extends ThreadEvent["type"]>(
  typeOrContract: Type | EventContract<Type>,
  payload?: Extract<ThreadEvent, { type: Type }>["payload"],
  metadata: AgentEventMetadata = {},
): AgentEventInput<Type> | EventFactory<Type> {
  if (typeof typeOrContract === "object") {
    const contract = typeOrContract;
    const factory = ((factoryPayload: Extract<ThreadEvent, { type: Type }>["payload"], factoryMetadata: AgentEventMetadata = {}) => {
      const result = contract.payload.safeParse(factoryPayload);
      if (!result.success) {
        throw new WeaveError("EVENT_PAYLOAD_INVALID", `Invalid payload for event ${contract.type}`, result.error);
      }

      return { ...factoryMetadata, type: contract.type, payload: result.data } as EventInstance<Type>;
    }) as unknown as EventFactory<Type>;
    Object.defineProperties(factory, {
      type: { value: contract.type, enumerable: true },
      payload: { value: contract.payload, enumerable: true },
      visibility: { value: contract.visibility, enumerable: true },
      version: { value: contract.version, enumerable: true },
      description: { value: contract.description, enumerable: true },
    });
    return factory;
  }

  if (payload === undefined) {
    throw new Error(`Event payload is required for ${typeOrContract}`);
  }

  const type = typeOrContract;
  return { ...metadata, type, payload } as AgentEventInput<Type>;
}

export const event = defineEvent;

export type AgentContext<
  Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
> = {
  readonly threadId: string;
  readonly actor: Actor;
  readonly signal: AbortSignal;
  tool<Input, Output>(
    key: string,
    tool: ToolContract<string, Input, Output>,
    input: Input,
    options?: ToolCallOptions,
  ): Promise<Output>;
  gate(key: string, request: GateRequest): Promise<GateResolution>;
  spawn<Input extends SessionMetadata, Output>(
    key: string,
    agent: AgentContract<string, Input, Output>,
    input: Input,
    options?: SpawnOptions,
  ): Promise<ThreadRef<Output>>;
  join<Output>(key: string, thread: ThreadRef<Output>, options?: JoinOptions): Promise<AgentRun<Output>>;
  cancelChild(key: string, thread: ThreadRef, options?: CancelChildOptions): Promise<void>;
  children(options?: ChildrenOptions): Promise<readonly ThreadRef[]>;
  checkpoint<Value>(key: string, compute: () => MaybePromise<Value>): Promise<Value>;
  emit(key: string, event: EventInstance): Promise<void>;
  id(key: string): string;
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
