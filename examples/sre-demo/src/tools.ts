import { defineTool } from "weave";
import { z } from "zod";

const environment = z.enum(["staging", "production"]);

export const axiomSearchLogs = defineTool({
  name: "axiom.searchLogs",
  description: "Search Axiom logs for production incident clues.",
  input: z.object({
    environment,
    query: z.string().min(1),
    timeRangeMinutes: z.number().int().positive(),
    limit: z.number().int().positive().max(1000),
  }),
  output: z.object({
    errorPattern: z.string().min(1),
    service: z.string().min(1),
    count: z.number().int().nonnegative(),
    sample: z.string().min(1),
  }),
  summarize(output) {
    return `Axiom found ${output.count} ${output.errorPattern} logs from ${output.service}.`;
  },
  credentials: ({ input }) => ({
    name: "axiom.production",
    kind: "secret",
    provider: "axiom",
    reason: "Search production logs for incident evidence.",
    scopes: ["logs:read"],
    scope: { environment: input.environment },
  }),
  async run({ credentials, progress }) {
    credentials.value("axiom.production");
    await progress({ percent: 50, message: "querying axiom.searchLogs" });
    return {
      errorPattern: "DatabaseTimeoutError",
      service: "checkout-api",
      count: 184,
      sample: "DatabaseTimeoutError: checkout write timed out after 3000ms",
    };
  },
});

export const grafanaQueryMetrics = defineTool({
  name: "grafana.queryMetrics",
  description: "Query Grafana metrics for service health signals.",
  input: z.object({
    environment,
    service: z.string().min(1),
    metrics: z.array(z.string().min(1)).min(1),
    timeRangeMinutes: z.number().int().positive(),
  }),
  output: z.object({
    fiveXxRate: z.string().min(1),
    latencyP95: z.string().min(1),
    dbPoolWaitMs: z.number().int().nonnegative(),
  }),
  summarize(output) {
    return `Grafana shows 5xx rate ${output.fiveXxRate}, p95 ${output.latencyP95}, DB wait ${output.dbPoolWaitMs}ms.`;
  },
  credentials: ({ input }) => ({
    name: "grafana.production",
    kind: "secret",
    provider: "grafana",
    reason: "Read production metrics for the incident window.",
    scopes: ["metrics:read"],
    scope: { environment: input.environment, service: input.service },
  }),
  async run({ credentials, progress }) {
    credentials.value("grafana.production");
    await progress({ percent: 50, message: "querying grafana.queryMetrics" });
    return {
      fiveXxRate: "12%",
      latencyP95: "3.4s",
      dbPoolWaitMs: 920,
    };
  },
});

export const sentryFindIssues = defineTool({
  name: "sentry.findIssues",
  description: "Find matching Sentry issues for the incident window.",
  input: z.object({
    environment,
    project: z.string().min(1),
    query: z.string().min(1),
    timeRangeMinutes: z.number().int().positive(),
  }),
  output: z.object({
    issue: z.string().min(1),
    release: z.string().min(1),
    stackTop: z.string().min(1),
  }),
  summarize(output) {
    return `Sentry issue ${output.issue} started in release ${output.release}.`;
  },
  credentials: ({ input }) => ({
    name: "sentry.production",
    kind: "secret",
    provider: "sentry",
    reason: "Read production error issues for the incident window.",
    scopes: ["issues:read"],
    scope: { environment: input.environment, project: input.project },
  }),
  async run({ credentials, progress }) {
    credentials.value("sentry.production");
    await progress({ percent: 50, message: "querying sentry.findIssues" });
    return {
      issue: "CHECKOUT-DB-TIMEOUT",
      release: "checkout-api@2026.05.20.1",
      stackTop: "CheckoutRepository.createOrder -> DatabaseClient.transaction",
    };
  },
});

export const deployInspectRecentChanges = defineTool({
  name: "deploy.inspectRecentChanges",
  description: "Inspect deploy metadata around the incident window.",
  input: z.object({
    environment,
    service: z.string().min(1),
    timeRangeMinutes: z.number().int().positive(),
  }),
  output: z.object({
    service: z.string().min(1),
    release: z.string().min(1),
    deployedMinutesBeforeSpike: z.number().int().nonnegative(),
    author: z.string().min(1),
  }),
  summarize(output) {
    return `${output.service}@${output.release} shipped ${output.deployedMinutesBeforeSpike} minutes before the spike.`;
  },
  credentials: ({ input }) => ({
    name: "deploy.production",
    kind: "scoped-token",
    provider: "deploy-metadata",
    reason: "Read production deploy metadata for the affected service.",
    scopes: ["deploys:read"],
    scope: { environment: input.environment, service: input.service },
  }),
  async run({ credentials, progress }) {
    credentials.value("deploy.production");
    await progress({ percent: 50, message: "querying deploy.inspectRecentChanges" });
    return {
      service: "checkout-api",
      release: "2026.05.20.1",
      deployedMinutesBeforeSpike: 14,
      author: "demo-release-bot",
    };
  },
});

export const infraRebuildNode = defineTool({
  name: "infra.rebuildNode",
  description: "Drain and rebuild an infrastructure node.",
  input: z.object({
    environment: z.literal("production"),
    nodeId: z.string().min(1),
    reason: z.string().min(1),
  }),
  output: z.object({
    nodeId: z.string().min(1),
    action: z.literal("rebuild"),
    status: z.literal("completed"),
  }),
  summarize(output) {
    return `Mock remediation completed: ${output.nodeId} was ${output.action}ed and returned to service.`;
  },
  credentials: ({ input }) => ({
    name: "infra.production",
    kind: "delegated-identity",
    provider: "infra",
    reason: "Execute approved production remediation as delegated on-call identity.",
    scopes: ["node:drain", "node:rebuild"],
    scope: { environment: input.environment, nodeId: input.nodeId },
  }),
  async run({ credentials, progress }) {
    credentials.value("infra.production");
    await progress({ percent: 50, message: "querying infra.rebuildNode" });
    return {
      nodeId: "nats-prod-1",
      action: "rebuild" as const,
      status: "completed" as const,
    };
  },
});

export const sreTools = [
  axiomSearchLogs,
  grafanaQueryMetrics,
  sentryFindIssues,
  deployInspectRecentChanges,
  infraRebuildNode,
] as const;

export type SreToolName = (typeof sreTools)[number]["name"];
