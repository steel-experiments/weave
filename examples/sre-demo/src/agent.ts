import { agent, approvalPolicy, domainEvent, event } from "weave/runtime";
import { z } from "zod";
import {
  FINDING_PRODUCED,
  FindingProducedSchema,
  INCIDENT_REPORT_PRODUCED,
  IncidentReportProducedSchema,
  REMEDIATION_PROPOSED,
  RemediationProposedSchema,
} from "./events.js";
import {
  axiomSearchLogs,
  deployInspectRecentChanges,
  grafanaQueryMetrics,
  infraRebuildNode,
  sentryFindIssues,
  sreTools,
} from "./tools.js";

export const sreAgentInput = z.object({
  prompt: z.string().min(1),
});

export const sreAgent = agent({
  name: "sre",
  description: "Run-first SRE agent for the north-star incident demo.",
  input: sreAgentInput,
  tools: sreTools,
  async run(ctx, input) {
    const logs = await ctx.tool("axiom-search-logs", axiomSearchLogs, {
      environment: "production" as const,
      query: "service:checkout-api level:error DatabaseTimeoutError",
      timeRangeMinutes: 30,
      limit: 20,
    });

    const metrics = await ctx.tool("grafana-query-metrics", grafanaQueryMetrics, {
      environment: "production" as const,
      service: logs.service,
      metrics: ["http_5xx_rate", "latency_p95", "db_pool_wait_ms"],
      timeRangeMinutes: 30,
    });

    const issues = await ctx.tool("sentry-find-issues", sentryFindIssues, {
      environment: "production" as const,
      project: logs.service,
      query: `${logs.errorPattern} release:latest`,
      timeRangeMinutes: 30,
    });

    const deploy = await ctx.tool("deploy-inspect-recent-changes", deployInspectRecentChanges, {
      environment: "production" as const,
      service: logs.service,
      timeRangeMinutes: 60,
    });

    await ctx.emit(
      "finding:checkout-api-db-timeout",
      domainEvent(FINDING_PRODUCED, FindingProducedSchema, {
        findingId: ctx.uuid("finding:checkout-api-db-timeout"),
        severity: "critical",
        summary: `${logs.service} production errors correlate with ${logs.errorPattern} logs, elevated latency, and the latest deploy.`,
        evidence: [
          { source: "axiom", summary: `${logs.errorPattern} repeated after deploy window.` },
          { source: "grafana", summary: `5xx rate reached ${metrics.fiveXxRate} and DB wait time rose immediately after deploy.` },
          { source: "sentry", summary: `New issue ${issues.issue} in ${issues.release}.` },
          { source: "deploy", summary: `${deploy.service} release ${deploy.release} deployed ${deploy.deployedMinutesBeforeSpike} minutes before spike.` },
        ],
      }),
    );

    await ctx.emit(
      "remediation:rebuild-nats-prod-1",
      domainEvent(REMEDIATION_PROPOSED, RemediationProposedSchema, {
        remediationId: ctx.uuid("remediation:rebuild-nats-prod-1"),
        actionToolName: "infra.rebuildNode",
        summary: "Rebuild nats-prod-1 after draining connections to clear suspected stale routing state.",
        risk: "high",
        requiresApproval: true,
      }),
    );

    const rebuildInput = {
      environment: "production" as const,
      nodeId: "nats-prod-1",
      reason: "Drain and rebuild node after correlated checkout-api database timeout incident.",
      risk: "high" as const,
    };
    const approvalGate = productionRemediationPolicy.evaluate(rebuildInput);
    const approval = approvalGate
      ? await ctx.gate("approve-rebuild-nats-prod-1", approvalGate)
      : { gateId: "policy-not-required", resolution: "approved" as const };

    if (approval.resolution === "denied") {
      const report = deniedReport();
      await ctx.emit("incident-report:denied", domainEvent(INCIDENT_REPORT_PRODUCED, IncidentReportProducedSchema, report));
      await ctx.emit(
        "response:denied",
        event("agent.reply.produced", { message: "Remediation was denied. Investigation report produced without action." }),
      );
      return report;
    }

    await ctx.tool("infra-rebuild-node", infraRebuildNode, rebuildInput);

    const report = finalReport({
      service: logs.service,
      release: deploy.release,
      errorPattern: logs.errorPattern,
    });
    await ctx.emit("incident-report:final", domainEvent(INCIDENT_REPORT_PRODUCED, IncidentReportProducedSchema, report));
    await ctx.emit("response:final", event("agent.reply.produced", { message: `${report.title}: ${report.rootCause}` }));
    return report;
  },
});

const productionRemediationPolicy = approvalPolicy({
  name: "production-remediation",
  description: "Require human approval before high-risk production remediation.",
  requiresApproval(input: ProductionRemediationPolicyInput) {
    return input.environment === "production" && input.risk === "high";
  },
  gate(input: ProductionRemediationPolicyInput) {
    return {
      reason: "risky-remediation",
      proposedAction: `Approve rebuilding ${input.nodeId} in production.`,
    };
  },
});

type ProductionRemediationPolicyInput = {
  environment: "production";
  nodeId: string;
  risk: "low" | "medium" | "high";
};

function finalReport(input: { service: string; release: string; errorPattern: string }) {
  return {
    title: "SRE investigation complete: checkout-api production incident",
    summary:
      "The thread-backed SRE agent correlated logs, metrics, Sentry errors, and deploy metadata. Human approval was required before the remediation tool executed.",
    rootCause: `${input.service} release ${input.release} triggered database timeout failures under checkout traffic.`,
    actions: [
      "Queried Axiom logs for production checkout-api errors.",
      "Queried Grafana metrics for 5xx rate, latency, and DB wait time.",
      "Queried Sentry for new checkout-api exceptions.",
      "Inspected recent deploy metadata.",
      "Requested and received manual approval for risky remediation.",
      "Executed mock infra.rebuildNode for nats-prod-1.",
    ],
    evidence: [
      `Axiom: repeated ${input.errorPattern} after deploy.`,
      "Grafana: 5xx rate peaked at 12% and p95 latency rose to 3.4s.",
      "Sentry: CHECKOUT-DB-TIMEOUT issue tied to release 2026.05.20.1.",
      "Deploy metadata: release landed 14 minutes before the spike.",
    ],
  };
}

function deniedReport() {
  return {
    title: "SRE investigation stopped before remediation",
    summary: "The proposed remediation was denied by the manual approval gate.",
    rootCause: "checkout-api release 2026.05.20.1 is still the likely root cause.",
    actions: ["Collected logs, metrics, errors, and deploy metadata.", "Did not run remediation."],
    evidence: ["Manual approval gate was denied."],
  };
}
