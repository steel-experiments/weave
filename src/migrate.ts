import type { Pool } from "pg";

const schemaSql = `
create schema if not exists weave;

create table if not exists weave.thread (
  id text primary key,
  status text not null check (status in ('idle', 'running', 'waiting', 'blocked', 'completed', 'failed')),
  next_seq integer not null default 0,
  active_lease_owner_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists weave.thread_event (
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

create unique index if not exists thread_event_idempotency_key_unique
  on weave.thread_event(thread_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists thread_event_type_idx
  on weave.thread_event(thread_id, type, seq);

create table if not exists weave.thread_lease (
  thread_id text primary key references weave.thread(id) on delete cascade,
  owner_id text not null,
  token uuid not null,
  expires_at timestamptz not null
);

create table if not exists weave.thread_gate (
  gate_id uuid primary key,
  thread_id text not null references weave.thread(id) on delete cascade,
  status text not null check (status in ('pending', 'resolved')),
  gate_type text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_json jsonb
);

create index if not exists thread_gate_pending_idx
  on weave.thread_gate(thread_id, status);

create table if not exists weave.thread_inbox (
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

alter table weave.thread_inbox
  drop constraint if exists thread_inbox_consumer_check;

alter table weave.thread_inbox
  add constraint thread_inbox_consumer_check
  check (consumer in ('runner', 'tool-worker'));

create index if not exists thread_inbox_pending_idx
  on weave.thread_inbox(consumer, state, visible_at, id);

create index if not exists thread_inbox_thread_idx
  on weave.thread_inbox(thread_id, consumer, state);

create table if not exists weave.thread_artifact (
  artifact_id uuid primary key,
  thread_id text not null references weave.thread(id) on delete cascade,
  tool_call_id uuid,
  kind text not null,
  media_type text not null,
  sha256 text not null,
  byte_length integer not null,
  uri text not null,
  source_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists thread_artifact_thread_idx
  on weave.thread_artifact(thread_id, created_at, artifact_id);

create index if not exists thread_artifact_tool_call_idx
  on weave.thread_artifact(tool_call_id, created_at);

create table if not exists weave.thread_snapshot (
  snapshot_key text primary key,
  thread_id text not null references weave.thread(id) on delete cascade,
  artifact_id uuid not null references weave.thread_artifact(artifact_id) on delete cascade,
  sha256 text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists thread_snapshot_thread_idx
  on weave.thread_snapshot(thread_id, updated_at, snapshot_key);

create table if not exists weave.observability_span (
  trace_id text not null,
  span_id text not null,
  parent_span_id text,
  thread_id text references weave.thread(id) on delete cascade,
  event_id uuid,
  correlation_id uuid,
  causation_id uuid,
  tool_call_id uuid,
  tool_name text,
  name text not null,
  kind text not null check (kind in ('internal', 'tool', 'credential', 'db', 'http')),
  status text not null check (status in ('ok', 'error')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_ms integer not null,
  attributes_json jsonb not null default '{}'::jsonb,
  primary key (trace_id, span_id)
);

create index if not exists observability_span_thread_idx
  on weave.observability_span(thread_id, started_at);

create index if not exists observability_span_tool_call_idx
  on weave.observability_span(tool_call_id, started_at);

create table if not exists weave.observability_log (
  id bigserial primary key,
  timestamp timestamptz not null,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  trace_id text,
  span_id text,
  thread_id text references weave.thread(id) on delete cascade,
  event_id uuid,
  correlation_id uuid,
  causation_id uuid,
  tool_call_id uuid,
  tool_name text,
  attributes_json jsonb not null default '{}'::jsonb
);

create index if not exists observability_log_thread_idx
  on weave.observability_log(thread_id, timestamp, id);

create index if not exists observability_log_trace_idx
  on weave.observability_log(trace_id, span_id);
`;

export async function migrate(pool: Pool, options: { reset?: boolean } = {}): Promise<void> {
  if (options.reset) {
    await pool.query("drop schema if exists weave cascade");
  }

  await pool.query(schemaSql);
}
