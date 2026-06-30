import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import {
  getAgent,
  isDomainEvent,
  type ThreadEvent,
  type ThreadProjection,
  type ThreadSummary,
} from "weave/runtime";
import { ContractToolWorker, ThreadRunner, ThreadService, createWeaveRuntime } from "weave/runtime";
import { PostgresThreadArtifactStore, PostgresThreadEngine, ThreadArtifactSchema, createPool, migrate } from "weave/postgres";
import { createApiServer } from "weave/server";
import { z } from "zod";
import { steelDocsSyncApp } from "./app.js";
import { FINDING_PRODUCED, FindingProducedSchema } from "./events.js";
import { startSteelFixtureServer } from "./fixtures.js";

const ToolArtifactSchema = z.object({
  artifactId: z.string().uuid(),
  threadId: z.string().min(1),
  toolCallId: z.string().uuid().nullable(),
  kind: z.enum(["docs-page", "llms-txt", "openapi-spec"]),
  uri: z.string().min(1),
  sourceUrl: z.string().url(),
  mediaType: z.string().min(1),
  sha256: z.string().length(64),
  byteLength: z.number().int().nonnegative(),
});

const ToolArtifactListSchema = z.array(ToolArtifactSchema).length(3);
const PersistedArtifactListSchema = z.array(ThreadArtifactSchema).length(3);

const pool = createPool();
const fixtures = await startSteelFixtureServer();

try {
  await migrate(pool, { reset: true });

  const engine = new PostgresThreadEngine(pool);
  const artifactStore = new PostgresThreadArtifactStore(pool);
  const runtimeApp = { ...steelDocsSyncApp, artifactStore };
  const service = new ThreadService(engine);
  const server = createApiServer(engine, service, { artifactStore: runtimeApp.artifactStore });
  await listen(server);

  const address = server.address();
  assert(isAddressInfo(address));
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const activeAgent = getAgent(runtimeApp, "steel-docs");
  const runtime = createWeaveRuntime({
    app: runtimeApp,
    agentName: "steel-docs",
    engine,
    service,
    intervalMs: 25,
  });
  const { runnerDaemon, toolDaemon } = runtime;
  runnerDaemon.start();
  toolDaemon.start();

  try {
    const created = await postJson<{ threadId: string; correlationId: string }>(`${baseUrl}/threads`, {
      prompt: "@steel-docs audit production drift for steel-dev/docs and summarize warnings.",
      metadata: {
        repository: "steel-dev/docs",
        ref: "refs/heads/main",
        sha: "8d2c4ef",
        mode: "production-drift",
        docsBaseUrl: fixtures.baseUrl,
        llmsTxtUrl: `${fixtures.baseUrl}/llms.txt`,
        openApiSpecUrl: `${fixtures.baseUrl}/openapi.json`,
      },
    });

    const finalProjection = await waitForProjection(baseUrl, created.threadId, (projection) => {
      return projection.status === "completed";
    });
    const summary = await getJson<ThreadSummary>(`${baseUrl}/threads/${created.threadId}/summary`);
    const artifactListing = await getJson<{ artifacts: z.infer<typeof PersistedArtifactListSchema> }>(
      `${baseUrl}/threads/${created.threadId}/artifacts`,
    );
    const events = await getEvents(baseUrl, created.threadId);

    assert.deepEqual(
      events.filter((event) => event.type === "tool.requested").map((event) => event.payload.toolName),
      ["steel.auditDocsSync", "steel.modelReview"],
    );
    assert.deepEqual(
      events.filter((event) => event.type === "tool.requested").map((event) => [event.scopeKey, event.stepKey]),
      [
        ["agent:steel-docs", "audit-docs"],
        ["agent:steel-docs", "model-review"],
      ],
    );
    const findingSeverities = events
      .filter((event) => isDomainEvent(event, FINDING_PRODUCED))
      .map((event) => FindingProducedSchema.parse(event.payload.data).severity);
    const findingBreakdown = {
      critical: findingSeverities.filter((severity) => severity === "critical").length,
      warning: findingSeverities.filter((severity) => severity === "warning").length,
      info: findingSeverities.filter((severity) => severity === "info").length,
    };

    assert.equal(finalProjection.status, "completed");
    assert.equal(summary.outcome, "passed");
    assert.equal(summary.execution.status, "succeeded");
    assert.equal(summary.execution.errorCode, null);
    assert.deepEqual(findingBreakdown, { critical: 0, warning: 2, info: 0 });
    assert.equal(finalProjection.pendingGateIds.length, 0);
    assert.equal(events.length, finalProjection.tailSeq);
    assert.equal(events.filter((event) => isDomainEvent(event, FINDING_PRODUCED)).length, 2);

    const toolCompleted = events.find((event) => event.type === "tool.completed");
    const finalResponse = events.find((event) => event.type === "agent.response.produced");
    assert(toolCompleted);
    assert(finalResponse);
    const artifacts = readArtifacts(toolCompleted.payload.output);
    assert.equal(artifacts.length, 3);
    assert.deepEqual(artifacts.map((artifact) => artifact.kind), ["docs-page", "llms-txt", "openapi-spec"]);
    assert.deepEqual(
      artifactListing.artifacts.map((artifact) => artifact.artifactId),
      artifacts.map((artifact) => artifact.artifactId),
    );

    console.log("Steel docs sync demo verified");
    console.log(`api=${baseUrl}`);
    console.log(`threadId=${created.threadId}`);
    console.log(`app=${runtimeApp.name}`);
    console.log(`agent=${activeAgent.name}`);
    console.log(`tool=${activeAgent.tools?.[0]?.name ?? "unknown"}`);
    console.log(`outcome=${summary.outcome}`);
    console.log(`execution=${summary.execution.status}`);
    console.log(`artifacts=${artifacts.length}`);
    console.log(`auditSummary=${toolCompleted.payload.summary ?? "unknown"}`);
    console.log(`finalMessage=${summary.finalMessage ?? finalResponse.payload.message}`);
  } finally {
    await runnerDaemon.stop();
    await toolDaemon.stop();
    server.close();
  }
} finally {
  await pool.end();
  fixtures.server.close();
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

function readArtifacts(data: unknown): z.infer<typeof ToolArtifactListSchema> {
  const artifacts = z
    .object({
      artifacts: ToolArtifactListSchema,
    })
    .parse(data);
  return artifacts.artifacts;
}
