import type { MailboxEngine } from "./contracts.js";
import { eventKey, nowIso, type MailboxEvent } from "./events.js";

type ToolRequestedEvent = Extract<MailboxEvent, { type: "tool.requested" }>;

export class MockSreToolWorker {
  constructor(private readonly engine: MailboxEngine) {}

  async processOnce(mailboxId: string): Promise<{ acted: boolean; eventType?: string }> {
    const events = await this.engine.read(mailboxId);
    const request = events.find((event): event is ToolRequestedEvent => {
      if (event.type !== "tool.requested") {
        return false;
      }
      return !hasTerminalEvent(events, event.payload.toolCallId);
    });

    if (!request) {
      return { acted: false };
    }

    const toolCallId = request.payload.toolCallId;
    const started = events.some((event) => event.type === "tool.started" && event.payload.toolCallId === toolCallId);
    if (!started) {
      const event = this.startedEvent(mailboxId, request);
      await this.engine.append([event]);
      return { acted: true, eventType: event.type };
    }

    const progressed = events.some((event) => event.type === "tool.progress" && event.payload.toolCallId === toolCallId);
    if (!progressed) {
      const event = this.progressEvent(mailboxId, request);
      await this.engine.append([event]);
      return { acted: true, eventType: event.type };
    }

    const event = this.completedEvent(mailboxId, request);
    await this.engine.append([event]);
    return { acted: true, eventType: event.type };
  }

  private startedEvent(mailboxId: string, request: ToolRequestedEvent): MailboxEvent {
    return {
      eventId: eventKey(mailboxId, "tool.started", request.payload.toolCallId),
      mailboxId,
      type: "tool.started",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: "mock-sre-tool-worker" },
      payload: { toolCallId: request.payload.toolCallId, toolName: request.payload.toolName },
    };
  }

  private progressEvent(mailboxId: string, request: ToolRequestedEvent): MailboxEvent {
    return {
      eventId: eventKey(mailboxId, "tool.progress", `${request.payload.toolCallId}:50`),
      mailboxId,
      type: "tool.progress",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: "mock-sre-tool-worker" },
      payload: {
        toolCallId: request.payload.toolCallId,
        percent: 50,
        message: `querying ${request.payload.toolName}`,
      },
    };
  }

  private completedEvent(mailboxId: string, request: ToolRequestedEvent): MailboxEvent {
    const output = mockOutputFor(request);
    return {
      eventId: eventKey(mailboxId, "tool.completed", request.payload.toolCallId),
      mailboxId,
      type: "tool.completed",
      occurredAt: nowIso(),
      correlationId: request.correlationId,
      causationId: request.eventId,
      actor: { type: "worker", id: "mock-sre-tool-worker" },
      payload: {
        toolCallId: request.payload.toolCallId,
        output,
      },
    };
  }
}

function hasTerminalEvent(events: MailboxEvent[], toolCallId: string): boolean {
  return events.some((event) => {
    if (event.type !== "tool.completed" && event.type !== "tool.failed") {
      return false;
    }
    return event.payload.toolCallId === toolCallId;
  });
}

function mockOutputFor(request: ToolRequestedEvent): {
  summary: string;
  requiresManualApproval: boolean;
  data: unknown;
} {
  switch (request.payload.toolName) {
    case "axiom.searchLogs":
      return {
        summary: "Axiom found 184 DatabaseTimeoutError logs from checkout-api in production after the latest deploy.",
        requiresManualApproval: false,
        data: {
          errorPattern: "DatabaseTimeoutError",
          service: "checkout-api",
          count: 184,
          sample: "DatabaseTimeoutError: checkout write timed out after 3000ms",
        },
      };
    case "grafana.queryMetrics":
      return {
        summary: "Grafana shows checkout-api 5xx rate peaked at 12%, p95 latency hit 3.4s, and DB pool wait rose sharply.",
        requiresManualApproval: false,
        data: {
          fiveXxRate: "12%",
          latencyP95: "3.4s",
          dbPoolWaitMs: 920,
        },
      };
    case "sentry.findIssues":
      return {
        summary: "Sentry issue CHECKOUT-DB-TIMEOUT started in release checkout-api@2026.05.20.1.",
        requiresManualApproval: false,
        data: {
          issue: "CHECKOUT-DB-TIMEOUT",
          release: "checkout-api@2026.05.20.1",
          stackTop: "CheckoutRepository.createOrder -> DatabaseClient.transaction",
        },
      };
    case "deploy.inspectRecentChanges":
      return {
        summary: "Deploy metadata shows checkout-api@2026.05.20.1 shipped 14 minutes before the error spike.",
        requiresManualApproval: false,
        data: {
          service: "checkout-api",
          release: "2026.05.20.1",
          deployedMinutesBeforeSpike: 14,
          author: "demo-release-bot",
        },
      };
    case "infra.rebuildNode":
      return {
        summary: "Mock remediation completed: nats-prod-1 was drained, rebuilt, and returned to service.",
        requiresManualApproval: false,
        data: {
          nodeId: "nats-prod-1",
          action: "rebuild",
          status: "completed",
        },
      };
    case "mock.async-progress":
      return {
        summary: "mock async tool completed successfully",
        requiresManualApproval: true,
        data: {},
      };
  }
}
