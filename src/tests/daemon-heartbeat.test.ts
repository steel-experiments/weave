import assert from "node:assert/strict";
import { Pool } from "pg";
import { migrate } from "../migrate.js";
import { PostgresThreadEngine } from "../postgres-engine.js";

const connectionString = process.env.DATABASE_URL ?? "postgres://dev:password@localhost:5432/dev";

const testPool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 1_000 });

try {
  await testPool.query("select 1");
} catch (error) {
  await testPool.end();
  console.log(`Daemon heartbeat tests skipped: ${errorMessage(error)}`);
  process.exit(0);
}

try {
  await testHeartbeatKeepsClaimAliveAndFencesOldOwner();
  console.log("Daemon heartbeat tests passed");
} finally {
  await testPool.end();
}

async function testHeartbeatKeepsClaimAliveAndFencesOldOwner(): Promise<void> {
  await migrate(testPool);
  const engine = new PostgresThreadEngine(testPool);
  const threadId = "daemon-heartbeat-test-thread";

  await testPool.query("delete from weave.thread where id = $1", [threadId]);
  await engine.createThread(threadId, {});
  await testPool.query(
    `insert into weave.thread_inbox(thread_id, consumer, event_seq, state, visible_at)
     values ($1, 'tool-worker', 0, 'pending', now())`,
    [threadId],
  );

  const ownerA = "owner-A";
  const ownerB = "owner-B";

  const claimedA = await engine.claimInbox("tool-worker", ownerA, 10, 200);
  assert.equal(claimedA.length, 1);
  const id = claimedA[0]!.id;

  await engine.heartbeatInbox([id], ownerA, 10_000);
  await sleep(350);
  const blockedB = await engine.claimInbox("tool-worker", ownerB, 10, 200);
  assert.equal(blockedB.length, 0, "heartbeat kept the claim fresh — B cannot reclaim a live item");

  await engine.heartbeatInbox([id], ownerA, 100);
  await sleep(250);
  const reclaimedB = await engine.claimInbox("tool-worker", ownerB, 10, 200);
  assert.equal(reclaimedB.length, 1, "after the renewed ttl lapses with no heartbeat, B reclaims");

  await engine.heartbeatInbox([id], ownerA, 10_000);
  await sleep(250);
  const reclaimedAgain = await engine.claimInbox("tool-worker", ownerA, 10, 200);
  assert.equal(
    reclaimedAgain.length,
    1,
    "old owner's heartbeat does not extend the new owner's claim",
  );

  await testPool.query("delete from weave.thread where id = $1", [threadId]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
