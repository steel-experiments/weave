# Similar Systems

## Purpose

This document compares Agent Mailbox to adjacent systems so we can be clear about:

- what already exists
- what ideas we should borrow
- where Agent Mailbox is genuinely different
- what systems may complement it rather than compete with it

## Short Summary

There is no single existing system that fully matches the Agent Mailbox idea.

Instead, the space breaks into a few categories:

- workflow and durable execution systems
- actor and virtual actor runtimes
- event stream and messaging systems
- event-native databases and event stores
- agent frameworks with persistence or interrupts

Agent Mailbox sits between those categories.

The strongest framing is not that those systems are pure competitors.

The strongest framing is that many of them can become engines, adapters, or companion services behind the mailbox control plane.

It is closest to:

- a durable actor mailbox
- an event-sourced control plane
- a policy and supervision boundary for agents

It is not exactly:

- just a workflow engine
- just an event store
- just an actor runtime
- just an agent framework

## Comparison Criteria

To compare systems fairly, these are the capabilities that matter most for Agent Mailbox:

- durable append-only history
- replay or resumability
- per-entity ordering
- human interruption or approval support
- side-effect mediation
- runtime portability
- policy and credential boundary support
- agent-to-agent or parent-child coordination
- operational simplicity

## Category 1: Durable Workflow Systems

These systems solve long-running execution very well, but they tend to center the workflow runtime rather than a mailbox abstraction.

### Temporal

What it is:

- a durable workflow execution platform built around event history, replay, and activities

Strengths:

- excellent durability and replay model
- strong long-running execution semantics
- well-developed timers, retries, child workflows, and signals
- clear separation between workflow code and external activities

Weaknesses relative to Agent Mailbox:

- more heavyweight than the primitive we want
- deterministic workflow constraints leak into application design
- workflow is the main abstraction, not mailbox or event boundary
- policy, credential mediation, and human gate semantics are not the primary core abstraction

Best lesson for us:

- resume from durable history, not process memory

Bottom line:

- Temporal is the strongest reference for durability and replay
- Agent Mailbox should borrow its durability discipline without becoming a full workflow platform first

### Inngest

What it is:

- a durable execution platform with step-based memoization and event-triggered functions

Strengths:

- serverless-friendly execution model
- simpler developer model than strict deterministic replay
- strong step and retry semantics
- good event-triggered function story

Weaknesses relative to Agent Mailbox:

- still function and workflow centered
- not primarily a mailbox or per-agent durable control-plane model
- tool mediation, identity ingress, and approval gates are not its central abstraction

Best lesson for us:

- step-level memoization is a practical alternative to full deterministic replay

Bottom line:

- very relevant for serverless durable execution ideas
- less relevant as the full conceptual model for mailbox-native agents

### Trigger.dev

What it is:

- long-running async task platform with checkpoint-resume behavior and task orchestration

Strengths:

- strong async task and subtask model
- checkpointing and resumable waits
- observability and tracing story

Weaknesses relative to Agent Mailbox:

- task oriented rather than mailbox oriented
- checkpoint-resume is a different core technique than event-first durable mailboxes
- less natural fit for agent identity, inbox semantics, and stream-linked supervision

Best lesson for us:

- long-running tasks need excellent tracing, resumption, and subtask linkage

Bottom line:

- strong inspiration for async task execution and tracing
- not the same primitive as a durable mailbox

### LangGraph

What it is:

- agent and workflow graph runtime with persistence, interrupts, and durable execution

Strengths:

- directly relevant to agent systems
- human-in-the-loop is first-class
- checkpointing and resume are built in
- pushes developers toward explicit task boundaries for side effects

Weaknesses relative to Agent Mailbox:

- graph execution is the core abstraction
- still closer to an agent runtime than a neutral cross-runtime control plane
- not designed primarily as the durable event boundary shared across multiple external runtimes and integrations

Best lesson for us:

- side effects must be explicit and resumable

Bottom line:

- probably the most relevant agent-oriented execution system to compare against
- Agent Mailbox differs by wanting to sit outside the agent framework itself

### Sandcastle and Four Framework style systems

What they are:

- agent harnesses or runtime-side orchestration layers
- sandbox or tool-execution substrates
- prompt, tool, and execution-loop frameworks

Strengths:

- strong fit for how an agent actually runs
- useful for tool exposure and sandboxing
- likely good integrations on the execution side of Agent Mailbox

Weaknesses relative to Agent Mailbox:

- usually not the durable source of truth
- not primarily the cross-runtime event boundary
- not primarily a gate, trace, and policy control plane

Best lesson for us:

- keep runtime harness concerns separate from mailbox control-plane concerns

Bottom line:

- your intuition is correct
- these are better treated as runtime-side integrations or execution engines than as mailbox competitors

## Category 2: Actor and Virtual Actor Systems

These systems are strong references for identity, serialization, and ephemeral compute.

### Orleans

What it is:

- virtual actor framework with stable identities, activations, persistence, and reminders

Strengths:

- stable actor identity
- runtime activations are ephemeral
- reminders/timers are durable
- strong mental model for one logical entity with resumable behavior

Weaknesses relative to Agent Mailbox:

- state is usually modeled as grain state, not an append-only event mailbox
- not primarily built around traceable external side-effect events
- policy and credential mediation are outside the core concept

Best lesson for us:

- mailbox identity should be stable even if execution is not

Bottom line:

- excellent conceptual reference for addressable agent identity and wake/resume behavior

### Akka

What it is:

- actor framework with message passing, supervision, clustering, persistence, and streams

Strengths:

- canonical actor mailbox semantics
- strong supervision model
- sequential message handling per actor
- supports persistence and event sourcing in the wider platform

Weaknesses relative to Agent Mailbox:

- lower-level application framework, not a focused agent control-plane product
- durable history and policy boundary need more explicit assembly
- human workflows and secret mediation are not first-class primitives

Best lesson for us:

- actor mailboxes plus supervision are extremely relevant

Bottom line:

- strong conceptual ancestor of the mailbox idea
- too general-purpose to be the direct product shape we want

### Cloudflare Durable Objects

What it is:

- named stateful serverless objects with durable storage and alarms

Strengths:

- very close to the “one logical entity with durable state and ephemeral compute” model
- strong fit for coordination-heavy workloads
- serverless operational model

Weaknesses relative to Agent Mailbox:

- stateful object is the unit, but append-only event history is not the main abstraction
- cross-tool policy, credential mediation, and trace-first agent orchestration are not built in
- Cloudflare-specific runtime model

Best lesson for us:

- one named durable coordination unit per agent or mailbox is a powerful primitive

Bottom line:

- perhaps the best serverless systems analogy for the mailbox runtime boundary

## Category 3: Event Streams and Messaging Systems

These systems are best viewed as substrates, not full mailbox products.

### NATS JetStream

What it is:

- durable streaming and replay on top of NATS

Strengths:

- replayable streams
- durable consumers
- low-latency fanout and operational flexibility
- compare-and-set and KV/object store features in the broader platform

Weaknesses relative to Agent Mailbox:

- stream broker, not an event store per mailbox by default
- per-entity optimistic concurrency and event-sourced entity loading are not the primary model
- policy, gates, and credential boundaries are not first-class

Best lesson for us:

- decouple durable history from live consumption and replay

Bottom line:

- good substrate candidate for delivery and fanout
- not sufficient alone as the mailbox source of truth

### S2 / s2-lite

What it is:

- durable streams API with self-hostable open source implementation backed by object storage

Strengths:

- strong per-stream ordering
- follow semantics map well to mailbox subscriptions
- durable before acknowledgment
- naturally mailbox-like if one stream equals one mailbox

Weaknesses relative to Agent Mailbox:

- stream engine, not mailbox product
- auth and lifecycle gaps in `s2-lite`
- single-node implementation today

Best lesson for us:

- one stream per mailbox is a very clean and attractive engine shape

Bottom line:

- highly relevant as an engine candidate
- not the whole solution by itself

## Category 4: Event Stores and Event-Native Databases

These systems are strongest when you want the event log itself to be the database.

### EventStoreDB / KurrentDB

What it is:

- event-native database built for event sourcing, stream access, projections, and replay

Strengths:

- append-only streams are a first-class database concept
- event sourcing, projections, and replay are core
- causation and correlation are part of the mental model
- much closer to mailbox history than a general broker is

Weaknesses relative to Agent Mailbox:

- still a data platform rather than an agent control plane
- human gates, tool execution lifecycle, and runtime adapters sit above it
- may be more event-sourcing-heavy than needed for a simple early mailbox implementation

Best lesson for us:

- first-class streams plus projections are a strong fit for mailbox history and derived views

Bottom line:

- one of the closest storage-layer comparisons to the mailbox event log idea

### Event sourcing as a pattern

What it is:

- store immutable domain events as the system of record and rebuild state by replay

Strengths:

- excellent fit for audit, replay, and historical reconstruction
- per-entity streams match mailbox identity well
- projections map cleanly to mailbox views like status, pending gates, and latest agent response

Weaknesses relative to Agent Mailbox:

- it is a pattern, not a full system
- does not by itself define agent runtime integration, tool mediation, or supervision

Best lesson for us:

- the mailbox event log should be the source of truth, and projections should stay secondary

Bottom line:

- foundational pattern, but not enough by itself

## Category 5: Authorization and Policy Systems

These are not similar systems in the full product sense, but they are relevant to one slice of the problem.

### SpiceDB and Zanzibar-style systems

What they are:

- relationship-based authorization engines

Strengths:

- strong fit for answering who may access what
- good for mailbox ownership, gate resolution permissions, and delegated capabilities

Weaknesses relative to Agent Mailbox:

- authorization only
- no durable mailbox event model
- no runner or tool lifecycle

Best lesson for us:

- keep policy facts separate from mailbox history

Bottom line:

- excellent companion system, not a competing system

## Overall Positioning

The nearest neighbors by category are:

- Temporal and Inngest for durable orchestration
- LangGraph for agent-centric durable execution
- Orleans, Akka, and Durable Objects for actor and identity models
- S2 and JetStream for durable stream substrates
- EventStoreDB/KurrentDB for event-native persistence

The distinctive Agent Mailbox angle is combining these concerns into one boundary:

- durable event log
- ordered inbox
- trace boundary
- policy and gate boundary
- credential mediation boundary
- runtime-neutral wake/resume surface

That combination is what makes it feel like a separate product category.

## Comparison Table

| System | Closest category | Strongest overlap | Biggest gap vs Agent Mailbox |
| --- | --- | --- | --- |
| Temporal | Workflow engine | Replay, durability, external activities | More workflow-centric and heavier than desired |
| Inngest | Durable execution platform | Serverless-friendly durable steps | Function-centric, not mailbox-centric |
| Trigger.dev | Async task runtime | Long-running execution, resume, tracing | Task orchestration more than mailbox control plane |
| LangGraph | Agent runtime with persistence | Agent interrupts and durable execution | Still a runtime/framework, not neutral control layer |
| Orleans | Virtual actor system | Stable identity, ephemeral activation | Not append-only mailbox-first |
| Akka | Actor/supervision framework | Mailboxes, supervision, sequential processing | Lower-level and less event-log/product focused |
| Durable Objects | Serverless coordination primitive | Named durable coordination units | Not event-history-first or cross-runtime neutral |
| JetStream | Stream substrate | Replayable durable streams | Not an event store or mailbox product by itself |
| S2 | Durable stream engine | Per-stream ordering and follow semantics | Engine only, not mailbox platform |
| EventStoreDB/KurrentDB | Event-native database | Streams, projections, replay | Not an agent control plane |
| SpiceDB | Policy engine | Fine-grained authorization | Not execution, mailbox, or stream coordination |

## What We Should Borrow

### From Temporal

- replay discipline
- explicit side-effect boundaries
- child execution and signal concepts

### From Inngest and Trigger.dev

- serverless-friendly resumability
- step memoization and idempotency discipline
- execution tracing around long-running work

### From LangGraph

- human interruption as a first-class execution concern
- resumable agent execution with explicit side-effect boundaries

### From Orleans, Akka, and Durable Objects

- stable identity per logical agent or mailbox
- one serialized execution path per mailbox
- ephemeral compute with durable wake behavior
- supervision concepts

### From S2, JetStream, and EventStoreDB/KurrentDB

- durable append-only streams
- replay and follow semantics
- causation and correlation IDs
- projection-friendly event history

### From SpiceDB-style systems

- keep authorization and relationship policy as a separate specialized layer

## What Seems Most Unique About Agent Mailbox

The strongest product distinction is not any one feature.

It is the combination of these into one durable boundary for agents:

- event sourcing
- mailbox semantics
- resumable runner surface
- tool mediation
- human approval gates
- delegated identity and credential boundaries
- trace-first coordination between agents, humans, and tools

Most other systems cover only a subset.

## Practical Conclusion

Agent Mailbox should not try to beat every category at its own game.

Instead it should:

- use workflow systems as durability inspiration
- use actor systems as identity and serialization inspiration
- use stream engines and event stores as storage inspiration
- use policy engines as companion systems
- treat adjacent systems as pluggable parts behind one stable mailbox boundary

The project becomes strongest if it stays focused on the missing layer between them:

`durable, policy-aware, traceable, runtime-neutral agent coordination through mailboxes`

This means many “competitors” are better understood as:

- execution engines
- coordination engines
- stream engines
- event stores
- policy companions

all sitting behind or beside Agent Mailbox.

## Recommended Strategy From This Comparison

### Build ourselves

- mailbox model
- event taxonomy
- runner and adapter interface
- gate and policy boundary
- trace model
- stream linking model

### Reuse or integrate

- storage engine substrate
- event store backend
- policy engine
- runtime-specific adapters

### Avoid early overreach

- do not rebuild a full Temporal competitor in v1
- do not build a full general-purpose actor platform in v1
- do not build a full secret management system in v1

The right first move is still a narrow mailbox primitive with strong event semantics.

## References

- Temporal workflow execution: `https://docs.temporal.io/workflow-execution`
- LangGraph durable execution: `https://docs.langchain.com/oss/python/langgraph/durable-execution`
- Cloudflare Durable Objects: `https://developers.cloudflare.com/durable-objects/`
- Orleans overview: `https://learn.microsoft.com/en-us/dotnet/orleans/overview`
- NATS JetStream: `https://docs.nats.io/nats-concepts/jetstream`
- Event sourcing pattern: `https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing`
- Inngest durable execution: `https://www.inngest.com/docs/learn/how-functions-are-executed`
- Trigger.dev how it works: `https://trigger.dev/docs/how-it-works`
- Akka actor model: `https://doc.akka.io/docs/akka/current/typed/guide/actors-intro.html`
- KurrentDB: `https://www.eventstore.com/eventstoredb`
