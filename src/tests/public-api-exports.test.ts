import assert from "node:assert/strict";
import * as root from "weave";
import * as core from "weave/core";
import * as postgres from "weave/postgres";

const rootExports = root as unknown as Record<string, unknown>;
const coreExports = core as unknown as Record<string, unknown>;
const postgresExports = postgres as unknown as Record<string, unknown>;

assert.equal(typeof rootExports.deterministicUuid, "function");
assert.equal(typeof rootExports.newEventId, "function");
assert.equal(typeof rootExports.buildThreadSummary, "function");
assert.equal(typeof rootExports.ReplayMismatchError, "function");
assert.equal(typeof rootExports.WeaveError, "function");
assert.equal(typeof rootExports.ThreadQueryService, "function");

assert.equal(typeof coreExports.ThreadService, "function");
assert.equal(typeof coreExports.ThreadQueryService, "function");
assert.equal(typeof coreExports.buildThreadSummary, "function");

assert.equal(typeof postgresExports.PostgresThreadEngine, "function");
assert.equal(typeof postgresExports.migrate, "function");
assert.equal(typeof postgresExports.ThreadService, "function");
assert.equal(typeof postgresExports.ThreadQueryService, "function");
assert.equal(typeof postgresExports.createPool, "function");
assert.equal(typeof postgresExports.truncateWeaveForTest, "function");

for (const platform of [
  "createWeaveRuntime",
  "createApiServer",
  "ContractToolWorker",
  "ThreadRunner",
  "authGateway",
  "createOpenCodeCliAdapter",
  "DeterministicMockAgent",
  "GitWorktreeWorkspaceProvider",
  "agent",
  "tool",
  "weave",
  "capability",
]) {
  assert.equal(rootExports[platform], undefined, `weave root must not expose platform symbol: ${platform}`);
  assert.equal(coreExports[platform], undefined, `weave/core must not expose platform symbol: ${platform}`);
  assert.equal(postgresExports[platform], undefined, `weave/postgres must not expose platform symbol: ${platform}`);
}

console.log("Public API export smoke test passed");
