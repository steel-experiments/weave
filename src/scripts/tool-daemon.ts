import { ToolWorkerDaemon } from "../runtime/daemons.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { MockAsyncToolWorker } from "../runtime/mock-tool-worker.js";
import { PostgresThreadEngine } from "../postgres-engine.js";

const pool = createPool();
await migrate(pool);

const engine = new PostgresThreadEngine(pool);
const worker = new MockAsyncToolWorker(engine);
const daemon = new ToolWorkerDaemon(engine, worker);

daemon.start();
console.log("Tool worker daemon started");

async function shutdown(): Promise<void> {
  await daemon.stop();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
