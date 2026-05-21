import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import {
  CompositeObservabilitySink,
  ContractToolWorker,
  MailboxRunner,
  MailboxService,
  PostgresObservabilitySink,
  PostgresMailboxEngine,
  RunnerDaemon,
  ToolWorkerDaemon,
  createApiServer,
  createPool,
  getAgent,
  migrate,
  otlpFromEnv,
  toMermaidTimeline,
  toTextTimeline,
  type MailboxEvent,
  type MailboxProjection,
} from "@agent-mailbox/core";
import { sreDemoApp } from "./app.js";

const pool = createPool();

try {
  await migrate(pool, { reset: true });

  const engine = new PostgresMailboxEngine(pool);
  const postgresObservability = new PostgresObservabilitySink(pool);
  const otlpObservability = otlpFromEnv({ serviceName: "agent-mailbox-sre-demo" });
  const observability = otlpObservability
    ? new CompositeObservabilitySink([postgresObservability, otlpObservability])
    : postgresObservability;
  const runtimeApp = { ...sreDemoApp, observability };
  const service = new MailboxService(engine);
  const server = createApiServer(engine, service);
  await listen(server);

  const address = server.address();
  assert(isAddressInfo(address));
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const activeAgent = getAgent(runtimeApp, "sre");

  const runnerDaemon = new RunnerDaemon(engine, new MailboxRunner(engine, engine, activeAgent.planner), 25);
  const toolDaemon = new ToolWorkerDaemon(
    engine,
    new ContractToolWorker(engine, activeAgent.tools, "sre-tool-worker", runtimeApp.credentialProvider, runtimeApp.observability),
    25,
  );
  runnerDaemon.start();
  toolDaemon.start();

  try {
    const created = await postJson<{ mailboxId: string; correlationId: string }>(`${baseUrl}/mailboxes`, {
      prompt:
        "@sre can you investigate the production checkout-api 5xx spike and ask before taking risky remediation?",
    });

    const blockedProjection = await waitForProjection(baseUrl, created.mailboxId, (projection) => {
      return projection.status === "blocked" && projection.pendingGateIds.length === 1;
    });

    const beforeApprovalEvents = await getEvents(baseUrl, created.mailboxId);
    assertToolSequence(beforeApprovalEvents, [
      "axiom.searchLogs",
      "grafana.queryMetrics",
      "sentry.findIssues",
      "deploy.inspectRecentChanges",
    ]);
    assert(beforeApprovalEvents.some((event) => event.type === "agent.finding.produced"));
    assert(beforeApprovalEvents.some((event) => event.type === "agent.remediation.proposed"));
    const rebuildNode = activeAgent.tools.find((tool) => tool.name === "infra.rebuildNode");
    assert(rebuildNode?.gate?.({
      input: {
        environment: "production",
        nodeId: "nats-prod-1",
        reason: "demo",
      },
    }));

    const gateId = blockedProjection.pendingGateIds[0];
    assert(gateId);

    await postJson(`${baseUrl}/mailboxes/${created.mailboxId}/gates/${gateId}/resolve`, {
      resolution: "approved",
      comment: "On-call approves mock rebuild for the demo.",
    });

    const finalProjection = await waitForProjection(baseUrl, created.mailboxId, (projection) => {
      return projection.status === "completed";
    });

    const events = await getEvents(baseUrl, created.mailboxId);
    const spans = await postgresObservability.listSpans(created.mailboxId);
    const logs = await postgresObservability.listLogs(created.mailboxId);
    assertToolSequence(events, [
      "axiom.searchLogs",
      "grafana.queryMetrics",
      "sentry.findIssues",
      "deploy.inspectRecentChanges",
      "infra.rebuildNode",
    ]);

    const report = events.find((event) => event.type === "agent.incident_report.produced");
    const finalResponse = events.find((event) => event.type === "agent.response.produced");
    assert(report);
    assert(finalResponse);
    assert.equal(finalProjection.pendingGateIds.length, 0);
    assert.equal(events.length, finalProjection.tailSeq);
    assert(spans.some((span) => span.name === "tool.execute axiom.searchLogs"));
    assert(spans.some((span) => span.name === "credential.resolve infra.production"));
    assert(logs.some((log) => log.message === "Tool execution completed"));

    console.log("SRE north-star demo verified");
    console.log(`api=${baseUrl}`);
    console.log(`mailboxId=${created.mailboxId}`);
    console.log(`app=${runtimeApp.name}`);
    console.log(`agent=${activeAgent.name}`);
    console.log("registeredTools:");
    for (const tool of activeAgent.tools) {
      const gate = tool.gate ? " gate=manual-approval" : "";
      console.log(`- ${tool.name}${gate}`);
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
  } finally {
    runnerDaemon.stop();
    toolDaemon.stop();
    server.close();
  }
} finally {
  await pool.end();
}

function assertToolSequence(events: MailboxEvent[], expected: string[]): void {
  const actual = events.filter((event) => event.type === "tool.requested").map((event) => event.payload.toolName);
  assert.deepEqual(actual, expected);
}

function listen(server: ReturnType<typeof createApiServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function waitForProjection(
  baseUrl: string,
  mailboxId: string,
  predicate: (projection: MailboxProjection) => boolean,
): Promise<MailboxProjection> {
  const deadline = Date.now() + 8_000;

  while (Date.now() < deadline) {
    const projection = await getJson<MailboxProjection>(`${baseUrl}/mailboxes/${mailboxId}`);
    if (predicate(projection)) {
      return projection;
    }
    await sleep(25);
  }

  throw new Error(`Timed out waiting for projection predicate on mailbox ${mailboxId}`);
}

async function getEvents(baseUrl: string, mailboxId: string): Promise<MailboxEvent[]> {
  const body = await getJson<{ events: MailboxEvent[] }>(`${baseUrl}/mailboxes/${mailboxId}/events`);
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
