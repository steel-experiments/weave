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

- consume allowed tools and declared scoped capabilities
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

Tool execution, credential provider calls, agent `run` execution, and policy evaluation are wrapped in a small internal Effect-style adapter so runtime code can handle typed success/failure values while keeping public authoring APIs Promise-first.

### 4. Policy and Credential Layer

Responsibilities:

- determine what an agent is allowed to do
- enforce approval or gate requirements
- mediate credential use and enforce declared capability intent at supported request boundaries
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

### Timer

A thread-native durable sleep point. `ctx.sleep` records `timer.scheduled`, the inbox delays runner visibility until `fireAt`, and the runner records `timer.fired` before replaying past the sleep.

### Capability

A typed declaration of scoped access intent. Capability contracts can be attached to tools as static metadata or requested from tool input with `.request(params)`.

Capability contracts are not credentials. Credentials resolve secret material; capabilities describe authorized access intent and expected scope shape. Capability requests map to existing credential provider requests when a tool needs secret material.

Runtime request policies can inspect capability declarations and capability requests during `ctx.tool` planning. Tool workers do not re-evaluate policies; they use capability requests only to resolve credential material through the configured provider.

### Policy

A runtime request rule that can allow, deny, or require approval before a supported durable request is recorded. Current enforcement happens at the `ctx.tool` planning boundary and records `policy.evaluated` audit evidence.

Policies run in `app.policies` order. `allow` records evidence and continues. `deny` and `approval_required` short-circuit later policies. Once recorded, policy decisions replay from the event log rather than re-running current policy code for the same durable request.

If policy evaluation code throws before producing a decision, no `policy.evaluated` evidence is recorded for that policy. Through `ThreadRunner`, the exception is recorded as the existing durable `agent.failed` behavior.

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
