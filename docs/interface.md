# Mailbox Interface

## Purpose

This document describes the practical interface of Agent Mailbox.

The goal is to keep the interface small enough to adapt many existing agents, while still supporting:

- durability
- resumability
- tool mediation
- supervision
- auditability
- human interruption

## Design Approach

The mailbox interface should be split into two layers:

- a low-level engine interface for durable stream operations
- a higher-level mailbox interface for agent control-plane operations

This separation lets us:

- swap storage engines
- keep mailbox semantics stable
- adapt multiple runtimes without exposing storage details directly

## Layer 1: Engine Interface

This is the minimum durable stream interface needed under the mailbox.

### Append

Append one or more events durably to a mailbox stream.

```ts
type AppendOptions = {
  expectedTailSeq?: number
  idempotencyKey?: string
}

type AppendResult = {
  firstSeq: number
  lastSeq: number
}

interface MailboxEngine {
  append(mailboxId: string, events: MailboxEvent[], options?: AppendOptions): Promise<AppendResult>
}
```

Requirements:

- atomic for a batch
- durable before acknowledgment
- ordered within a mailbox
- supports optimistic concurrency or fencing semantics
- supports idempotent retries

### Read

Read a durable range of events.

```ts
interface MailboxEngine {
  read(mailboxId: string, fromSeq?: number, limit?: number): Promise<MailboxEvent[]>
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

interface MailboxEngine {
  follow(mailboxId: string, cursor?: FollowCursor): AsyncIterable<MailboxEvent>
}
```

Used for:

- waking runners
- supervisor subscriptions
- integration adapters
- child or linked mailbox flows

### Tail and metadata

```ts
type MailboxTail = {
  tailSeq: number
  updatedAt: string
}

interface MailboxEngine {
  getTail(mailboxId: string): Promise<MailboxTail>
}
```

### Lease operations

The engine may expose lease helpers directly, or the mailbox layer may implement them separately.

```ts
type Lease = {
  mailboxId: string
  ownerId: string
  expiresAt: string
  token: string
}

interface MailboxLeaseStore {
  acquireLease(mailboxId: string, ownerId: string, ttlMs: number): Promise<Lease | null>
  renewLease(mailboxId: string, token: string, ttlMs: number): Promise<Lease>
  releaseLease(mailboxId: string, token: string): Promise<void>
}
```

This is important because the mailbox should strongly prefer one active runner per mailbox.

## Layer 2: Mailbox Interface

This is the agent-facing control-plane interface built on top of the engine.

## Mailbox Event Envelope

```ts
type MailboxEvent = {
  eventId: string
  mailboxId: string
  seq?: number
  type: string
  occurredAt: string
  causationId?: string
  correlationId?: string
  idempotencyKey?: string
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

## Mailbox State View

The mailbox product will usually maintain projections or derived state.

```ts
type MailboxState = {
  mailboxId: string
  status: "idle" | "running" | "waiting" | "blocked" | "completed" | "failed"
  tailSeq: number
  pendingGateIds: string[]
  activeLeaseOwnerId?: string
  snapshotSeq?: number
  updatedAt: string
}
```

This should be treated as a convenience view, not the source of truth.

## Higher-Level Mailbox Operations

These are logical operations that become mailbox events under the hood.

### Send input to mailbox

```ts
interface MailboxService {
  sendUserMessage(mailboxId: string, message: unknown, context?: object): Promise<AppendResult>
}
```

This typically emits:

- `session.started` if needed
- `prompt.received` or `user.message.received`

### Request a tool

```ts
interface MailboxService {
  requestTool(mailboxId: string, toolName: string, args: unknown, metadata?: object): Promise<AppendResult>
}
```

This typically emits:

- `tool.requested`

Workers later emit:

- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`

### Create a gate

```ts
interface MailboxService {
  createGate(mailboxId: string, gateType: string, payload: unknown): Promise<AppendResult>
  resolveGate(mailboxId: string, gateId: string, resolution: unknown): Promise<AppendResult>
}
```

This handles:

- human approval
- MFA/OTP input
- policy escalation
- supervisor intervention

### Sleep or wake

```ts
interface MailboxService {
  sleepUntil(mailboxId: string, at: string, reason?: string): Promise<AppendResult>
  wake(mailboxId: string, reason?: string): Promise<AppendResult>
}
```

This models resumable waiting without a persistent process.

### Link streams

```ts
type MailboxLinkFilter = {
  eventTypes?: string[]
}

interface MailboxService {
  linkMailbox(parentMailboxId: string, childMailboxId: string, filter?: MailboxLinkFilter): Promise<void>
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
- `mailbox.link.created`

## Runner Contract

The mailbox should not need to know an agent's internal implementation.

It only needs a runner contract.

```ts
interface MailboxRunner {
  wake(mailboxId: string): Promise<void>
}
```

In practice, a runner does:

1. acquire lease
2. read mailbox state and event history
3. rebuild context or apply snapshot
4. invoke an agent adapter for a bounded step
5. append output events
6. release or renew lease

## What The Mailbox Must Guarantee

- events are durable before they are treated as committed
- event order is stable within a mailbox
- runners can stop and resume without losing truth
- tool calls are mediated by events, not by hidden side effects
- humans and supervisors can intervene using the same event model

## What The Mailbox Should Not Assume

- that the agent runtime is long-lived
- that in-memory state is durable
- that tools are synchronous
- that a single storage engine will always be used
- that every integration needs to understand low-level engine concepts
