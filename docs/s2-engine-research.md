# S2 Research For Agent Mailbox

## Purpose

This document evaluates `s2-streamstore/s2`, especially `s2-lite`, as:

- a source of architectural ideas for Agent Mailbox
- a possible first durable event stream engine

Repository:

- `https://github.com/s2-streamstore/s2`

Related docs:

- `https://s2.dev`

## Executive Summary

S2 is a strong reference point for the event stream layer of Agent Mailbox.

It is especially relevant because it already models:

- durable ordered append-only streams
- live followers on those streams
- strict per-stream sequencing
- durability before acknowledgment
- object-storage-backed persistence
- a self-hostable single-node implementation

The short recommendation is:

- learn from it immediately
- consider `s2-lite` as a prototype or first experimental engine
- do not tightly couple Agent Mailbox to `s2-lite` as the only production plan

The main reason is that `s2-lite` appears very well aligned with the mailbox event log problem, but less complete for the broader control-plane concerns we care about, especially:

- authentication
- deletion and lifecycle cleanup
- multi-node/high-availability behavior
- mailbox-native policy and gate semantics

## What S2 Is

S2 describes itself as a durable streams API.

The repository contains:

- `s2-cli`
- `s2-lite`: self-hostable S2 server
- `s2-sdk`: Rust SDK

The open source implementation, `s2-lite`, is a single-node server that uses SlateDB as its storage engine.

SlateDB persists to:

- S3
- Tigris
- other S3-compatible object stores
- local disk for local-root mode
- in-memory mode for testing

Important implementation claim:

- when backed by object storage, data is durable before acknowledgment or before being returned to readers

That is directly relevant to our mailbox source-of-truth model.

## High-Level Architecture

DeepWiki and the repo docs point to a three-layer shape.

### 1. API Layer

Implemented with `axum`.

Exposes endpoints for:

- basins
- streams
- records append/read
- health and metrics

### 2. Streamer Task Layer

Each stream has a dedicated Tokio task called a `streamer`.

The streamer owns:

- the current tail position
- append serialization
- broadcast to followers after acknowledgment

This is one of the most important design takeaways.

It gives each stream a single-writer coordination point without needing a heavyweight distributed workflow engine.

### 3. Storage Layer

SlateDB stores:

- stream metadata
- records
- timestamp indexes
- tail positions
- fencing tokens
- trim points

All of that is persisted as key-value data.

## Domain Model

S2 uses three core concepts.

### Basin

A namespace containing streams.

For Agent Mailbox this could map to:

- workspace
- tenant
- deployment environment
- project

### Stream

An ordered append-only sequence of records.

For Agent Mailbox this maps naturally to:

- one mailbox per stream

Alternative mapping:

- one agent session per stream
- one long-lived agent identity per stream

The per-mailbox-per-stream mapping is the cleanest first fit.

### Record

A record has:

- sequence number
- timestamp
- optional headers
- binary body

For Agent Mailbox, each record could carry one mailbox event.

Suggested mapping:

- record headers: event type, causation ID, correlation ID, actor type, actor ID
- record body: JSON payload or binary payload reference

## Why S2 Maps Well To Agent Mailbox

The mailbox primitive needs:

- ordered per-mailbox event history
- append durability
- resumable readers
- efficient tailing for supervisors or runners
- a clean source of truth outside runtime memory

S2 already provides most of that shape.

### Per-stream total ordering

Every stream has a monotonic sequence number.

This is useful for:

- mailbox event replay
- cursor tracking
- resuming runners
- supervisor observation
- deterministic state reconstruction

### Follow semantics

S2 supports live follow behavior.

This is useful for:

- waking a runner when new mailbox events arrive
- supervisor subscriptions
- integration adapters
- parent-child coordination

### Durable append acknowledgment

S2 writes are durable before ack.

This is important because Agent Mailbox should treat the event log as authoritative.

### Conditional append support

S2 supports conditional append using:

- expected sequence matching
- fencing tokens

This is useful for:

- optimistic concurrency
- mailbox lease handoff patterns
- split-brain prevention
- safe resume semantics

### Single stream owner model

Each stream's streamer task serializes appends.

That lines up with our current design instinct:

- one active runner lease per mailbox

S2 does not give us the runner lease by itself, but its stream model supports building that on top.

## Internal Design Takeaways Worth Copying

### 1. One coordination loop per stream

This is probably the most directly reusable idea.

Agent Mailbox should strongly consider one active coordination loop per mailbox stream for:

- assigning positions
- applying write conditions
- broadcasting visible updates
- managing stable positions

Even if we do not use S2 itself, this is a good design pattern.

### 2. Separate durable history from live broadcast

S2 persists data to durable storage and separately broadcasts acknowledged events to followers.

We should do the same:

- mailbox event log is the durable source of truth
- live subscriptions are just a delivery convenience

### 3. Sequence number and timestamp together

S2 tracks both sequence order and timestamp.

This is useful for mailbox replay because we care about:

- exact ordering for correctness
- time for audit, observability, and time-based queries

### 4. Object storage as durability substrate

S2 is a real example of building a durable stream abstraction on top of object storage.

That makes it relevant to the long-term serverless, low-cost direction for Agent Mailbox.

## Storage And Concurrency Model

From the DeepWiki research:

- each stream has a single streamer task
- records are keyed by stream and position
- timestamp indexes support time-based lookup
- tail position is stored durably
- writes happen in batches
- writes use durable acknowledgment semantics

This means:

- ordering is strict within one stream
- concurrency is high across many streams
- one hot stream is limited by one streamer's throughput

For Agent Mailbox, that tradeoff is acceptable and even desirable.

We want mailbox-local serialization far more than mailbox-local parallel writes.

## Potential Mapping To Agent Mailbox

One possible first mapping:

### Basin

Use one basin per environment or tenant.

Examples:

- `dev`
- `prod`
- `workspace-acme`

### Stream

Use one stream per mailbox.

Examples:

- `mailbox.agent-123`
- `mailbox.session-456`

### Record

One mailbox event per record.

Examples:

- `user.message.received`
- `tool.requested`
- `tool.progress`
- `gate.created`
- `gate.resolved`
- `agent.response.produced`

### Follow

Use followers for:

- runners
- supervisors
- Slack notifier workers
- stream-link adapters

### Conditional append

Use conditional append or fencing to enforce:

- runner lease ownership
- replay-safe append expectations

## What S2 Does Not Solve For Us

This is the important boundary.

S2 is primarily a durable stream engine.

Agent Mailbox is broader than that.

We still need mailbox-native logic for:

- policy checks
- approval gates
- secret/capability mediation
- mailbox status projections
- runner leases
- inbox visibility rules
- stream linking and filtering
- trace model conventions

So even if S2 becomes the first engine, it should sit under our own mailbox abstraction.

## Main Limitations Of s2-lite

The main concerns from the research are below.

### 1. Authentication is not built in

DeepWiki indicates `s2-lite` does not meaningfully enforce access tokens today.

Implication:

- we would need our own auth layer in front of it

### 2. Deletion and lifecycle cleanup are incomplete

Deletion for basins, streams, and records is not fully complete.

Implication:

- acceptable for early append-only experiments
- weak for a mature lifecycle story
- we would need to rely more on retention than deletion in early use

### 3. Single-node architecture

`s2-lite` is single-node.

Implication:

- fine for local/self-hosted early deployments
- not enough as the full long-term HA story
- still durable if backed by object storage, but not replicated compute/control

### 4. Operational maturity gaps

DeepWiki notes:

- append pipelining is disabled by default for safety
- observability is basic
- some hosted/cloud compatibility differences remain

Implication:

- good experimental engine
- not yet something to blindly standardize on as the whole product foundation

### 5. It is a stream store, not a mailbox product

Implication:

- we still need our own core domain model above it

## Recommendation

## Recommended stance

Use S2 in one of these ways, in order of safety.

### Option A: Learn from it, do not depend on it initially

Use it as a design reference while building our own first engine on a simpler store like Postgres.

Pros:

- least dependency risk
- easiest operational story
- simpler debugging early on

Cons:

- we do not directly test the object-storage-backed direction

### Option B: Build an engine abstraction and implement `s2-lite` as an experimental backend

This is the best strategic option.

Use a mailbox storage interface such as:

- append events
- read from sequence
- follow stream
- compare-and-append
- fetch tail

Then implement:

- Postgres engine first
- `s2-lite` engine second

Pros:

- validates portability
- lets us test real stream semantics
- avoids locking the whole project to one immature backend

Cons:

- more upfront abstraction work

### Option C: Use `s2-lite` as the very first engine

This is possible if the immediate goal is to prove the mailbox primitive against a durable stream substrate.

Pros:

- closest to the event-stream-native architecture we want long term
- built-in follow semantics are a very good fit
- durable object-store-backed append is attractive

Cons:

- auth gap
- lifecycle gaps
- single-node implementation
- may slow down iteration if we are also defining the mailbox abstraction at the same time

## My recommendation

The best path is Option B.

Build Agent Mailbox so the storage engine boundary is explicit, then:

- start with the simplest dependable engine for core mailbox semantics
- add `s2-lite` quickly as the first alternative backend

If the goal is fastest delivery of a mailbox MVP, Postgres is still the safer first engine.

If the goal is fastest exploration of an event-stream-native architecture, `s2-lite` is a strong experimental first backend.

## How We Could Use S2 In Practice

If we choose to try it, a minimal architecture could look like:

```txt
Agent Mailbox API
  -> mailbox service
  -> engine adapter
      -> s2-lite
          basin = tenant/environment
          stream = mailbox ID
          record = mailbox event

supervisors/runners
  -> follow stream

mailbox projections
  -> maintained by mailbox service or projection workers
```

Important note:

We should not expose S2 concepts directly as the whole user-facing model.

Instead:

- our domain model stays mailbox-first
- S2 stays an implementation detail of the engine layer

## Specific Takeaways For Agent Mailbox

### Good ideas to adopt

- one active coordination task per stream/mailbox
- strict per-stream ordering
- follower model for real-time observation
- object-storage-backed durability as a serious long-term target
- conditional append with fencing or expected sequence checks

### Things to avoid inheriting blindly

- exposing raw stream-store terminology instead of mailbox terminology
- depending on engine-level auth to solve mailbox policy
- assuming stream retention alone solves deletion, compliance, or archival

## Bottom Line

S2 is highly relevant.

It is probably one of the better examples of a lightweight, durable, ordered stream substrate that resembles the event layer Agent Mailbox wants.

`s2-lite` is credible as:

- a design reference
- a prototype engine
- an experimental first backend behind an abstraction

It is less convincing as:

- the only engine we commit the whole project to immediately

For Agent Mailbox, the cleanest position is:

- build our mailbox abstraction first
- keep the engine boundary explicit
- evaluate `s2-lite` as one of the first real engines behind that abstraction

## References

- GitHub repo: `https://github.com/s2-streamstore/s2`
- S2 docs: `https://s2.dev/docs/concepts`
- S2 README: `https://raw.githubusercontent.com/s2-streamstore/s2/main/README.md`
