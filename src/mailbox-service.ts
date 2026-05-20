import { randomUUID } from "node:crypto";
import type { MailboxEngine } from "./contracts.js";
import { newEventId, nowIso, type MailboxEvent } from "./events.js";

export class MailboxService {
  constructor(private readonly engine: MailboxEngine) {}

  async startSession(prompt: string): Promise<{ mailboxId: string; correlationId: string }> {
    const mailboxId = randomUUID();
    const correlationId = randomUUID();
    await this.engine.createMailbox(mailboxId);

    const events: MailboxEvent[] = [
      {
        eventId: newEventId(),
        mailboxId,
        type: "session.started",
        occurredAt: nowIso(),
        correlationId,
        actor: { type: "system", id: "poc" },
        payload: { source: "test" },
      },
      {
        eventId: newEventId(),
        mailboxId,
        type: "prompt.received",
        occurredAt: nowIso(),
        correlationId,
        actor: { type: "user", id: "demo-user" },
        payload: { prompt },
      },
    ];

    await this.engine.append(events);
    return { mailboxId, correlationId };
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
