# Positioning

## Core Framing

Agent Mailbox should be positioned as the control plane for agents.

It should not be positioned as a monolithic replacement for every workflow engine, event store, runtime, or policy system.

The strongest framing is:

```txt
Agent Mailbox = durable control plane
Other systems = engines, adapters, or companion services
```

## What This Means

Agent Mailbox defines the stable boundary for:

- durable event history
- ordered inbox semantics
- resumable execution coordination
- tool mediation
- human gates and approvals
- trace and audit boundaries
- policy and credential mediation
- mailbox-to-mailbox coordination

It does not need to own every implementation detail below that boundary.

## The Main Positioning Statement

Agent Mailbox is a durable, runtime-neutral control plane for agents.

It lets teams plug in:

- execution engines
- stream and storage engines
- coordination engines
- policy and identity systems
- external integrations

while preserving one stable mailbox model.

## Why This Is Stronger Than Competing Head-On

If we position Agent Mailbox as a direct competitor to every adjacent system, the product becomes conceptually bloated.

If we position it as the control boundary above and between those systems, the product becomes:

- easier to explain
- easier to adopt incrementally
- easier to extend
- more useful in heterogeneous environments

This also matches the actual problem:

teams already have runtimes, tools, queues, stores, and identity systems

what they lack is a coherent, durable boundary that ties them together safely for agent execution.

## Product Boundary

### Agent Mailbox owns

- mailbox identity
- mailbox event model
- runner and wake model
- gate and approval semantics
- trace model
- capability and policy boundary semantics
- adapter interfaces
- stream-link and subagent coordination model

### Agent Mailbox does not need to own

- every workflow runtime
- every storage backend
- every event broker
- every policy engine
- every credential system
- every browser or sandbox implementation

Those can be attached behind the mailbox.

## How To Think About Adjacent Systems

### Execution engines

Examples:

- Temporal
- Inngest
- Trigger.dev
- LangGraph
- OpenCode-like runtimes
- Codex-like runtimes
- Claude Code-like runtimes

These can execute work on behalf of a mailbox.

### Coordination engines

Examples:

- Orleans
- Akka
- Cloudflare Durable Objects

These can host mailbox-local coordination or stable entity execution.

### Stream and storage engines

Examples:

- S2
- JetStream
- EventStoreDB / KurrentDB
- Postgres
- SQLite

These can store mailbox events, power replay, or drive subscriptions.

### Policy and identity companions

Examples:

- SpiceDB
- vault systems
- OAuth and delegated identity systems
- secret managers

These can answer who may do what and under which constraints.

### External integrations

Examples:

- Slack
- Linear
- email
- SMS
- browser session providers
- sandbox providers

These consume and emit mailbox events.

## Key Differentiator

The key differentiator is not that Agent Mailbox has better workflow execution than Temporal or better stream durability than EventStoreDB.

The differentiator is that Agent Mailbox gives all of those systems one shared control boundary for agent work.

That boundary is where:

- execution resumes
- side effects are mediated
- human approvals pause and resume progress
- traces are connected
- delegated identities attach
- credentials are consumed safely
- subagents coordinate

## How To Explain The Project Simply

### Short form

Agent Mailbox is the control plane for agents.

### Slightly longer form

Agent Mailbox is a durable event and coordination boundary that lets different agent runtimes, tools, engines, and policy systems work together through one mailbox model.

### Contributor form

You do not need to replace your workflow engine, event store, or runtime to use Agent Mailbox. You plug them into the mailbox model as engines or adapters.

## Strategic Benefit

This framing creates a much healthier ecosystem strategy.

Instead of saying:

- replace Temporal
- replace LangGraph
- replace EventStoreDB
- replace Durable Objects

we say:

- connect them
- normalize them behind one mailbox abstraction
- make them interoperable for agent control flows

That opens up many adoption paths.

## Adoption Paths

### Path 1: existing runtime, new mailbox

A team keeps its current agent runtime but adds mailbox durability, tracing, and gates.

### Path 2: existing store, new control plane

A team keeps Postgres, EventStoreDB, or S2, but uses Agent Mailbox as the new orchestration boundary.

### Path 3: existing workflow engine, mailbox wrapper

A team continues using Temporal or Inngest under the hood, but adopts mailbox semantics for cross-agent coordination.

### Path 4: full greenfield mailbox-native system

A team builds directly around the mailbox abstraction from the start.

## What To Avoid In Messaging

Avoid saying or implying:

- we built a better Temporal
- we built a better LangGraph
- we built a better EventStoreDB
- we built a better actor runtime

That blurs the product boundary.

Better framing:

- we built the missing control plane between them

## Bottom Line

Agent Mailbox is strongest when framed as:

- the durable control plane for agents
- the mailbox abstraction that unifies runtimes, engines, tools, humans, and policies
- the stable boundary above interchangeable engines and integrations

That is a bigger and more defensible category than trying to replace each adjacent system directly.
