import type {
  AgentContract,
  AgentContext,
  AgentEventInput,
  AnyAgentContract,
  GateRequest,
  GateResolution,
} from "./agent-contract.js";
import { ReplayMismatchError, ToolFailedError, WeaveError } from "./errors.js";
import {
  deterministicUuid,
  eventKey,
  nowIso,
  type Actor,
  type ThreadEvent,
} from "./events.js";
import type { AgentPlan, AgentPlanner } from "./runner.js";
import type { ToolContract } from "./tool-contract.js";

type SuspensionReason = "tool-requested" | "tool-pending" | "gate-created" | "gate-pending";

class AgentSuspended extends Error {
  constructor(
    readonly reason: SuspensionReason,
    readonly events: readonly ThreadEvent[],
  ) {
    super(reason);
    this.name = "AgentSuspended";
  }
}

export function createAgentPlanner(agent: AnyAgentContract, agentName = agent.name): AgentPlanner {
  if (agent.run) {
    return new RunAgentPlanner(agent, agentName);
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
    });

    try {
      const output = await this.agent.run(context, input);
      const plannedEvents = context.drainEvents();
      if (!plannedEvents.some((event) => event.type === "agent.response.produced")) {
        plannedEvents.push(context.responseEvent("agent-run-output", formatAgentOutput(output)));
      }

      return toPlan(events, plannedEvents);
    } catch (error) {
      if (error instanceof AgentSuspended) {
        return toPlan(events, [...context.drainEvents(), ...error.events]);
      }
      if (error instanceof ToolFailedError) {
        return null;
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

  constructor(
    private readonly options: {
      agentName: string;
      threadId: string;
      events: readonly ThreadEvent[];
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

      throw new AgentSuspended("tool-pending", []);
    }

    const requested = this.toolRequestedEvent(key, tool.name, inputResult.data);
    throw new AgentSuspended("tool-requested", [requested]);
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

      throw new AgentSuspended("gate-pending", []);
    }

    throw new AgentSuspended("gate-created", [this.gateCreatedEvent(key, request)]);
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

  uuid(key: string): string {
    return deterministicUuid("agent-context", this.threadId, this.scopeKey, key);
  }

  drainEvents(): ThreadEvent[] {
    const drained = [...this.pendingEvents];
    this.pendingEvents.length = 0;
    return drained;
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

  private toolRequestedEvent<Input>(key: string, toolName: string, input: Input): ThreadEvent {
    const cause = newestEvent(this.options.events);
    const toolCallId = deterministicUuid("tool-call", this.threadId, this.scopeKey, key, toolName);
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
  return agent.input ? agent.input.parse(rawInput) : rawInput;
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

function hasTerminalAgentResponse(events: readonly ThreadEvent[]): boolean {
  return events.some((event) => event.type === "agent.response.produced" || event.type === "agent.incident_report.produced");
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

  return "tool-completed";
}

function formatAgentOutput(output: unknown): string {
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
