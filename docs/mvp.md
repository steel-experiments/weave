# MVP Definition

## Goal

The MVP should prove that Weave is a real primitive, not just an idea.

That means proving resumability, structured tool execution, and interrupt handling through one durable event boundary.

## MVP Questions

The MVP should answer:

- can an agent session be durably recorded as events?
- can a runner stop and later resume from thread state?
- can tool execution be modeled better than raw shell polling?
- can a human or supervisor interrupt the flow and let it continue later?
- can we trace what happened from start to finish?

## In Scope

### Thread core

- create thread
- append ordered events
- read or replay thread history
- basic correlation and trace metadata

### Runner

- acquire thread lease
- reconstruct state from thread history or snapshot
- process visible inbox items
- emit new events

### Structured tool execution

- tool definition with name and arguments
- request event
- started event
- progress event
- completed or failed event

### Human or supervisor interruption

- gate created
- gate resolved
- thread resumed

### One linked coordination path

- simple parent-child or supervisor stream linkage

## Out of Scope for First Cut

- a full workflow language
- a large plugin marketplace
- many storage engines at once
- advanced multi-tenant policy models
- full secret vault product surface
- broad UI surface area

## Candidate Demo Flow

```txt
user starts agent session
agent requests a tool action
tool emits progress
tool or worker requires approval or human input
thread creates gate
human resolves gate
runner resumes
tool completes
agent emits final response
```

## MVP Event Set

Suggested first event types:

- `session.started`
- `prompt.received`
- `agent.step.requested`
- `tool.requested`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`
- `gate.created`
- `gate.resolved`
- `runner.resumed`
- `agent.reply.produced`

## MVP Success Criteria

The MVP is successful if:

- the same session can survive process restarts
- tool progress is visible through events
- the system can pause on human input and continue later
- session history is inspectable after completion
- the result is meaningful enough that future adapters can target the same primitive

## Suggested Implementation Bias

Bias the MVP toward simplicity:

- one storage backend
- one runner implementation
- one structured tool worker
- one gate type
- one end-to-end demo

The goal is to prove the shape of the primitive before generalizing it.
