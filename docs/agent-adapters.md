# Agent Adapters

## Purpose

This document explains how Weave can adapt OpenCode-style agents and other common agent architectures.

The goal is not to rewrite every agent runtime.

The goal is to wrap them with a thread-aware runner and tool surface.

## Core Idea

Most agents should integrate through an adapter layer.

The adapter is responsible for:

- turning thread events into agent input
- invoking the agent for one bounded step or turn
- intercepting tool usage
- turning agent outputs back into thread events

This means the thread can support many runtimes without forcing a single internal implementation style.

## General Adapter Shape

```ts
type AgentStepResult = {
  events?: ThreadEvent[]
  requestedTools?: Array<{
    name: string
    args: unknown
    metadata?: object
  }>
  gateRequest?: {
    type: string
    payload: unknown
  }
  sleepUntil?: string
  finalResponse?: unknown
}

interface AgentAdapter {
  buildInput(events: ThreadEvent[], state: ThreadState): Promise<unknown>
  runStep(input: unknown): Promise<AgentStepResult>
}
```

This keeps the thread runtime small.

## Three Common Agent Shapes

## 1. Request/response agents

Shape:

```txt
input -> run once -> final output
```

Adaptation difficulty:

- easy

Thread approach:

- replay events
- construct input
- invoke the agent once
- emit `agent.response.produced`

Good fit for:

- simple assistants
- stateless LLM wrappers
- summarizers and analyzers

## 2. Tool-calling loop agents

Shape:

```txt
input -> reason -> request tool -> get result -> reason -> final output
```

Adaptation difficulty:

- moderate, but very workable

Thread approach:

- provide thread-backed tools
- intercept tool calls before side effects occur
- emit `tool.requested`
- let workers emit `tool.completed`
- rerun the agent when results arrive

This is the best fit for the thread model.

## 3. Long-running interactive agents

Shape:

- persistent process
- maintains live in-memory state
- may hold browser, shell, or session state internally

Adaptation difficulty:

- higher

Thread approach:

- reduce reliance on process memory
- move durable truth into thread events
- turn persistent resources into explicit session handles or capabilities
- reinvoke the agent across durable boundaries

## OpenCode-Style Agents

## Why they are promising

OpenCode-style coding agents are likely good candidates if they already have:

- a stepwise loop
- explicit tool calls
- a known prompt and context construction path
- reinvocation support after tool results

If the host can intercept tool calls before they execute, then integration should be straightforward.

## Likely adaptation model

The easiest path is to wrap the agent rather than rewrite its internals.

### Step 1: thread-backed tools

Replace direct tools such as:

- `bash`
- `browser`
- `read file`
- `write file`

with thread-aware tools that:

- emit a `tool.requested` event
- return control to the host runner
- continue only when `tool.completed` or `tool.failed` arrives

### Step 2: bounded turns

Run OpenCode in bounded steps rather than as an endlessly trusted live process.

Examples of a step boundary:

- before a side effect
- after a tool result
- on user message arrival
- on gate resolution

### Step 3: reconstruct context from thread state

The adapter should rebuild enough state from:

- prior messages
- tool results
- gate outcomes
- thread metadata

so that the agent can continue without depending on hidden live memory.

## What makes OpenCode easy or hard to adapt

### Easy if

- tool calls are explicit and host-interceptable
- the runtime can be re-entered with reconstructed context
- session history is externalizable
- final or intermediate actions are structured

### Hard if

- tools execute deep inside opaque internals
- important state only exists in memory
- the process assumes it stays alive forever
- progress and interrupts are not surfaced cleanly

## Other Agent Families

## Function-calling chat agents

These are easy to adapt.

Why:

- tool requests are already structured
- they naturally fit request/result loops

## Planner-executor agents

These are also a good fit.

Why:

- the planner can emit intent into the thread
- execution workers can return results as events

## Browser-first agents

These are workable, but need more care.

Why:

- browser session state must become explicit
- credentials and OTP handling should be capability-based
- the browser worker should be separate from the reasoning runtime

## Local shell-heavy coding agents

These are workable if shell access is already abstracted as a tool.

If shell access is deeply embedded and opaque, adaptation gets harder.

## What The Adapter Should Own

The adapter should own:

- prompt or input construction from thread events
- mapping agent intents to thread events
- mapping tool results back into agent-visible context
- identifying step boundaries

The adapter should not own:

- durable storage semantics
- policy evaluation logic
- supervisor routing logic
- direct secret access decisions

Those belong to the thread platform.

## Practical Compatibility Assessment

### Best fit

- coding agents with explicit tools
- function-calling agents
- planner/executor systems
- reinvocable hosted agent runtimes

### Medium fit

- interactive CLI agents with some hidden session state
- browser agents with sticky live runtime state

### Weak fit

- opaque systems that only expose final text
- systems with uncontrolled side effects and no interception points

## Recommended Integration Strategy

### 1. Do not start with deep runtime rewrites

Wrap existing runtimes first.

### 2. Force tools through thread boundaries

This is the main source of control, observability, and resumability.

### 3. Reinvoke across durable boundaries

Do not rely on live process memory for correctness.

### 4. Model resources explicitly

Browser sessions, sandboxes, temporary workdirs, and credentials should be represented as thread-known resources or capabilities.

## Bottom Line

Most OpenCode-style and modern tool-using agents should be adaptable to Weave.

The easiest path is:

- adapter layer
- thread-backed tools
- bounded runner turns
- replay and reinvocation

The main integration risk is not the LLM itself.

It is hidden state and hidden side effects inside long-lived runtimes.
