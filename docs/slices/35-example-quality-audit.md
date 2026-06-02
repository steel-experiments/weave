# Example Quality Audit Slice

## Status

- Vertical: `weave-core`
- Status: `Proposed`
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

- [ ] SRE demo has a clear gate-heavy/runtime semantics role.
- [ ] Steel docs sync demonstrates run-first authoring and domain-shaped tool outputs.
- [ ] Simple assistant routes model calls through tools and does not imply the model provider is required for Weave.
- [ ] Examples avoid raw nondeterminism inside `agent.run`.
- [ ] Examples avoid manual event construction where context helpers should be used.
- [ ] Example README or root README explains each example's purpose and requirements.
- [ ] All example workspaces typecheck.

## Progress

- [ ] Audit SRE demo.
- [ ] Audit Steel docs sync.
- [ ] Audit simple assistant.
- [ ] Update example docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

Include:

- examples changed
- smoke commands run
- credential requirements documented
- commands run
- known example limitations

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `README.md`
- [ ] relevant example README files if present
- [ ] `docs/declarative-api.md` if examples are referenced there
