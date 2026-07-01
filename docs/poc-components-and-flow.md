# PoC Components And Flow

## Purpose

This document describes the first PoC architecture in enough detail to begin implementation.

## High-Level Shape

```txt
API
  -> Thread Service
      -> Postgres Engine
      -> Projection updates
      -> Wake hints

Runner
  -> reads thread history
  -> invokes deterministic mock agent adapter
  -> appends new events

Mock Tool Worker
  -> consumes tool.requested
  -> emits started/progress/completed

Human Approval API
  -> resolves gate
  -> wakes runner
```

## Components

## 1. Thread Service

Responsibilities:

- create a thread session
- validate incoming events with Zod
- append events through the engine
- update derived state
- provide APIs for prompt submission and gate resolution
- notify listeners that a thread has new durable work

Suggested endpoints for the PoC:

- `POST /threads`
- `POST /threads/:id/prompt`
- `GET /threads/:id/events`
- `GET /threads/:id`
- `POST /threads/:id/gates/:gateId/resolve`

## 2. Postgres Engine

Responsibilities:

- store the append-only event log
- assign thread-local sequence numbers
- maintain thread tail position
- store and enforce leases
- store gate records and thread projection data
- send wake hints with `LISTEN/NOTIFY` or allow polling

Important properties:

- append is atomic
- order is stable per thread
- reads are replayable by sequence number

## 3. Thread Projection

Responsibilities:

- expose a quick current-state view
- avoid replay for every API read

Projection fields:

- thread ID
- status
- tail sequence number
- active lease owner
- pending gate IDs
- updated timestamp

Suggested statuses:

- `idle`
- `running`
- `waiting`
- `blocked`
- `completed`
- `failed`

## 4. Runner

Responsibilities:

- wait for a thread wake signal or poll for runnable work
- acquire the thread lease
- append `runner.resumed`
- read thread history
- invoke the deterministic mock agent adapter
- append resulting events
- release the lease when the step is done

Runner behavior should be bounded. One wake should process one logical agent turn.

## 5. Deterministic Mock Agent Adapter

Responsibilities:

- inspect thread history
- decide what to do next based only on durable events
- produce strongly typed output events

It does not call tools directly.

Instead it emits `tool.requested` or `gate.created` or `agent.reply.produced`.

Decision table:

- prompt exists and no tool requested -> request tool
- tool completed and approval needed and no open gate -> create gate
- gate resolved approved -> produce final response
- gate resolved denied -> produce denial response

## 6. Mock Tool Worker

Responsibilities:

- observe `tool.requested`
- emit `tool.started`
- emit multiple `tool.progress` events over time
- emit `tool.completed`

Deterministic behavior:

- always emits the same progress pattern
- always completes successfully
- always returns `requiresManualApproval = true`

Suggested progress pattern:

- 25% `queued`
- 50% `processing`
- 75% `finalizing`
- 100% final `tool.completed`

## 7. Gate Resolution API

Responsibilities:

- accept approval or denial for one gate
- append `gate.resolved`
- update thread projection
- wake the runner

## Suggested Postgres Tables

The exact schema can evolve, but the PoC needs these shapes.

### `thread`

- `id`
- `status`
- `tail_seq`
- `active_lease_owner_id`
- `updated_at`

### `thread_event`

- `thread_id`
- `seq`
- `event_id`
- `type`
- `occurred_at`
- `correlation_id`
- `causation_id`
- `actor_type`
- `actor_id`
- `payload_json`

### `thread_lease`

- `thread_id`
- `owner_id`
- `token`
- `expires_at`

### `thread_gate`

- `gate_id`
- `thread_id`
- `status`
- `gate_type`
- `created_at`
- `resolved_at`
- `resolution_json`

### `thread_projection`

- `thread_id`
- `status`
- `tail_seq`
- `active_lease_owner_id`
- `pending_gate_ids`
- `updated_at`

## Detailed Flow

## Phase 1: Session creation and prompt submission

1. Client calls `POST /threads`.
2. Thread service creates thread metadata and projection row.
3. Client calls `POST /threads/:id/prompt`.
4. Thread service appends:
   - `session.started`
   - `prompt.received`
5. Thread service updates projection status to `idle` or `waiting`.
6. Thread service sends wake hint for the runner.

## Phase 2: First runner step

1. Runner receives wake signal.
2. Runner acquires lease.
3. Runner appends `runner.resumed`.
4. Runner reads thread history.
5. Runner invokes mock agent adapter.
6. Adapter emits:
   - `agent.step.started`
   - `tool.requested`
   - `agent.step.completed`
7. Thread service appends those events transactionally.
8. Projection status becomes `waiting`.
9. Runner releases lease.

## Phase 3: Tool worker execution

1. Tool worker sees `tool.requested`.
2. Tool worker appends `tool.started`.
3. Tool worker appends several `tool.progress` events over time.
4. Tool worker appends `tool.completed` with:
   - summary text
   - `requiresManualApproval = true`
5. Thread service updates projection and wakes the runner.

## Phase 4: Second runner step

1. Runner acquires lease.
2. Runner appends `runner.resumed`.
3. Runner reads thread history including the completed tool result.
4. Mock agent adapter sees approval is required and no open gate exists.
5. Adapter emits:
   - `agent.step.started`
   - `gate.created`
   - `agent.step.completed`
6. Projection status becomes `blocked`.
7. Runner releases lease.

## Phase 5: Human approval

1. Human or test client calls `POST /threads/:id/gates/:gateId/resolve`.
2. Thread service appends `gate.resolved`.
3. Projection status becomes `waiting`.
4. Thread service wakes the runner.

## Phase 6: Final runner step

1. Runner acquires lease.
2. Runner appends `runner.resumed`.
3. Runner reads thread history including the resolved gate.
4. Mock agent adapter emits:
   - `agent.step.started`
   - `agent.reply.produced`
   - `agent.step.completed`
5. Projection status becomes `completed`.
6. Runner releases lease.

## Failure Handling For The PoC

Keep failure handling minimal but explicit.

### Runner crash

- lease eventually expires
- another runner attempt can reacquire and replay

### Tool worker crash

- requested tool remains visible in history
- tool worker can retry deterministically later

### Duplicate wake signals

- harmless if lease and append semantics are correct

### Duplicate event attempts

- prevented or tolerated via idempotency keys where needed

## Testing Strategy

The PoC should be testable without any real LLM or external tool.

Key tests:

- session can be reconstructed from events alone
- only one runner lease is active at a time
- mock tool emits progress before completion
- gate resolution unblocks final response generation
- replay after process restart produces the same result

## Bottom Line

This PoC is intentionally narrow.

It is not trying to prove every future feature.

It is trying to prove one powerful claim:

`a thread can durably coordinate agent reasoning, async tool work, human approval, and resumable execution through a single event boundary`
