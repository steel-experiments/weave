import {
  deterministicUuid,
  eventKey,
  nowIso,
  type MailboxEvent,
} from "./events.js";
import type { AgentPlan, AgentPlanner } from "./runner.js";

type PromptReceivedEvent = Extract<MailboxEvent, { type: "prompt.received" }>;
type ToolRequestedEvent = Extract<MailboxEvent, { type: "tool.requested" }>;
type ToolCompletedEvent = Extract<MailboxEvent, { type: "tool.completed" }>;
type GateCreatedEvent = Extract<MailboxEvent, { type: "gate.created" }>;
type GateResolvedEvent = Extract<MailboxEvent, { type: "gate.resolved" }>;

type SreToolName =
  | "axiom.searchLogs"
  | "grafana.queryMetrics"
  | "sentry.findIssues"
  | "deploy.inspectRecentChanges"
  | "infra.rebuildNode";

export class DeterministicSreAgent implements AgentPlanner {
  plan(mailboxId: string, events: MailboxEvent[]): AgentPlan | null {
    const prompt = events.find(isPromptReceivedEvent);
    if (!prompt) {
      return null;
    }

    if (!toolRequested(events, "axiom.searchLogs")) {
      return this.requestAxiom(mailboxId, prompt);
    }

    if (toolCompleted(events, "axiom.searchLogs") && !toolRequested(events, "grafana.queryMetrics")) {
      return this.requestGrafana(mailboxId, completedTool(events, "axiom.searchLogs") ?? prompt);
    }

    if (toolCompleted(events, "grafana.queryMetrics") && !toolRequested(events, "sentry.findIssues")) {
      return this.requestSentry(mailboxId, completedTool(events, "grafana.queryMetrics") ?? prompt);
    }

    if (toolCompleted(events, "sentry.findIssues") && !toolRequested(events, "deploy.inspectRecentChanges")) {
      return this.requestDeploy(mailboxId, completedTool(events, "sentry.findIssues") ?? prompt);
    }

    const deployCompleted = completedTool(events, "deploy.inspectRecentChanges");
    if (deployCompleted && !events.some((event) => event.type === "agent.finding.produced")) {
      return this.produceFindingAndGate(mailboxId, deployCompleted);
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
      return this.requestRebuild(mailboxId, gateResolved);
    }

    if (gateResolved?.payload.resolution === "denied" && !events.some((event) => event.type === "agent.incident_report.produced")) {
      return this.produceDeniedReport(mailboxId, gateResolved);
    }

    const rebuildCompleted = completedTool(events, "infra.rebuildNode");
    if (rebuildCompleted && !events.some((event) => event.type === "agent.incident_report.produced")) {
      return this.produceFinalReport(mailboxId, rebuildCompleted);
    }

    return null;
  }

  private requestAxiom(mailboxId: string, cause: PromptReceivedEvent): AgentPlan {
    return this.toolPlan(mailboxId, cause, "new-prompt", "axiom.searchLogs", {
      environment: "production",
      query: "service:checkout-api level:error DatabaseTimeoutError",
      timeRangeMinutes: 30,
      limit: 20,
    });
  }

  private requestGrafana(mailboxId: string, cause: MailboxEvent): AgentPlan {
    return this.toolPlan(mailboxId, cause, "tool-completed", "grafana.queryMetrics", {
      environment: "production",
      service: "checkout-api",
      metrics: ["http_5xx_rate", "latency_p95", "db_pool_wait_ms"],
      timeRangeMinutes: 30,
    });
  }

  private requestSentry(mailboxId: string, cause: MailboxEvent): AgentPlan {
    return this.toolPlan(mailboxId, cause, "tool-completed", "sentry.findIssues", {
      environment: "production",
      project: "checkout-api",
      query: "DatabaseTimeoutError release:latest",
      timeRangeMinutes: 30,
    });
  }

  private requestDeploy(mailboxId: string, cause: MailboxEvent): AgentPlan {
    return this.toolPlan(mailboxId, cause, "tool-completed", "deploy.inspectRecentChanges", {
      environment: "production",
      service: "checkout-api",
      timeRangeMinutes: 60,
    });
  }

  private requestRebuild(mailboxId: string, cause: GateResolvedEvent): AgentPlan {
    return this.toolPlan(mailboxId, cause, "gate-resolved", "infra.rebuildNode", {
      environment: "production",
      nodeId: "nats-prod-1",
      reason: "Drain and rebuild node after correlated checkout-api database timeout incident.",
    });
  }

  private toolPlan(
    mailboxId: string,
    cause: MailboxEvent,
    resumeReason: AgentPlan["resumeReason"],
    toolName: SreToolName,
    args: Record<string, unknown>,
  ): AgentPlan {
    const semanticKey = `request:${toolName}`;
    const stepId = deterministicUuid("sre-step", mailboxId, semanticKey);
    const toolCallId = deterministicUuid("sre-tool-call", mailboxId, toolName);

    return {
      resumeReason,
      events: [
        this.stepStarted(mailboxId, cause, stepId, resumeReason === "new-prompt" ? "prompt" : resumeReason),
        {
          eventId: eventKey(mailboxId, "tool.requested", toolName),
          mailboxId,
          type: "tool.requested",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: { toolCallId, toolName, args } as Extract<ToolRequestedEvent["payload"], { toolName: typeof toolName }>,
        },
        this.stepCompleted(mailboxId, cause, stepId, "requested-tool"),
      ],
    };
  }

  private produceFindingAndGate(mailboxId: string, cause: ToolCompletedEvent): AgentPlan {
    const stepId = deterministicUuid("sre-step", mailboxId, "finding-and-gate");
    const findingId = deterministicUuid("sre-finding", mailboxId, "checkout-api-db-timeout");
    const remediationId = deterministicUuid("sre-remediation", mailboxId, "rebuild-nats-prod-1");
    const gateId = deterministicUuid("sre-gate", mailboxId, "rebuild-nats-prod-1");

    return {
      resumeReason: "tool-completed",
      events: [
        this.stepStarted(mailboxId, cause, stepId, "tool-completed"),
        {
          eventId: eventKey(mailboxId, "agent.finding.produced", findingId),
          mailboxId,
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
          eventId: eventKey(mailboxId, "agent.remediation.proposed", remediationId),
          mailboxId,
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
          eventId: eventKey(mailboxId, "gate.created", gateId),
          mailboxId,
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
        this.stepCompleted(mailboxId, cause, stepId, "created-gate"),
      ],
    };
  }

  private produceFinalReport(mailboxId: string, cause: ToolCompletedEvent): AgentPlan {
    const stepId = deterministicUuid("sre-step", mailboxId, "final-report");
    const report = {
      title: "SRE investigation complete: checkout-api production incident",
      summary:
        "The mailbox-backed SRE agent correlated logs, metrics, Sentry errors, and deploy metadata. Human approval was required before the remediation tool executed.",
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
        this.stepStarted(mailboxId, cause, stepId, "tool-completed"),
        {
          eventId: eventKey(mailboxId, "agent.incident_report.produced", "final"),
          mailboxId,
          type: "agent.incident_report.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: report,
        },
        {
          eventId: eventKey(mailboxId, "agent.response.produced", "sre-final"),
          mailboxId,
          type: "agent.response.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: { message: `${report.title}: ${report.rootCause}` },
        },
        this.stepCompleted(mailboxId, cause, stepId, "produced-response"),
      ],
    };
  }

  private produceDeniedReport(mailboxId: string, cause: GateResolvedEvent): AgentPlan {
    const stepId = deterministicUuid("sre-step", mailboxId, "denied-report");
    return {
      resumeReason: "gate-resolved",
      events: [
        this.stepStarted(mailboxId, cause, stepId, "gate-resolved"),
        {
          eventId: eventKey(mailboxId, "agent.incident_report.produced", "denied"),
          mailboxId,
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
          eventId: eventKey(mailboxId, "agent.response.produced", "sre-denied"),
          mailboxId,
          type: "agent.response.produced",
          occurredAt: nowIso(),
          correlationId: cause.correlationId,
          causationId: cause.eventId,
          actor: { type: "agent", id: "sre-mock-agent" },
          payload: { message: "Remediation was denied. Investigation report produced without action." },
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
      actor: { type: "agent", id: "sre-mock-agent" },
      payload: { stepId, reason },
    };
  }

  private stepCompleted(
    mailboxId: string,
    cause: MailboxEvent,
    stepId: string,
    outcome: "requested-tool" | "created-gate" | "produced-response",
  ): MailboxEvent {
    return {
      eventId: eventKey(mailboxId, "agent.step.completed", stepId),
      mailboxId,
      type: "agent.step.completed",
      occurredAt: nowIso(),
      correlationId: cause.correlationId,
      causationId: cause.eventId,
      actor: { type: "agent", id: "sre-mock-agent" },
      payload: { stepId, outcome },
    };
  }
}

function isPromptReceivedEvent(event: MailboxEvent): event is PromptReceivedEvent {
  return event.type === "prompt.received";
}

function toolRequested(events: MailboxEvent[], toolName: SreToolName): boolean {
  return events.some((event) => event.type === "tool.requested" && event.payload.toolName === toolName);
}

function toolCompleted(events: MailboxEvent[], toolName: SreToolName): boolean {
  return completedTool(events, toolName) !== undefined;
}

function completedTool(events: MailboxEvent[], toolName: SreToolName): ToolCompletedEvent | undefined {
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
