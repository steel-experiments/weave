# Runnable Inbox Model

## Purpose

The runnable inbox is the bridge between the durable event log and background consumers.

The event log stores everything.

The inbox stores only work that should wake a specific consumer.

## Why This Exists

The first PoC daemon implementation inferred work by scanning broad mailbox state and event history.

That worked for a script, but it blurred two different concepts:

- durable history
- runnable work

The explicit inbox model makes that separation real.

## Current PoC Table

The PoC stores work in `agent_mailbox.mailbox_inbox`.

Each row represents one event routed to one consumer.

Fields include:

- mailbox ID
- consumer name
- event sequence number
- state: `pending`, `claimed`, or `done`
- claim owner
- claim expiry
- attempt count

## Current Consumers

The PoC has two consumers:

- `runner`
- `mock-tool-worker`

## Routing Rules

The append path routes events into the inbox transactionally.

### Runner wake events

- `prompt.received`
- `tool.completed`
- `tool.failed`
- `gate.resolved`

### Tool worker wake events

- `tool.requested`

### History-only events

- `session.started`
- `runner.resumed`
- `agent.step.started`
- `agent.step.completed`
- `tool.started`
- `tool.progress`
- `gate.created`
- `agent.response.produced`

## Claim Flow

Consumers use claim semantics rather than broad scans.

```txt
consumer polls inbox
  -> claims pending rows with expiry
  -> processes related mailbox
  -> marks claimed rows done
```

If a consumer crashes after claiming work, the claim expires and another attempt can claim it later.

## Why This Is Better

- runner and worker loops do not infer work from broad state
- each wake reason is tied to a concrete event sequence
- work can be claimed safely by multiple daemon instances later
- the event log remains the source of truth
- inbox rows are delivery state, not domain history

## Current Limitation

The tool worker currently processes a mock tool lifecycle to completion after claiming a `tool.requested` inbox row.

That is fine for the PoC.

For real long-running tools, the worker model should evolve toward:

- durable tool execution state
- heartbeats or progress cursor
- retry limits
- dead-letter behavior

## Next Improvements

- expose inbox state in diagnostics
- add retry/dead-letter policy
- add consumer cursors for projections
- move from polling to Postgres `LISTEN/NOTIFY` wake hints
- support multiple consumer groups or worker types
