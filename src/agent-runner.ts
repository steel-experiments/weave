import type {
  AgentContract,
  AgentContext,
  AgentEventInput,
  AgentRun,
  AnyAgentContract,
  CancelChildOptions,
  ChildrenOptions,
  GateRequest,
  GateResolution,
  JoinOptions,
  SpawnOptions,
  ThreadRef,
} from "./agent-contract.js";
import {
  ChildThreadFailedError,
  ParallelDurableEffectError,
  PolicyDeniedError,
  ReplayMismatchError,
  ToolFailedError,
  WeaveError,
} from "./errors.js";
import {
  deterministicUuid,
  eventKey,
  nowIso,
  stableJsonHash,
  type Actor,
  type SessionMetadata,
  type ThreadEvent,
} from "./events.js";
import type { AgentPlan, AgentPlanner } from "./runner.js";
import type { ThreadService } from "./thread-service.js";
import type { ToolContract } from "./tool-contract.js";
import type { AnyPolicyRule, PolicyDecision, PolicyRequest } from "./policy-contract.js";

type SuspensionReason =
  | "tool-requested"
  | "tool-pending"
  | "gate-created"
  | "gate-pending"
  | "spawn-created"
  | "join-pending"
  | "cancel-child-created";

class AgentSuspended extends Error {
  constructor(
    readonly reason: SuspensionReason,
    readonly events: readonly ThreadEvent[],
  ) {
    super(reason);
    this.name = "AgentSuspended";
  }
}

export type CreateAgentPlannerOptions = {
  service?: ThreadService;
  policies?: readonly AnyPolicyRule[];
};

export function createAgentPlanner(
  agent: AnyAgentContract,
  agentName = agent.name,
  options: CreateAgentPlannerOptions = {},
): AgentPlanner {
  if (agent.run) {
    return new RunAgentPlanner(agent, agentName, options);
  }

  if (agent.planner) {
    return agent.planner;
  }

  throw new Error(`Agent must define either run or planner: ${agent.name}`);
}

class RunAgentPlanner implements AgentPlanner {
  constructor(
    private readonly agent: AgentContract,
    private readonly agentName: string,
    private readonly options: CreateAgentPlannerOptions,
  ) {}

  async plan(threadId: string, events: ThreadEvent[]): Promise<AgentPlan | null> {
    if (!this.agent.run || hasTerminalAgentResponse(events)) {
      return null;
    }

    const input = readAgentInput(this.agent, events);
    if (input === undefined) {
      return null;
    }

    const context = new ReplayAgentContext({
      agentName: this.agentName,
      threadId,
      events,
      service: this.options.service,
      policies: this.options.policies,
    });

    try {
      const rawOutput = await this.agent.run(context, input);
      const output = validateAgentOutput(this.agent, rawOutput);
      const plannedEvents = context.drainEvents();
      const outputSummary = formatAgentOutput(output);
      if (!plannedEvents.some((event) => event.type === "agent.response.produced")) {
        plannedEvents.push(context.responseEvent("agent-run-output", outputSummary));
      }
      if (output !== undefined) {
        plannedEvents.push(context.outputEvent("agent-run-output", output, outputSummary));
      }

      return toPlan(events, plannedEvents);
    } catch (error) {
      if (error instanceof AgentSuspended) {
        const parallelError = context.parallelDurableEffectError();
        if (parallelError) {
          throw parallelError;
        }
        return toPlan(events, [...context.drainEvents(), ...error.events]);
      }
      if (error instanceof ToolFailedError) {
        return null;
      }
      if (error instanceof PolicyDeniedError) {
        return toPlan(events, [...context.drainEvents(), context.failedEvent(error)]);
      }
      throw error;
    }
  }
}

class ReplayAgentContext implements AgentContext {
  readonly actor: Actor;
  readonly signal: AbortSignal;
  readonly scopeKey: string;

  private readonly pendingEvents: ThreadEvent[] = [];
  private readonly controller = new AbortController();
  private suspendedEffect: { kind: string; key: string } | undefined;
  private parallelEffectError: ParallelDurableEffectError | undefined;

  constructor(
    private readonly options: {
      agentName: string;
      threadId: string;
      events: readonly ThreadEvent[];
      service?: ThreadService;
      policies?: readonly AnyPolicyRule[];
    },
  ) {
    this.actor = { type: "agent", id: options.agentName };
    this.signal = this.controller.signal;
    this.scopeKey = `agent:${options.agentName}`;
  }

  get threadId(): string {
    return this.options.threadId;
  }

  async tool<Input, Output>(
    key: string,
    tool: ToolContract<string, Input, Output>,
    input: Input,
  ): Promise<Output> {
    const inputResult = tool.input.safeParse(input);
    if (!inputResult.success) {
      throw new WeaveError("TOOL_INPUT_INVALID", `Invalid input for tool ${tool.name}`, inputResult.error);
    }

    const matchingEvent = findEventByDurableIdentity(this.options.events, this.scopeKey, key);
    if (matchingEvent && matchingEvent.type !== "tool.requested") {
      throw new ReplayMismatchError("Durable step key was previously used for a different effect kind", {
        scopeKey: this.scopeKey,
        stepKey: key,
        existingType: matchingEvent.type,
        requestedType: "tool.requested",
      });
    }

    const request = matchingEvent?.type === "tool.requested" ? matchingEvent : undefined;
    if (request) {
      if (request.payload.toolName !== tool.name) {
        throw new ReplayMismatchError("Durable step key was previously used for a different tool", {
          scopeKey: this.scopeKey,
          stepKey: key,
          previousToolName: request.payload.toolName,
          nextToolName: tool.name,
        });
      }

      const terminal = findToolTerminalEvent(this.options.events, request.payload.toolCallId);
      if (terminal?.type === "tool.completed") {
        const outputResult = tool.output.safeParse(terminal.payload.output);
        if (!outputResult.success) {
          throw new ReplayMismatchError("Stored tool output failed the current output schema", {
            scopeKey: this.scopeKey,
            stepKey: key,
            toolName: tool.name,
            error: terminal.payload.output,
          });
        }
        return outputResult.data;
      }

      if (terminal?.type === "tool.failed") {
        throw new ToolFailedError(terminal.payload.message, {
          scopeKey: this.scopeKey,
          stepKey: key,
          toolName: tool.name,
          errorCode: terminal.payload.errorCode,
        });
      }

      this.suspend("tool", key, "tool-pending", []);
    }

    this.enforceToolPolicy(key, tool, inputResult.data);

    const requested = this.toolRequestedEvent(key, tool.name, inputResult.data);
    this.suspend("tool", key, "tool-requested", [requested]);
  }

  async emit(key: string, event: AgentEventInput): Promise<void> {
    const matchingEvent = findEventByDurableIdentity(this.options.events, this.scopeKey, key);
    if (matchingEvent) {
      if (matchingEvent.type !== event.type) {
        throw new ReplayMismatchError("Durable event key was previously used for a different event type", {
          scopeKey: this.scopeKey,
          stepKey: key,
          existingType: matchingEvent.type,
          requestedType: event.type,
        });
      }
      if (canonicalJson(matchingEvent.payload) !== canonicalJson(event.payload)) {
        throw new ReplayMismatchError("Durable event key was previously used with a different payload", {
          scopeKey: this.scopeKey,
          stepKey: key,
          eventType: event.type,
        });
      }
      return;
    }

    const cause = newestEvent([...this.options.events, ...this.pendingEvents]);
    this.pendingEvents.push({
      eventId: eventKey(this.threadId, event.type, `${this.scopeKey}:${key}`),
      threadId: this.threadId,
      type: event.type,
      occurredAt: nowIso(),
      correlationId: event.correlationId ?? cause?.correlationId,
      causationId: event.causationId ?? cause?.eventId,
      idempotencyKey: event.idempotencyKey,
      scopeKey: this.scopeKey,
      stepKey: key,
      actor: this.actor,
      payload: event.payload,
    } as ThreadEvent);
  }

  async gate(key: string, request: GateRequest): Promise<GateResolution> {
    const matchingEvent = findEventByDurableIdentity(this.options.events, this.scopeKey, key);
    if (matchingEvent && matchingEvent.type !== "gate.created") {
      throw new ReplayMismatchError("Durable step key was previously used for a different effect kind", {
        scopeKey: this.scopeKey,
        stepKey: key,
        existingType: matchingEvent.type,
        requestedType: "gate.created",
      });
    }

    const expectedPayload = this.gateCreatedPayload(key, request);
    const gateCreated = matchingEvent?.type === "gate.created" ? matchingEvent : undefined;
    if (gateCreated) {
      if (canonicalJson(gateCreated.payload) !== canonicalJson(expectedPayload)) {
        throw new ReplayMismatchError("Durable gate key was previously used with a different payload", {
          scopeKey: this.scopeKey,
          stepKey: key,
          eventType: "gate.created",
        });
      }

      const resolved = findGateResolvedEvent(this.options.events, gateCreated.payload.gateId);
      if (resolved) {
        return resolved.payload;
      }

      this.suspend("gate", key, "gate-pending", []);
    }

    this.suspend("gate", key, "gate-created", [this.gateCreatedEvent(key, request)]);
  }

  async spawn<Input extends SessionMetadata, Output>(
    key: string,
    childAgent: AgentContract<string, Input, Output>,
    input: Input,
    options: SpawnOptions = {},
  ): Promise<ThreadRef<Output>> {
    const inputResult = childAgent.input ? childAgent.input.safeParse(input) : { success: true as const, data: input };
    if (!inputResult.success) {
      throw new WeaveError("SPAWN_INPUT_INVALID", `Invalid input for child agent ${childAgent.name}`, inputResult.error);
    }

    const matchingEvent = findEventByDurableIdentity(this.options.events, this.scopeKey, key);
    if (matchingEvent && matchingEvent.type !== "child_thread.spawned") {
      throw new ReplayMismatchError("Durable step key was previously used for a different effect kind", {
        scopeKey: this.scopeKey,
        stepKey: key,
        existingType: matchingEvent.type,
        requestedType: "child_thread.spawned",
      });
    }

    const expected = this.spawnExpectedPayload(key, childAgent.name, inputResult.data, options);
    const spawned = matchingEvent?.type === "child_thread.spawned" ? matchingEvent : undefined;
    if (spawned) {
      const comparable = {
        childAgentName: spawned.payload.childAgentName,
        scopeKey: spawned.payload.scopeKey,
        stepKey: spawned.payload.stepKey,
        mode: spawned.payload.mode,
        inputHash: spawned.payload.inputHash,
        inputSummary: spawned.payload.inputSummary,
        metadata: spawned.payload.metadata,
      };
      if (canonicalJson(comparable) !== canonicalJson(expected)) {
        throw new ReplayMismatchError("Durable spawn key was previously used with different child work", {
          scopeKey: this.scopeKey,
          stepKey: key,
          eventType: "child_thread.spawned",
        });
      }

      return {
        threadId: spawned.payload.childThreadId,
        agentName: spawned.payload.childAgentName,
        parentThreadId: this.threadId,
        parentScopeKey: this.scopeKey,
        parentStepKey: key,
        ...(childAgent.output ? { outputSchema: childAgent.output } : {}),
      };
    }

    if (!this.options.service) {
      throw new WeaveError("SPAWN_SERVICE_UNAVAILABLE", "ctx.spawn requires ThreadService runtime binding", {
        scopeKey: this.scopeKey,
        stepKey: key,
        childAgentName: childAgent.name,
      });
    }

    await this.options.service.startChildSession({
      parentThreadId: this.threadId,
      agentName: childAgent.name,
      input: inputResult.data,
      prompt: options.prompt,
      source: options.source,
      actor: options.actor ?? this.actor,
      metadata: options.metadata,
      parentScopeKey: this.scopeKey,
      parentStepKey: key,
      detached: options.detached,
      idempotencyKey: `${this.scopeKey}:${key}`,
    });
    this.suspend("spawn", key, "spawn-created", []);
  }

  async join<Output>(key: string, thread: ThreadRef<Output>, options: JoinOptions = {}): Promise<AgentRun<Output>> {
    const matchingEvent = findEventByDurableIdentity(this.options.events, this.scopeKey, key);
    if (matchingEvent && matchingEvent.type !== "child_thread.completed" && matchingEvent.type !== "child_thread.failed") {
      throw new ReplayMismatchError("Durable step key was previously used for a different effect kind", {
        scopeKey: this.scopeKey,
        stepKey: key,
        existingType: matchingEvent.type,
        requestedType: "child_thread.completed|child_thread.failed",
      });
    }

    if (matchingEvent?.type === "child_thread.completed") {
      if (matchingEvent.payload.childThreadId !== thread.threadId) {
        throw new ReplayMismatchError("Durable join key was previously used for a different child thread", {
          scopeKey: this.scopeKey,
          stepKey: key,
          previousChildThreadId: matchingEvent.payload.childThreadId,
          nextChildThreadId: thread.threadId,
        });
      }

      let output: Output | undefined;
      if ("output" in matchingEvent.payload) {
        if (thread.outputSchema) {
          const outputResult = thread.outputSchema.safeParse(matchingEvent.payload.output);
          if (!outputResult.success) {
            throw new ReplayMismatchError("Joined child output failed the child agent output schema", {
              scopeKey: this.scopeKey,
              stepKey: key,
              childThreadId: thread.threadId,
              childAgentName: thread.agentName,
              error: outputResult.error,
            });
          }
          output = outputResult.data;
        } else {
          output = matchingEvent.payload.output as Output;
        }
      }

      return {
        status: "completed",
        thread,
        ...(output !== undefined ? { output } : {}),
        outputSummary: matchingEvent.payload.outputSummary,
      };
    }

    if (matchingEvent?.type === "child_thread.failed") {
      if (matchingEvent.payload.childThreadId !== thread.threadId) {
        throw new ReplayMismatchError("Durable join key was previously used for a different child thread", {
          scopeKey: this.scopeKey,
          stepKey: key,
          previousChildThreadId: matchingEvent.payload.childThreadId,
          nextChildThreadId: thread.threadId,
        });
      }

      if (options.throwOnFailure) {
        throw new ChildThreadFailedError(matchingEvent.payload.message, {
          scopeKey: this.scopeKey,
          stepKey: key,
          childThreadId: thread.threadId,
          errorCode: matchingEvent.payload.errorCode,
        });
      }

      return {
        status: "failed",
        thread,
        errorCode: matchingEvent.payload.errorCode,
        message: matchingEvent.payload.message,
      };
    }

    if (this.options.service) {
      await this.options.service.mirrorChildTerminalEvent({
        parentThreadId: this.threadId,
        childThreadId: thread.threadId,
        childAgentName: thread.agentName,
        parentScopeKey: this.scopeKey,
        parentStepKey: key,
      });
    }

    this.suspend("join", key, "join-pending", []);
  }

  async cancelChild(key: string, thread: ThreadRef, options: CancelChildOptions = {}): Promise<void> {
    const matchingEvent = findEventByDurableIdentity(this.options.events, this.scopeKey, key);
    if (matchingEvent && matchingEvent.type !== "child_thread.failed") {
      throw new ReplayMismatchError("Durable step key was previously used for a different effect kind", {
        scopeKey: this.scopeKey,
        stepKey: key,
        existingType: matchingEvent.type,
        requestedType: "child_thread.failed",
      });
    }

    if (matchingEvent?.type === "child_thread.failed") {
      if (matchingEvent.payload.childThreadId !== thread.threadId) {
        throw new ReplayMismatchError("Durable child cancellation key was previously used for a different child thread", {
          scopeKey: this.scopeKey,
          stepKey: key,
          previousChildThreadId: matchingEvent.payload.childThreadId,
          nextChildThreadId: thread.threadId,
        });
      }
      return;
    }

    if (!this.options.service) {
      throw new WeaveError("CANCEL_CHILD_SERVICE_UNAVAILABLE", "ctx.cancelChild requires ThreadService runtime binding", {
        threadId: this.threadId,
        scopeKey: this.scopeKey,
        stepKey: key,
        childThreadId: thread.threadId,
      });
    }

    await this.options.service.cancelChildThread({
      parentThreadId: this.threadId,
      childThreadId: thread.threadId,
      childAgentName: thread.agentName,
      parentScopeKey: this.scopeKey,
      parentStepKey: key,
      reason: options.reason,
      actor: options.actor ?? this.actor,
    });
    this.suspend("cancel-child", key, "cancel-child-created", []);
  }

  async children(options: ChildrenOptions = {}): Promise<readonly ThreadRef[]> {
    if (!this.options.service) {
      throw new WeaveError("CHILDREN_SERVICE_UNAVAILABLE", "ctx.children requires ThreadService runtime binding", {
        threadId: this.threadId,
        scopeKey: this.scopeKey,
      });
    }

    return this.options.service.listChildren(this.threadId, options);
  }

  async checkpoint<Value>(key: string, compute: () => Promise<Value> | Value): Promise<Value> {
    const matchingEvent = findEventByDurableIdentity(this.options.events, this.scopeKey, key);
    if (matchingEvent) {
      if (matchingEvent.type !== "checkpoint.completed") {
        throw new ReplayMismatchError("Durable step key was previously used for a different effect kind", {
          scopeKey: this.scopeKey,
          stepKey: key,
          existingType: matchingEvent.type,
          requestedType: "checkpoint.completed",
        });
      }
      return matchingEvent.payload.value as Value;
    }

    const value = await compute();
    const cause = newestEvent([...this.options.events, ...this.pendingEvents]);
    this.pendingEvents.push({
      eventId: eventKey(this.threadId, "checkpoint.completed", `${this.scopeKey}:${key}`),
      threadId: this.threadId,
      type: "checkpoint.completed",
      occurredAt: nowIso(),
      correlationId: cause?.correlationId,
      causationId: cause?.eventId,
      scopeKey: this.scopeKey,
      stepKey: key,
      actor: this.actor,
      payload: {
        scopeKey: this.scopeKey,
        stepKey: key,
        value,
      },
    });
    return value;
  }

  id(key: string): string {
    return deterministicUuid("agent-context", this.threadId, this.scopeKey, key);
  }

  uuid(key: string): string {
    return this.id(key);
  }

  drainEvents(): ThreadEvent[] {
    const drained = [...this.pendingEvents];
    this.pendingEvents.length = 0;
    return drained;
  }

  parallelDurableEffectError(): ParallelDurableEffectError | undefined {
    return this.parallelEffectError;
  }

  responseEvent(key: string, message: string): ThreadEvent {
    const cause = newestEvent([...this.options.events, ...this.pendingEvents]);
    return {
      eventId: eventKey(this.threadId, "agent.response.produced", `${this.scopeKey}:${key}`),
      threadId: this.threadId,
      type: "agent.response.produced",
      occurredAt: nowIso(),
      correlationId: cause?.correlationId,
      causationId: cause?.eventId,
      scopeKey: this.scopeKey,
      stepKey: key,
      actor: this.actor,
      payload: { message },
    };
  }

  outputEvent(key: string, output: unknown, summary?: string): ThreadEvent {
    const cause = newestEvent([...this.options.events, ...this.pendingEvents]);
    return {
      eventId: eventKey(this.threadId, "agent.output.completed", `${this.scopeKey}:${key}`),
      threadId: this.threadId,
      type: "agent.output.completed",
      occurredAt: nowIso(),
      correlationId: cause?.correlationId,
      causationId: cause?.eventId,
      scopeKey: this.scopeKey,
      stepKey: key,
      actor: this.actor,
      payload: {
        output,
        ...(summary ? { summary } : {}),
      },
    };
  }

  failedEvent(error: WeaveError): Extract<ThreadEvent, { type: "agent.failed" }> {
    const cause = newestEvent([...this.options.events, ...this.pendingEvents]);
    return {
      eventId: eventKey(this.threadId, "agent.failed", `${error.code}:${cause?.eventId ?? this.options.events.length}`),
      threadId: this.threadId,
      type: "agent.failed",
      occurredAt: nowIso(),
      correlationId: cause?.correlationId,
      causationId: cause?.eventId,
      scopeKey: this.scopeKey,
      stepKey: "agent-run-failed",
      actor: this.actor,
      payload: {
        errorCode: error.code,
        message: error.message,
      },
    };
  }

  private enforceToolPolicy<Input, Output>(key: string, tool: ToolContract<string, Input, Output>, input: Input): void {
    const existing = this.findPolicyEvaluation(key);
    if (existing) {
      this.validatePolicyEvaluation(key, tool, input, existing);
      this.applyStoredPolicyDecision(key, existing);
      return;
    }

    const policies = this.options.policies ?? [];
    if (policies.length === 0) {
      return;
    }

    const toolCallId = this.toolCallId(key, tool.name);
    const evaluation = evaluatePolicies(policies, {
      type: "tool",
      threadId: this.threadId,
      agentName: this.options.agentName,
      scopeKey: this.scopeKey,
      stepKey: key,
      toolName: tool.name,
      input,
      capabilities: tool.capabilities ?? [],
    });
    const policyEvent = this.policyEvaluatedEvent(key, tool, input, toolCallId, evaluation);
    this.pendingEvents.push(policyEvent);

    if (evaluation.decision.outcome === "allow") {
      return;
    }

    if (evaluation.decision.outcome === "deny") {
      throw new PolicyDeniedError(evaluation.decision.reason, {
        policyName: evaluation.policyName,
        scopeKey: this.scopeKey,
        stepKey: key,
        toolName: tool.name,
      });
    }

    this.suspend("policy", this.policyGateStepKey(key), "gate-created", [
      this.gateCreatedEvent(this.policyGateStepKey(key), {
        ...evaluation.decision.gate,
        relatedToolCallId: evaluation.decision.gate.relatedToolCallId ?? toolCallId,
      }),
    ]);
  }

  private applyStoredPolicyDecision(key: string, event: Extract<ThreadEvent, { type: "policy.evaluated" }>): void {
    if (event.payload.outcome === "allowed") {
      return;
    }

    if (event.payload.outcome === "denied") {
      throw new PolicyDeniedError(event.payload.reason ?? "Policy denied request", {
        policyName: event.payload.policyName,
        scopeKey: this.scopeKey,
        stepKey: key,
        toolName: event.payload.toolName,
      });
    }

    const gateCreated = findEventByDurableIdentity(this.options.events, this.scopeKey, this.policyGateStepKey(key));
    if (!gateCreated || gateCreated.type !== "gate.created") {
      throw new ReplayMismatchError("Policy approval required but durable gate evidence is missing", {
        scopeKey: this.scopeKey,
        stepKey: key,
        policyStepKey: event.payload.policyStepKey,
      });
    }

    const resolved = findGateResolvedEvent(this.options.events, gateCreated.payload.gateId);
    if (!resolved) {
      this.suspend("policy", this.policyGateStepKey(key), "gate-pending", []);
    }

    if (resolved.payload.resolution === "denied") {
      throw new PolicyDeniedError(resolved.payload.comment ?? event.payload.reason ?? "Policy approval denied", {
        policyName: event.payload.policyName,
        scopeKey: this.scopeKey,
        stepKey: key,
        gateId: gateCreated.payload.gateId,
      });
    }
  }

  private validatePolicyEvaluation<Input, Output>(
    key: string,
    tool: ToolContract<string, Input, Output>,
    input: Input,
    event: Extract<ThreadEvent, { type: "policy.evaluated" }>,
  ): void {
    const expected = {
      scopeKey: this.scopeKey,
      stepKey: key,
      policyStepKey: this.policyStepKey(key),
      toolCallId: this.toolCallId(key, tool.name),
      toolName: tool.name,
      inputHash: stableJsonHash(input),
      capabilityNames: capabilityNames(tool),
    };
    const actual = {
      scopeKey: event.payload.scopeKey,
      stepKey: event.payload.stepKey,
      policyStepKey: event.payload.policyStepKey,
      toolCallId: event.payload.toolCallId,
      toolName: event.payload.toolName,
      inputHash: event.payload.inputHash,
      capabilityNames: event.payload.capabilityNames,
    };

    if (canonicalJson(actual) !== canonicalJson(expected)) {
      throw new ReplayMismatchError("Durable policy evaluation key was previously used with different request input", {
        scopeKey: this.scopeKey,
        stepKey: key,
        eventType: "policy.evaluated",
      });
    }
  }

  private findPolicyEvaluation(key: string): Extract<ThreadEvent, { type: "policy.evaluated" }> | undefined {
    const event = findEventByDurableIdentity(this.options.events, this.scopeKey, this.policyStepKey(key));
    if (event && event.type !== "policy.evaluated") {
      throw new ReplayMismatchError("Durable policy key was previously used for a different event type", {
        scopeKey: this.scopeKey,
        stepKey: this.policyStepKey(key),
        existingType: event.type,
        requestedType: "policy.evaluated",
      });
    }
    return event;
  }

  private policyEvaluatedEvent<Input, Output>(
    key: string,
    tool: ToolContract<string, Input, Output>,
    input: Input,
    toolCallId: string,
    evaluation: EvaluatedPolicyDecision,
  ): Extract<ThreadEvent, { type: "policy.evaluated" }> {
    const cause = newestEvent([...this.options.events, ...this.pendingEvents]);
    const policyStepKey = this.policyStepKey(key);
    const gateId =
      evaluation.decision.outcome === "approval_required"
        ? deterministicUuid("gate", this.threadId, this.scopeKey, this.policyGateStepKey(key))
        : undefined;
    return {
      eventId: eventKey(this.threadId, "policy.evaluated", `${this.scopeKey}:${policyStepKey}`),
      threadId: this.threadId,
      type: "policy.evaluated",
      occurredAt: nowIso(),
      correlationId: cause?.correlationId,
      causationId: cause?.eventId,
      scopeKey: this.scopeKey,
      stepKey: policyStepKey,
      actor: this.actor,
      payload: {
        policyEvaluationId: deterministicUuid("policy-evaluation", this.threadId, this.scopeKey, key, tool.name),
        requestType: "tool",
        outcome: policyOutcome(evaluation.decision),
        scopeKey: this.scopeKey,
        stepKey: key,
        policyStepKey,
        toolCallId,
        toolName: tool.name,
        inputHash: stableJsonHash(input),
        capabilityNames: capabilityNames(tool),
        policyName: evaluation.policyName,
        reason: evaluation.decision.reason,
        gateId,
      },
    };
  }

  private toolRequestedEvent<Input>(key: string, toolName: string, input: Input): ThreadEvent {
    const cause = newestEvent([...this.options.events, ...this.pendingEvents]);
    const toolCallId = this.toolCallId(key, toolName);
    return {
      eventId: eventKey(this.threadId, "tool.requested", `${this.scopeKey}:${key}:${toolName}`),
      threadId: this.threadId,
      type: "tool.requested",
      occurredAt: nowIso(),
      correlationId: cause?.correlationId,
      causationId: cause?.eventId,
      scopeKey: this.scopeKey,
      stepKey: key,
      actor: this.actor,
      payload: {
        toolCallId,
        toolName,
        args: input,
        scopeKey: this.scopeKey,
        stepKey: key,
      },
    };
  }

  private toolCallId(key: string, toolName: string): string {
    return deterministicUuid("tool-call", this.threadId, this.scopeKey, key, toolName);
  }

  private policyStepKey(key: string): string {
    return `${key}:policy`;
  }

  private policyGateStepKey(key: string): string {
    return `${key}:policy-gate`;
  }

  private suspend(
    kind: string,
    key: string,
    reason: SuspensionReason,
    events: readonly ThreadEvent[],
  ): never {
    this.markSuspendingEffect(kind, key);
    throw new AgentSuspended(reason, events);
  }

  private markSuspendingEffect(kind: string, key: string): void {
    if (!this.suspendedEffect) {
      this.suspendedEffect = { kind, key };
      return;
    }

    this.parallelEffectError ??= new ParallelDurableEffectError(
      "Parallel durable effects are not supported; await ctx.* effects sequentially",
      {
        first: this.suspendedEffect,
        next: { kind, key },
      },
    );
    throw this.parallelEffectError;
  }

  private gateCreatedEvent(key: string, request: GateRequest): ThreadEvent {
    const cause = newestEvent([...this.options.events, ...this.pendingEvents]);
    return {
      eventId: eventKey(this.threadId, "gate.created", `${this.scopeKey}:${key}`),
      threadId: this.threadId,
      type: "gate.created",
      occurredAt: nowIso(),
      correlationId: cause?.correlationId,
      causationId: cause?.eventId,
      scopeKey: this.scopeKey,
      stepKey: key,
      actor: this.actor,
      payload: this.gateCreatedPayload(key, request),
    };
  }

  private gateCreatedPayload(
    key: string,
    request: GateRequest,
  ): Extract<ThreadEvent, { type: "gate.created" }>["payload"] {
    return {
      gateId: deterministicUuid("gate", this.threadId, this.scopeKey, key),
      gateType: request.gateType ?? "manual-approval",
      reason: request.reason,
      relatedToolCallId: request.relatedToolCallId,
      proposedAction: request.proposedAction,
    };
  }

  private spawnExpectedPayload(
    key: string,
    childAgentName: string,
    input: SessionMetadata,
    options: SpawnOptions,
  ): Pick<
    Extract<ThreadEvent, { type: "child_thread.spawned" }>["payload"],
    "childAgentName" | "scopeKey" | "stepKey" | "mode" | "inputHash" | "inputSummary" | "metadata"
  > {
    return {
      childAgentName,
      scopeKey: this.scopeKey,
      stepKey: key,
      mode: options.detached ? "detached" : "attached",
      inputHash: stableJsonHash(input),
      inputSummary: options.prompt,
      metadata: options.metadata,
    };
  }
}

function toPlan(history: readonly ThreadEvent[], events: ThreadEvent[]): AgentPlan | null {
  if (events.length === 0) {
    return null;
  }

  return {
    resumeReason: resumeReasonFor(newestEvent(history)),
    events,
  };
}

function readAgentInput(agent: AgentContract, events: readonly ThreadEvent[]): unknown {
  const sessionStarted = events.find((event) => event.type === "session.started");
  const promptReceived = events.find((event) => event.type === "prompt.received");
  if (!promptReceived) {
    return undefined;
  }

  const rawInput = sessionStarted?.payload.metadata ?? { prompt: promptReceived.payload.prompt };
  if (!agent.input) {
    return rawInput;
  }

  const inputResult = agent.input.safeParse(rawInput);
  if (!inputResult.success) {
    throw new WeaveError("AGENT_INPUT_INVALID", `Invalid input for agent ${agent.name}`, inputResult.error);
  }

  return inputResult.data;
}

function validateAgentOutput(agent: AgentContract, output: unknown): unknown {
  if (!agent.output) {
    return output;
  }

  const outputResult = agent.output.safeParse(output);
  if (!outputResult.success) {
    throw new WeaveError("AGENT_OUTPUT_INVALID", `Invalid output for agent ${agent.name}`, outputResult.error);
  }

  return outputResult.data;
}

function findEventByDurableIdentity(
  events: readonly ThreadEvent[],
  scopeKey: string,
  stepKey: string,
): ThreadEvent | undefined {
  return events.find((event) => eventScopeKey(event) === scopeKey && eventStepKey(event) === stepKey);
}

function eventScopeKey(event: ThreadEvent): string | undefined {
  return event.scopeKey ?? payloadString(event, "scopeKey");
}

function eventStepKey(event: ThreadEvent): string | undefined {
  return event.stepKey ?? payloadString(event, "stepKey");
}

function payloadString(event: ThreadEvent, key: string): string | undefined {
  if (!event.payload || typeof event.payload !== "object") {
    return undefined;
  }

  const value = Reflect.get(event.payload, key);
  return typeof value === "string" ? value : undefined;
}

function findToolTerminalEvent(
  events: readonly ThreadEvent[],
  toolCallId: string,
): Extract<ThreadEvent, { type: "tool.completed" | "tool.failed" }> | undefined {
  return events.find(
    (event): event is Extract<ThreadEvent, { type: "tool.completed" | "tool.failed" }> =>
      (event.type === "tool.completed" || event.type === "tool.failed") && event.payload.toolCallId === toolCallId,
  );
}

function findGateResolvedEvent(
  events: readonly ThreadEvent[],
  gateId: string,
): Extract<ThreadEvent, { type: "gate.resolved" }> | undefined {
  return events.find(
    (event): event is Extract<ThreadEvent, { type: "gate.resolved" }> =>
      event.type === "gate.resolved" && event.payload.gateId === gateId,
  );
}

type EvaluatedPolicyDecision = {
  policyName?: string;
  decision: PolicyDecision;
};

function evaluatePolicies(policies: readonly AnyPolicyRule[], request: PolicyRequest): EvaluatedPolicyDecision {
  let approvalRequired: EvaluatedPolicyDecision | undefined;
  let allowed: EvaluatedPolicyDecision | undefined;

  for (const rule of policies) {
    const decision = rule.evaluate(request);
    if (!decision) {
      continue;
    }

    const evaluated = { policyName: rule.name, decision };
    if (decision.outcome === "deny") {
      return evaluated;
    }
    if (decision.outcome === "approval_required") {
      approvalRequired ??= evaluated;
      continue;
    }
    allowed ??= evaluated;
  }

  return approvalRequired ?? allowed ?? { decision: { outcome: "allow" } };
}

function policyOutcome(decision: PolicyDecision): "allowed" | "denied" | "approval_required" {
  if (decision.outcome === "allow") {
    return "allowed";
  }
  return decision.outcome === "deny" ? "denied" : "approval_required";
}

function capabilityNames(tool: ToolContract<string, any, any>): string[] {
  return [...(tool.capabilities ?? []).map((capability) => capability.name)].sort();
}

function hasTerminalAgentResponse(events: readonly ThreadEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "agent.response.produced" ||
      event.type === "agent.incident_report.produced" ||
      event.type === "agent.failed",
  );
}

function newestEvent(events: readonly ThreadEvent[]): ThreadEvent | undefined {
  return events.at(-1);
}

function resumeReasonFor(event: ThreadEvent | undefined): AgentPlan["resumeReason"] {
  if (event?.type === "prompt.received") {
    return "new-prompt";
  }

  if (event?.type === "gate.resolved") {
    return "gate-resolved";
  }

  if (event?.type === "child_thread.spawned") {
    return "child-spawned";
  }

  if (event?.type === "child_thread.completed") {
    return "child-completed";
  }

  if (event?.type === "child_thread.failed") {
    return "child-failed";
  }

  return "tool-completed";
}

function formatAgentOutput(output: unknown): string {
  if (output === undefined) {
    return "undefined";
  }

  if (typeof output === "string") {
    return output;
  }

  if (output && typeof output === "object") {
    const finalMessage = Reflect.get(output, "finalMessage");
    if (typeof finalMessage === "string" && finalMessage.length > 0) {
      return finalMessage;
    }
  }

  return JSON.stringify(output);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonicalJson(value));
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForCanonicalJson);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortForCanonicalJson(nested)]),
  );
}
