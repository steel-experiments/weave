# Example Quality Audit Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Make the SRE demo, Steel docs sync example, and simple assistant example act as trustworthy demos and regression assets for the V1 authoring model.

## Non-goals

- Do not add new examples.
- Do not require real external credentials for normal regression checks.
- Do not convert every example to the same style if distinct roles are useful.
- Do not hide known limitations of model-backed or integration-backed examples.

## User Outcome

As a potential app author, I can use the examples to understand the supported V1 patterns and avoid unsafe replay patterns.

## Architecture Impact

- No core primitive changes are expected.
- Examples should clarify role-specific patterns: gate-heavy runtime semantics, run-first/domain-output authoring, and model-backed tool execution.
- May add lightweight smoke commands or docs if examples expose gaps.

## Implementation Plan

1. Assign a clear role to each example in docs.
2. Audit the SRE demo as the gate-heavy runtime semantics example.
3. Audit Steel docs sync as the run-first and domain-output authoring example.
4. Audit simple assistant as the model-backed run-first example.
5. Remove accidental raw nondeterminism from `agent.run` bodies.
6. Ensure model calls and external effects happen through tools or durable context methods.
7. Add or document smoke commands that can run without external credentials where practical.
8. Keep typecheck green across all example workspaces.

## Test Plan

- Run `npm run typecheck`.
- Run `npm test` if example changes touch core semantics or shared test fixtures.
- Run deterministic demo smoke commands where they do not require external credentials.
- For credentialed examples, verify startup errors and docs clearly explain requirements.

## Acceptance Criteria

- [x] SRE demo has a clear gate-heavy/runtime semantics role.
- [x] Steel docs sync demonstrates run-first authoring and domain-shaped tool outputs.
- [x] Simple assistant routes model calls through tools and does not imply the model provider is required for Weave.
- [x] Examples avoid raw nondeterminism inside `agent.run`.
- [x] Examples avoid manual event construction where context helpers should be used.
- [x] Example README or root README explains each example's purpose and requirements.
- [x] All example workspaces typecheck.

## Progress

- [x] Audit SRE demo.
- [x] Audit Steel docs sync.
- [x] Audit simple assistant.
- [x] Update example docs.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- Audited `examples/sre-demo`, `examples/steel-docs-sync`, and `examples/simple-assistant` agent bodies.
- Confirmed examples route side effects through durable tools and context helpers rather than raw side effects inside `agent.run`.
- Confirmed the simple assistant model call is routed through `zenChatCompletionTool` and requires `OPENCODE_API_KEY` only for that example.
- Added a root README `Examples` section assigning each example a clear role and documenting credential requirements.
- Added package descriptions to the example workspaces.

Changed files:

- `README.md`
- `examples/sre-demo/package.json`
- `examples/steel-docs-sync/package.json`
- `examples/simple-assistant/package.json`

Commands run:

- `npm test`
- `npm run typecheck`

Smoke commands not run:

- `npm run sre:demo`
- `npm run steel:demo`

Reason: both deterministic demos are DB-backed and call `migrate(..., { reset: true })`, which resets the shared `weave` schema. They were audited in code and covered by workspace typecheck here.

Known limitations:

- The simple assistant is credentialed and network-backed, so it is documented as optional and not a Weave provider requirement.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `README.md`
- [x] relevant example README files if present
- [x] `docs/declarative-api.md` if examples are referenced there
