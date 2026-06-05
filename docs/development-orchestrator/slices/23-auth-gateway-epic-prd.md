# Auth Gateway Epic PRD

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-05`
- Owner: `weave-maintainer`

## Goal

Create a multi-slice auth gateway PRD that Weave Maintainer can execute as one ordered epic after source checkpointing exists.

## Non-goals

- Do not implement auth slices in this slice.
- Do not run the full auth epic before source checkpoints are available.
- Do not combine unrelated core work into the auth epic.

## User Outcome

As a maintainer, I can start one auth gateway initiative and let Weave Maintainer progress through the remaining auth slices with source checkpoints between them.

## Architecture Impact

- Adds `docs/prds/auth-gateway-epic.md` as an executable Maintainer input.
- Converts existing proposed auth slice docs into ordered `## Slice ...` sections.
- Keeps slice 52 as shipped context and includes slices 53-56 as executable work.

## Implementation Plan

1. Create `docs/prds/auth-gateway-epic.md`.
2. Include context from shipped slices 51 and 52.
3. Add explicit ordered sections for slices 53, 54, 55, and 56.
4. Include verification, review, risk, and non-goal guidance for the whole epic.
5. Document the recommended `npm run initiative:run` command.

## Test Plan

- Compile the PRD with the deterministic markdown compiler.
- Verify it produces ordered slices for 53-56.
- Run `npm test`, `npm run typecheck`, and `git diff --check` if code changes are needed.

## Acceptance Criteria

- [ ] Auth epic PRD exists and is executable by Weave Maintainer.
- [ ] PRD compiles into ordered slices 53-56.
- [ ] PRD references shipped context from slices 51 and 52.
- [ ] PRD warns not to run without source checkpoint support.
- [ ] Recommended runner command is documented.

## Progress

- [ ] Create auth epic PRD.
- [ ] Validate compiler output.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `docs/prds/auth-gateway-epic.md`
