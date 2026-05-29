# Docs Sync Slice 7: External Result Publishing

## Status

- Vertical: docs-sync
- Status: Planned
- Last updated: 2026-05-29
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Publish docs sync results back to GitHub through thread-visible tool lifecycle events rather than hidden GitHub Action side effects.

## User Outcome

Docs maintainers can see check runs, PR comments, issues, or audit artifacts linked from the thread that produced them.

## Architecture Impact

This is app-level egress using reusable credential and tool semantics.

Expected tool:

- `github.publishAuditResult`

Expected outputs:

- check run URL
- PR comment URL when applicable
- issue URL for scheduled drift when applicable
- uploaded artifact URL when applicable

Credential rule:

- GitHub token is resolved through credential provider
- raw token is never stored in events or artifacts

## Test Plan

- Report-only mode skips publishing and records that publishing was disabled.
- Publishing creates or updates a check run through a fake GitHub boundary.
- Duplicate publish attempts are idempotent and do not duplicate comments or issues.
- Credential failure becomes `credential.failed` or `tool.failed` with no secret leakage.
- Published URLs are included in final response and thread-visible output.

## Acceptance Criteria

- [ ] Publishing can be disabled by audit mode.
- [ ] All publish attempts have tool lifecycle events.
- [ ] Credentials are never stored in thread events.
- [ ] GitHub URLs are included in the final response when publishing succeeds.

## Progress

- [ ] Define `github.publishAuditResult` input and output schemas.
- [ ] Define check-run versus PR-comment versus issue policy by audit mode.
- [ ] Add credential requirements and redaction tests.
- [ ] Add idempotency key strategy for check runs and comments.
- [ ] Add integration test through real tool worker with fake GitHub client.

## Completion Notes

Not started.

## Docs To Update On Completion

- [ ] `../../steel-docs-sync-example.md`
- [ ] `../../declarative-api.md` if credential behavior changes
- [ ] this slice with exact implementation evidence
