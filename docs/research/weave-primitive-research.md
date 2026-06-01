# Weave Primitive Research

## Thesis

The core idea is sound: treat each agent as a durable, message-driven actor whose source of truth is an append-only thread, while execution is disposable.

This is not a new systems pattern, but it is a strong recombination of a few proven ideas:

- event sourcing for auditability and replay
- actor-style identity and single-writer coordination
- workflow durability for pause/resume
- policy enforcement at side-effect boundaries
- capability-mediated secret access

The opportunity is to package those ideas into a smaller primitive than a full workflow engine.

## What Existing Systems Suggest

### Temporal

Temporal validates the durability model:

- execution is reconstructed from event history
- workers emit commands and wait for external results
- replay is the mechanism behind resumability

Relevant lesson:

Do not persist process memory. Persist an ordered history of decisions and external outcomes, then replay deterministic logic.

What not to copy directly:

- full workflow-language semantics
- deterministic VM constraints leaking into all application code
- heavyweight service surface if the goal is a smaller primitive

### LangGraph durable execution

LangGraph reinforces a simpler version of the same idea:

- resume from persisted checkpoints, not from heap snapshots
- isolate side effects behind idempotent task boundaries
- human interrupts are first-class pause/resume points

Relevant lesson:

The thread runtime should assume re-entry and replay. Side effects must be modeled explicitly as requests and results.

### Orleans and virtual actors

Orleans validates the identity and activation model:

- each logical actor has stable identity
- runtime instances can appear and disappear
- persistent state plus reminders let activations be ephemeral

Relevant lesson:

An agent thread should have a stable address and a wake mechanism, while compute stays ephemeral.

### Cloudflare Durable Objects

Durable Objects validate the coordination boundary:

- named stateful units
- compute co-located with durable state
- alarms for wake-up

Relevant lesson:

Per-agent serialization is valuable. A thread should strongly prefer one active runner lease per agent thread.

### Event sourcing guidance

Event sourcing literature is useful here, but it also highlights the main risk:

- append-only history gives replay, audit, and reconstruction
- per-entity streams simplify ordering and concurrency
- snapshots are an optimization only

Relevant warning:

Do not event-source everything. Event sourcing is a good fit for agent control flow, side effects, approvals, and trace history. It is not automatically the right shape for all read models or all application state.

### NATS JetStream and message streams

JetStream validates the replayable inbox side:

- durable streams
- replay from offset or time
- explicit consumer state
- at-least-once delivery and idempotency requirements

Relevant lesson:

The thread needs durable delivery semantics and replay, but a broker alone is not enough. You still need per-thread event history, concurrency control, and policy state.

### SpiceDB / relationship-based auth

Relationship-based auth is relevant for delegated identity and capability scope:

- who may operate which thread
- which human may resolve which gate
- which runner may consume which secret capability

Relevant lesson:

Keep policy facts and thread history separate. The thread should ask a policy system questions; it should not become the whole authorization graph.

## Recommended Architectural Shape

## Core model

Each thread is a durable stream plus a few derived indexes.

The stream is authoritative.

Derived state exists for:

- current thread status
- next runnable event offset
- pending gates
- active runner lease
- materialized conversation or task state
- search and observability views

Conceptually:

```txt
Thread
  id
  identity bindings
  policy bindings
  capability bindings
  lease state

ThreadEvent
  thread_id
  seq
  event_id
  causation_id
  correlation_id
  type
  payload
  created_at
  actor

ThreadCursor
  thread_id
  consumer_name
  last_seq
```

## Separation of concerns

Use four logical layers.

### 1. Thread service

Responsible for:

- append events atomically
- enforce per-thread ordering
- maintain inbox visibility state
- manage leases and wakeups
- expose replay APIs

### 2. Runner

Responsible for:

- acquire thread lease
- load thread state or snapshot
- replay from last checkpoint
- invoke agent logic on newly visible events
- emit effect requests, internal state events, or sleeps

The runner should never perform privileged side effects directly.

### 3. Activity workers

Responsible for:

- browser actions
- LLM calls
- sandboxed code execution
- email or SMS I/O
- webhook delivery
- timers

They consume `*.requested` events and emit `*.completed`, `*.failed`, or `*.needs_approval` events.

### 4. Policy and vault services

Responsible for:

- evaluating whether a requested action is allowed
- minting scoped capabilities
- resolving secret references without disclosing raw secret values to the runner

## Event model

Keep event types small and intention-revealing.

Bad:

```txt
state.updated
```

Better:

```txt
user.message.received
agent.step.planned
tool.call.requested
tool.call.completed
browser.navigation.requested
browser.captcha.detected
gate.created
gate.resolved
secret.use.requested
secret.use.authorized
runner.sleep.requested
runner.wake.triggered
```

Use envelopes with stable metadata:

```ts
type ThreadEvent = {
  eventId: string
  threadId: string
  seq: number
  type: string
  occurredAt: string
  causationId?: string
  correlationId?: string
  actor: {
    type: "user" | "agent" | "system" | "worker" | "human"
    id: string
  }
  payload: unknown
}
```

## Inbox semantics

The inbox should not just be "all events".

Model two concepts separately:

- event log: complete history
- runnable inbox: events that should wake or resume the agent

This avoids waking the runner for every observability event.

Example:

- `llm.call.started` belongs in history, but does not necessarily enter the runnable inbox
- `llm.call.completed` likely does
- `gate.created` may suspend the thread
- `gate.resolved` should re-enter the runnable inbox

## Determinism model

Do not require full Temporal-style deterministic code from day one.

Instead:

- make side effects explicit as requested/completed event pairs
- require idempotency keys on all effect requests
- store effect results as events
- allow runners to recompute pure logic from events

This gives practical replay without needing a custom language runtime.

## Storage recommendation

### Production default: Postgres

Use Postgres first.

Reasons:

- strong transactions for append + index updates
- row locking and advisory locks for thread lease control
- easy ordered per-thread streams
- `LISTEN/NOTIFY` for low-latency wakeups
- good fit for audit queries and operational tooling
- can later use logical decoding or outbox patterns for downstream replication

### Local/dev option: SQLite

SQLite is good for single-node development and embedded deployments.

But it should not be the primary distributed design target because:

- WAL mode is single-host
- only one writer at a time
- concurrent multi-process behavior is narrower
- operational clustering story is limited

Recommendation:

- support SQLite for dev or edge
- design the abstraction around Postgres semantics first

## Minimal schema for an MVP

```sql
create table thread (
  id text primary key,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seq bigint not null default 0,
  runner_lease_owner text,
  runner_lease_expires_at timestamptz,
  snapshot_seq bigint,
  snapshot_blob jsonb
);

create table thread_event (
  thread_id text not null references thread(id),
  seq bigint not null,
  event_id text not null,
  type text not null,
  causation_id text,
  correlation_id text,
  actor_type text not null,
  actor_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (thread_id, seq),
  unique (event_id)
);

create table thread_inbox (
  thread_id text not null references thread(id),
  seq bigint not null,
  visible_at timestamptz not null default now(),
  state text not null,
  primary key (thread_id, seq)
);

create table thread_gate (
  id text primary key,
  thread_id text not null references thread(id),
  event_seq bigint not null,
  gate_type text not null,
  status text not null,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution jsonb
);

create table thread_capability (
  id text primary key,
  thread_id text not null references thread(id),
  capability_type text not null,
  scope jsonb not null,
  expires_at timestamptz,
  revoked_at timestamptz
);
```

## Execution loop

The runner contract can stay very small.

```txt
1. poll or receive wake signal for thread
2. acquire lease if none active
3. read snapshot + events since snapshot
4. rebuild agent state
5. pull visible inbox items after last handled seq
6. run agent step budget
7. append produced events in one transaction
8. release lease if idle, or keep briefly if more work is queued
```

Important constraints:

- one active lease per thread
- bounded step budget per wake to avoid monopolization
- appends must be atomic with inbox and gate side effects
- runner must be safe to crash at any point

## Policy boundary

All side effects should flow through an explicit request path.

Example:

```txt
agent emits browser.navigation.requested
thread service evaluates policy
if allowed -> enqueue browser worker input
if gated -> append gate.created
if denied -> append action.denied
```

That means agent code never directly calls `browser.goto()` or `sendEmail()` in production mode. It only asks for effects.

This is the main simplification that makes replay, audit, and approvals coherent.

## Secret and credential model

The design goal here should be capability transport, not secret transport.

Use references like:

```txt
cap://thread/{id}/otp/google-account
cap://thread/{id}/smtp/send-as/support
cap://session/{browserSessionId}/origin/https://accounts.google.com/fill-otp
```

The runner sees:

- capability existence
- policy metadata
- audit trail

The worker sees:

- a scoped token or one-time grant sufficient to use the secret in-context

Avoid returning raw OTPs or passwords into the runner unless a product requirement explicitly demands it.

## Human-in-the-loop design

Treat approvals as thread-native state, not ad hoc callback state.

Suggested lifecycle:

```txt
action.requested
gate.created
gate.notification.sent
human.response.received
gate.resolved
action.released
action.completed | action.denied
```

A gate should be addressable and replayable like any other thread object.

## Federated identity model

Do not embed email addresses, phone numbers, browser sessions, and OAuth grants directly into the thread core table.

Model them as bound ingress or capability resources with explicit lifetime and provenance.

Example bindings:

- thread `m_123` can receive mail from alias `case-123@inbox.example`
- thread `m_123` can consume SMS from leased number `+1...` until expiry
- thread `m_123` can instruct browser session `bs_456` for origin set X

That keeps identity delegation auditable and revocable.

## Observability and traceability

The thread event stream already gives most of the audit surface.

Add:

- `correlation_id` per task or user request
- `causation_id` linking child events to parent events
- worker execution IDs
- policy evaluation decision records
- payload offloading for large artifacts to object storage

Large blobs should not live in hot event rows. Store references.

## Where this should be stricter than a workflow engine

The thread primitive should be opinionated about:

- append-only event history
- explicit effect requests/results
- one active runner lease per thread
- first-class gates and capabilities
- replayable policy decisions

## Where this should be looser than a workflow engine

The thread primitive should avoid baking in:

- a DSL for workflow programming
- mandatory graph compilation
- language-level determinism constraints everywhere
- a giant built-in activity catalog

The thread is the substrate. Higher-level agent frameworks can sit on top.

## Key risks

### 1. Rebuilding a workflow engine by accident

If retries, timers, compensation, branching, child agents, and approvals all become bespoke thread features, you can recreate Temporal poorly.

Mitigation:

Keep the primitive small. Events, inboxes, gates, leases, capabilities, and workers are enough for the first version.

### 2. Too much replay cost

Long-lived threads can accumulate large histories.

Mitigation:

- snapshots every N events or M bytes
- archive cold event segments
- materialized projections for hot reads

### 3. Non-idempotent side effects

This is the biggest operational risk.

Mitigation:

- effect requests carry idempotency keys
- workers store completion records keyed by request ID
- append completion event exactly once or make duplicates harmless

### 4. Policy becoming inconsistent across append and execution phases

If policy is checked only when the agent requests an action, but not when the worker executes it, permissions can drift.

Mitigation:

Evaluate policy at both boundaries:

- when admitting the request
- when minting the execution capability

### 5. Secrets leaking into event payloads

Mitigation:

- schema-level separation between references and resolved values
- redaction before append
- vault-only secret materialization

## Recommended MVP

Build the smallest end-to-end slice that proves resumability and gates.

### MVP scope

- Postgres-backed thread service
- append-only event store per thread
- inbox table for runnable events
- single runner process with thread leases
- one human gate type
- one timer or sleep mechanism
- one activity worker type, likely HTTP/tool call or browser action
- snapshot support, even if basic

### MVP event set

- `user.message.received`
- `agent.step.requested`
- `tool.call.requested`
- `tool.call.completed`
- `gate.created`
- `gate.resolved`
- `runner.sleep.requested`
- `runner.wake.triggered`
- `agent.reply.produced`

### MVP user story

```txt
user asks agent to log in
agent requests browser navigation
browser detects OTP requirement
worker emits otp.required
thread creates gate
human supplies OTP or approves OTP capability use
gate resolves
runner wakes and continues
agent completes task
```

If that works reliably across process restarts, the primitive is real.

## Suggested implementation phases

### Phase 1: Single-node control plane

- Postgres tables
- append and replay API
- lease acquisition
- simple runner loop
- timer wakeups with `visible_at`

### Phase 2: Policy and gates

- action admission checks
- gate lifecycle
- audit decision events

### Phase 3: Capability-based secret use

- vault references
- scoped grants for workers
- secret-redaction rules in event append path

### Phase 4: Multi-agent and delegated identity

- agent-to-agent messages
- leased ingress identities
- external channel adapters

### Phase 5: Operational hardening

- snapshots and compaction policy
- dead letter handling
- metrics and tracing
- archive and replay tooling

## Concrete recommendation

If we build this, we should start with:

- Postgres as the durable control-plane store
- thread-local ordered event streams
- thread leases instead of long-lived runtimes
- explicit requested/completed side-effect events
- first-class gates and capability references

We should not start with:

- Kafka as the primary source of truth
- heap snapshotting or persistent JS processes
- direct secret injection into agent runtime
- a generic workflow DSL

## Bottom line

The design is feasible and well-supported by adjacent systems.

The novel part is not append-only logs or actors by themselves. The novel part is treating the thread as the single durable boundary where:

- agent execution resumes
- side effects are mediated
- human approvals pause and release work
- delegated identities attach
- credentials are consumed safely
- traces and audits are reconstructed

That is a coherent primitive.

The best first implementation is a small Postgres-backed thread service with leases, append-only events, runnable inbox rows, and effect workers. If that slice works for OTP, approval, and browser resumption, the rest of the architecture can grow around it.

## References

- Temporal workflow execution and replay: https://docs.temporal.io/workflow-execution
- LangGraph durable execution: https://docs.langchain.com/oss/python/langgraph/durable-execution
- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/
- Microsoft Orleans overview: https://learn.microsoft.com/en-us/dotnet/orleans/overview
- Azure event sourcing pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing
- NATS JetStream concepts: https://docs.nats.io/nats-concepts/jetstream
- PostgreSQL logical decoding concepts: https://www.postgresql.org/docs/current/logicaldecoding-explanation.html
- SQLite WAL: https://sqlite.org/wal.html
- SpiceDB relationships: https://authzed.com/docs/spicedb/concepts/relationships
