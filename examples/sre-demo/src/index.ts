import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import {
  getAgent,
  toMermaidTimeline,
  toTextTimeline,
  type ThreadEvent,
  type ThreadProjection,
} from "weave";
import {
  CompositeObservabilitySink,
  ContractToolWorker,
  ThreadRunner,
  createWeaveRuntime,
  ThreadService,
  otlpFromEnv,
} from "weave/runtime";
import {
  PostgresObservabilitySink,
  PostgresThreadEngine,
  createPool,
  migrate,
} from "weave/postgres";
import { createApiServer } from "weave/server";
import { sreDemoApp } from "./app.js";

const pool = createPool();
const conversationOutput = process.argv.includes("--conversation") || process.argv.includes("--demo");
const style = {
  bold: (value: string) => `\u001B[1m${value}\u001B[22m`,
  blue: (value: string) => `\u001B[34m${value}\u001B[39m`,
  green: (value: string) => `\u001B[32m${value}\u001B[39m`,
  gray: (value: string) => `\u001B[90m${value}\u001B[39m`,
  magenta: (value: string) => `\u001B[35m${value}\u001B[39m`,
  dim: (value: string) => `\u001B[2m${value}\u001B[22m`,
};

try {
  await migrate(pool, { reset: true });

  const engine = new PostgresThreadEngine(pool);
  const postgresObservability = new PostgresObservabilitySink(pool);
  const otlpObservability = otlpFromEnv({ serviceName: "weave-sre-demo" });
  const observability = otlpObservability
    ? new CompositeObservabilitySink([postgresObservability, otlpObservability])
    : postgresObservability;
  const runtimeApp = { ...sreDemoApp, observability };
  const service = new ThreadService(engine);
  const server = createApiServer(engine, service, {
    observability: runtimeApp.observability,
    observabilityReader: postgresObservability,
  });
  await listen(server);

  const address = server.address();
  assert(isAddressInfo(address));
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const activeAgent = getAgent(runtimeApp, "sre");
  const runtime = createWeaveRuntime({
    app: runtimeApp,
    agentName: "sre",
    engine,
    service,
    intervalMs: 25,
    toolWorkerId: "sre-tool-worker",
  });
  const { runnerDaemon, toolDaemon } = runtime;
  runnerDaemon.start();
  toolDaemon.start();

  try {
    const prompt = "@sre can you investigate the production checkout-api 5xx spike and ask before taking risky remediation?";
    const created = await postJson<{ threadId: string; correlationId: string }>(`${baseUrl}/threads`, { prompt });

    const blockedProjection = await waitForProjection(baseUrl, created.threadId, (projection) => {
      return projection.status === "blocked" && projection.pendingGateIds.length === 1;
    });

    const beforeApprovalEvents = await getEvents(baseUrl, created.threadId);
    assertToolSequence(beforeApprovalEvents, [
      "axiom.searchLogs",
      "grafana.queryMetrics",
      "sentry.findIssues",
      "deploy.inspectRecentChanges",
    ]);
    assert(beforeApprovalEvents.some((event) => event.type === "agent.finding.produced"));
    assert(beforeApprovalEvents.some((event) => event.type === "agent.remediation.proposed"));
    const approvalGate = beforeApprovalEvents.find((event) => event.type === "gate.created");
    assert.equal(approvalGate?.payload.reason, "risky-remediation");
    assert.equal(approvalGate?.payload.proposedAction, "Approve rebuilding nats-prod-1 in production.");

    const gateId = blockedProjection.pendingGateIds[0];
    assert(gateId);

    await postJson(`${baseUrl}/threads/${created.threadId}/gates/${gateId}/resolve`, {
      resolution: "approved",
      comment: "On-call approves mock rebuild for the demo.",
    });

    const finalProjection = await waitForProjection(baseUrl, created.threadId, (projection) => {
      return projection.status === "completed";
    });

    const events = await getEvents(baseUrl, created.threadId);
    const spans = await postgresObservability.listSpans(created.threadId);
    const logs = await postgresObservability.listLogs(created.threadId);
    const apiSpans = await getJson<{ spans: typeof spans }>(`${baseUrl}/threads/${created.threadId}/observability/spans`);
    const apiLogs = await getJson<{ logs: typeof logs }>(`${baseUrl}/threads/${created.threadId}/observability/logs`);
    assertToolSequence(events, [
      "axiom.searchLogs",
      "grafana.queryMetrics",
      "sentry.findIssues",
      "deploy.inspectRecentChanges",
      "infra.rebuildNode",
    ]);
    assertDomainToolOutputs(events);

    const report = events.find((event) => event.type === "agent.incident_report.produced");
    const finalResponse = events.find((event) => event.type === "agent.response.produced");
    assert(report);
    assert(finalResponse);
    assert.equal(finalProjection.pendingGateIds.length, 0);
    assert.equal(events.length, finalProjection.tailSeq);
    assert(spans.some((span) => span.name === "tool.execute axiom.searchLogs"));
    assert(spans.some((span) => span.name === "credential.resolve infra.production"));
    assert(spans.some((span) => span.name === "runner.runOnce"));
    assert(spans.some((span) => span.name === "agent.plan"));
    assert(spans.some((span) => span.name === "api.request"));
    assert(logs.some((log) => log.message === "Tool execution completed"));
    assert(apiSpans.spans.some((span) => span.name === "tool.execute axiom.searchLogs"));
    assert(apiLogs.logs.some((log) => log.message === "Tool execution completed"));

    if (conversationOutput) {
      await logConversation(events, finalProjection);
    } else {
      console.log("SRE north-star demo verified");
      console.log(`api=${baseUrl}`);
      console.log(`threadId=${created.threadId}`);
      console.log(`app=${runtimeApp.name}`);
      console.log(`agent=${activeAgent.name}`);
      console.log("registeredTools:");
      for (const tool of activeAgent.tools ?? []) {
        console.log(`- ${tool.name}`);
      }
      console.log("credentialEvents:");
      for (const event of events) {
        if (event.type === "credential.requested") {
          console.log(`- requested ${event.payload.credentialName} kind=${event.payload.kind}`);
        }
        if (event.type === "credential.resolved") {
          console.log(`- resolved ${event.payload.credentialName} source=${event.payload.source}`);
        }
      }
      console.log("toolRequests:");
      for (const event of events) {
        if (event.type === "tool.requested") {
          console.log(`- ${event.payload.toolName}`);
        }
      }
      console.log("observability:");
      console.log(`- spans=${spans.length}`);
      console.log(`- logs=${logs.length}`);
      console.log(`- otlp=${otlpObservability ? "enabled" : "disabled"}`);
      for (const span of spans.filter((item) => item.kind === "tool" || item.kind === "credential")) {
        console.log(`- span ${span.name} status=${span.status}`);
      }
      console.log("timeline:");
      console.log(toTextTimeline(events));
      console.log("mermaid:");
      console.log("```mermaid");
      console.log(toMermaidTimeline(events));
      console.log("```");
      console.log(`finalStatus=${finalProjection.status}`);
      console.log(`incidentTitle=${report.payload.title}`);
      console.log(`finalMessage=${finalResponse.payload.message}`);
    }
  } finally {
    await runnerDaemon.stop();
    await toolDaemon.stop();
    server.close();
  }
} finally {
  await pool.end();
}

function assertToolSequence(events: ThreadEvent[], expected: string[]): void {
  const actual = events.filter((event) => event.type === "tool.requested").map((event) => event.payload.toolName);
  assert.deepEqual(actual, expected);
}

function assertDomainToolOutputs(events: ThreadEvent[]): void {
  const completed = events.filter((event) => event.type === "tool.completed");
  assert(completed.length > 0);
  for (const event of completed) {
    assert.equal(hasObjectKey(event.payload.output, "summary"), false);
    assert.equal(hasObjectKey(event.payload.output, "requiresManualApproval"), false);
    assert.equal(typeof event.payload.summary, "string");
  }
}

function hasObjectKey(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && key in value);
}

async function logConversation(events: ThreadEvent[], finalProjection: ThreadProjection): Promise<void> {
  const toolNamesByCallId = new Map<string, string>();

  console.log(style.dim("Weave SRE demo"));
  console.log(style.dim("----------------------"));
  console.log();

  for (const event of events) {
    if (event.type === "tool.requested") {
      toolNamesByCallId.set(event.payload.toolCallId, event.payload.toolName);
    }

    switch (event.type) {
      case "prompt.received":
        await say("user", event.payload.prompt);
        await waitForEffect(700);
        await say("system", "Starting SRE investigation...");
        break;

      case "tool.requested":
        await say("system", `${friendlyToolAction(event.payload.toolName)}...`);
        break;

      case "tool.progress": {
        const toolName = toolNamesByCallId.get(event.payload.toolCallId) ?? "tool";
        await say("system", `${friendlyToolName(toolName)} ${event.payload.percent}% - ${event.payload.message}`, 220);
        break;
      }

      case "tool.completed": {
        const toolName = toolNamesByCallId.get(event.payload.toolCallId) ?? "tool";
        await say("system", `${friendlyToolName(toolName)} complete - ${toolSummary(event.payload)}`);
        break;
      }

      case "agent.finding.produced":
        console.log();
        await say("agent", `Finding (${event.payload.severity}): ${event.payload.summary}`, 650);
        break;

      case "agent.remediation.proposed":
        await say("agent", `Proposed remediation (${event.payload.risk} risk): ${event.payload.summary}`, 650);
        break;

      case "gate.created":
        console.log();
        await say("system", `Approval required - ${event.payload.proposedAction ?? event.payload.reason}`, 900);
        break;

      case "gate.resolved": {
        const comment = event.payload.comment ? ` - ${event.payload.comment}` : "";
        await say("human", `${event.payload.resolution}${comment}`, 700);
        break;
      }

      case "agent.incident_report.produced":
        console.log();
        await say("agent", event.payload.title, 700);
        await say("agent", `Root cause - ${event.payload.rootCause}`, 700);
        break;

      case "agent.response.produced":
        await say("agent", event.payload.message, 700);
        break;
    }
  }

  console.log();
  await say("system", `Demo finished with thread status=${finalProjection.status}`, 0);
}

async function say(role: "user" | "system" | "agent" | "human", message: string, delayMs = 450): Promise<void> {
  console.log(`${formatRole(role)} ${message}`);
  await waitForEffect(delayMs);
}

function formatRole(role: "user" | "system" | "agent" | "human"): string {
  switch (role) {
    case "user":
      return style.bold(style.blue("user:"));
    case "system":
      return style.bold(style.gray("system:"));
    case "agent":
      return style.bold(style.green("agent:"));
    case "human":
      return style.bold(style.magenta("human:"));
  }
}

async function waitForEffect(ms: number): Promise<void> {
  if (ms <= 0 || process.env.NO_DEMO_WAIT === "1") {
    return;
  }
  await sleep(ms);
}

function friendlyToolAction(toolName: string): string {
  switch (toolName) {
    case "axiom.searchLogs":
      return "Searching Axiom logs";
    case "grafana.queryMetrics":
      return "Querying Grafana metrics";
    case "sentry.findIssues":
      return "Checking Sentry issues";
    case "deploy.inspectRecentChanges":
      return "Inspecting recent deploys";
    case "infra.rebuildNode":
      return "Executing approved remediation";
    default:
      return `Running ${toolName}`;
  }
}

function friendlyToolName(toolName: string): string {
  return toolName;
}

function toolSummary(payload: Extract<ThreadEvent, { type: "tool.completed" }>["payload"]): string {
  if (payload.summary) {
    return payload.summary;
  }

  const output = payload.output;
  if (output && typeof output === "object") {
    const summary = Reflect.get(output, "summary");
    if (typeof summary === "string") {
      return summary;
    }
  }

  return "completed";
}

function listen(server: ReturnType<typeof createApiServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function waitForProjection(
  baseUrl: string,
  threadId: string,
  predicate: (projection: ThreadProjection) => boolean,
): Promise<ThreadProjection> {
  const deadline = Date.now() + 8_000;

  while (Date.now() < deadline) {
    const projection = await getJson<ThreadProjection>(`${baseUrl}/threads/${threadId}`);
    if (predicate(projection)) {
      return projection;
    }
    await sleep(25);
  }

  throw new Error(`Timed out waiting for projection predicate on thread ${threadId}`);
}

async function getEvents(baseUrl: string, threadId: string): Promise<ThreadEvent[]> {
  const body = await getJson<{ events: ThreadEvent[] }>(`${baseUrl}/threads/${threadId}/events`);
  return body.events;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return parseJsonResponse<T>(response);
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return typeof address === "object" && address !== null && "port" in address;
}
