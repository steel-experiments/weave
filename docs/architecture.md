# Architecture

## System View

Weave should act as the durable control layer between agents and the outside world.

```txt
agent runtime(s)
  <-> thread control layer
  <-> tools / workers / humans / integrations
```

The thread is where durable history, routing, policy checks, and resumability come together.

## Main Layers

### 1. Agent Layer

Examples:

- OpenCode
- Codex
- Claude Code
- local custom agents
- cloud sandbox agents
- browser-capable agents

Responsibilities:

- consume allowed tools and, in future slices, scoped capabilities
- process thread-visible events
- emit decisions or effect requests back into the thread

The agent runtime should not be the durable source of truth.

### 2. Thread Layer

This is the core of the project.

Responsibilities:

- durable append-only event log
- ordered thread-local event streams
- runnable inbox semantics
- artifact and snapshot references for large external data
- trace and correlation metadata
- wake and resume mechanics
- stream-to-stream routing or linking
- gate and interrupt lifecycle

Core idea:

- full event log for history
- narrower runnable inbox for what should wake the agent

### 3. Tool and Worker Layer

Examples:

- shell or sandbox execution
- browser workers
- LLM invocation workers
- email or messaging workers
- webhook handlers
- timers and schedulers

Responsibilities:

- receive explicit work requests
- emit structured lifecycle events
- support progress and long-running execution
- surface bounded retries, terminal failures, and dead-letter diagnostics
- avoid opaque fire-and-forget behavior

Tool workers should keep large raw payloads out of thread events. Events should contain durable facts, summaries, hashes, and artifact references; artifact storage owns raw bodies.

### 4. Policy and Credential Layer

Responsibilities:

- determine what an agent is allowed to do
- enforce approval or gate requirements
- mediate credential use today and capability-based secret use in future slices
- keep raw secret material out of normal agent execution paths where possible

### 5. Integration Layer

Examples:

- Slack
- Linear
- webhooks
- email
- SMS
- browser/session providers
- other threads or agent systems

Responsibilities:

- translate external signals into thread events
- translate thread events into external actions

## Core Primitives

### Thread

A durable addressable execution boundary for one agent session, task, or logical worker identity.

### Event

An immutable record of something that happened, was requested, or was decided.

### Inbox

The subset of events that should wake, resume, or notify a consumer.

### Runner

An ephemeral process that acquires a thread, replays state, does bounded work, and emits more events.

### Gate

A thread-native object representing work paused on approval, human input, or another external decision.

### Capability

Planned, not part of the current V1 authoring surface.

A scoped permission or secret reference granted to a worker or integration without exposing raw secret values more broadly than necessary.

### Stream Link

A controlled way for one thread stream to feed another thread or supervisor path.

## Architectural Constraints

### Durable source of truth

The thread event history is authoritative.

### Ephemeral compute

Runners may stop at any time and later resume.

### Structured side effects

Tool and integration activity should happen through explicit requested and completed events.

### Per-thread coordination

Prefer one active runner lease per thread to keep ordering and state reconstruction simple.

### Trace continuity

Every important event should be correlated back to the initiating session, prompt, or parent workflow.

## Expected Evolution

The initial architecture should be simple and narrow.

Over time it can grow to support:

- child threads and subagents with richer orchestration
- filtered stream routing
- richer policy engines
- pluggable storage backends
- more sophisticated integration adapters

But the core should remain small:

- thread
- event
- inbox
- runner
- worker
- gate
- capability
