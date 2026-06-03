# Prompt-Driven Workflow Example

## Status

- Vertical: `weave-core`
- Status: `Planned`
- Last updated: `2026-06-03`
- Owner: `weave-examples`

## Goal

Build an example where a user gives Weave a high-level prompt and Weave creates a custom task harness for that prompt.

The example should show how Weave can approximate Claude Code's dynamic workflow idea with durable threads, child agents, policies, gates, and an OpenCode-backed agent harness.

## User Outcome

As an engineer, I can ask Weave for a custom workflow such as:

```txt
Create a workflow to review this draft blog post. Verify each technical claim against the codebase, fan out checks by claim, adversarially review weak citations, and return a publish/no-publish recommendation.
```

Weave should then:

- classify the task and choose an orchestration pattern
- generate a workflow plan from the prompt
- show the plan and required capabilities before risky execution
- spawn focused child agents for the plan steps
- join and synthesize child outputs into a structured result
- preserve the full durable trace so the workflow can resume after interruption

## Context

Claude Code dynamic workflows create a task-specific JavaScript harness that can spawn and coordinate subagents. The valuable product idea is not the JavaScript file itself. The value is that the agent can choose a harness pattern that fits the task instead of forcing every task through one default coding loop.

For Weave, the safer first version should not execute arbitrary model-written JavaScript. It should generate a typed workflow plan that a deterministic Weave runner interprets.

This keeps Weave's durable thread as the source of truth and lets policies inspect every tool, child agent, credential, and human gate request.

## Proposed Example Shape

```txt
user prompt
  -> workflow.compiler agent
  -> workflow plan artifact plus summary
  -> optional approval gate
  -> workflow.runner agent
  -> child agents backed by OpenCode or model tools
  -> verifier child agents
  -> synthesizer result
```

The example should start with one concrete workflow family, not a universal workflow builder.

Recommended first example:

- name: `examples/prompt-workflow-review`
- task: verify technical claims in a document against this repository
- pattern: `fan-out-and-synthesize` plus optional `adversarial-verification`
- child runtime: OpenCode-backed harness for repository-aware claim checks
- output: structured claim table, confidence, sources, and publish recommendation

This is narrower than all dynamic workflows, but it exercises the important primitives: prompt-to-plan, child agents, model routing, gates, artifacts, joins, and durable resume.

## What Weave Needs

### 1. OpenCode-backed harness agent

We need a reusable agent adapter that can run an OpenCode-style coding agent through Weave's normal tool surface.

The harness should provide:

- a bounded `agent.run` wrapper around an OpenCode task
- a tool manifest matching the normal OpenCode tools the example needs, such as read/search shell-safe commands, file reads, and maybe web fetches
- thread-backed tool execution so tool requests become `tool.requested` and `tool.completed` events
- policy-aware capability declarations for repo read, shell, network, and file write boundaries
- structured output validation with a Zod schema

The first version can be conservative:

- repo read/search tools only
- no file writes
- no arbitrary shell mutation
- no external network unless explicitly enabled by policy

### 2. Workflow plan schema

The compiler agent should output data, not executable code.

Example shape:

```ts
const workflowPlan = z.object({
  objective: z.string(),
  pattern: z.enum([
    "classify-and-act",
    "fan-out-and-synthesize",
    "adversarial-verification",
    "generate-and-filter",
    "tournament",
    "loop-until-done",
  ]),
  budget: z.object({
    maxChildAgents: z.number().int().positive(),
    maxDepth: z.number().int().nonnegative(),
    maxToolCalls: z.number().int().positive().optional(),
  }),
  requiredCapabilities: z.array(z.object({
    name: z.string(),
    reason: z.string(),
  })),
  steps: z.array(z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("spawn"),
      key: z.string(),
      agentName: z.string(),
      input: z.unknown(),
      verifyWith: z.string().optional(),
    }),
    z.object({
      kind: z.literal("join"),
      key: z.string(),
      childKey: z.string(),
    }),
    z.object({
      kind: z.literal("synthesize"),
      key: z.string(),
      inputKeys: z.array(z.string()),
    }),
  ])),
});
```

The plan should be stored as an artifact and summarized in thread events. It should include deterministic step keys so replay can reconcile child spawns and joins safely.

### 3. Workflow runner agent

The runner interprets the plan using existing durable effects:

- `ctx.checkpoint` stores normalized plan state
- `ctx.gate` asks for approval before high-risk execution
- `ctx.spawn` creates child threads for plan steps
- `ctx.join` waits for child outputs
- `ctx.emit` records domain events such as accepted plan, rejected plan, and synthesized result

Current Weave does not support implicit parallel durable effects with `Promise.all`. That does not block this example. The runner can spawn children sequentially across replay passes without joining them immediately. Once all children are spawned, it can join them. The children then run concurrently from their own inboxes.

### 4. Child agent catalog

The generated plan should only reference registered agents. The MVP catalog can include:

- `workflow.claimExtractor`: extracts factual technical claims from the input document
- `workflow.claimChecker`: checks one claim against repository evidence using the OpenCode harness
- `workflow.claimVerifier`: adversarially reviews one checker result and flags weak evidence
- `workflow.synthesizer`: merges claim results into the final recommendation

The compiler may choose among these agents, but it must not invent unregistered agents unless the workflow is rejected or routed to a human for authoring.

### 5. Policy and capability boundary

The example should make the safety story explicit.

The compiler can ask for capabilities, but policies decide whether they are allowed:

- repo read access may be allowed automatically
- file writes should be denied for the first example
- network access should require approval or be disabled
- shell commands should be limited to read-only commands or routed through a purpose-built search tool
- plan execution should gate if the plan requests capabilities beyond the example default

This demonstrates why Weave is a control layer instead of just a generated script runner.

## MVP Workflow

1. User starts a root thread targeting `workflow.customize` with `{ prompt, documentPath }`.
2. `workflow.customize` calls a model tool to produce a `WorkflowPlan`.
3. The plan is validated, normalized, and stored as an artifact.
4. If required capabilities are outside the default safe set, `ctx.gate` asks for user approval.
5. The runner spawns `claimExtractor`.
6. For each extracted claim, the runner spawns `claimChecker` child work.
7. For low-confidence or high-impact claims, the runner spawns `claimVerifier` child work.
8. The runner joins children and spawns or calls `synthesizer`.
9. The final output includes a claim table, citations, confidence, and recommendation.

## Example Output

```json
{
  "recommendation": "revise",
  "summary": "3 claims were verified, 2 need stronger evidence, and 1 appears inaccurate.",
  "claims": [
    {
      "claim": "Weave child threads preserve root thread lineage across nested descendants.",
      "status": "verified",
      "confidence": 0.91,
      "evidence": ["docs/declarative-api.md:717-746"],
      "verifierNotes": "Source directly supports lineage and child session behavior."
    }
  ]
}
```

## Non-goals

- Do not execute arbitrary model-generated JavaScript in the first version.
- Do not build a fully general workflow language.
- Do not add broad file mutation or production remediation tools.
- Do not require continuation suspension; replay-based durable effects remain the model.
- Do not make the compiler bypass registered agents, tools, policies, or capability checks.

## Architecture Impact

Expected reusable changes:

- Add an example-level workflow plan schema and interpreter.
- Add or harden an OpenCode-style agent adapter if no reusable adapter exists yet.
- Add model-backed tools for plan compilation and synthesis, or use existing model invocation boundaries if available.
- Add example event types for workflow plan creation, plan acceptance, child result classification, and final synthesis.
- Add artifacts for generated plans, source document snapshots, child outputs, and final reports.

Expected core primitive changes:

- No new primitive is required for the MVP if `ctx.spawn`, `ctx.join`, `ctx.gate`, `ctx.checkpoint`, `ctx.emit`, capabilities, and policies are sufficient.
- A later slice may add explicit batch spawn/join helpers if the example exposes too much boilerplate.

## Implementation Plan

1. Create a minimal OpenCode harness spike.
2. Define `WorkflowPlan`, `WorkflowStep`, and final report schemas in the example.
3. Implement `workflow.compiler` as a constrained model-backed agent or tool that emits only the plan schema.
4. Implement `workflow.runner` as deterministic TypeScript that interprets the validated plan through Weave effects.
5. Implement claim extraction, claim checking, verifier, and synthesizer child agents.
6. Add policies that allow repo read/search and deny write/network by default.
7. Add a demo script that starts the root thread and runs runner/tool daemons until completion.
8. Add docs showing prompt examples, event flow, and how this differs from executing generated JavaScript.

## Test Plan

- Unit test workflow plan validation and normalization.
- Unit test deterministic step-key generation from extracted claims.
- Integration test a full prompt-to-report run with mocked model outputs and real Weave thread/service boundaries.
- Replay test interruption after plan creation, after child spawn, and after partial joins.
- Policy test denial when the generated plan asks for file write or network access.
- Output schema test for child checker, verifier, and final report agents.
- Regression test that changed plan content for an existing step key produces replay mismatch or a controlled plan rejection.

## Acceptance Criteria

- [ ] A user can run one command or script to create a prompt-driven workflow thread.
- [ ] The generated workflow plan is schema-validated and stored durably before execution.
- [ ] The workflow uses registered Weave agents and tools only.
- [ ] The workflow fans out claim checks through child threads and joins their outputs.
- [ ] The workflow can resume after interruption without duplicating child work.
- [ ] Policies prevent unsafe generated plans from executing silently.
- [ ] The final report is structured and cites evidence.

## Open Questions

- Should the first OpenCode harness be a child agent adapter or a tool that invokes OpenCode for one bounded task?
- Should workflow plans be authored as app-local schemas first, or should Weave expose a reusable `workflow` helper later?
- How much model routing should the MVP support: agent name only, or explicit model/runtime profile on each child step?
- Should the compiler ask a human to refine the rubric before execution, or only when capabilities exceed policy defaults?

## Progress

- [x] Planning document created.
- [ ] OpenCode harness approach selected.
- [ ] Example schemas drafted.
- [ ] Example implementation started.
- [ ] Tests added.
- [ ] Completion notes written.

## Completion Notes

Fill this in when the slice ships.

Include:

- shipped behavior
- changed files or modules
- tests added
- commands run
- known gaps
- follow-up slices created

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/README.md`
- [ ] `docs/agent-adapters.md` if the OpenCode harness becomes reusable
- [ ] `docs/declarative-api.md` if workflow examples expose new public helpers
- [ ] `docs/glossary.md` if `WorkflowPlan` or `WorkflowCompiler` becomes shared vocabulary
- [ ] `docs/slices/README.md` if status changes
