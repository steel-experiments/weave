import { createPool } from "../db.js";
import { createLocalDashboardServer } from "../development-dashboard.js";
import { migrate } from "../migrate.js";
import { PostgresThreadEngine } from "../postgres-engine.js";
import { ThreadService } from "../thread-service.js";

const pool = createPool();
await migrate(pool, { reset: false });

const engine = new PostgresThreadEngine(pool);
const service = new ThreadService(engine);
const server = createLocalDashboardServer({ pool, service });
const host = process.env.WEAVE_DASHBOARD_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.WEAVE_DASHBOARD_PORT ?? process.env.PORT ?? "3010", 10);

server.listen(port, host, () => {
  console.log(`Weave workflow dashboard listening on http://${host}:${port}`);
  if (host === "0.0.0.0") {
    console.log(`Open locally at http://127.0.0.1:${port} or via your Tailscale/device IP on port ${port}.`);
  }
});

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
