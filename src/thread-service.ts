import { randomUUID } from "node:crypto";
import type { ThreadEngine } from "./contracts.js";
import type { ThreadRef } from "./agent-contract.js";
import { ReplayMismatchError } from "./errors.js";
import {
  deterministicUuid,
  newEventId,
  nowIso,
  stableJsonHash,
  type Actor,
  type ThreadEvent,
  type SessionMetadata,
  type SessionSource,
  type ThreadStatus,
} from "./events.js";

export type StartSessionInput = {
  prompt: string;
  source?: SessionSource;
  agentName?: string;
  actor?: Actor;
  metadata?: SessionMetadata;
  idempotencyKey?: string;
};

type NormalizedStartSessionInput = Required<Pick<StartSessionInput, "prompt" | "source" | "actor">> & {
  agentName?: string;
  metadata?: SessionMetadata;
  idempotencyKey?: string;
};

type ExistingSession = {
  threadId: string;
  correlationId: string;
  sessionStarted?: Extract<ThreadEvent, { type: "session.started" }>;
  promptReceived?: Extract<ThreadEvent, { type: "prompt.received" }>;
};

export type StartChildSessionInput = {
  parentThreadId: string;
  agentName: string;
  input: SessionMetadata;
  prompt?: string;
  source?: SessionSource;
  actor?: Actor;
  metadata?: SessionMetadata;
  parentScopeKey?: string;
  parentStepKey?: string;
  detached?: boolean;
  idempotencyKey?: string;
};

export type StartChildSessionResult = {
  threadId: string;
  correlationId: string;
  parentThreadId: string;
  rootThreadId: string;
};

export type MirrorChildTerminalEventInput = {
  parentThreadId: string;
  childThreadId: string;
  childAgentName?: string;
  parentScopeKey: string;
  parentStepKey: string;
};

export type MirrorChildTerminalEventResult =
  | { mirrored: true; eventType: "child_thread.completed" | "child_thread.failed" }
  | { mirrored: false; reason: "child-not-terminal" };

export type ListChildrenOptions = {
  includeDetached?: boolean;
  agentName?: string | readonly string[];
  status?: ThreadStatus | readonly ThreadStatus[];
};

export type CancelChildThreadInput = {
  parentThreadId: string;
  childThreadId: string;
  childAgentName?: string;
  parentScopeKey?: string;
  parentStepKey?: string;
  reason?: string;
  actor?: Actor;
};

export type CancelChildThreadResult = {
  childThreadId: string;
  cancelled: boolean;
  errorCode: "CHILD_CANCELLED";
};

export type DeliverSignalInput = {
  threadId: string;
  signal: string;
  payload: unknown;
  waitId?: string;
  scopeKey?: string;
  stepKey?: string;
  actor?: Actor;
  idempotencyKey?: string;
};

export type DeliverSignalResult = {
  delivered: boolean;
  eventType: "signal.received";
  waitId: string;
};

export type LatestReply = {
  message: string;
  eventId: string;
  occurredAt: string;
};

export type OpenGate = {
  gateId: string;
  gateType: "manual-approval";
  reason: string;
  proposedAction?: string;
  scopeKey?: string;
  stepKey?: string;
  occurredAt: string;
};

export class ThreadService {
  constructor(private readonly engine: ThreadEngine) {}

  async startSession(input: string | StartSessionInput): Promise<{ threadId: string; correlationId: string }> {
    const normalized = normalizeStartSessionInput(input);
    const threadId = normalized.idempotencyKey
      ? deterministicUuid("session-thread", normalized.source, normalized.idempotencyKey)
      : randomUUID();
    const correlationId = normalized.idempotencyKey
      ? deterministicUuid("session-correlation", normalized.source, normalized.idempotencyKey)
      : randomUUID();

    await this.engine.createThread(threadId);

    const existingSession = await readExistingSession(this.engine, threadId);
    if (existingSession) {
      validateStartSessionIdempotency(normalized, existingSession);
      return toSessionResult(existingSession);
    }

    const events: ThreadEvent[] = [
      {
        eventId: normalized.idempotencyKey
          ? deterministicUuid("session-started", threadId, normalized.idempotencyKey)
          : newEventId(),
        threadId,
        type: "session.started",
        occurredAt: nowIso(),
        correlationId,
        idempotencyKey: normalized.idempotencyKey,
        actor: { type: "system", id: "thread-service" },
        payload: {
          source: normalized.source,
          agentName: normalized.agentName,
          metadata: normalized.metadata,
        },
      },
      {
        eventId: normalized.idempotencyKey
          ? deterministicUuid("prompt-received", threadId, normalized.idempotencyKey)
          : newEventId(),
        threadId,
        type: "prompt.received",
        occurredAt: nowIso(),
        correlationId,
        actor: normalized.actor,
        payload: { prompt: normalized.prompt },
      },
    ];

    try {
      await this.engine.append(events);
      return { threadId, correlationId };
    } catch (error) {
      if (!normalized.idempotencyKey) {
        throw error;
      }

      const concurrentSession = await readExistingSession(this.engine, threadId);
      if (concurrentSession) {
        validateStartSessionIdempotency(normalized, concurrentSession);
        return toSessionResult(concurrentSession);
      }

      throw error;
    }
  }

  async startChildSession(input: StartChildSessionInput): Promise<StartChildSessionResult> {
    const parentProjection = await this.engine.getProjection(input.parentThreadId);
    if (!parentProjection) {
      throw new Error(`Parent thread not found: ${input.parentThreadId}`);
    }

    const source = input.source ?? "system";
    const actor = input.actor ?? { type: "system", id: "thread-service" };
    const threadId = input.idempotencyKey
      ? deterministicUuid("child-session-thread", input.parentThreadId, source, input.idempotencyKey)
      : randomUUID();
    const generatedCorrelationId = input.idempotencyKey
      ? deterministicUuid("child-session-correlation", input.parentThreadId, source, input.idempotencyKey)
      : randomUUID();
    const rootThreadId = parentProjection.rootThreadId ?? input.parentThreadId;
    const parentScopeKey = input.parentScopeKey ?? "service:thread-service";
    const parentStepKey = input.parentStepKey ?? `child:${threadId}`;

    await this.engine.createThread(threadId, {
      parentThreadId: input.parentThreadId,
      rootThreadId,
      parentScopeKey,
      parentStepKey,
    });

    const childProjection = await this.engine.getProjection(threadId);
    validateChildLineageIdempotency(
      {
        parentThreadId: input.parentThreadId,
        rootThreadId,
        parentScopeKey,
        parentStepKey,
        idempotencyKey: input.idempotencyKey,
      },
      childProjection,
      threadId,
    );

    const existingSession = await readExistingSession(this.engine, threadId);
    const correlationId = existingSession?.correlationId ?? generatedCorrelationId;

    if (existingSession) {
      validateChildSessionIdempotency(
        {
          threadId,
          source,
          agentName: input.agentName,
          childInput: input.input,
          prompt: input.prompt ?? `Child session for ${input.agentName}`,
          idempotencyKey: input.idempotencyKey,
        },
        existingSession,
      );
    }

    if (!existingSession) {
      const events: ThreadEvent[] = [
        {
          eventId: input.idempotencyKey
            ? deterministicUuid("child-session-started", threadId, input.idempotencyKey)
            : newEventId(),
          threadId,
          type: "session.started",
          occurredAt: nowIso(),
          correlationId,
          idempotencyKey: input.idempotencyKey,
          actor: { type: "system", id: "thread-service" },
          payload: {
            source,
            agentName: input.agentName,
            metadata: input.input,
          },
        },
        {
          eventId: input.idempotencyKey
            ? deterministicUuid("child-prompt-received", threadId, input.idempotencyKey)
            : newEventId(),
          threadId,
          type: "prompt.received",
          occurredAt: nowIso(),
          correlationId,
          actor,
          payload: { prompt: input.prompt ?? `Child session for ${input.agentName}` },
        },
      ];

      try {
        await this.engine.append(events);
      } catch (error) {
        if (!input.idempotencyKey) {
          throw error;
        }

        const concurrentSession = await readExistingSession(this.engine, threadId);
        if (!concurrentSession) {
          throw error;
        }
        validateChildSessionIdempotency(
          {
            threadId,
            source,
            agentName: input.agentName,
            childInput: input.input,
            prompt: input.prompt ?? `Child session for ${input.agentName}`,
            idempotencyKey: input.idempotencyKey,
          },
          concurrentSession,
        );
      }
    }

    await ensureChildSpawnedEvent(this.engine, {
      parentThreadId: input.parentThreadId,
      childThreadId: threadId,
      childAgentName: input.agentName,
      correlationId,
      parentScopeKey,
      parentStepKey,
      mode: input.detached ? "detached" : "attached",
      inputHash: stableJsonHash(input.input),
      inputSummary: input.prompt,
      metadata: input.metadata,
    });

    return {
      threadId,
      correlationId,
      parentThreadId: input.parentThreadId,
      rootThreadId,
    };
  }

  async mirrorChildTerminalEvent(input: MirrorChildTerminalEventInput): Promise<MirrorChildTerminalEventResult> {
    const childProjection = await this.engine.getProjection(input.childThreadId);
    if (!childProjection || (childProjection.status !== "completed" && childProjection.status !== "failed")) {
      return { mirrored: false, reason: "child-not-terminal" };
    }

    if (childProjection.parentThreadId !== input.parentThreadId) {
      throw new Error(`Child thread not found for parent: ${input.childThreadId}`);
    }

    const parentEvents = await this.engine.read(input.parentThreadId);
    const spawned = parentEvents.find((event) => {
      return event.type === "child_thread.spawned" && event.payload.childThreadId === input.childThreadId;
    });
    if (!spawned) {
      throw new Error(`Child thread was not spawned by parent: ${input.childThreadId}`);
    }

    const existing = parentEvents.find((event) => {
      return (
        (event.type === "child_thread.completed" || event.type === "child_thread.failed") &&
        event.scopeKey === input.parentScopeKey &&
        event.stepKey === input.parentStepKey &&
        event.payload.childThreadId === input.childThreadId
      );
    });
    if (existing?.type === "child_thread.completed" || existing?.type === "child_thread.failed") {
      return { mirrored: true, eventType: existing.type };
    }

    const childEvents = await this.engine.read(input.childThreadId);
    const childTerminal = newestEvent(childEvents);
    const parentCause = newestEvent(parentEvents);
    const base = {
      threadId: input.parentThreadId,
      occurredAt: nowIso(),
      correlationId: parentEvents[0]?.correlationId ?? childTerminal?.correlationId,
      causationId: parentCause?.eventId,
      scopeKey: input.parentScopeKey,
      stepKey: input.parentStepKey,
      actor: { type: "system", id: "thread-service" } as const,
    };

    if (childProjection.status === "completed") {
      const response = newestEventOfType(childEvents, "agent.response.produced");
      const output = newestEventOfType(childEvents, "agent.output.completed");
      const event: Extract<ThreadEvent, { type: "child_thread.completed" }> = {
        ...base,
        eventId: deterministicUuid("child-thread-completed", input.parentThreadId, input.parentScopeKey, input.parentStepKey, input.childThreadId),
        type: "child_thread.completed",
        idempotencyKey: `child-thread-completed:${input.parentScopeKey}:${input.parentStepKey}:${input.childThreadId}`,
        payload: {
          childThreadId: input.childThreadId,
          ...(input.childAgentName ? { childAgentName: input.childAgentName } : {}),
          ...(output && "output" in output.payload ? { output: output.payload.output } : {}),
          ...(output?.payload.summary ?? response?.payload.message
            ? { outputSummary: output?.payload.summary ?? response?.payload.message }
            : {}),
        },
      };
      await appendChildTerminalEvent(this.engine, event);
      return { mirrored: true, eventType: "child_thread.completed" };
    }

    const failed = newestFailedEvent(childEvents);
    const event: Extract<ThreadEvent, { type: "child_thread.failed" }> = {
      ...base,
      eventId: deterministicUuid("child-thread-failed", input.parentThreadId, input.parentScopeKey, input.parentStepKey, input.childThreadId),
      type: "child_thread.failed",
      idempotencyKey: `child-thread-failed:${input.parentScopeKey}:${input.parentStepKey}:${input.childThreadId}`,
      payload: {
        childThreadId: input.childThreadId,
        ...(input.childAgentName ? { childAgentName: input.childAgentName } : {}),
        errorCode: failed?.payload.errorCode ?? "CHILD_THREAD_FAILED",
        message: failed?.payload.message ?? `Child thread failed: ${input.childThreadId}`,
      },
    };
    await appendChildTerminalEvent(this.engine, event);
    return { mirrored: true, eventType: "child_thread.failed" };
  }

  async cancelChildThread(input: CancelChildThreadInput): Promise<CancelChildThreadResult> {
    const childProjection = await this.engine.getProjection(input.childThreadId);
    if (!childProjection || childProjection.parentThreadId !== input.parentThreadId) {
      throw new Error(`Child thread not found for parent: ${input.childThreadId}`);
    }

    if (childProjection.status === "completed") {
      throw new Error(`Child thread is already completed: ${input.childThreadId}`);
    }

    const childEvents = await this.engine.read(input.childThreadId);
    const existingCancellation = childEvents.find((event): event is Extract<ThreadEvent, { type: "agent.failed" }> => {
      return event.type === "agent.failed" && event.payload.errorCode === "CHILD_CANCELLED";
    });
    let appendedCancellation = false;

    if (!existingCancellation && childProjection.status !== "failed") {
      const cause = newestEvent(childEvents);
      await this.engine.append([
        {
          eventId: deterministicUuid("child-cancelled", input.parentThreadId, input.childThreadId),
          threadId: input.childThreadId,
          type: "agent.failed",
          occurredAt: nowIso(),
          correlationId: cause?.correlationId,
          causationId: cause?.eventId,
          idempotencyKey: `child-cancelled:${input.parentThreadId}:${input.childThreadId}`,
          actor: input.actor ?? { type: "system", id: "thread-service" },
          payload: {
            errorCode: "CHILD_CANCELLED",
            message: input.reason ?? `Child thread cancelled: ${input.childThreadId}`,
          },
        },
      ]);
      appendedCancellation = true;
    }

    if (input.parentScopeKey && input.parentStepKey) {
      await this.mirrorChildTerminalEvent({
        parentThreadId: input.parentThreadId,
        childThreadId: input.childThreadId,
        childAgentName: input.childAgentName,
        parentScopeKey: input.parentScopeKey,
        parentStepKey: input.parentStepKey,
      });
    }

    return { childThreadId: input.childThreadId, cancelled: appendedCancellation || existingCancellation !== undefined, errorCode: "CHILD_CANCELLED" };
  }

  async listChildren(parentThreadId: string, options: ListChildrenOptions = {}): Promise<readonly ThreadRef[]> {
    const parentEvents = await this.engine.read(parentThreadId);
    const spawnedEvents = parentEvents.filter(
      (event): event is Extract<ThreadEvent, { type: "child_thread.spawned" }> => event.type === "child_thread.spawned",
    );
    const refs: ThreadRef[] = [];
    const seen = new Set<string>();

    for (const event of spawnedEvents) {
      if (seen.has(event.payload.childThreadId)) {
        continue;
      }
      seen.add(event.payload.childThreadId);

      if (!options.includeDetached && event.payload.mode === "detached") {
        continue;
      }

      if (!matchesFilter(event.payload.childAgentName, options.agentName)) {
        continue;
      }

      const projection = await this.engine.getProjection(event.payload.childThreadId);
      if (!matchesFilter(projection?.status, options.status)) {
        continue;
      }

      refs.push({
        threadId: event.payload.childThreadId,
        agentName: event.payload.childAgentName,
        parentThreadId,
        rootThreadId: projection?.rootThreadId ?? undefined,
        parentScopeKey: event.payload.scopeKey,
        parentStepKey: event.payload.stepKey,
        status: projection?.status,
      });
    }

    return refs;
  }

  async getSessionMetadata(threadId: string): Promise<SessionMetadata | null> {
    const events = await this.engine.read(threadId);
    const started = events.find(
      (event): event is Extract<ThreadEvent, { type: "session.started" }> =>
        event.type === "session.started",
    );
    return started?.payload.metadata ?? null;
  }

  async getEvents(
    threadId: string,
    options: {
      type?: ThreadEvent["type"] | readonly ThreadEvent["type"][];
      fromSeq?: number;
      limit?: number;
    } = {},
  ): Promise<readonly ThreadEvent[]> {
    const events = await this.engine.read(
      threadId,
      options.fromSeq !== undefined ? { fromSeq: options.fromSeq } : undefined,
    );
    const types =
      options.type === undefined
        ? undefined
        : Array.isArray(options.type)
          ? options.type
          : [options.type];
    const filtered = types ? events.filter((event) => types.includes(event.type)) : events;
    return options.limit !== undefined ? filtered.slice(0, options.limit) : filtered;
  }

  async getLatestReply(threadId: string): Promise<LatestReply | null> {
    const events = await this.engine.read(threadId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event && (event.type === "agent.reply.produced" || event.type === "agent.response.produced")) {
        return { message: event.payload.message, eventId: event.eventId, occurredAt: event.occurredAt };
      }
    }
    return null;
  }

  async listOpenGates(threadId: string): Promise<readonly OpenGate[]> {
    const events = await this.engine.read(threadId);
    const resolved = new Set<string>();
    for (const event of events) {
      if (event.type === "gate.resolved") {
        resolved.add(event.payload.gateId);
      }
    }
    const open: OpenGate[] = [];
    for (const event of events) {
      if (event.type !== "gate.created" || resolved.has(event.payload.gateId)) {
        continue;
      }
      open.push({
        gateId: event.payload.gateId,
        gateType: event.payload.gateType,
        reason: event.payload.reason,
        proposedAction: event.payload.proposedAction,
        scopeKey: event.scopeKey,
        stepKey: event.stepKey,
        occurredAt: event.occurredAt,
      });
    }
    return open;
  }

  async resolveGate(
    threadId: string,
    gateId: string,
    resolution: "approved" | "denied",
    comment?: string,
    actor?: Actor,
  ): Promise<void> {
    const events = await this.engine.read(threadId);
    const gateCreated = events.find(
      (event) => event.type === "gate.created" && event.payload.gateId === gateId,
    );

    if (!gateCreated) {
      throw new Error(`Gate not found: ${gateId}`);
    }

    const alreadyResolved = events.some(
      (event) => event.type === "gate.resolved" && event.payload.gateId === gateId,
    );

    if (alreadyResolved) {
      throw new Error(`Gate already resolved: ${gateId}`);
    }

    await this.engine.append([
      {
        eventId: newEventId(),
        threadId,
        type: "gate.resolved",
        occurredAt: nowIso(),
        correlationId: gateCreated.correlationId,
        causationId: gateCreated.eventId,
        scopeKey: gateCreated.scopeKey,
        stepKey: gateCreated.stepKey,
        actor: actor ?? { type: "human", id: "demo-approver" },
        payload: { gateId, resolution, comment },
      },
    ]);
  }

  async deliverSignal(input: DeliverSignalInput): Promise<DeliverSignalResult> {
    const events = await this.engine.read(input.threadId);
    const waiting = findWaitingSignal(events, input);
    const existing = events.find((event): event is Extract<ThreadEvent, { type: "signal.received" }> => {
      return event.type === "signal.received" && event.payload.waitId === waiting.payload.waitId;
    });
    const payloadHash = stableJsonHash(input.payload);

    if (existing) {
      if (existing.payload.signalName !== input.signal || existing.payload.payloadHash !== payloadHash) {
        throw new ReplayMismatchError("Signal delivery does not match the already delivered signal", {
          threadId: input.threadId,
          waitId: waiting.payload.waitId,
          signalName: input.signal,
        });
      }
      return { delivered: false, eventType: "signal.received", waitId: waiting.payload.waitId };
    }

    await this.engine.append([
      {
        eventId: input.idempotencyKey
          ? deterministicUuid("signal-received", input.threadId, input.idempotencyKey)
          : deterministicUuid("signal-received", input.threadId, waiting.payload.waitId, payloadHash),
        threadId: input.threadId,
        type: "signal.received",
        occurredAt: nowIso(),
        correlationId: waiting.correlationId,
        causationId: waiting.eventId,
        idempotencyKey: input.idempotencyKey,
        scopeKey: waiting.scopeKey,
        stepKey: waiting.stepKey,
        actor: input.actor ?? { type: "system", id: "thread-service" },
        payload: {
          waitId: waiting.payload.waitId,
          signalName: input.signal,
          payloadHash,
          data: input.payload,
        },
      },
    ]);

    return { delivered: true, eventType: "signal.received", waitId: waiting.payload.waitId };
  }
}

function findWaitingSignal(
  events: readonly ThreadEvent[],
  input: DeliverSignalInput,
): Extract<ThreadEvent, { type: "signal.waiting" }> {
  const candidates = events.filter((event): event is Extract<ThreadEvent, { type: "signal.waiting" }> => {
    if (event.type !== "signal.waiting" || event.payload.signalName !== input.signal) {
      return false;
    }
    if (input.waitId && event.payload.waitId !== input.waitId) {
      return false;
    }
    if (input.scopeKey && event.payload.scopeKey !== input.scopeKey) {
      return false;
    }
    if (input.stepKey && event.payload.stepKey !== input.stepKey) {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    throw new Error(`Signal wait not found: ${input.signal}`);
  }
  if (candidates.length > 1) {
    throw new Error(`Signal delivery is ambiguous: ${input.signal}`);
  }

  const waiting = candidates[0];
  if (!waiting) {
    throw new Error(`Signal wait not found: ${input.signal}`);
  }
  return waiting;
}

function matchesFilter<Value extends string>(value: Value | undefined, filter: Value | readonly Value[] | undefined): boolean {
  if (filter === undefined) {
    return true;
  }

  if (value === undefined) {
    return false;
  }

  return Array.isArray(filter) ? filter.includes(value) : filter === value;
}

function normalizeStartSessionInput(input: string | StartSessionInput): NormalizedStartSessionInput {
  if (typeof input === "string") {
    return {
      prompt: input,
      source: "test",
      actor: { type: "user", id: "demo-user" },
    };
  }

  return {
    prompt: input.prompt,
    source: input.source ?? "test",
    agentName: input.agentName,
    actor: input.actor ?? { type: "user", id: "demo-user" },
    metadata: input.metadata,
    idempotencyKey: input.idempotencyKey,
  };
}

async function readExistingSession(
  engine: ThreadEngine,
  threadId: string,
): Promise<ExistingSession | null> {
  const events = await engine.read(threadId, { limit: 2 });
  if (events.length === 0) {
    return null;
  }

  const correlationId = events[0]?.correlationId;
  if (!correlationId) {
    return null;
  }

  return {
    threadId,
    correlationId,
    sessionStarted: events.find(
      (event): event is Extract<ThreadEvent, { type: "session.started" }> => event.type === "session.started",
    ),
    promptReceived: events.find(
      (event): event is Extract<ThreadEvent, { type: "prompt.received" }> => event.type === "prompt.received",
    ),
  };
}

function validateStartSessionIdempotency(input: NormalizedStartSessionInput, existing: ExistingSession): void {
  const sessionPayload = existing.sessionStarted?.payload;
  const promptPayload = existing.promptReceived?.payload;
  const mismatches: string[] = [];

  if (sessionPayload?.source !== input.source) {
    mismatches.push("source");
  }
  if (sessionPayload?.agentName !== input.agentName) {
    mismatches.push("agentName");
  }
  if (stableValueHash(sessionPayload?.metadata) !== stableValueHash(input.metadata)) {
    mismatches.push("metadata");
  }
  if (promptPayload?.prompt !== input.prompt) {
    mismatches.push("prompt");
  }

  if (mismatches.length > 0) {
    throw new ReplayMismatchError("Idempotent root session request does not match the existing session", {
      threadId: existing.threadId,
      idempotencyKey: input.idempotencyKey,
      mismatches,
    });
  }
}

function validateChildLineageIdempotency(
  input: {
    parentThreadId: string;
    rootThreadId: string;
    parentScopeKey: string;
    parentStepKey: string;
    idempotencyKey?: string;
  },
  projection: Awaited<ReturnType<ThreadEngine["getProjection"]>>,
  childThreadId: string,
): void {
  const mismatches: string[] = [];
  if (projection?.parentThreadId !== input.parentThreadId) {
    mismatches.push("parentThreadId");
  }
  if (projection?.rootThreadId !== input.rootThreadId) {
    mismatches.push("rootThreadId");
  }
  if (projection?.parentScopeKey !== input.parentScopeKey) {
    mismatches.push("parentScopeKey");
  }
  if (projection?.parentStepKey !== input.parentStepKey) {
    mismatches.push("parentStepKey");
  }

  if (mismatches.length > 0) {
    throw new ReplayMismatchError("Idempotent child session lineage does not match the existing child", {
      childThreadId,
      idempotencyKey: input.idempotencyKey,
      mismatches,
    });
  }
}

function validateChildSessionIdempotency(
  input: {
    threadId: string;
    source: SessionSource;
    agentName: string;
    childInput: SessionMetadata;
    prompt: string;
    idempotencyKey?: string;
  },
  existing: ExistingSession,
): void {
  const sessionPayload = existing.sessionStarted?.payload;
  const promptPayload = existing.promptReceived?.payload;
  const mismatches: string[] = [];

  if (sessionPayload?.source !== input.source) {
    mismatches.push("source");
  }
  if (sessionPayload?.agentName !== input.agentName) {
    mismatches.push("agentName");
  }
  if (stableValueHash(sessionPayload?.metadata) !== stableValueHash(input.childInput)) {
    mismatches.push("input");
  }
  if (promptPayload?.prompt !== input.prompt) {
    mismatches.push("prompt");
  }

  if (mismatches.length > 0) {
    throw new ReplayMismatchError("Idempotent child session request does not match the existing child session", {
      childThreadId: input.threadId,
      idempotencyKey: input.idempotencyKey,
      mismatches,
    });
  }
}

function stableValueHash(value: unknown): string {
  return stableJsonHash(value ?? null);
}

function toSessionResult(session: ExistingSession): { threadId: string; correlationId: string } {
  return {
    threadId: session.threadId,
    correlationId: session.correlationId,
  };
}

async function ensureChildSpawnedEvent(
  engine: ThreadEngine,
  input: {
    parentThreadId: string;
    childThreadId: string;
    childAgentName: string;
    correlationId: string;
    parentScopeKey: string;
    parentStepKey: string;
    mode: "attached" | "detached";
    inputHash?: string;
    inputSummary?: string;
    metadata?: SessionMetadata;
  },
): Promise<void> {
  const parentEvents = await engine.read(input.parentThreadId);
  const existing = parentEvents.find((event): event is Extract<ThreadEvent, { type: "child_thread.spawned" }> => {
    return event.type === "child_thread.spawned" && event.payload.childThreadId === input.childThreadId;
  });
  if (existing) {
    validateChildSpawnedIdempotency(input, existing);
    return;
  }

  const event: Extract<ThreadEvent, { type: "child_thread.spawned" }> = {
    eventId: deterministicUuid("child-thread-spawned", input.parentThreadId, input.childThreadId),
    threadId: input.parentThreadId,
    type: "child_thread.spawned",
    occurredAt: nowIso(),
    correlationId: parentEvents[0]?.correlationId ?? input.correlationId,
    causationId: parentEvents.at(-1)?.eventId,
    idempotencyKey: `child-thread-spawned:${input.childThreadId}`,
    scopeKey: input.parentScopeKey,
    stepKey: input.parentStepKey,
    actor: { type: "system", id: "thread-service" },
    payload: {
      childThreadId: input.childThreadId,
      childAgentName: input.childAgentName,
      scopeKey: input.parentScopeKey,
      stepKey: input.parentStepKey,
      mode: input.mode,
      ...(input.inputHash ? { inputHash: input.inputHash } : {}),
      ...(input.inputSummary ? { inputSummary: input.inputSummary } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  };

  try {
    await engine.append([event]);
  } catch (error) {
    const concurrentEvents = await engine.read(input.parentThreadId);
    const concurrentEvent = concurrentEvents.find((candidate): candidate is Extract<ThreadEvent, { type: "child_thread.spawned" }> => {
      return candidate.type === "child_thread.spawned" && candidate.payload.childThreadId === input.childThreadId;
    });
    if (concurrentEvent) {
      validateChildSpawnedIdempotency(input, concurrentEvent);
      return;
    }

    throw error;
  }
}

function validateChildSpawnedIdempotency(
  input: Parameters<typeof ensureChildSpawnedEvent>[1],
  existing: Extract<ThreadEvent, { type: "child_thread.spawned" }>,
): void {
  const expected = {
    childAgentName: input.childAgentName,
    scopeKey: input.parentScopeKey,
    stepKey: input.parentStepKey,
    mode: input.mode,
    inputHash: input.inputHash,
    inputSummary: input.inputSummary,
    metadata: input.metadata,
  };
  const actual = {
    childAgentName: existing.payload.childAgentName,
    scopeKey: existing.payload.scopeKey,
    stepKey: existing.payload.stepKey,
    mode: existing.payload.mode,
    inputHash: existing.payload.inputHash,
    inputSummary: existing.payload.inputSummary,
    metadata: existing.payload.metadata,
  };
  const mismatches = Object.keys(expected).filter((key) => {
    const typedKey = key as keyof typeof expected;
    return stableValueHash(actual[typedKey]) !== stableValueHash(expected[typedKey]);
  });

  if (mismatches.length > 0) {
    throw new ReplayMismatchError("Idempotent child spawn event does not match the existing parent event", {
      parentThreadId: input.parentThreadId,
      childThreadId: input.childThreadId,
      mismatches,
    });
  }
}

async function appendChildTerminalEvent(
  engine: ThreadEngine,
  event: Extract<ThreadEvent, { type: "child_thread.completed" | "child_thread.failed" }>,
): Promise<void> {
  try {
    await engine.append([event]);
  } catch (error) {
    const events = await engine.read(event.threadId);
    const existing = events.some((candidate) => {
      return (
        candidate.type === event.type &&
        candidate.scopeKey === event.scopeKey &&
        candidate.stepKey === event.stepKey &&
        candidate.payload.childThreadId === event.payload.childThreadId
      );
    });
    if (existing) {
      return;
    }

    throw error;
  }
}

function newestEvent(events: readonly ThreadEvent[]): ThreadEvent | undefined {
  return events.at(-1);
}

function newestEventOfType<Type extends ThreadEvent["type"]>(
  events: readonly ThreadEvent[],
  type: Type,
): Extract<ThreadEvent, { type: Type }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === type) {
      return event as Extract<ThreadEvent, { type: Type }>;
    }
  }
  return undefined;
}

function newestFailedEvent(
  events: readonly ThreadEvent[],
): Extract<ThreadEvent, { type: "agent.failed" | "tool.failed" }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "agent.failed" || event?.type === "tool.failed") {
      return event;
    }
  }
  return undefined;
}
