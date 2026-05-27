import { RunnerDaemon } from "../daemons.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { PostgresMailboxEngine } from "../postgres-engine.js";
import { MailboxRunner } from "../runner.js";

const pool = createPool();
await migrate(pool);

const engine = new PostgresMailboxEngine(pool);
const runner = new MailboxRunner(engine, engine);
const daemon = new RunnerDaemon(engine, runner);

daemon.start();
console.log("Runner daemon started");

async function shutdown(): Promise<void> {
  await daemon.stop();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
