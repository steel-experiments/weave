import { randomUUID } from "node:crypto";
import type { MailboxEngine } from "./contracts.js";
import {
  deterministicUuid,
  newEventId,
  nowIso,
  type Actor,
  type MailboxEvent,
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

export class MailboxService {
  constructor(private readonly engine: MailboxEngine) {}

  async startSession(input: string | StartSessionInput): Promise<{ mailboxId: string; correlationId: string }> {
    const normalized = normalizeStartSessionInput(input);
    const mailboxId = normalized.idempotencyKey
      ? deterministicUuid("session-mailbox", normalized.source, normalized.idempotencyKey)
      : randomUUID();
    const correlationId = normalized.idempotencyKey
      ? deterministicUuid("session-correlation", normalized.source, normalized.idempotencyKey)
      : randomUUID();

    await this.engine.createMailbox(mailboxId);

    const existingSession = await readExistingSession(this.engine, mailboxId);
    if (existingSession) {
      return existingSession;
    }

    const events: MailboxEvent[] = [
      {
        eventId: normalized.idempotencyKey
          ? deterministicUuid("session-started", mailboxId, normalized.idempotencyKey)
          : newEventId(),
        mailboxId,
        type: "session.started",
        occurredAt: nowIso(),
        correlationId,
        idempotencyKey: normalized.idempotencyKey,
        actor: { type: "system", id: "mailbox-service" },
        payload: {
          source: normalized.source,
          metadata: normalized.metadata,
        },
      },
      {
        eventId: normalized.idempotencyKey
          ? deterministicUuid("prompt-received", mailboxId, normalized.idempotencyKey)
          : newEventId(),
        mailboxId,
        type: "prompt.received",
        occurredAt: nowIso(),
        correlationId,
        actor: normalized.actor,
        payload: { prompt: normalized.prompt },
      },
    ];

    try {
      await this.engine.append(events);
      return { mailboxId, correlationId };
    } catch (error) {
      if (!normalized.idempotencyKey) {
        throw error;
      }

      const concurrentSession = await readExistingSession(this.engine, mailboxId);
      if (concurrentSession) {
        return concurrentSession;
      }

      throw error;
    }
  }

  async resolveGate(
    mailboxId: string,
    gateId: string,
    resolution: "approved" | "denied",
    comment?: string,
  ): Promise<void> {
    const events = await this.engine.read(mailboxId);
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
        mailboxId,
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
  engine: MailboxEngine,
  mailboxId: string,
): Promise<{ mailboxId: string; correlationId: string } | null> {
  const events = await engine.read(mailboxId, { limit: 2 });
  if (events.length === 0) {
    return null;
  }

  const correlationId = events[0]?.correlationId;
  if (!correlationId) {
    return null;
  }

  return {
    mailboxId,
    correlationId,
  };
}
