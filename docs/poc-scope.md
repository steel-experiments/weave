# PoC Scope

## Purpose

This document freezes the first proof-of-concept scope so implementation can begin without reopening core decisions every session.

## Fixed Decisions

These decisions are locked for the PoC.

### Mailbox model

- one mailbox = one agent session
- parent and child mailbox relationships are future work
- the mailbox is the durable source of truth for the session

### Execution model

- one runner implementation
- one deterministic mock agent adapter
- one async mock tool worker with progress events
- one gate type: manual approval
- one end-to-end resume flow

### Storage model

- Postgres is the first engine
- the engine boundary remains explicit so other backends can follow later

### Typing model

- strongly typed events and contracts
- TypeScript examples for interfaces
- Zod schemas for runtime validation

## PoC Goal

The PoC should prove that Agent Mailbox works as a real primitive.

It must demonstrate:

- durable event history per session
- runner restart or reinvocation from mailbox state
- structured tool lifecycle with progress
- a manual approval gate
- traceable end-to-end flow from prompt to final response

## First Demo

The first demo flow is:

```txt
user starts session
mailbox records prompt
runner invokes deterministic mock agent
agent requests mock async tool
tool emits started and progress events
tool completes with a result that requires approval
runner resumes and creates a manual approval gate
human resolves gate
runner resumes again
agent emits final response
mailbox is completed
```

This proves both asynchronous tool work and resumable execution after human input.

## In Scope

### Mailbox core

- create mailbox for a session
- append strongly typed events
- read event history by sequence number
- lease a mailbox to one runner
- maintain a simple mailbox state projection

### Runner

- acquire a lease
- read mailbox history
- build deterministic input for the mock agent
- append agent-generated events
- release or renew the lease

### Mock agent adapter

- deterministic
- no real LLM
- outputs fixed next actions based on mailbox history
- creates exactly one tool request and one final response

### Mock tool worker

- consumes `tool.requested`
- emits `tool.started`
- emits multiple `tool.progress` events
- emits `tool.completed`
- returns a payload that instructs the agent to request approval

### Manual approval gate

- create gate
- resolve gate
- wake runner after resolution

### Projection

- mailbox status
- tail sequence number
- active lease owner
- pending gate IDs
- updated timestamp

## Out Of Scope

- multiple agent runtimes
- child mailboxes
- policy engine integration
- secret management
- browser sessions
- real sandbox execution
- multi-node clustering
- UI-heavy surfaces
- general workflow language

## Success Criteria

The PoC is successful if:

- one mailbox session can be created and completed
- every state change is reconstructable from durable events
- the mock tool emits observable progress over time
- the session blocks on approval and later resumes correctly
- the final response is produced only after approval is resolved
- restarting the runner process or rerunning the loop does not break correctness

## Recommended PoC Shape

Keep the first implementation small.

### Deployment shape

- local development only
- one application codebase
- Postgres database
- one API process
- one runner loop
- one tool worker loop

These loops may run in the same process at first if that speeds iteration.

### Runtime shape

- no real LLM
- no real coding agent
- deterministic adapter logic only

This keeps the PoC focused on mailbox semantics rather than model behavior.

## Component List

The PoC needs these components:

- mailbox API/service
- Postgres engine
- mailbox projection updater
- runner
- deterministic mock agent adapter
- mock tool worker
- gate resolution API

## Implementation Order

Build in this order:

1. Postgres schema and engine
2. event schemas and contracts
3. mailbox service and projection updates
4. deterministic runner and mock agent adapter
5. mock tool worker with progress
6. manual gate resolution path
7. end-to-end demo script

## Future-Compatible Choices

Even though this is a PoC, keep these seams explicit:

- engine interface
- agent adapter interface
- worker contract
- event typing and validation
- parent-child mailbox relationship as a future extension

This keeps the PoC from turning into a dead end.
