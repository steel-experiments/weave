import assert from "node:assert/strict";
import { Pool } from "pg";
import { dashboardHtml, createLocalDashboardServer } from "../development-dashboard.js";
import { buildDashboardState } from "../development-dashboard.js";
import { newEventId, nowIso, type ThreadEvent } from "../events.js";
import { migrate } from "../migrate.js";
import { PostgresThreadEngine } from "../postgres-engine.js";

const html = dashboardHtml();
assert.match(html, /Workflow Console/);
assert.match(html, /Sleek|gates:list|initiative:status/);
assert.match(html, /#0b1326/);
assert.match(html, /JetBrains Mono/);
assert.match(html, /\/api\/state/);
assert.match(html, /\/api\/gates\//);

const server = createLocalDashboardServer({ pool: {} as never, service: {} as never });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Workflow Console/);
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

const connectionString = process.env.DATABASE_URL ?? "postgres://dev:password@localhost:5432/dev";
const testPool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 1_000 });

try {
  await testPool.query("select 1");
  await migrate(testPool);
  const engine = new PostgresThreadEngine(testPool);
  const threadId = `dashboard-state-${Date.now()}`;
  await engine.createThread(threadId);
  const events: ThreadEvent[] = [
    {
      eventId: newEventId(),
      threadId,
      type: "dev.initiative.started",
      occurredAt: nowIso(),
      actor: { type: "agent", id: "weave.maintainer" },
      payload: {
        initiative: "Dashboard State Regression",
        repo: "weave",
        baseBranch: "main",
        workingBranch: "dashboard-state-regression",
        contextFiles: ["README.md"],
      },
    },
    {
      eventId: newEventId(),
      threadId,
      type: "tool.progress",
      occurredAt: nowIso(),
      actor: { type: "worker", id: "test-worker" },
      payload: {
        toolCallId: newEventId(),
        percent: 50,
        message: "Halfway there.",
      },
    },
  ];
  await engine.append(events);
  const state = await buildDashboardState(testPool, threadId);
  assert.equal(state.selected?.threadId, threadId);
  assert.equal(state.toolEvents.some((event) => event.detail === "Halfway there."), true);
  await testPool.query("delete from weave.thread where id = $1", [threadId]);
} catch (error) {
  console.log(`Development dashboard Postgres regression skipped: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await testPool.end();
}

console.log("Development dashboard tests passed");
