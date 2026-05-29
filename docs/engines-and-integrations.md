# Engines And Integrations

## Purpose

This document describes how Weave should treat other systems:

- as engines behind the thread
- as adapters into the thread
- as companion services alongside the thread

This helps keep the architecture modular and the product story clear.

## Core Model

Weave should define one stable control-plane model above a set of pluggable components.

```txt
Weave Core
  -> execution engines
  -> stream/storage engines
  -> coordination engines
  -> policy/identity companions
  -> external integrations
```

## 1. Execution Engines

Execution engines run agent logic or long-running work on behalf of a thread.

Examples:

- OpenCode-like runtimes
- Codex-like runtimes
- Claude Code-like runtimes
- Sandcastle-backed runtimes
- Four Framework-style runtimes
- Temporal workflows
- Inngest functions
- Trigger.dev tasks
- LangGraph graphs

### Responsibilities

- consume thread context
- run a bounded step or turn
- request tools or side effects
- produce thread events
- pause or return control at durable boundaries

### Thread relationship

Execution engines should not own the source of truth.

They should execute against the thread and emit results back into it.

### Runtime harnesses versus thread core

Some systems are better understood as agent harnesses rather than thread infrastructure.

Examples:

- Sandcastle
- Four Framework
- custom coding-agent loops
- prompt-and-tool orchestration layers

These systems usually focus on:

- how the agent runs
- how prompts are assembled
- how tools are exposed
- how code executes inside a sandbox or runtime
- how local retries or loops are structured

That makes them execution-side integrations.

They are usually not responsible for:

- durable cross-runtime event history
- thread-native gates
- shared trace boundaries across humans, tools, and agents
- delegated identity and policy mediation
- runtime-neutral resumability

So in Weave terms, they belong on the runtime side of the architecture, not in the thread core.

## 2. Stream and Storage Engines

These engines durably store thread events and may support replay or follow semantics.

Examples:

- Postgres
- SQLite
- S2 / s2-lite
- EventStoreDB / KurrentDB
- JetStream

### Responsibilities

- append events durably
- preserve thread-local ordering
- support replay
- support subscriptions or follow behavior where possible

### Thread relationship

The storage engine is an implementation detail behind the thread event log.

The thread API should stay stable even if the engine changes.

## 3. Coordination Engines

These engines can host thread-local coordination or stable logical identities.

Examples:

- Orleans
- Akka
- Cloudflare Durable Objects

### Responsibilities

- stable logical identity
- serialized handling per thread entity
- timers or reminders
- durable wake and activation behavior

### Thread relationship

These may host thread coordination behavior, but they should still operate under thread semantics rather than replacing them.

## 4. Policy and Identity Companions

These systems answer who may do what and under which conditions.

Examples:

- SpiceDB
- vault systems
- secret managers
- OAuth delegation systems
- delegated browser identity systems

### Responsibilities

- authorization checks
- relationship and role evaluation
- capability issuance
- secret or token mediation

### Thread relationship

Thread events should record that a policy decision happened.

The policy engine itself does not need to be embedded inside the thread event store.

## 5. External Integrations

These integrations connect outside systems to thread events.

Examples:

- Slack
- Linear
- email
- SMS
- webhooks
- browser session providers
- sandbox providers

### Responsibilities

- turn external signals into thread events
- react to thread events by calling outside systems

### Thread relationship

Integrations should always cross the thread boundary through explicit events, not hidden side effects.

## Recommended Interface Boundaries

## Execution engine interface

```ts
interface ExecutionEngine {
  runStep(threadId: string): Promise<void>
}
```

## Storage engine interface

```ts
interface StorageEngine {
  append(threadId: string, events: ThreadEvent[], options?: object): Promise<object>
  read(threadId: string, fromSeq?: number, limit?: number): Promise<ThreadEvent[]>
  follow(threadId: string, cursor?: object): AsyncIterable<ThreadEvent>
}
```

## Policy engine interface

```ts
interface PolicyEngine {
  evaluate(request: object): Promise<object>
}
```

## Integration adapter interface

```ts
interface IntegrationAdapter {
  handleEvent(event: ThreadEvent): Promise<void>
}
```

## Why This Matters

This separation gives Weave a better long-term architecture.

It allows:

- one stable event model
- one stable gate model
- multiple runtime strategies
- multiple engine backends
- incremental adoption
- community-built adapters without changing core semantics

## Recommended Early Strategy

### Build in core

- thread event model
- trace and causation conventions
- gate semantics
- lease semantics
- stream-link semantics
- engine interfaces

### Reuse through engines and companions

- workflow runtimes
- event stores
- stream substrates
- policy engines
- secret managers

### Integrate externally

- chat apps
- issue trackers
- browser providers
- sandbox platforms

## Bottom Line

Weave should treat adjacent systems as pluggable infrastructure around a stable control-plane core.

That is how the project stays:

- modular
- adoptable
- extensible
- not trapped by one engine choice
