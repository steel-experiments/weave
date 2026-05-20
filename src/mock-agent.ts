import {
  deterministicUuid,
  eventKey,
  nowIso,
  type MailboxEvent,
} from "./events.js";

type PromptReceivedEvent = Extract<MailboxEvent, { type: "prompt.received" }>;
type ToolRequestedEvent = Extract<MailboxEvent, { type: "tool.requested" }>;
type ToolCompletedEvent = Extract<MailboxEvent, { type: "tool.completed" }>;
type GateCreatedEvent = Extract<MailboxEvent, { type: "gate.created" }>;
type GateResolvedEvent = Extract<MailboxEvent, { type: "gate.resolved" }>;

export type MockAgentPlan = {
  resumeReason: "new-prompt" | "tool-completed" | "gate-resolved";
  events: MailboxEvent[];
};

export class DeterministicMockAgent {
  plan(mailboxId: string, events: MailboxEvent[]): MockAgentPlan | null {
    const prompt = events.find(isPromptReceivedEvent);
    if (!prompt) {
      return null;
    }

    const toolRequested = events.find(isToolRequestedEvent);
    if (!toolRequested) {
      return this.requestTool(mailboxId, prompt);
    }

    const toolCompleted = events.find(
      (event): event is ToolCompletedEvent =>
        event.type === "tool.completed" && event.payload.toolCallId === toolRequested.payload.toolCallId,
    );

    if (toolCompleted?.payload.output.requiresManualApproval) {
      const gateCreated = events.find(
        (event): event is GateCreatedEvent =>
          event.type === "gate.created" && event.payload.relatedToolCallId === toolRequested.payload.toolCallId,
      );

      if (!gateCreated) {
        return this.createGate(mailboxId, toolCompleted, toolRequested.payload.toolCallId);
      }

      const gateResolved = events.find(
        (event): event is GateResolvedEvent =>
          event.type === "gate.resolved" && event.payload.gateId === gateCreated.payload.gateId,
      );

      const responseProduced = events.some((event) => event.type === "agent.response.produced");
      if (gateResolved && !responseProduced) {
        return this.produceResponse(mailboxId, gateResolved, toolCompleted);
      }
    }

    return null;
  }

  private requestTool(mailboxId: string, prompt: PromptReceivedEvent): MockAgentPlan {
    const stepId = deterministicUuid("step", mailboxId, "request-tool");
    const toolCallId = deterministicUuid("tool-call", mailboxId, "mock.async-progress", "first");
    const correlationId = prompt.correlationId;

    return {
      resumeReason: "new-prompt",
      events: [
        {
          eventId: eventKey(mailboxId, "agent.step.started", "request-tool"),
          mailboxId,
          type: "agent.step.started",
          occurredAt: nowIso(),
          correlationId,
          causationId: prompt.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { stepId, reason: "prompt" },
        },
        {
          eventId: eventKey(mailboxId, "tool.requested", toolCallId),
          mailboxId,
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
          eventId: eventKey(mailboxId, "agent.step.completed", "request-tool"),
          mailboxId,
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

  private createGate(mailboxId: string, toolCompleted: ToolCompletedEvent, toolCallId: string): MockAgentPlan {
    const stepId = deterministicUuid("step", mailboxId, "create-gate");
    const gateId = deterministicUuid("gate", mailboxId, toolCallId);

    return {
      resumeReason: "tool-completed",
      events: [
        {
          eventId: eventKey(mailboxId, "agent.step.started", "create-gate"),
          mailboxId,
          type: "agent.step.started",
          occurredAt: nowIso(),
          correlationId: toolCompleted.correlationId,
          causationId: toolCompleted.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { stepId, reason: "tool-completed" },
        },
        {
          eventId: eventKey(mailboxId, "gate.created", gateId),
          mailboxId,
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
          eventId: eventKey(mailboxId, "agent.step.completed", "create-gate"),
          mailboxId,
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
    mailboxId: string,
    gateResolved: GateResolvedEvent,
    toolCompleted: ToolCompletedEvent,
  ): MockAgentPlan {
    const stepId = deterministicUuid("step", mailboxId, "produce-response");
    const approved = gateResolved.payload.resolution === "approved";
    const message = approved
      ? `Approved result: ${toolCompleted.payload.output.summary}`
      : "The manual approval gate was denied, so the session was cancelled.";

    return {
      resumeReason: "gate-resolved",
      events: [
        {
          eventId: eventKey(mailboxId, "agent.step.started", "produce-response"),
          mailboxId,
          type: "agent.step.started",
          occurredAt: nowIso(),
          correlationId: gateResolved.correlationId,
          causationId: gateResolved.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { stepId, reason: "gate-resolved" },
        },
        {
          eventId: eventKey(mailboxId, "agent.response.produced", "final"),
          mailboxId,
          type: "agent.response.produced",
          occurredAt: nowIso(),
          correlationId: gateResolved.correlationId,
          causationId: gateResolved.eventId,
          actor: { type: "agent", id: "mock-agent" },
          payload: { message },
        },
        {
          eventId: eventKey(mailboxId, "agent.step.completed", "produce-response"),
          mailboxId,
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

function isPromptReceivedEvent(event: MailboxEvent): event is PromptReceivedEvent {
  return event.type === "prompt.received";
}

function isToolRequestedEvent(event: MailboxEvent): event is ToolRequestedEvent {
  return event.type === "tool.requested";
}
