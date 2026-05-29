import {
  deterministicUuid,
  eventKey,
  nowIso,
  type AgentPlan,
  type AgentPlanner,
  type ThreadEvent,
} from "weave";
import { z } from "zod";
import { SteelDocsAuditDataSchema, SteelDocsModelReviewDataSchema } from "./tools.js";

type PromptReceivedEvent = Extract<ThreadEvent, { type: "prompt.received" }>;
type ToolCompletedEvent = Extract<ThreadEvent, { type: "tool.completed" }>;

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
  plan(threadId: string, events: ThreadEvent[]): AgentPlan | null {
    const prompt = events.find(isPromptReceivedEvent);
    if (!prompt) {
      return null;
    }

    if (!toolRequested(events, "steel.auditDocsSync")) {
      return this.requestAudit(threadId, prompt, events);
    }

    const auditCompleted = completedTool(events, "steel.auditDocsSync");
    if (auditCompleted && !toolRequested(events, "steel.modelReview")) {
      return this.requestModelReview(threadId, auditCompleted);
    }

    const reviewCompleted = completedTool(events, "steel.modelReview");
    if (reviewCompleted && !events.some((event) => event.type === "agent.response.produced")) {
      return this.produceReport(threadId, reviewCompleted);
    }

    return null;
  }

  private requestAudit(threadId: string, cause: PromptReceivedEvent, events: ThreadEvent[]): AgentPlan {
    const stepId = deterministicUuid("steel-step", threadId, "request-audit");
    const auditInput = readAuditInput(events) ?? defaultAuditInput;
    return {
      resumeReason: "new-prompt",
      events: [
        this.stepStarted(threadId, cause, stepId, "prompt"),
        {
          eventId: eventKey(threadId, "tool.requested", "steel.auditDocsSync"),
          threadId,
          type: "tool.requested",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "steel-docs-agent" },
          payload: {
            toolCallId: deterministicUuid("steel-tool-call", threadId, "steel.auditDocsSync"),
            toolName: "steel.auditDocsSync",
            args: auditInput,
          },
        },
        this.stepCompleted(threadId, cause, stepId, "requested-tool"),
      ],
    };
  }

  private requestModelReview(threadId: string, cause: ToolCompletedEvent): AgentPlan {
    const stepId = deterministicUuid("steel-step", threadId, "request-model-review");
    const auditData = SteelDocsAuditDataSchema.parse(cause.payload.output.data);

    return {
      resumeReason: "tool-completed",
      events: [
        this.stepStarted(threadId, cause, stepId, "tool-completed"),
        {
          eventId: eventKey(threadId, "tool.requested", "steel.modelReview"),
          threadId,
          type: "tool.requested",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "steel-docs-agent" },
          payload: {
            toolCallId: deterministicUuid("steel-tool-call", threadId, "steel.modelReview"),
            toolName: "steel.modelReview",
            args: auditData,
          },
        },
        this.stepCompleted(threadId, cause, stepId, "requested-tool"),
      ],
    };
  }

  private produceReport(threadId: string, cause: ToolCompletedEvent): AgentPlan {
    const stepId = deterministicUuid("steel-step", threadId, "produce-report");
    const review = SteelDocsModelReviewDataSchema.parse(cause.payload.output.data);
    const findingEvents: ThreadEvent[] = review.findings.map((finding, index) => ({
      eventId: eventKey(threadId, "agent.finding.produced", `steel-model-review:${index}`),
      threadId,
      type: "agent.finding.produced",
      occurredAt: nowIso(),
      correlationId: cause.correlationId,
      causationId: cause.eventId,
      actor: { type: "agent", id: "steel-docs-agent" },
      payload: {
        findingId: deterministicUuid("steel-finding", threadId, `model-review:${index}`),
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
        this.stepStarted(threadId, cause, stepId, "tool-completed"),
        ...findingEvents,
        {
          eventId: eventKey(threadId, "agent.response.produced", "steel-final"),
          threadId,
          type: "agent.response.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "steel-docs-agent" },
          payload: {
            message: review.finalMessage,
          },
        },
        this.stepCompleted(threadId, cause, stepId, "produced-response"),
      ],
    };
  }

  private stepStarted(
    threadId: string,
    cause: ThreadEvent,
    stepId: string,
    reason: "prompt" | "tool-completed" | "gate-resolved" | "manual-resume",
  ): ThreadEvent {
    return {
      eventId: eventKey(threadId, "agent.step.started", stepId),
      threadId,
      type: "agent.step.started",
      occurredAt: nowIso(),
      correlationId: cause.correlationId,
      causationId: cause.eventId,
      actor: { type: "agent", id: "steel-docs-agent" },
      payload: { stepId, reason },
    };
  }

  private stepCompleted(
    threadId: string,
    cause: ThreadEvent,
    stepId: string,
    outcome: "requested-tool" | "produced-response",
  ): ThreadEvent {
    return {
      eventId: eventKey(threadId, "agent.step.completed", stepId),
      threadId,
      type: "agent.step.completed",
      occurredAt: nowIso(),
      correlationId: cause.correlationId,
      causationId: cause.eventId,
      actor: { type: "agent", id: "steel-docs-agent" },
      payload: { stepId, outcome },
    };
  }
}

function isPromptReceivedEvent(event: ThreadEvent): event is PromptReceivedEvent {
  return event.type === "prompt.received";
}

function toolRequested(events: ThreadEvent[], toolName: string): boolean {
  return events.some((event) => event.type === "tool.requested" && event.payload.toolName === toolName);
}

function completedTool(events: ThreadEvent[], toolName: string): ToolCompletedEvent | undefined {
  return events.find(
    (event): event is ToolCompletedEvent => event.type === "tool.completed" && requestedToolName(events, event) === toolName,
  );
}

function requestedToolName(events: ThreadEvent[], event: ToolCompletedEvent): string | undefined {
  const request = events.find(
    (candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
      candidate.type === "tool.requested" && candidate.payload.toolCallId === event.payload.toolCallId,
  );
  return request?.payload.toolName;
}

function readAuditInput(events: ThreadEvent[]): z.output<typeof SteelDocsSessionMetadataSchema> | null {
  const sessionStarted = events.find(
    (event): event is Extract<ThreadEvent, { type: "session.started" }> => event.type === "session.started",
  );
  if (!sessionStarted?.payload.metadata) {
    return null;
  }

  const result = SteelDocsSessionMetadataSchema.safeParse(sessionStarted.payload.metadata);
  return result.success ? result.data : null;
}
