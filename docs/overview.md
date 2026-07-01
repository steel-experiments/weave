# Weave Overview

## Summary

Weave is Steel's open, durable, event-driven control layer for agents.

The product name is Weave. It may be spoken as Steel Weave in Steel contexts, but repository docs and code should use Weave.

It sits between:

- agent runtimes
- tools and activities
- credentials and secrets
- policies and approvals
- humans and supervisors
- external integrations

The goal is not to build a single agent runtime.

The goal is to build the glue layer that lets many runtimes, tools, and integrations operate through one durable control boundary.

## Core Thesis

Agents should not be treated as fragile request-response applications.

They should operate through a durable thread that records:

- what started a session
- what the agent decided
- what tools it invoked
- what happened while those tools ran
- what policies applied
- what humans approved or denied
- how execution resumed after interruption

The runtime is ephemeral.

The thread is the source of truth.

## What This Project Is

Weave is:

- a durable event boundary for agents
- a router between agents and tools
- a trace surface for every decision and side effect
- a policy enforcement point
- a place for interrupt, approval, and resume workflows
- a neutral integration layer across runtimes and tools

## What This Project Is Not

Weave is not primarily:

- a foundation model
- a single agent framework
- a workflow DSL
- a replacement for every tool runtime
- a reason to tightly couple to one cloud provider

## Design Goals

### 1. Runtime portability

The same thread should work with different execution environments:

- local agents
- hosted coding agents
- browser-capable agents
- cloud sandboxes

### 2. Durable execution

Execution should resume from thread state and event history, not from process memory.

### 3. Better tool semantics

Tool execution should be more structured than raw shell calls.

Tools should support:

- typed arguments
- explicit start and completion
- progress updates
- long-running execution
- async callbacks
- cancellation and interrupts

### 4. Unified tracing

Every action should be traceable across the full lifecycle of a session.

### 5. Policy at the boundary

Permissions, approvals, and capability use should be enforced where side effects cross the thread boundary.

### 6. Extensibility

The project should make it easy for the community to add:

- runtime adapters
- tool adapters
- integrations
- policy providers
- storage backends over time

## Stretch Goal

The stretch goal is to make Weave the open source control plane that developers use when they want agents to be:

- durable
- observable
- resumable
- interruptible
- policy-aware
- integration-friendly

In the strongest version of this project:

- a session can move across runtimes
- subagents can coordinate through linked event streams
- humans can step in through the same event model
- tools can report progress and receive feedback in real time
- policies and secrets can be mediated without leaking raw credentials into the agent runtime
- developers can plug in Slack, Linear, browser sessions, sandboxes, and custom tools without changing the core model

The long-term ambition is to become the shared event and control substrate for open agent systems.

## Primary Consumer

Weave is proven by the host applications built on top of it in production-shaped workflows. Each such host is a separate product on top of the kernel.

The original SRE agent harness remains a strong target workflow, but it is best treated as one host application slice rather than a separate north star.

## Principles

- event-first
- durable by default
- runtime-agnostic
- tool-agnostic
- append-only history
- trace everything important
- explicit side-effect boundaries
- human-in-the-loop as a first-class path
- composable streams
- open ecosystem over closed stack

## Near-Term Focus

The early project focus should stay narrow.

We need to prove:

- a thread can durably record agent execution
- a runner can resume from thread state
- tool execution can be modeled better than bash polling
- a human or supervisor can interrupt and unblock work
- one event stream can coordinate with another in a controlled way

If those pieces work, the broader platform vision becomes credible.
