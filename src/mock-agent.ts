import {
  deterministicUuid,
  eventKey,
  nowIso,
  type ThreadEvent,
} from "./events.js";
import { isLegacyToolCompletionOutput } from "./tool-contract.js";

type PromptReceivedEvent = Extract<ThreadEvent, { type: "prompt.received" }>;
type ToolRequestedEvent = Extract<ThreadEvent, { type: "tool.requested" }>;
type ToolCompletedEvent = Extract<ThreadEvent, { type: "tool.completed" }>;
type GateCreatedEvent = Extract<ThreadEvent, { type: "gate.created" }>;
type GateResolvedEvent = Extract<ThreadEvent, { type: "gate.resolved" }>;

export type MockAgentPlan = {
  resumeReason: "new-prompt" | "tool-completed" | "gate-resolved";
  events: ThreadEvent[];
};

export class DeterministicMockAgent {
  plan(threadId: string, events: ThreadEvent[]): MockAgentPlan | null {
    const prompt = events.find(isPromptReceivedEvent);
    if (!prompt) {
      return null;
    }

    const toolRequested = events.find(isToolRequestedEvent);
    if (!toolRequested) {
      return this.requestTool(threadId, prompt);
    }

    const toolCompleted = events.find(
      (event): event is ToolCompletedEvent =>
        event.type === "tool.completed" && event.payload.toolCallId === toolRequested.payload.toolCallId,
    );

    if (isLegacyToolCompletionOutput(toolCompleted?.payload.output) && toolCompleted.payload.output.requiresManualApproval) {
      const gateCreated = events.find(
        (event): event is GateCreatedEvent =>
          event.type === "gate.created" && event.payload.relatedToolCallId === toolRequested.payload.toolCallId,
      );

      if (!gateCreated) {
        return this.createGate(threadId, toolCompleted, toolRequested.payload.toolCallId);
      }

      const gateResolved = events.find(
        (event): event is GateResolvedEvent =>
          event.type === "gate.resolved" && event.payload.gateId === gateCreated.payload.gateId,
      );

      const responseProduced = events.some((event) => event.type === "agent.response.produced");
      if (gateResolved && !responseProduced) {
        return this.produceResponse(threadId, gateResolved, toolCompleted);
      }
    }

    return null;
  }

  private requestTool(threadId: string, prompt: PromptReceivedEvent): MockAgentPlan {
    const stepId = deterministicUuid("step", threadId, "request-tool");
    const toolCallId = deterministicUuid("tool-call", threadId, "mock.async-progress", "first");
    const correlationId = prompt.correlationId;

    return {
      resumeReason: "new-prompt",
      events: [
        {
          eventId: eventKey(threadId, "agent.step.started", "request-tool"),
          threadId,
          type: "agent.step.started",
          occurredAt: nowIso(),
          correlationId,
          causationId: prompt.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { stepId, reason: "prompt" },
        },
        {
          eventId: eventKey(threadId, "tool.requested", toolCallId),
          threadId,
          type: "tool.requested",
          occurredAt: nowIso(),
          correlationId,
          causationId: prompt.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: {
            toolCallId,
            toolName: "mock.async-progress",
            args: { jobLabel: "poc-demo-job" },
          },
        },
        {
          eventId: eventKey(threadId, "agent.step.completed", "request-tool"),
          threadId,
          type: "agent.step.completed",
          occurredAt: nowIso(),
          correlationId,
          causationId: prompt.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { stepId, outcome: "requested-tool" },
        },
      ],
    };
  }

  private createGate(threadId: string, toolCompleted: ToolCompletedEvent, toolCallId: string): MockAgentPlan {
    const stepId = deterministicUuid("step", threadId, "create-gate");
    const gateId = deterministicUuid("gate", threadId, toolCallId);

    return {
      resumeReason: "tool-completed",
      events: [
        {
          eventId: eventKey(threadId, "agent.step.started", "create-gate"),
          threadId,
          type: "agent.step.started",
          occurredAt: nowIso(),
          correlationId: toolCompleted.correlationId,
          causationId: toolCompleted.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { stepId, reason: "tool-completed" },
        },
        {
          eventId: eventKey(threadId, "gate.created", gateId),
          threadId,
          type: "gate.created",
          occurredAt: nowIso(),
          correlationId: toolCompleted.correlationId,
          causationId: toolCompleted.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: {
            gateId,
            gateType: "manual-approval",
            reason: "tool-result-requires-approval",
            relatedToolCallId: toolCallId,
          },
        },
        {
          eventId: eventKey(threadId, "agent.step.completed", "create-gate"),
          threadId,
          type: "agent.step.completed",
          occurredAt: nowIso(),
          correlationId: toolCompleted.correlationId,
          causationId: toolCompleted.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { stepId, outcome: "created-gate" },
        },
      ],
    };
  }

  private produceResponse(
    threadId: string,
    gateResolved: GateResolvedEvent,
    toolCompleted: ToolCompletedEvent,
  ): MockAgentPlan {
    const stepId = deterministicUuid("step", threadId, "produce-response");
    const approved = gateResolved.payload.resolution === "approved";
    const summary = toolCompleted.payload.summary ?? legacySummary(toolCompleted.payload.output) ?? "tool completed";
    const message = approved
      ? `Approved result: ${summary}`
      : "The manual approval gate was denied, so the session was cancelled.";

    return {
      resumeReason: "gate-resolved",
      events: [
        {
          eventId: eventKey(threadId, "agent.step.started", "produce-response"),
          threadId,
          type: "agent.step.started",
          occurredAt: nowIso(),
          correlationId: gateResolved.correlationId,
          causationId: gateResolved.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { stepId, reason: "gate-resolved" },
        },
        {
          eventId: eventKey(threadId, "agent.response.produced", "final"),
          threadId,
          type: "agent.response.produced",
          occurredAt: nowIso(),
          correlationId: gateResolved.correlationId,
          causationId: gateResolved.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { message },
        },
        {
          eventId: eventKey(threadId, "agent.step.completed", "produce-response"),
          threadId,
          type: "agent.step.completed",
          occurredAt: nowIso(),
          correlationId: gateResolved.correlationId,
          causationId: gateResolved.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { stepId, outcome: "produced-response" },
        },
      ],
    };
  }
}

function legacySummary(output: unknown): string | undefined {
  return isLegacyToolCompletionOutput(output) ? output.summary : undefined;
}

function isPromptReceivedEvent(event: ThreadEvent): event is PromptReceivedEvent {
  return event.type === "prompt.received";
}

function isToolRequestedEvent(event: ThreadEvent): event is ToolRequestedEvent {
  return event.type === "tool.requested";
}
