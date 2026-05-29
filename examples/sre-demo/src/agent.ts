import {
  deterministicUuid,
  eventKey,
  nowIso,
  type AgentPlan,
  type AgentPlanner,
  type ThreadEvent,
} from "weave";
import type { SreToolName } from "./tools.js";

type PromptReceivedEvent = Extract<ThreadEvent, { type: "prompt.received" }>;
type ToolRequestedEvent = Extract<ThreadEvent, { type: "tool.requested" }>;
type ToolCompletedEvent = Extract<ThreadEvent, { type: "tool.completed" }>;
type GateCreatedEvent = Extract<ThreadEvent, { type: "gate.created" }>;
type GateResolvedEvent = Extract<ThreadEvent, { type: "gate.resolved" }>;

export class DeterministicSreAgent implements AgentPlanner {
  plan(threadId: string, events: ThreadEvent[]): AgentPlan | null {
    const prompt = events.find(isPromptReceivedEvent);
    if (!prompt) {
      return null;
    }

    if (!toolRequested(events, "axiom.searchLogs")) {
      return this.requestAxiom(threadId, prompt);
    }

    if (toolCompleted(events, "axiom.searchLogs") && !toolRequested(events, "grafana.queryMetrics")) {
      return this.requestGrafana(threadId, completedTool(events, "axiom.searchLogs") ?? prompt);
    }

    if (toolCompleted(events, "grafana.queryMetrics") && !toolRequested(events, "sentry.findIssues")) {
      return this.requestSentry(threadId, completedTool(events, "grafana.queryMetrics") ?? prompt);
    }

    if (toolCompleted(events, "sentry.findIssues") && !toolRequested(events, "deploy.inspectRecentChanges")) {
      return this.requestDeploy(threadId, completedTool(events, "sentry.findIssues") ?? prompt);
    }

    const deployCompleted = completedTool(events, "deploy.inspectRecentChanges");
    if (deployCompleted && !events.some((event) => event.type === "agent.finding.produced")) {
      return this.produceFindingAndGate(threadId, deployCompleted);
    }

    const gateCreated = events.find(
      (event): event is GateCreatedEvent => event.type === "gate.created" && event.payload.reason === "risky-remediation",
    );
    const gateResolved = gateCreated
      ? events.find(
          (event): event is GateResolvedEvent =>
            event.type === "gate.resolved" && event.payload.gateId === gateCreated.payload.gateId,
        )
      : undefined;

    if (gateResolved?.payload.resolution === "approved" && !toolRequested(events, "infra.rebuildNode")) {
      return this.requestRebuild(threadId, gateResolved);
    }

    if (gateResolved?.payload.resolution === "denied" && !events.some((event) => event.type === "agent.incident_report.produced")) {
      return this.produceDeniedReport(threadId, gateResolved);
    }

    const rebuildCompleted = completedTool(events, "infra.rebuildNode");
    if (rebuildCompleted && !events.some((event) => event.type === "agent.incident_report.produced")) {
      return this.produceFinalReport(threadId, rebuildCompleted);
    }

    return null;
  }

  private requestAxiom(threadId: string, cause: PromptReceivedEvent): AgentPlan {
    return this.toolPlan(threadId, cause, "new-prompt", "axiom.searchLogs", {
      environment: "production",
      query: "service:checkout-api level:error DatabaseTimeoutError",
      timeRangeMinutes: 30,
      limit: 20,
    });
  }

  private requestGrafana(threadId: string, cause: ThreadEvent): AgentPlan {
    return this.toolPlan(threadId, cause, "tool-completed", "grafana.queryMetrics", {
      environment: "production",
      service: "checkout-api",
      metrics: ["http_5xx_rate", "latency_p95", "db_pool_wait_ms"],
      timeRangeMinutes: 30,
    });
  }

  private requestSentry(threadId: string, cause: ThreadEvent): AgentPlan {
    return this.toolPlan(threadId, cause, "tool-completed", "sentry.findIssues", {
      environment: "production",
      project: "checkout-api",
      query: "DatabaseTimeoutError release:latest",
      timeRangeMinutes: 30,
    });
  }

  private requestDeploy(threadId: string, cause: ThreadEvent): AgentPlan {
    return this.toolPlan(threadId, cause, "tool-completed", "deploy.inspectRecentChanges", {
      environment: "production",
      service: "checkout-api",
      timeRangeMinutes: 60,
    });
  }

  private requestRebuild(threadId: string, cause: GateResolvedEvent): AgentPlan {
    return this.toolPlan(threadId, cause, "gate-resolved", "infra.rebuildNode", {
      environment: "production",
      nodeId: "nats-prod-1",
      reason: "Drain and rebuild node after correlated checkout-api database timeout incident.",
    });
  }

  private toolPlan(
    threadId: string,
    cause: ThreadEvent,
    resumeReason: AgentPlan["resumeReason"],
    toolName: SreToolName,
    args: Record<string, unknown>,
  ): AgentPlan {
    const stepId = deterministicUuid("sre-step", threadId, `request:${toolName}`);
    const toolCallId = deterministicUuid("sre-tool-call", threadId, toolName);

    return {
      resumeReason,
      events: [
        this.stepStarted(threadId, cause, stepId, resumeReason === "new-prompt" ? "prompt" : resumeReason),
        {
          eventId: eventKey(threadId, "tool.requested", toolName),
          threadId,
          type: "tool.requested",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: { toolCallId, toolName, args },
        },
        this.stepCompleted(threadId, cause, stepId, "requested-tool"),
      ],
    };
  }

  private produceFindingAndGate(threadId: string, cause: ToolCompletedEvent): AgentPlan {
    const stepId = deterministicUuid("sre-step", threadId, "finding-and-gate");
    const findingId = deterministicUuid("sre-finding", threadId, "checkout-api-db-timeout");
    const remediationId = deterministicUuid("sre-remediation", threadId, "rebuild-nats-prod-1");
    const gateId = deterministicUuid("sre-gate", threadId, "rebuild-nats-prod-1");

    return {
      resumeReason: "tool-completed",
      events: [
        this.stepStarted(threadId, cause, stepId, "tool-completed"),
        {
          eventId: eventKey(threadId, "agent.finding.produced", findingId),
          threadId,
          type: "agent.finding.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: {
            findingId,
            severity: "critical",
            summary: "checkout-api production errors correlate with database timeout logs, elevated latency, and the latest deploy.",
            evidence: [
              { source: "axiom", summary: "DatabaseTimeoutError repeated after deploy window." },
              { source: "grafana", summary: "5xx rate and DB wait time rose immediately after deploy." },
              { source: "sentry", summary: "New issue in checkout-api release 2026.05.20.1." },
              { source: "deploy", summary: "checkout-api release 2026.05.20.1 deployed 14 minutes before spike." },
            ],
          },
        },
        {
          eventId: eventKey(threadId, "agent.remediation.proposed", remediationId),
          threadId,
          type: "agent.remediation.proposed",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: {
            remediationId,
            actionToolName: "infra.rebuildNode",
            summary: "Rebuild nats-prod-1 after draining connections to clear suspected stale routing state.",
            risk: "high",
            requiresApproval: true,
          },
        },
        {
          eventId: eventKey(threadId, "gate.created", gateId),
          threadId,
          type: "gate.created",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: {
            gateId,
            gateType: "manual-approval",
            reason: "risky-remediation",
            proposedAction: "Approve rebuilding nats-prod-1 in production.",
          },
        },
        this.stepCompleted(threadId, cause, stepId, "created-gate"),
      ],
    };
  }

  private produceFinalReport(threadId: string, cause: ToolCompletedEvent): AgentPlan {
    const stepId = deterministicUuid("sre-step", threadId, "final-report");
    const report = {
      title: "SRE investigation complete: checkout-api production incident",
      summary:
        "The thread-backed SRE agent correlated logs, metrics, Sentry errors, and deploy metadata. Human approval was required before the remediation tool executed.",
      rootCause: "checkout-api release 2026.05.20.1 triggered database timeout failures under checkout traffic.",
      actions: [
        "Queried Axiom logs for production checkout-api errors.",
        "Queried Grafana metrics for 5xx rate, latency, and DB wait time.",
        "Queried Sentry for new checkout-api exceptions.",
        "Inspected recent deploy metadata.",
        "Requested and received manual approval for risky remediation.",
        "Executed mock infra.rebuildNode for nats-prod-1.",
      ],
      evidence: [
        "Axiom: repeated DatabaseTimeoutError after deploy.",
        "Grafana: 5xx rate peaked at 12% and p95 latency rose to 3.4s.",
        "Sentry: CHECKOUT-DB-TIMEOUT issue tied to release 2026.05.20.1.",
        "Deploy metadata: release landed 14 minutes before the spike.",
      ],
    };

    return {
      resumeReason: "tool-completed",
      events: [
        this.stepStarted(threadId, cause, stepId, "tool-completed"),
        {
          eventId: eventKey(threadId, "agent.incident_report.produced", "final"),
          threadId,
          type: "agent.incident_report.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: report,
        },
        {
          eventId: eventKey(threadId, "agent.response.produced", "sre-final"),
          threadId,
          type: "agent.response.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: { message: `${report.title}: ${report.rootCause}` },
        },
        this.stepCompleted(threadId, cause, stepId, "produced-response"),
      ],
    };
  }

  private produceDeniedReport(threadId: string, cause: GateResolvedEvent): AgentPlan {
    const stepId = deterministicUuid("sre-step", threadId, "denied-report");
    return {
      resumeReason: "gate-resolved",
      events: [
        this.stepStarted(threadId, cause, stepId, "gate-resolved"),
        {
          eventId: eventKey(threadId, "agent.incident_report.produced", "denied"),
          threadId,
          type: "agent.incident_report.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: {
            title: "SRE investigation stopped before remediation",
            summary: "The proposed remediation was denied by the manual approval gate.",
            rootCause: "checkout-api release 2026.05.20.1 is still the likely root cause.",
            actions: ["Collected logs, metrics, errors, and deploy metadata.", "Did not run remediation."],
            evidence: ["Manual approval gate was denied."],
          },
        },
        {
          eventId: eventKey(threadId, "agent.response.produced", "sre-denied"),
          threadId,
          type: "agent.response.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: { message: "Remediation was denied. Investigation report produced without action." },
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
      actor: { type: "agent", id: "sre-mock-agent" },
      payload: { stepId, reason },
    };
  }

  private stepCompleted(
    threadId: string,
    cause: ThreadEvent,
    stepId: string,
    outcome: "requested-tool" | "created-gate" | "produced-response",
  ): ThreadEvent {
    return {
      eventId: eventKey(threadId, "agent.step.completed", stepId),
      threadId,
      type: "agent.step.completed",
      occurredAt: nowIso(),
      correlationId: cause.correlationId,
      causationId: cause.eventId,
      actor: { type: "agent", id: "sre-mock-agent" },
      payload: { stepId, outcome },
    };
  }
}

function isPromptReceivedEvent(event: ThreadEvent): event is PromptReceivedEvent {
  return event.type === "prompt.received";
}

function toolRequested(events: ThreadEvent[], toolName: SreToolName): boolean {
  return events.some((event) => event.type === "tool.requested" && event.payload.toolName === toolName);
}

function toolCompleted(events: ThreadEvent[], toolName: SreToolName): boolean {
  return completedTool(events, toolName) !== undefined;
}

function completedTool(events: ThreadEvent[], toolName: SreToolName): ToolCompletedEvent | undefined {
  const request = events.find(
    (event): event is ToolRequestedEvent => event.type === "tool.requested" && event.payload.toolName === toolName,
  );
  if (!request) {
    return undefined;
  }

  return events.find(
    (event): event is ToolCompletedEvent =>
      event.type === "tool.completed" && event.payload.toolCallId === request.payload.toolCallId,
  );
}
