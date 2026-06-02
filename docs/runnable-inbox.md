# Runnable Inbox Model

## Purpose

The runnable inbox is the bridge between the durable event log and background consumers.

The event log stores everything.

The inbox stores only work that should wake a specific consumer.

## Why This Exists

The first PoC daemon implementation inferred work by scanning broad thread state and event history.

That worked for a script, but it blurred two different concepts:

- durable history
- runnable work

The explicit inbox model makes that separation real.

## Current PoC Table

The PoC stores work in `weave.thread_inbox`.

Each row represents one event routed to one consumer.

Fields include:

- thread ID
- consumer name
- event sequence number
- state: `pending`, `claimed`, `done`, or `dead-letter`
- claim owner
- claim expiry
- attempt count
- last error code and message for dead-lettered work

## Current Consumers

The PoC has two consumers:

- `runner`
- `tool-worker`

## Routing Rules

The append path routes events into the inbox transactionally.

### Runner wake events

- `prompt.received`
- `tool.completed`
- `gate.resolved`
- `child_thread.spawned`
- `child_thread.completed`
- `child_thread.failed`

`tool.failed` and `agent.failed` are terminal events in V1. They mark thread projection state as failed instead of waking the runner.

### Tool worker wake events

- `tool.requested`

### History-only events

- `session.started`
- `runner.resumed`
- `agent.step.started`
- `agent.step.completed`
- `agent.failed`
- `tool.started`
- `tool.progress`
- `credential.requested`
- `credential.resolved`
- `credential.failed`
- `tool.failed`
- `gate.created`
- `agent.response.produced`
- `agent.output.completed`
- `agent.finding.produced`
- `agent.remediation.proposed`
- `agent.incident_report.produced`
- `checkpoint.completed`

## Claim Flow

Consumers use claim semantics rather than broad scans.

```txt
consumer polls inbox
  -> claims pending rows with expiry
  -> processes related thread
  -> marks claimed rows done
```

If a consumer crashes after claiming work, the claim expires and another attempt can claim it later.

If a worker reaches a terminal execution failure, the inbox item is marked `dead-letter` with error metadata. Thread events remain the durable domain history; inbox rows describe delivery state only.

## Why This Is Better

- runner and worker loops do not infer work from broad state
- each wake reason is tied to a concrete event sequence
- work can be claimed safely by multiple daemon instances later
- the event log remains the source of truth
- inbox rows are delivery state, not domain history

## Current Reliability Behavior

The contract tool worker processes typed tool contracts after claiming `tool.requested` inbox rows.

Current bounded behavior:

- `RetryableToolError` retries up to three attempts
- retry attempts emit `tool.progress`
- terminal tool failures append `tool.failed`
- failed tool-worker inbox items are dead-lettered with error code and message
- `/threads/:id/diagnostics/inbox` exposes inbox item state and attempts when backed by Postgres

Future long-running tools may still need richer durable execution state, heartbeats, or progress cursors.

## Next Improvements

- make retry/dead-letter policy configurable
- add consumer cursors for projections
- move from polling to Postgres `LISTEN/NOTIFY` wake hints
- support multiple consumer groups or worker types
