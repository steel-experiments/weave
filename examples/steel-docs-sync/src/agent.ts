import {
  deterministicUuid,
  eventKey,
  nowIso,
  type AgentPlan,
  type AgentPlanner,
  type MailboxEvent,
} from "@agent-mailbox/core";

type PromptReceivedEvent = Extract<MailboxEvent, { type: "prompt.received" }>;
type ToolCompletedEvent = Extract<MailboxEvent, { type: "tool.completed" }>;

export class DeterministicSteelDocsAgent implements AgentPlanner {
  plan(mailboxId: string, events: MailboxEvent[]): AgentPlan | null {
    const prompt = events.find(isPromptReceivedEvent);
    if (!prompt) {
      return null;
    }

    if (!toolRequested(events, "steel.auditDocsSync")) {
      return this.requestAudit(mailboxId, prompt);
    }

    const auditCompleted = completedTool(events, "steel.auditDocsSync");
    if (auditCompleted && !events.some((event) => event.type === "agent.response.produced")) {
      return this.produceReport(mailboxId, auditCompleted);
    }

    return null;
  }

  private requestAudit(mailboxId: string, cause: PromptReceivedEvent): AgentPlan {
    const stepId = deterministicUuid("steel-step", mailboxId, "request-audit");
    return {
      resumeReason: "new-prompt",
      events: [
        this.stepStarted(mailboxId, cause, stepId, "prompt"),
        {
          eventId: eventKey(mailboxId, "tool.requested", "steel.auditDocsSync"),
          mailboxId,
          type: "tool.requested",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "steel-docs-agent" },
          payload: {
            toolCallId: deterministicUuid("steel-tool-call", mailboxId, "steel.auditDocsSync"),
            toolName: "steel.auditDocsSync",
            args: {
              repository: "steel-dev/docs",
              ref: "refs/heads/main",
              sha: "8d2c4ef",
              mode: "production-drift",
              docsBaseUrl: "https://docs.steel.dev",
              llmsTxtUrl: "https://docs.steel.dev/llms.txt",
              openApiSpecUrl: "https://docs.steel.dev/openapi.json",
            },
          },
        },
        this.stepCompleted(mailboxId, cause, stepId, "requested-tool"),
      ],
    };
  }

  private produceReport(mailboxId: string, cause: ToolCompletedEvent): AgentPlan {
    const stepId = deterministicUuid("steel-step", mailboxId, "produce-report");
    const findingWarningA = deterministicUuid("steel-finding", mailboxId, "llms-api-gap");
    const findingWarningB = deterministicUuid("steel-finding", mailboxId, "openapi-link-gap");

    return {
      resumeReason: "tool-completed",
      events: [
        this.stepStarted(mailboxId, cause, stepId, "tool-completed"),
        {
          eventId: eventKey(mailboxId, "agent.finding.produced", findingWarningA),
          mailboxId,
          type: "agent.finding.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "steel-docs-agent" },
          payload: {
            findingId: findingWarningA,
            severity: "warning",
            summary: "llms.txt coverage lags behind the published API reference navigation.",
            evidence: [
              { source: "llms.txt", summary: "Authentication reference path missing from fixture llms.txt." },
              { source: "docs-nav", summary: "Published navigation includes /reference/api/authentication." },
            ],
          },
        },
        {
          eventId: eventKey(mailboxId, "agent.finding.produced", findingWarningB),
          mailboxId,
          type: "agent.finding.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "steel-docs-agent" },
          payload: {
            findingId: findingWarningB,
            severity: "warning",
            summary: "OpenAPI surface is ahead of the linked docs entry points for agents runs.",
            evidence: [
              { source: "openapi", summary: "Fixture spec includes /v1/agents/runs." },
              { source: "docs-nav", summary: "Fixture landing path has no linked page for agents runs." },
            ],
          },
        },
        {
          eventId: eventKey(mailboxId, "agent.response.produced", "steel-final"),
          mailboxId,
          type: "agent.response.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "steel-docs-agent" },
          payload: {
            message: "Steel docs sync audit completed with 2 warnings. Review llms.txt coverage and agents runs reference linking.",
          },
        },
        this.stepCompleted(mailboxId, cause, stepId, "produced-response"),
      ],
    };
  }

  private stepStarted(
    mailboxId: string,
    cause: MailboxEvent,
    stepId: string,
    reason: "prompt" | "tool-completed" | "gate-resolved" | "manual-resume",
  ): MailboxEvent {
    return {
      eventId: eventKey(mailboxId, "agent.step.started", stepId),
      mailboxId,
      type: "agent.step.started",
      occurredAt: nowIso(),
      correlationId: cause.correlationId,
      causationId: cause.eventId,
      actor: { type: "agent", id: "steel-docs-agent" },
      payload: { stepId, reason },
    };
  }

  private stepCompleted(
    mailboxId: string,
    cause: MailboxEvent,
    stepId: string,
    outcome: "requested-tool" | "produced-response",
  ): MailboxEvent {
    return {
      eventId: eventKey(mailboxId, "agent.step.completed", stepId),
      mailboxId,
      type: "agent.step.completed",
      occurredAt: nowIso(),
      correlationId: cause.correlationId,
      causationId: cause.eventId,
      actor: { type: "agent", id: "steel-docs-agent" },
      payload: { stepId, outcome },
    };
  }
}

function isPromptReceivedEvent(event: MailboxEvent): event is PromptReceivedEvent {
  return event.type === "prompt.received";
}

function toolRequested(events: MailboxEvent[], toolName: string): boolean {
  return events.some((event) => event.type === "tool.requested" && event.payload.toolName === toolName);
}

function completedTool(events: MailboxEvent[], toolName: string): ToolCompletedEvent | undefined {
  return events.find(
    (event): event is ToolCompletedEvent => event.type === "tool.completed" && requestedToolName(events, event) === toolName,
  );
}

function requestedToolName(events: MailboxEvent[], event: ToolCompletedEvent): string | undefined {
  const request = events.find(
    (candidate): candidate is Extract<MailboxEvent, { type: "tool.requested" }> =>
      candidate.type === "tool.requested" && candidate.payload.toolCallId === event.payload.toolCallId,
  );
  return request?.payload.toolName;
}
