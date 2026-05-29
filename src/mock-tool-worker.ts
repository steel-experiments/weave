import type { ThreadEngine } from "./contracts.js";
import { eventKey, nowIso, type ThreadEvent } from "./events.js";

type ToolRequestedEvent = Extract<ThreadEvent, { type: "tool.requested" }>;

const progressSteps = [
  { percent: 25, message: "queued" },
  { percent: 50, message: "processing" },
  { percent: 75, message: "finalizing" },
] as const;

export class MockAsyncToolWorker {
  constructor(private readonly engine: ThreadEngine) {}

  async processOnce(threadId: string): Promise<{ acted: boolean; eventType?: string }> {
    const events = await this.engine.read(threadId);
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
      const event = this.startedEvent(threadId, request);
      await this.engine.append([event]);
      return { acted: true, eventType: event.type };
    }

    const progressCount = events.filter(
      (event) => event.type === "tool.progress" && event.payload.toolCallId === toolCallId,
    ).length;
    const nextProgress = progressSteps[progressCount];

    if (nextProgress) {
      const event = this.progressEvent(threadId, request, nextProgress.percent, nextProgress.message);
      await this.engine.append([event]);
      return { acted: true, eventType: event.type };
    }

    const event = this.completedEvent(threadId, request);
    await this.engine.append([event]);
    return { acted: true, eventType: event.type };
  }

  private startedEvent(threadId: string, request: ToolRequestedEvent): ThreadEvent {
    const toolCallId = request.payload.toolCallId;
    return {
      eventId: eventKey(threadId, "tool.started", toolCallId),
      threadId,
      type: "tool.started",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: "mock-tool-worker" },
      payload: { toolCallId, toolName: "mock.async-progress" },
    };
  }

  private progressEvent(
    threadId: string,
    request: ToolRequestedEvent,
    percent: number,
    message: string,
  ): ThreadEvent {
    const toolCallId = request.payload.toolCallId;
    return {
      eventId: eventKey(threadId, "tool.progress", `${toolCallId}:${percent}`),
      threadId,
      type: "tool.progress",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: "mock-tool-worker" },
      payload: { toolCallId, percent, message },
    };
  }

  private completedEvent(threadId: string, request: ToolRequestedEvent): ThreadEvent {
    const toolCallId = request.payload.toolCallId;
    return {
      eventId: eventKey(threadId, "tool.completed", toolCallId),
      threadId,
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

function isToolRequestedEvent(event: ThreadEvent): event is ToolRequestedEvent {
  return event.type === "tool.requested";
}
