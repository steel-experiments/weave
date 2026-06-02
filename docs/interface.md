# Thread Interface

## Purpose

This document describes the practical interface of Weave.

The goal is to keep the interface small enough to adapt many existing agents, while still supporting:

- durability
- resumability
- tool mediation
- supervision
- auditability
- human interruption

## Design Approach

The thread interface should be split into two layers:

- a low-level engine interface for durable stream operations
- a higher-level thread interface for agent control-plane operations

This separation lets us:

- swap storage engines
- keep thread semantics stable
- adapt multiple runtimes without exposing storage details directly

## Layer 1: Engine Interface

This is the minimum durable stream interface needed under the thread.

### Append

Append one or more events durably to a thread stream.

```ts
type AppendOptions = {
  expectedTailSeq?: number
  idempotencyKey?: string
}

type AppendResult = {
  firstSeq: number
  lastSeq: number
}

interface ThreadEngine {
  append(threadId: string, events: ThreadEvent[], options?: AppendOptions): Promise<AppendResult>
}
```

Requirements:

- atomic for a batch
- durable before acknowledgment
- ordered within a thread
- supports optimistic concurrency or fencing semantics
- supports idempotent retries

### Read

Read a durable range of events.

```ts
interface ThreadEngine {
  read(threadId: string, fromSeq?: number, limit?: number): Promise<ThreadEvent[]>
}
```

Used for:

- replay
- debugging
- audit
- rebuilding state projections

### Follow

Subscribe to newly durable events.

```ts
type FollowCursor = { fromSeq?: number; tail?: boolean }

interface ThreadEngine {
  follow(threadId: string, cursor?: FollowCursor): AsyncIterable<ThreadEvent>
}
```

Used for:

- waking runners
- supervisor subscriptions
- integration adapters
- child or linked thread flows

### Tail and metadata

```ts
type ThreadTail = {
  tailSeq: number
  updatedAt: string
}

interface ThreadEngine {
  getTail(threadId: string): Promise<ThreadTail>
}
```

### Lease operations

The engine may expose lease helpers directly, or the thread layer may implement them separately.

```ts
type Lease = {
  threadId: string
  ownerId: string
  expiresAt: string
  token: string
}

interface ThreadLeaseStore {
  acquireLease(threadId: string, ownerId: string, ttlMs: number): Promise<Lease | null>
  renewLease(threadId: string, token: string, ttlMs: number): Promise<Lease>
  releaseLease(threadId: string, token: string): Promise<void>
}
```

This is important because the thread should strongly prefer one active runner per thread.

## Layer 2: Thread Interface

This is the agent-facing control-plane interface built on top of the engine.

## Thread Event Envelope

```ts
type ThreadEvent = {
  eventId: string
  threadId: string
  seq?: number
  type: string
  occurredAt: string
  causationId?: string
  correlationId?: string
  idempotencyKey?: string
  scopeKey?: string
  stepKey?: string
  actor: {
    type: "user" | "agent" | "worker" | "human" | "system"
    id: string
  }
  payload: unknown
}
```

Notes:

- `seq` is assigned by the durable engine
- `type` should be intention-revealing
- `correlationId` groups a logical request or session
- `causationId` links an event to the event that caused it
- `scopeKey` and `stepKey` identify durable replay effects, such as `ctx.tool("stable-key", ...)`

## Thread State View

The thread product will usually maintain projections or derived state.

```ts
type ThreadState = {
  threadId: string
  status: "idle" | "running" | "waiting" | "blocked" | "completed" | "failed"
  tailSeq: number
  pendingGateIds: string[]
  activeLeaseOwnerId?: string
  snapshotSeq?: number
  updatedAt: string
}
```

This should be treated as a convenience view, not the source of truth.

## Higher-Level Thread Operations

These are logical operations that become thread events under the hood.

### Send input to thread

```ts
interface ThreadService {
  sendUserMessage(threadId: string, message: unknown, context?: object): Promise<AppendResult>
}
```

This typically emits:

- `session.started` if needed
- `prompt.received` or `user.message.received`

### Request a tool

```ts
interface ThreadService {
  requestTool(threadId: string, toolName: string, args: unknown, metadata?: object): Promise<AppendResult>
}
```

This typically emits:

- `tool.requested`

Workers later emit:

- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`

`tool.completed.payload.output` is the canonical raw tool result. `tool.completed.payload.summary` is optional display metadata. Legacy approval flags may appear inside old tool output envelopes, but new approval flows should use gates or future first-class approval events.

### Create a gate

```ts
interface ThreadService {
  createGate(threadId: string, gateType: string, payload: unknown): Promise<AppendResult>
  resolveGate(threadId: string, gateId: string, resolution: unknown): Promise<AppendResult>
}
```

This handles:

- human approval
- MFA/OTP input
- policy escalation
- supervisor intervention

### Sleep or wake

```ts
interface ThreadService {
  sleepUntil(threadId: string, at: string, reason?: string): Promise<AppendResult>
  wake(threadId: string, reason?: string): Promise<AppendResult>
}
```

This models resumable waiting without a persistent process.

### Link streams

```ts
type ThreadLinkFilter = {
  eventTypes?: string[]
}

interface ThreadService {
  linkThread(parentThreadId: string, childThreadId: string, filter?: ThreadLinkFilter): Promise<void>
}
```

This supports:

- parent-child agent relationships
- supervision
- filtered event routing

## Typical Event Types

Suggested initial event set:

- `session.started`
- `user.message.received`
- `prompt.received`
- `agent.step.started`
- `agent.step.completed`
- `tool.requested`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`
- `gate.created`
- `gate.resolved`
- `runner.slept`
- `runner.resumed`
- `agent.response.produced`
- `thread.link.created`

## Runner Contract

The thread should not need to know an agent's internal implementation.

It only needs a runner contract.

```ts
interface ThreadRunner {
  wake(threadId: string): Promise<void>
}
```

In practice, a runner does:

1. acquire lease
2. read thread state and event history
3. rebuild context or apply snapshot
4. invoke an agent adapter for a bounded step
5. append output events
6. release or renew lease

## What The Thread Must Guarantee

- events are durable before they are treated as committed
- event order is stable within a thread
- runners can stop and resume without losing truth
- tool calls are mediated by events, not by hidden side effects
- humans and supervisors can intervene using the same event model

## What The Thread Should Not Assume

- that the agent runtime is long-lived
- that in-memory state is durable
- that tools are synchronous
- that a single storage engine will always be used
- that every integration needs to understand low-level engine concepts
