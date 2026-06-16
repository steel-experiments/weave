import { createApiServer } from "../runtime/api-server.js";
import { createPool } from "../db.js";
import { ThreadService } from "../thread-service.js";
import { migrate } from "../migrate.js";
import { PostgresThreadEngine } from "../postgres-engine.js";

const pool = createPool();
await migrate(pool);

const engine = new PostgresThreadEngine(pool);
const service = new ThreadService(engine);
const server = createApiServer(engine, service);
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

server.listen(port, () => {
  console.log(`Weave API listening on http://localhost:${port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
