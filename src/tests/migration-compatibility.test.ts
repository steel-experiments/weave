import assert from "node:assert/strict";
import { Pool } from "pg";
import { buildThreadSummary } from "../summary.js";
import { migrate } from "../migrate.js";
import { PostgresThreadEngine } from "../postgres-engine.js";

const connectionString = process.env.DATABASE_URL ?? "postgres://dev:password@localhost:5432/dev";

const testPool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 1_000 });

try {
  await testPool.query("select 1");
} catch (error) {
  await testPool.end();
  console.log(`Migration compatibility tests skipped: ${errorMessage(error)}`);
  process.exit(0);
}

try {
  await testFreshMigrationIsIdempotent();
  await testMainEraSchemaMigratesWithoutReset();
  console.log("Migration compatibility tests passed");
} finally {
  await testPool.end();
}

async function testFreshMigrationIsIdempotent(): Promise<void> {
  await inRollbackTransaction(async () => {
    await migrate(testPool, { reset: true });
    await assertCurrentColumnsExist();

    await migrate(testPool);
    await assertCurrentColumnsExist();
  });
}

async function testMainEraSchemaMigratesWithoutReset(): Promise<void> {
  await inRollbackTransaction(async () => {
    await createMainEraSchema(testPool);
    await migrate(testPool);

    await assertCurrentColumnsExist();

    const engine = new PostgresThreadEngine(testPool);
    const projection = await engine.getProjection("legacy-thread");
    assert(projection);
    assert.equal(projection.threadId, "legacy-thread");
    assert.equal(projection.status, "completed");
    assert.equal(projection.parentThreadId, null);
    assert.equal(projection.rootThreadId, "legacy-thread");
    assert.equal(projection.parentScopeKey, null);
    assert.equal(projection.parentStepKey, null);

    const events = await engine.read("legacy-thread");
    assert.equal(events.length, 4);
    const completed = events.find((event) => event.type === "tool.completed");
    assert(completed?.type === "tool.completed");
    assert.deepEqual(completed.payload, {
      toolCallId: "11111111-1111-4111-8111-111111111111",
      output: {
        summary: "Legacy tool completed",
        requiresManualApproval: false,
        data: { title: "Legacy output" },
      },
      summary: "Legacy tool completed",
    });

    const summary = buildThreadSummary(projection, events);
    assert.equal(summary.finalMessage, "Legacy final response");
    assert.equal(summary.execution.status, "succeeded");
  });
}

async function inRollbackTransaction(run: () => Promise<void>): Promise<void> {
  await testPool.query("begin");
  try {
    await run();
  } finally {
    await testPool.query("rollback");
  }
}

async function assertCurrentColumnsExist(): Promise<void> {
  const threadColumns = await columnNames("thread");
  assert(threadColumns.has("parent_thread_id"));
  assert(threadColumns.has("root_thread_id"));
  assert(threadColumns.has("parent_scope_key"));
  assert(threadColumns.has("parent_step_key"));

  const eventColumns = await columnNames("thread_event");
  assert(eventColumns.has("scope_key"));
  assert(eventColumns.has("step_key"));
}

async function columnNames(tableName: string): Promise<Set<string>> {
  const result = await testPool.query<{ column_name: string }>(
    `select column_name
     from information_schema.columns
     where table_schema = 'weave' and table_name = $1`,
    [tableName],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function createMainEraSchema(pool: Pool): Promise<void> {
  await pool.query(`
    drop schema if exists weave cascade;
    create schema weave;

    create table weave.thread (
      id text primary key,
      status text not null check (status in ('idle', 'running', 'waiting', 'blocked', 'completed', 'failed')),
      next_seq integer not null default 0,
      active_lease_owner_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table weave.thread_event (
      thread_id text not null references weave.thread(id) on delete cascade,
      seq integer not null,
      event_id uuid not null,
      type text not null,
      occurred_at timestamptz not null,
      correlation_id uuid,
      causation_id uuid,
      idempotency_key text,
      actor_type text not null,
      actor_id text not null,
      payload_json jsonb not null,
      primary key (thread_id, seq),
      unique (event_id)
    );

    create table weave.thread_inbox (
      id bigserial primary key,
      thread_id text not null references weave.thread(id) on delete cascade,
      consumer text not null,
      event_seq integer not null,
      state text not null check (state in ('pending', 'claimed', 'done', 'dead-letter')),
      visible_at timestamptz not null default now(),
      claimed_by text,
      claimed_until timestamptz,
      last_error_code text,
      last_error_message text,
      attempts integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (thread_id, consumer, event_seq)
    );

    insert into weave.thread(id, status, next_seq)
    values ('legacy-thread', 'completed', 4);

    insert into weave.thread_event(
      thread_id,
      seq,
      event_id,
      type,
      occurred_at,
      correlation_id,
      causation_id,
      idempotency_key,
      actor_type,
      actor_id,
      payload_json
    ) values
      (
        'legacy-thread',
        0,
        '00000000-0000-4000-8000-000000000001',
        'session.started',
        now(),
        '99999999-9999-4999-8999-999999999999',
        null,
        null,
        'system',
        'legacy-test',
        '{"source":"test"}'::jsonb
      ),
      (
        'legacy-thread',
        1,
        '00000000-0000-4000-8000-000000000002',
        'prompt.received',
        now(),
        '99999999-9999-4999-8999-999999999999',
        '00000000-0000-4000-8000-000000000001',
        null,
        'user',
        'legacy-user',
        '{"prompt":"legacy prompt"}'::jsonb
      ),
      (
        'legacy-thread',
        2,
        '00000000-0000-4000-8000-000000000003',
        'tool.completed',
        now(),
        '99999999-9999-4999-8999-999999999999',
        '00000000-0000-4000-8000-000000000002',
        null,
        'worker',
        'legacy-worker',
        '{"toolCallId":"11111111-1111-4111-8111-111111111111","summary":"Legacy tool completed","requiresManualApproval":false,"data":{"title":"Legacy output"}}'::jsonb
      ),
      (
        'legacy-thread',
        3,
        '00000000-0000-4000-8000-000000000004',
        'agent.response.produced',
        now(),
        '99999999-9999-4999-8999-999999999999',
        '00000000-0000-4000-8000-000000000003',
        null,
        'agent',
        'legacy-agent',
        '{"message":"Legacy final response"}'::jsonb
      );
  `);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
