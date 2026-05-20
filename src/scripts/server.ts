import { createApiServer } from "../api-server.js";
import { createPool } from "../db.js";
import { MailboxService } from "../mailbox-service.js";
import { migrate } from "../migrate.js";
import { PostgresMailboxEngine } from "../postgres-engine.js";

const pool = createPool();
await migrate(pool);

const engine = new PostgresMailboxEngine(pool);
const service = new MailboxService(engine);
const server = createApiServer(engine, service);
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

server.listen(port, () => {
  console.log(`Agent Mailbox API listening on http://localhost:${port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
