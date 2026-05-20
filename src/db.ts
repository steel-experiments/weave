import { Pool } from "pg";

export function createPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://dev:password@localhost:5432/dev",
  });
}
