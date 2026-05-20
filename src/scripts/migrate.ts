import { createPool } from "../db.js";
import { migrate } from "../migrate.js";

const pool = createPool();

try {
  await migrate(pool, { reset: process.argv.includes("--reset") });
  console.log("Database migration complete");
} finally {
  await pool.end();
}
