import {
  deterministicUuid,
  eventKey,
  nowIso,
  type AgentPlan,
  type AgentPlanner,
  type MailboxEvent,
} from "@agent-mailbox/core";
import { z } from "zod";
import { SteelDocsAuditDataSchema, SteelDocsModelReviewDataSchema } from "./tools.js";

type PromptReceivedEvent = Extract<MailboxEvent, { type: "prompt.received" }>;
type ToolCompletedEvent = Extract<MailboxEvent, { type: "tool.completed" }>;

const SteelDocsSessionMetadataSchema = z.object({
  repository: z.literal("steel-dev/docs"),
  ref: z.string().min(1),
  sha: z.string().min(7),
  mode: z.enum(["production-drift", "pull-request", "manual"]),
  docsBaseUrl: z.string().url(),
  llmsTxtUrl: z.string().url(),
  openApiSpecUrl: z.string().url().optional(),
});

const defaultAuditInput = {
  repository: "steel-dev/docs",
  ref: "refs/heads/main",
  sha: "8d2c4ef",
  mode: "production-drift",
  docsBaseUrl: "https://docs.steel.dev",
  llmsTxtUrl: "https://docs.steel.dev/llms.txt",
  openApiSpecUrl: "https://docs.steel.dev/openapi.json",
} satisfies z.input<typeof SteelDocsSessionMetadataSchema>;

export class DeterministicSteelDocsAgent implements AgentPlanner {
  plan(mailboxId: string, events: MailboxEvent[]): AgentPlan | null {
    const prompt = events.find(isPromptReceivedEvent);
    if (!prompt) {
      return null;
    }

    if (!toolRequested(events, "steel.auditDocsSync")) {
      return this.requestAudit(mailboxId, prompt, events);
    }

    const auditCompleted = completedTool(events, "steel.auditDocsSync");
    if (auditCompleted && !toolRequested(events, "steel.modelReview")) {
      return this.requestModelReview(mailboxId, auditCompleted);
    }

    const reviewCompleted = completedTool(events, "steel.modelReview");
    if (reviewCompleted && !events.some((event) => event.type === "agent.response.produced")) {
      return this.produceReport(mailboxId, reviewCompleted);
    }

    return null;
  }

  private requestAudit(mailboxId: string, cause: PromptReceivedEvent, events: MailboxEvent[]): AgentPlan {
    const stepId = deterministicUuid("steel-step", mailboxId, "request-audit");
    const auditInput = readAuditInput(events) ?? defaultAuditInput;
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
            args: auditInput,
          },
        },
        this.stepCompleted(mailboxId, cause, stepId, "requested-tool"),
      ],
    };
  }

  private requestModelReview(mailboxId: string, cause: ToolCompletedEvent): AgentPlan {
    const stepId = deterministicUuid("steel-step", mailboxId, "request-model-review");
    const auditData = SteelDocsAuditDataSchema.parse(cause.payload.output.data);

    return {
      resumeReason: "tool-completed",
      events: [
        this.stepStarted(mailboxId, cause, stepId, "tool-completed"),
        {
          eventId: eventKey(mailboxId, "tool.requested", "steel.modelReview"),
          mailboxId,
          type: "tool.requested",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "steel-docs-agent" },
          payload: {
            toolCallId: deterministicUuid("steel-tool-call", mailboxId, "steel.modelReview"),
            toolName: "steel.modelReview",
            args: auditData,
          },
        },
        this.stepCompleted(mailboxId, cause, stepId, "requested-tool"),
      ],
    };
  }

  private produceReport(mailboxId: string, cause: ToolCompletedEvent): AgentPlan {
    const stepId = deterministicUuid("steel-step", mailboxId, "produce-report");
    const review = SteelDocsModelReviewDataSchema.parse(cause.payload.output.data);
    const findingEvents: MailboxEvent[] = review.findings.map((finding, index) => ({
      eventId: eventKey(mailboxId, "agent.finding.produced", `steel-model-review:${index}`),
      mailboxId,
      type: "agent.finding.produced",
      occurredAt: nowIso(),
      correlationId: cause.correlationId,
      causationId: cause.eventId,
      actor: { type: "agent", id: "steel-docs-agent" },
      payload: {
        findingId: deterministicUuid("steel-finding", mailboxId, `model-review:${index}`),
        severity: finding.severity,
        summary: finding.summary,
        evidence: finding.evidence.map((evidence, evidenceIndex) => ({
          source: `model:${index}:${evidenceIndex}`,
          summary: evidence,
        })),
      },
    }));

    return {
      resumeReason: "tool-completed",
      events: [
        this.stepStarted(mailboxId, cause, stepId, "tool-completed"),
        ...findingEvents,
        {
          eventId: eventKey(mailboxId, "agent.response.produced", "steel-final"),
          mailboxId,
          type: "agent.response.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "steel-docs-agent" },
          payload: {
            message: review.finalMessage,
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

function readAuditInput(events: MailboxEvent[]): z.output<typeof SteelDocsSessionMetadataSchema> | null {
  const sessionStarted = events.find(
    (event): event is Extract<MailboxEvent, { type: "session.started" }> => event.type === "session.started",
  );
  if (!sessionStarted?.payload.metadata) {
    return null;
  }

  const result = SteelDocsSessionMetadataSchema.safeParse(sessionStarted.payload.metadata);
  return result.success ? result.data : null;
}
