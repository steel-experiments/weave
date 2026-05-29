# Engine Contracts

## Purpose

This document defines the minimal typed contracts needed for the Postgres-backed PoC.

These contracts should be treated as thread-level interfaces, not Postgres-specific APIs.

## Design Goals

- explicit engine boundary
- strong typing
- Zod validation for runtime safety
- simple enough to implement quickly in Postgres
- broad enough to support a later `s2-lite` engine

## Base Types

```ts
import { z } from "zod"

export const ThreadId = z.string().min(1)
export type ThreadId = z.infer<typeof ThreadId>

export const EventId = z.string().uuid()
export type EventId = z.infer<typeof EventId>

export const CorrelationId = z.string().uuid()
export type CorrelationId = z.infer<typeof CorrelationId>

export const CausationId = z.string().uuid()
export type CausationId = z.infer<typeof CausationId>

export const IsoDateTime = z.string().datetime()
export type IsoDateTime = z.infer<typeof IsoDateTime>
```

## Actor

```ts
export const Actor = z.object({
  type: z.enum(["user", "agent", "worker", "human", "system"]),
  id: z.string().min(1),
})
export type Actor = z.infer<typeof Actor>
```

## Event Envelope

The payload union is defined in `event-taxonomy.md`.

```ts
export const EventEnvelopeBase = z.object({
  eventId: EventId,
  threadId: ThreadId,
  seq: z.number().int().nonnegative().optional(),
  type: z.string().min(1),
  occurredAt: IsoDateTime,
  correlationId: CorrelationId.optional(),
  causationId: CausationId.optional(),
  idempotencyKey: z.string().min(1).optional(),
  actor: Actor,
})
```

## Append Contract

```ts
export const AppendOptions = z.object({
  expectedTailSeq: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1).optional(),
})
export type AppendOptions = z.infer<typeof AppendOptions>

export const AppendResult = z.object({
  firstSeq: z.number().int().nonnegative(),
  lastSeq: z.number().int().nonnegative(),
})
export type AppendResult = z.infer<typeof AppendResult>
```

Rules:

- append is atomic for the provided batch
- sequence numbers are assigned by the engine
- `expectedTailSeq` provides optimistic concurrency for future use
- `idempotencyKey` supports safe retry behavior

## Read Contract

```ts
export const ReadOptions = z.object({
  fromSeq: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(1000).default(100),
})
export type ReadOptions = z.infer<typeof ReadOptions>
```

Rules:

- returns events in ascending sequence order
- never skips durable events in range

## Follow Contract

For the PoC, follow may be implemented by polling plus `LISTEN/NOTIFY` hints.

```ts
export const FollowCursor = z.object({
  fromSeq: z.number().int().nonnegative().optional(),
  tail: z.boolean().optional(),
})
export type FollowCursor = z.infer<typeof FollowCursor>
```

Rules:

- follow yields only durable events
- follow preserves thread-local order
- follow is a delivery convenience, not the source of truth

## Lease Contract

```ts
export const Lease = z.object({
  threadId: ThreadId,
  ownerId: z.string().min(1),
  token: z.string().uuid(),
  expiresAt: IsoDateTime,
})
export type Lease = z.infer<typeof Lease>
```

Rules:

- at most one active lease per thread
- lease acquire returns `null` if another active lease exists
- runner must renew long-running leases
- expired leases may be acquired by another runner

## Projection Contract

```ts
export const ThreadStatus = z.enum([
  "idle",
  "running",
  "waiting",
  "blocked",
  "completed",
  "failed",
])
export type ThreadStatus = z.infer<typeof ThreadStatus>

export const ThreadProjection = z.object({
  threadId: ThreadId,
  status: ThreadStatus,
  tailSeq: z.number().int().nonnegative(),
  activeLeaseOwnerId: z.string().min(1).nullable(),
  pendingGateIds: z.array(z.string().min(1)),
  updatedAt: IsoDateTime,
})
export type ThreadProjection = z.infer<typeof ThreadProjection>
```

This projection is not the source of truth. It is a convenience view updated transactionally with event appends where practical.

## Engine Interfaces

```ts
export interface ThreadEngine {
  createThread(threadId: ThreadId): Promise<void>
  append(events: ThreadEvent[], options?: AppendOptions): Promise<AppendResult>
  read(threadId: ThreadId, options?: Partial<ReadOptions>): Promise<ThreadEvent[]>
  follow(threadId: ThreadId, cursor?: FollowCursor): AsyncIterable<ThreadEvent>
  getTail(threadId: ThreadId): Promise<{ tailSeq: number; updatedAt: string }>
}

export interface ThreadLeaseStore {
  acquireLease(threadId: ThreadId, ownerId: string, ttlMs: number): Promise<Lease | null>
  renewLease(threadId: ThreadId, token: string, ttlMs: number): Promise<Lease>
  releaseLease(threadId: ThreadId, token: string): Promise<void>
}

export interface ThreadProjectionStore {
  get(threadId: ThreadId): Promise<ThreadProjection | null>
}
```

## Postgres Implementation Notes

The PoC Postgres engine should provide:

- one table for thread metadata
- one append-only event table
- one table for leases
- one table for gates
- one projection table or a transactionally updated thread row
- optional `LISTEN/NOTIFY` on new event append for wake hints

## Transaction Boundaries

Each append transaction should:

- verify append preconditions
- assign sequence numbers
- insert event rows
- update thread tail
- update projection fields affected by those events
- notify listeners

This keeps the thread history and convenient state view consistent enough for the PoC.
