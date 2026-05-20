import type { Pool } from "pg";

const schemaSql = `
create schema if not exists agent_mailbox;

create table if not exists agent_mailbox.mailbox (
  id text primary key,
  status text not null check (status in ('idle', 'running', 'waiting', 'blocked', 'completed', 'failed')),
  next_seq integer not null default 0,
  active_lease_owner_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_mailbox.mailbox_event (
  mailbox_id text not null references agent_mailbox.mailbox(id) on delete cascade,
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
  primary key (mailbox_id, seq),
  unique (event_id)
);

create unique index if not exists mailbox_event_idempotency_key_unique
  on agent_mailbox.mailbox_event(mailbox_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists mailbox_event_type_idx
  on agent_mailbox.mailbox_event(mailbox_id, type, seq);

create table if not exists agent_mailbox.mailbox_lease (
  mailbox_id text primary key references agent_mailbox.mailbox(id) on delete cascade,
  owner_id text not null,
  token uuid not null,
  expires_at timestamptz not null
);

create table if not exists agent_mailbox.mailbox_gate (
  gate_id uuid primary key,
  mailbox_id text not null references agent_mailbox.mailbox(id) on delete cascade,
  status text not null check (status in ('pending', 'resolved')),
  gate_type text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_json jsonb
);

create index if not exists mailbox_gate_pending_idx
  on agent_mailbox.mailbox_gate(mailbox_id, status);
`;

export async function migrate(pool: Pool, options: { reset?: boolean } = {}): Promise<void> {
  if (options.reset) {
    await pool.query("drop schema if exists agent_mailbox cascade");
  }

  await pool.query(schemaSql);
}
