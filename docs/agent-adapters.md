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
- emit `agent.reply.produced`

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

## Public `weave/opencode` CLI Adapter

Core now exposes a reusable hardened OpenCode CLI adapter through `weave/opencode`.

It is for app authors who want to run `opencode run --format json` from a bounded workspace while keeping app-specific prompts, schemas, and orchestration outside core.

```ts
import { createOpenCodeCliAdapter, opencodePermissionProfile } from "weave/opencode";
import { z } from "zod";

const adapter = createOpenCodeCliAdapter({
  profile: opencodePermissionProfile({
    workspace: workspaceRef,
    tools: {
      readFiles: true,
      writeFiles: { allowedPaths: ["src/**", "docs/**"] },
      shell: { commands: ["npm test", "npm run typecheck"] },
      network: false,
      secrets: false,
      git: { allowCommit: false, allowBranchSwitch: false, allowPush: false },
    },
  }),
  output: z.object({ summary: z.string().min(1), filesChanged: z.array(z.string()).default([]) }),
});

const result = await adapter.run({
  workspace: workspaceRef,
  prompt: "Make the bounded change and return JSON only.",
  allowedPaths: ["src/**", "docs/**"],
});
```

The adapter provides:

- deny-by-default permission profiles via `opencodePermissionProfile()` and `opencodeDenyAllPermissionProfile()`
- built-in Weave capability requests for `opencode.run`, workspace read/write, bounded shell, network, secrets, and Git write authority
- extension seams for app-defined OpenCode-exposed tools, rejected unless every exposed tool declares corresponding Weave capabilities
- validated CLI command, args, profile flags, env allowlist, workspace root, timeout, and output byte limits
- sanitized child process env that rejects explicit keys outside the profile allowlist and rejects secret-shaped keys unless secrets are enabled
- schema-validated JSON output through the app-provided Zod schema
- actual Git changed-file enforcement against allowed paths, independent of any model-reported `filesChanged` field

Default profiles do not expose writes, shell commands, network, secrets, Git commits, branch switching, pushes, broad shell executables, unsafe session/file/remote flags, or `--dangerously-skip-permissions`.

Residual trust assumption: `weave/opencode` hardens process launch, env propagation, output parsing, and post-run Git diff enforcement. It is not an OS sandbox. Host-level safety still depends on the installed OpenCode binary honoring its permission flags, the local user account, filesystem permissions, symlink/host config exposure, and credentials available outside the sanitized process env.

## Example-local OpenCode adapter

The prompt workflow review example includes an example-local bounded adapter in `examples/prompt-workflow-review/src/opencode-adapter.ts`.

It predates the public CLI adapter and remains useful as a read-only thread-backed tool harness example.

The adapter shape is:

- `createOpenCodeAgent(...)` returns a normal Weave `agent(...)` contract
- OpenCode execution is represented by a mockable `OpenCodeSessionRunner`
- `createOpenCodeCliRunner(...)` can shell out to `opencode run --format json` for opt-in real binary testing
- repo operations use Weave tools: `repo.listFiles`, `repo.readFile`, `repo.readRange`, and `repo.searchText`
- writes, shell, and network are not exposed by the adapter
- structured outputs are parsed and validated against the caller's schema

This keeps Weave as the durable control layer while leaving the live OpenCode process/session implementation behind a replaceable boundary.

The opt-in prompt workflow integration test is `npm --workspace weave-prompt-workflow-review run test:opencode`.

## Workspace-scoped OpenCode implementer

The development orchestrator adds a separate implementation boundary for coding slices:

- `createOpenCodeImplementerAgent(...)` returns a normal Weave agent role named `weave.opencodeImplementer` by default
- `createOpenCodeImplementationTool(...)` wraps an injected `OpenCodeImplementationRunner` behind the `dev.opencode.implement` tool
- input is workspace-scoped through `WorkspaceRef`, not the current process checkout
- the tool declares `repo.read`, `repo.write.branch`, `opencode.run`, and bounded shell intent for policy inspection
- the agent emits `dev.implementation.started` and `dev.implementation.completed`
- the returned implementation summary is schema-validated and checkpointed as `implementation-summary`
- OpenCode claims are not treated as verification; test/typecheck/reviewer slices must independently validate the workspace diff later
- branch mismatches, `main`, and out-of-scope changed-file claims become structured blocked results

This boundary is intentionally not a full autonomous coding loop. It is the patching component that the slice runner can spawn after workspace allocation and before independent verification/review.

## Weave Maintainer OpenCode Usage

The development orchestrator consumes the public `weave/opencode` adapter rather than owning a standalone OpenCode CLI implementation:

- `examples/weave-maintainer/src/opencode-runner.ts` keeps maintainer prompt builders and schema/result mapping only.
- `createOpenCodeCliImplementationRunner(...)` wraps `createOpenCodeCliAdapter(...)` for `ImplementationSummarySchema`.
- `createOpenCodeCliRepairRunner(...)` wraps `createOpenCodeCliAdapter(...)` for `RepairResultSchema`.
- `buildOpenCodeImplementationRunInput(...)` and `buildOpenCodeRepairRunInput(...)` map maintainer inputs to generic `OpenCodeRunInput` with `workspace`, `prompt`, and per-slice `allowedPaths`.
- `createMaintainerOpenCodeImplementationPermissionProfile(...)` and `createMaintainerOpenCodeRepairPermissionProfile(...)` define distinct explicit profiles using `opencodePermissionProfile(...)`.
- `createMaintainerOpenCodePolicy(...)` denies unexpected `opencode.*` capability requests at the maintainer app boundary.
- Adapter errors for permission denial, out-of-scope actual diffs, invalid JSON/schema, timeout, max output, non-zero exit, and invalid workspace become maintainer structured blocked results.
- Branch mismatches are refused before OpenCode starts.
- Reported implementation files outside `allowedFiles` still fail before Weave treats the output as complete.
- Actual Git changed-file enforcement against `allowedFiles` is provided by `weave/opencode`, independent of model-reported `filesChanged`.

The runner executes inside `WorkspaceRef.path` and still returns claims only. The slice runner must rerun verification and reviewer children after every implementation or repair run, and source checkpoint/finalization gates remain outside OpenCode.

Residual trust assumption: the maintainer now inherits the `weave/opencode` security model. The adapter hardens launch, env, output parsing, and post-run Git diff enforcement, but it is not an OS sandbox. Host-level safety still depends on the installed OpenCode binary honoring its permission flags, the local user account, filesystem permissions, symlink/host config exposure, and credentials available outside the sanitized process environment.

Example configuration:

```ts
const implementationProfile = createMaintainerOpenCodeImplementationPermissionProfile();

const implementationRunner = createOpenCodeCliImplementationRunner({
  command: "opencode",
  args: ["run", "--format", "json"],
  permissionProfile: implementationProfile,
  timeoutMs: 600_000,
  maxOutputBytes: 256_000,
});
```

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
