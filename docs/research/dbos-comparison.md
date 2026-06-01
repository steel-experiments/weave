# DBOS Comparison

## Purpose

This document compares DBOS with Weave, where Weave means this repository: Steel's durable control plane for agent execution.

DBOS is not being compared to Weave Cloud or W&B Weave here.

## Short Summary

DBOS and Weave overlap around durable, resumable agent execution, but they start from different centers of gravity.

- DBOS is a durable execution and workflow runtime.
- Weave is a durable control plane and thread of record for agent work.

The most useful framing is:

```txt
DBOS checkpoints execution.
Weave records and governs agent work.
```

DBOS is best understood as a possible execution engine beneath or beside Weave, not as a complete replacement for Weave's control-plane model.

## What DBOS Is

DBOS is a durable workflow library and platform built around workflows, steps, queues, schedules, checkpoints, and recovery.

The core programming model is:

- workflow functions represent durable orchestration logic
- steps wrap side-effecting or non-deterministic operations
- step outputs are checkpointed to a system database
- on recovery, DBOS re-executes the workflow and skips already-checkpointed steps
- queues provide durable background execution and flow control
- schedules provide cron-style durable workflow starts
- Conductor provides workflow observability, recovery, management, retention, forking, and export

DBOS uses Postgres as its main production system database for workflow and step state. Its docs also position it for durable AI agents, long-running agents, human-in-the-loop flows, streaming responses, and integrations with agent frameworks such as Pydantic AI, LlamaIndex, OpenAI Agents SDK, and Google ADK.

## What Weave Is

Weave is the durable control plane for agents.

The core thesis from `what-is-weave.md` is:

```txt
The runtime is ephemeral. The thread is durable.
```

Weave records prompts, agent decisions, tool calls, tool progress, approvals, credential mediation, artifacts, interruptions, and outcomes as durable thread events.

Current core primitives include:

- thread: durable execution boundary for one agent session, task, or logical worker identity
- event: immutable record of something that happened, was requested, or was decided
- inbox: subset of events that should wake, resume, or notify a consumer
- runner: ephemeral process that acquires a thread, replays state, does bounded work, and emits events
- worker: executes explicit tool requests and emits lifecycle events
- gate: thread-native approval, human input, or policy pause
- capability: scoped permission or credential reference

Current Postgres-backed tables include:

- `weave.thread`
- `weave.thread_event`
- `weave.thread_lease`
- `weave.thread_gate`
- `weave.thread_inbox`
- `weave.thread_artifact`
- `weave.thread_snapshot`
- `weave.observability_span`
- `weave.observability_log`

## Core Difference

| Dimension | Weave | DBOS |
| --- | --- | --- |
| Primary abstraction | Durable thread for agent control | Durable workflow for execution |
| Source of truth | Append-only thread event log | Workflow and step checkpoints |
| Main unit | Agent session, task, or thread | Workflow function |
| Side effects | Explicit tool request, worker lifecycle, completion/failure events | Checkpointed `runStep` calls |
| Human-in-loop | First-class gates in the event model | Supported, but not the central primitive |
| Credential mediation | First-class evented credential boundary | Application-level concern unless added explicitly |
| Runtime posture | Runtime-neutral adapters | DBOS runtime wraps or hosts execution |
| Recovery model | Reconstruct from thread events and resume bounded runner/worker work | Re-execute workflow and skip checkpointed steps |
| Determinism burden | Event boundary reduces need for one deterministic workflow loop | Workflow code must be deterministic; non-determinism goes in steps |
| Queue/wake model | `thread_inbox` claim model | Durable queues with flow control |
| Observability | Thread events plus Postgres/OTLP spans/logs | Conductor workflow/queue management and traces |
| Maturity | Early proof of concept | More mature product and library ecosystem |
| Strategic role | Control plane above engines | Durable execution engine/runtime |

## Where DBOS Is Stronger Today

### Durable Execution Mechanics

DBOS has a more complete durable execution story today:

- workflow and step checkpointing
- step replay avoidance
- durable sleep
- queues
- scheduling
- workflow recovery after crash or restart
- workflow code upgrade strategies
- production workflow management through Conductor

Weave's current runner and tool-worker model is promising but still proof-of-concept stage. `runnable-inbox.md` already calls out future needs such as durable tool execution state, heartbeats, progress cursors, retry limits, and dead-letter behavior.

### Crash Boundaries Around Side Effects

DBOS's step model gives a clear answer for many side effects. Once a step completes and its output is checkpointed, DBOS does not re-run that step during recovery.

Weave records richer tool lifecycle events, but there is a risk window when an external side effect succeeds and the process crashes before appending `tool.completed` or another terminal event. Unless the tool adapter uses idempotency keys or an external outbox, Weave may repeat the action.

This is one of the most important durability gaps for Weave to close.

### Workflow Management Product

DBOS Conductor already provides capabilities Weave will eventually need in agent-native form:

- workflow list and filtering
- queue view
- cancel and resume
- fork from step
- workflow export
- retention management
- distributed recovery

Weave's event model is more agent-native, but the operator experience is not yet at DBOS's production maturity.

## Where Weave Is Stronger Or More Differentiated

### Agent-Native Control Plane Semantics

DBOS can run agents durably, but Weave makes these concepts central:

- thread of record
- typed tool request, progress, completion, and failure events
- credential request and resolution events
- human gates as durable first-class objects
- agent-to-agent and thread-to-thread coordination
- runtime neutrality across OpenCode-like, Codex-like, Claude Code-like, LangGraph-like, custom, local, and hosted agents

This is the strongest Weave differentiator.

### Runtime Neutrality

DBOS encourages wrapping an agent loop inside DBOS workflows and steps.

Weave treats the agent runtime as replaceable. Execution engines should consume thread context, do bounded work, request effects, and append results back to the thread. This lets Weave coordinate multiple runtimes through one event model.

### Policy And Credential Boundary

Weave's tool contract model includes credential mediation in the execution path:

- tools declare credential needs
- workers resolve credentials
- thread events record credential request, resolution, or failure
- secret values are not written to the durable event log

DBOS can support this at the application layer, but it is not the core out-of-box abstraction.

### Audit Semantics

DBOS records workflow progress and checkpoints. Weave records semantically meaningful control events:

- `prompt.received`
- `agent.step.started`
- `agent.step.completed`
- `tool.requested`
- `tool.progress`
- `tool.completed`
- `tool.failed`
- `gate.created`
- `gate.resolved`
- `credential.requested`
- `credential.resolved`
- `credential.failed`
- `agent.finding.produced`
- `agent.remediation.proposed`
- `agent.incident_report.produced`
- `agent.response.produced`

That is closer to an audit ledger for agent work than a generic workflow trace.

## Competitive Pressure

DBOS is not only a generic workflow engine. Its docs and product pages explicitly target durable AI agents, long-running agents, human-in-the-loop flows, observability, reproducibility, and a control plane for agents and workflows.

That means Weave should avoid vague positioning such as:

- durable agents
- reliable agents
- control plane for agents

Those claims are not wrong, but DBOS can credibly make similar claims.

A sharper Weave position is:

```txt
Weave is the runtime-neutral thread of record for agent work: tools, humans, credentials, policy, artifacts, and execution engines all meet at one durable event boundary.
```

## Strategic Options

### Option 1: Keep Weave Independent And Borrow DBOS Durability Patterns

Continue building Weave's Postgres event and inbox engine, but adopt DBOS-like discipline for step durability, idempotency, retries, recovery, and workflow management.

Benefits:

- preserves Weave's distinct thread/control-plane model
- avoids dependency on DBOS internals or pricing
- keeps the event log as the obvious source of truth

Risks:

- Weave must implement a lot of hard durability machinery itself
- crash-safe side-effect handling needs careful design
- production management UX will take time

Smallest validation:

- add failure-injection tests around runner and tool-worker crash windows
- document which cases are safe, unsafe, or require adapter idempotency

### Option 2: Use DBOS As An Execution Engine Behind Weave

Treat DBOS as one pluggable execution engine. Weave remains the thread of record; DBOS runs durable runner or tool workflows.

Possible mapping:

| Weave concept | DBOS-backed implementation |
| --- | --- |
| `thread_event` | Still Weave-owned |
| `thread_inbox` | Weave-owned or mapped to DBOS queues |
| runner turn | DBOS workflow or step |
| tool execution | DBOS step |
| long-running wait | DBOS durable sleep or workflow wait |
| human gate | Weave event model, optionally DBOS workflow wait |
| admin recovery | Weave UI plus optional DBOS Conductor initially |

Benefits:

- DBOS handles hard checkpoint/recovery mechanics
- Weave focuses on agent-native control-plane semantics
- matches Weave's intended engine/adapters architecture

Risks:

- double durability can confuse source-of-truth boundaries
- DBOS determinism constraints may leak into Weave adapters
- operationally, teams may need to understand both systems
- Conductor licensing and pricing may matter in production

Smallest validation:

- build a `DbosExecutionEngine` spike that wraps only `ThreadRunner.runOnce(threadId)` or `ContractToolWorker.processOnce(threadId)`
- keep Weave's event log unchanged
- correlate DBOS workflow IDs with Weave `threadId`
- force process crashes and compare behavior against the current daemon model

### Option 3: Replace Weave's Engine/Inbox With DBOS Queues And Workflows

Use DBOS workflows, queues, and schedules instead of Weave's custom inbox, lease, and retry machinery.

Benefits:

- faster route to mature durable execution
- less custom infrastructure to maintain
- DBOS Conductor can supply management tooling early

Risks:

- Weave may become a thin semantic layer over DBOS
- DBOS's workflow-centric model may distort the thread model
- Weave could lose control over per-thread ordering and runtime neutrality
- DBOS internals should not become an implicit storage abstraction unless there are stable APIs for everything Weave needs

Smallest validation:

- replace only `thread_inbox` processing with DBOS queues while leaving `thread_event` authoritative
- stop if the thread model starts contorting around DBOS concepts

### Option 4: Position Weave Above DBOS

Make DBOS one of the named execution engines Weave can supervise.

In this model, one Weave thread can coordinate:

- a DBOS workflow
- an OpenCode session
- a LangGraph graph
- a browser worker
- a human approval gate
- a credential provider

Benefits:

- turns DBOS from competitor into compatibility story
- reinforces Weave's runtime-neutral positioning
- keeps Weave focused on the durable event/control boundary

Risks:

- requires clean adapter contracts
- requires correlation between Weave threads and DBOS workflow IDs
- operator source of truth must be explicit

Smallest validation:

- add a design doc or prototype adapter that emits events such as `execution.dbos.workflow_started`, `execution.dbos.step_completed`, `execution.dbos.workflow_failed`, and `execution.dbos.workflow_completed` into a Weave thread

## Recommendation

Do not frame Weave as DBOS for agents or as a better durable workflow engine.

Frame Weave as:

```txt
the durable thread of record for agent work
```

The strongest technical path is to run a DBOS-backed execution-engine spike without replacing Weave's event log.

Success criteria for that spike:

- Weave event history remains authoritative and coherent
- DBOS recovery improves at least one concrete crash case
- external side effects are not duplicated under normal retry conditions
- the adapter does not force every Weave thread to become a DBOS workflow conceptually
- operators can still reason from the Weave thread first

If the spike works, DBOS is a strong execution-engine adapter. If it makes the thread model less clear, keep Weave independent and borrow DBOS's durability patterns instead.

## Sources Consulted

Weave repository:

- `README.md`
- `docs/what-is-weave.md`
- `docs/architecture.md`
- `docs/positioning.md`
- `docs/research/similar-systems.md`
- `docs/engines-and-integrations.md`
- `docs/declarative-api.md`
- `docs/runnable-inbox.md`
- `src/events.ts`
- `src/postgres-engine.ts`
- `src/migrate.ts`
- `src/runner.ts`
- `src/tool-worker.ts`
- `src/runtime.ts`

DBOS sources:

- https://docs.dbos.dev/architecture
- https://docs.dbos.dev/typescript/programming-guide
- https://docs.dbos.dev/ai/ai-quickstart
- https://docs.dbos.dev/production/workflow-management
- https://www.dbos.dev/dbos-pricing
