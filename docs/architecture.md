# Architecture

## System View

Agent Mailbox should act as the durable control layer between agents and the outside world.

```txt
agent runtime(s)
  <-> mailbox control layer
  <-> tools / workers / humans / integrations
```

The mailbox is where durable history, routing, policy checks, and resumability come together.

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

- consume allowed tools and capabilities
- process mailbox-visible events
- emit decisions or effect requests back into the mailbox

The agent runtime should not be the durable source of truth.

### 2. Mailbox Layer

This is the core of the project.

Responsibilities:

- durable append-only event log
- ordered mailbox-local event streams
- runnable inbox semantics
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
- avoid opaque fire-and-forget behavior

### 4. Policy and Credential Layer

Responsibilities:

- determine what an agent is allowed to do
- enforce approval or gate requirements
- mediate capability-based secret use
- keep raw secret material out of normal agent execution paths where possible

### 5. Integration Layer

Examples:

- Slack
- Linear
- webhooks
- email
- SMS
- browser/session providers
- other mailboxes or agent systems

Responsibilities:

- translate external signals into mailbox events
- translate mailbox events into external actions

## Core Primitives

### Mailbox

A durable addressable execution boundary for one agent session, task, or logical worker identity.

### Event

An immutable record of something that happened, was requested, or was decided.

### Inbox

The subset of events that should wake, resume, or notify a consumer.

### Runner

An ephemeral process that acquires a mailbox, replays state, does bounded work, and emits more events.

### Gate

A mailbox-native object representing work paused on approval, human input, or another external decision.

### Capability

A scoped permission or secret reference granted to a worker or integration without exposing raw secret values more broadly than necessary.

### Stream Link

A controlled way for one mailbox stream to feed another mailbox or supervisor path.

## Architectural Constraints

### Durable source of truth

The mailbox event history is authoritative.

### Ephemeral compute

Runners may stop at any time and later resume.

### Structured side effects

Tool and integration activity should happen through explicit requested and completed events.

### Per-mailbox coordination

Prefer one active runner lease per mailbox to keep ordering and state reconstruction simple.

### Trace continuity

Every important event should be correlated back to the initiating session, prompt, or parent workflow.

## Expected Evolution

The initial architecture should be simple and narrow.

Over time it can grow to support:

- child mailboxes and subagents
- filtered stream routing
- richer policy engines
- pluggable storage backends
- more sophisticated integration adapters

But the core should remain small:

- mailbox
- event
- inbox
- runner
- worker
- gate
- capability
