import assert from "node:assert/strict";
import { createPool } from "../db.js";
import { ThreadService } from "../thread-service.js";
import { migrate } from "../migrate.js";
import { MockAsyncToolWorker } from "../runtime/mock-tool-worker.js";
import { PostgresThreadEngine } from "../postgres-engine.js";
import { ThreadRunner } from "../runtime/runner.js";
import type { ThreadEvent } from "../events.js";
import { toMermaidTimeline } from "../timeline.js";

const pool = createPool();

try {
  await migrate(pool, { reset: true });

  const engine = new PostgresThreadEngine(pool);
  const service = new ThreadService(engine);
  const runner = new ThreadRunner(engine, engine);
  const worker = new MockAsyncToolWorker(engine);

  const { threadId } = await service.startSession(
    "Run the mock async job and ask for manual approval before producing the final answer.",
  );

  const firstRun = await runner.runOnce(threadId);
  assert.equal(firstRun.acted, true);
  assert.equal(firstRun.reason, "new-prompt");

  const workerEvents: string[] = [];
  while (true) {
    const result = await worker.processOnce(threadId);
    if (!result.acted) {
      break;
    }
    workerEvents.push(result.eventType ?? "unknown");
    await sleep(10);
  }

  assert.deepEqual(workerEvents, [
    "tool.started",
    "tool.progress",
    "tool.progress",
    "tool.progress",
    "tool.completed",
  ]);

  const secondRun = await runner.runOnce(threadId);
  assert.equal(secondRun.acted, true);
  assert.equal(secondRun.reason, "tool-completed");

  const blockedProjection = await engine.getProjection(threadId);
  assert(blockedProjection);
  assert.equal(blockedProjection.status, "blocked");
  assert.equal(blockedProjection.pendingGateIds.length, 1);

  const gateId = blockedProjection.pendingGateIds[0];
  assert(gateId);
  await service.resolveGate(threadId, gateId, "approved", "PoC approval granted");

  const finalRun = await runner.runOnce(threadId);
  assert.equal(finalRun.acted, true);
  assert.equal(finalRun.reason, "gate-resolved");

  const finalProjection = await engine.getProjection(threadId);
  assert(finalProjection);
  assert.equal(finalProjection.status, "completed");
  assert.equal(finalProjection.pendingGateIds.length, 0);

  const events = await engine.read(threadId);
  const eventTypes = events.map((event) => event.type);
  assert(eventTypes.includes("agent.response.produced"));
  assert.equal(events.length, finalProjection.tailSeq);

  const finalResponse = events.find((event) => event.type === "agent.response.produced");
  assert(finalResponse?.payload.message.includes("Approved result"));

  console.log("PoC flow verified");
  console.log(`threadId=${threadId}`);
  console.log("timeline:");
  for (const event of events) {
    console.log(`${String(event.seq).padStart(2, "0")} ${event.type}`);
  }
  console.log("mermaid:");
  console.log("```mermaid");
  console.log(toMermaidTimeline(events));
  console.log("```");
  console.log(`finalStatus=${finalProjection.status}`);
  console.log(`finalMessage=${finalResponse?.payload.message}`);
} finally {
  await pool.end();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
