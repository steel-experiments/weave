import { randomUUID } from "node:crypto";
import type { ThreadEngine } from "./contracts.js";
import type { ThreadRef } from "./agent-contract.js";
import {
  deterministicUuid,
  newEventId,
  nowIso,
  stableJsonHash,
  type Actor,
  type ThreadEvent,
  type SessionMetadata,
  type SessionSource,
} from "./events.js";

export type StartSessionInput = {
  prompt: string;
  source?: SessionSource;
  actor?: Actor;
  metadata?: SessionMetadata;
  idempotencyKey?: string;
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
      return existingSession;
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
        return concurrentSession;
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

    const existingSession = await readExistingSession(this.engine, threadId);
    const correlationId = existingSession?.correlationId ?? generatedCorrelationId;

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

    const parentEvents = await this.engine.read(input.parentThreadId);
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
      const event: Extract<ThreadEvent, { type: "child_thread.completed" }> = {
        ...base,
        eventId: deterministicUuid("child-thread-completed", input.parentThreadId, input.parentScopeKey, input.parentStepKey, input.childThreadId),
        type: "child_thread.completed",
        idempotencyKey: `child-thread-completed:${input.parentScopeKey}:${input.parentStepKey}:${input.childThreadId}`,
        payload: {
          childThreadId: input.childThreadId,
          ...(input.childAgentName ? { childAgentName: input.childAgentName } : {}),
          ...(response?.payload.message ? { outputSummary: response.payload.message } : {}),
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

      const projection = await this.engine.getProjection(event.payload.childThreadId);
      refs.push({
        threadId: event.payload.childThreadId,
        agentName: event.payload.childAgentName,
        parentThreadId,
        rootThreadId: projection?.rootThreadId ?? undefined,
        parentScopeKey: event.payload.scopeKey,
        parentStepKey: event.payload.stepKey,
      });
    }

    return refs;
  }

  async resolveGate(
    threadId: string,
    gateId: string,
    resolution: "approved" | "denied",
    comment?: string,
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
        actor: { type: "human", id: "demo-approver" },
        payload: { gateId, resolution, comment },
      },
    ]);
  }
}

function normalizeStartSessionInput(input: string | StartSessionInput): Required<Pick<StartSessionInput, "prompt" | "source" | "actor">> & {
  metadata?: SessionMetadata;
  idempotencyKey?: string;
} {
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
    actor: input.actor ?? { type: "user", id: "demo-user" },
    metadata: input.metadata,
    idempotencyKey: input.idempotencyKey,
  };
}

async function readExistingSession(
  engine: ThreadEngine,
  threadId: string,
): Promise<{ threadId: string; correlationId: string } | null> {
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
  const existing = parentEvents.some((event) => {
    return event.type === "child_thread.spawned" && event.payload.childThreadId === input.childThreadId;
  });
  if (existing) {
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
    const concurrentEvent = concurrentEvents.some((candidate) => {
      return candidate.type === "child_thread.spawned" && candidate.payload.childThreadId === input.childThreadId;
    });
    if (concurrentEvent) {
      return;
    }

    throw error;
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
