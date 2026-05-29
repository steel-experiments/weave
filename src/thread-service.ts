import { randomUUID } from "node:crypto";
import type { ThreadEngine } from "./contracts.js";
import {
  deterministicUuid,
  newEventId,
  nowIso,
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
