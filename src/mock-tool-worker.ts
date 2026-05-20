import type { MailboxEngine } from "./contracts.js";
import { eventKey, nowIso, type MailboxEvent } from "./events.js";

type ToolRequestedEvent = Extract<MailboxEvent, { type: "tool.requested" }>;

const progressSteps = [
  { percent: 25, message: "queued" },
  { percent: 50, message: "processing" },
  { percent: 75, message: "finalizing" },
] as const;

export class MockAsyncToolWorker {
  constructor(private readonly engine: MailboxEngine) {}

  async processOnce(mailboxId: string): Promise<{ acted: boolean; eventType?: string }> {
    const events = await this.engine.read(mailboxId);
    const request = events.find(isToolRequestedEvent);

    if (!request) {
      return { acted: false };
    }

    const toolCallId = request.payload.toolCallId;
    const completed = events.some(
      (event) => event.type === "tool.completed" && event.payload.toolCallId === toolCallId,
    );
    const failed = events.some((event) => event.type === "tool.failed" && event.payload.toolCallId === toolCallId);

    if (completed || failed) {
      return { acted: false };
    }

    const started = events.some((event) => event.type === "tool.started" && event.payload.toolCallId === toolCallId);
    if (!started) {
      const event = this.startedEvent(mailboxId, request);
      await this.engine.append([event]);
      return { acted: true, eventType: event.type };
    }

    const progressCount = events.filter(
      (event) => event.type === "tool.progress" && event.payload.toolCallId === toolCallId,
    ).length;
    const nextProgress = progressSteps[progressCount];

    if (nextProgress) {
      const event = this.progressEvent(mailboxId, request, nextProgress.percent, nextProgress.message);
      await this.engine.append([event]);
      return { acted: true, eventType: event.type };
    }

    const event = this.completedEvent(mailboxId, request);
    await this.engine.append([event]);
    return { acted: true, eventType: event.type };
  }

  private startedEvent(mailboxId: string, request: ToolRequestedEvent): MailboxEvent {
    const toolCallId = request.payload.toolCallId;
    return {
      eventId: eventKey(mailboxId, "tool.started", toolCallId),
      mailboxId,
      type: "tool.started",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: "mock-tool-worker" },
      payload: { toolCallId, toolName: "mock.async-progress" },
    };
  }

  private progressEvent(
    mailboxId: string,
    request: ToolRequestedEvent,
    percent: number,
    message: string,
  ): MailboxEvent {
    const toolCallId = request.payload.toolCallId;
    return {
      eventId: eventKey(mailboxId, "tool.progress", `${toolCallId}:${percent}`),
      mailboxId,
      type: "tool.progress",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: "mock-tool-worker" },
      payload: { toolCallId, percent, message },
    };
  }

  private completedEvent(mailboxId: string, request: ToolRequestedEvent): MailboxEvent {
    const toolCallId = request.payload.toolCallId;
    return {
      eventId: eventKey(mailboxId, "tool.completed", toolCallId),
      mailboxId,
      type: "tool.completed",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: "mock-tool-worker" },
      payload: {
        toolCallId,
        output: {
          summary: "mock async tool completed successfully",
          requiresManualApproval: true,
        },
      },
    };
  }
}

function isToolRequestedEvent(event: MailboxEvent): event is ToolRequestedEvent {
  return event.type === "tool.requested";
}
