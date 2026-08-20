# Shadow Architect Monitor

## Role

This document is a **read-only architecture and closure checkpoint**. It records what was reviewed, what is implemented, what is only verified on an internal integration branch, and what still requires local or Human authority.

It is not a daemon, scheduler, background session, legal reviewer, provider admission, merge bot, or release authority. A future Agent must rerun the checks against a new exact subject instead of treating this file as a live monitor.

## Reviewed subject

```yaml
repository: ed3c/website-design-compiler
canonical_main_sha: 4a79d9635911690950f02edda4505672ba7544f6
root_delivery_pr: 44
root_delivery_branch: codex/pr42-delivery-v2
root_delivery_head: 9e67222dea5580b1f807266162909422771da99e
integration_pr: 54
integration_branch: agent/shadow-architect-control-plane
integrated_code_head_before_document_refresh: c58958ee30e76d8aa9ad9388e6bf10adbd5a7db5
planning_pdf_sha256: 7350f0e3d29ace70a6c92343e5501b34763f452e057d9b8acef3829f57230ef6
planning_pdf_byte_length: 1878749
planning_pdf_publication: DIGEST_ONLY
checkpoint_date_utc: 2026-08-20
```

The documentation commits after `integrated_code_head_before_document_refresh` do not change the reviewed implementation semantics. Any later implementation change requires a new exact-head verification.

## Evidence vocabulary

The following terms are deliberately different:

- **IMPLEMENTED** — production or contract code exists.
- **VERIFIED** — declared commands and negative controls passed for an exact head.
- **INTEGRATED** — verified commits are reachable from PR #54's integration branch.
- **ADMITTED** — an engineering, Human, legal, provider, source-publication, or protected-input authority accepted the exact subject.
- **RELEASED** — the exact integrated subject passed the release profile and was promoted by authorized owners.

`IMPLEMENTED`, `VERIFIED`, and `INTEGRATED` never imply `ADMITTED` or `RELEASED`.

Repository evidence states remain:

`PASS | FAIL | ABSENT | NOT_IMPLEMENTED | NOT_EXERCISED | SKIPPED_BY_POLICY | NEEDS_INPUT | BLOCKED`.

## Integration checkpoint

The following convergence carriers were independently reviewed and merged into PR #54's branch. The merge is internal program convergence only.

| Plane | Carrier PR | Verified exact head | Internal merge commit | Result |
|---|---:|---|---|---|
| Source plane + compiler kernel + edited-page browser proof | #148 | `b1b5da6d8d8e71a87de8cb1fbeb32a93fd69e880` | `ace73bc7b9eba7c460c3489a18ccd4b0ba1fc6a0` | INTEGRATED |
| Technology admission + SPDX + SBOM/notices | #136 | `1a1a8307f053d89fa55424f560f5ac8840578513` | `13711eb0e3adad1479cc059252fbea55a208b650` | INTEGRATED |
| Executable control-plane contracts and queue compiler | #138 | `4f2c9d96bcdcc08447542c4faadd83183c9ee2ee` | `905fc4320f8ffc39dc104b373c1bafcc5783773a` | INTEGRATED |
| Credential-free Markdown/CSV/JSON projection | #129 | `d7fd8b0946b21187a0c8fc677a93d1a9192c3e6c` | `270d32402da1404c5e412077ccbf9d4e6805d887` | INTEGRATED |
| Optional-capability decision packet contract | #130 | `15b9e7a7b66b171553d7b5f405024eee07465903` | `c58958ee30e76d8aa9ad9388e6bf10adbd5a7db5` | INTEGRATED, CONTRACT ONLY |

The exact browser-proof carrier produced a durable `PASS` receipt for the edited page subject on desktop, tablet, mobile, and reduced-motion browser projects. The aggregate workflow stayed fail-closed because trusted visual-direction admission, independent Storybook golden review, and repository-rights/Human admissions were absent. That aggregate failure is not converted to a release `PASS`.

## Real-problem closure matrix

| Problem from issue/article/PDF framing | Current truth | State | Owning continuation |
|---|---|---|---|
| Immutable source identity, exact anchors, and separate inference | Manifest, observation, inference contracts exist and validate exact byte/Git subjects | VERIFIED + INTEGRATED | close #55/#58 foundations after issue ledger update |
| Supplied article/Markdown intake | UTF-8 caller-supplied bytes produce exact line observations; no network acquisition is claimed | VERIFIED + INTEGRATED | close #56 |
| Exact repository snapshot intake | Exact commit/tree/path/range snapshots produce observations; branch names and traversal fail closed | VERIFIED + INTEGRATED | close #57 |
| PDF intake | Digest-only parser-neutral boundary exists; no text, page observation, or parser output is fabricated | VERIFIED boundary; parser NOT_EXERCISED | close #63 boundary; keep #46 open for real parser and URL intake |
| Live URL acquisition | No admitted general URL adapter is integrated | NOT_IMPLEMENTED | #72 / LHQ-007 |
| Bidirectional page-graph edits | Exact-base typed patch, conflict/reject states, inverse history, provenance, and Puck/Payload round-trip exist | VERIFIED + INTEGRATED | close #139/#141 |
| Production content edits | Section prop and embedded content contract update atomically; claim-sensitive content is source-bound | VERIFIED + INTEGRATED | close #145 |
| Constraint boundary and solver decision | Hard findings dominate soft scores; deterministic overflow is `NEEDS_INPUT`; generic solver remains `NOT_ADMITTED` | VERIFIED + INTEGRATED | close #140; a future solver requires new evidence/admission |
| Edited graph reaches real browser | Exact source/base/patch/result/head identities bind four browser observations and screenshot hashes | VERIFIED + INTEGRATED | close #146; hardening remains #149 |
| Exact technology identity and rights-subject separation | Package/Git/artifact identities, distinct rights subjects, revocation, SPDX expression evaluation, and SBOM/notice evidence exist | VERIFIED + INTEGRATED | close #59/#64/#65/#71; Human/legal/provider gate remains #25 |
| Executable task/DAG/start model | Cycle, predecessor, exact-subject, writeset, and convergence-owner rules execute deterministically | VERIFIED + INTEGRATED | close #60/#66 |
| Replay-safe lease state machine | ACTIVE/CHECKPOINTED/RELEASED/LOST/EXPIRED transitions are deterministic and replay-safe | VERIFIED + INTEGRATED | close #67; active local carrier remains NOT_EXERCISED |
| Independent verifier and zero-context handoff | Worker/verifier roles, artifact hashes, writesets, negative controls, and successor identity are enforced | VERIFIED + INTEGRATED | close #68/#69 |
| Live local scheduler, worktrees, and lease carrier | No private/background scheduler was executed by cloud CI | NOT_EXERCISED | #49 / LHQ-002 |
| Deterministic document export | Canonical records project to local Markdown, CSV, and JSON with drift identity | VERIFIED + INTEGRATED | close #61 |
| Google Docs/Sheets/CodeXdoc writes | Provider adapters, OAuth, target IDs, and write receipts are absent | NOT_IMPLEMENTED / NOT_EXERCISED | #50, #70, #73, #74, #75 / LHQ-004 |
| Optional 3D/video/audio decisions | Decision schema/constructor exists, but tests use synthetic packets and no Human product outcome is frozen | CONTRACT VERIFIED; decision NEEDS_INPUT | #51, #62, #76 / LHQ-005 |
| Real production provider and release | Credentials, exact provider/model/output/service rights, billing/quota, Human admission, and main release are absent | BLOCKED | #25 / LHQ-001 and LHQ-006 |

## PR disposition

### Integrated carriers

- PR #148 — merged into PR #54 branch.
- PR #136 — merged into PR #54 branch.
- PR #138 — merged into PR #54 branch.
- PR #129 — merged into PR #54 branch.
- PR #130 — merged into PR #54 branch as a contract-only capability.

### Molecular predecessors

The following PRs are retained as trace records but are not separate merge units after their exact commits became reachable through a convergence carrier:

- source/kernel: #124, #125, #132, #137, #142, #143, #144, #147;
- technology: #127, #128;
- control plane: #133, #134, #135.

Foundation PRs #55, #126, and #131 were recognized as merged when their commits became reachable from the integration branch.

### Remaining delivery PRs

- PR #54: integration branch for this architecture program. It requires a fresh exact-head CI readback before merging into PR #44's branch.
- PR #44: root delivery PR targeting `main`. It remains draft and **must not merge to `main`** while required Human/provider/rights/visual/release gates fail.

## Issue disposition policy

Close an issue only when its stated mechanical acceptance criteria are implemented, verified, and integrated. Use a follow-on issue for hardening rather than keeping a completed implementation issue open indefinitely.

Keep parent issues open when their remaining acceptance includes a real parser, URL acquisition, active local execution, external provider write, Human product decision, legal/provider admission, or release authority.

Routing-only wave issues that duplicated status tracking are superseded by this monitor, the Stack PR index, and the Local Handoff queue. They should close as `not_planned`, not as fabricated implementation `PASS`.

## Current blockers

1. **Production provider / rights / protected execution** — issue #25.
2. **General URL acquisition adapter** — issue #72.
3. **Real PDF parser and permitted source-byte handling** — parent issue #46 / LHQ-003.
4. **Active local Git Town/worktree/scheduler carrier** — parent issue #49 / LHQ-002.
5. **Google Docs/Sheets/CodeXdoc adapters and OAuth** — #50, #70, #73, #74, #75 / LHQ-004.
6. **Evidence-bound optional product decisions** — #51, #62, #76 / LHQ-005.
7. **Durable edited-browser package hardening** — #149 / LHQ-008.
8. **Final exact-head PR #54 verification and PR #44/main release** — LHQ-006.

## Merge decision

```yaml
merge_pr_54_into_pr_44_branch: CONDITIONAL
condition: exact PR #54 head must pass implementation, build, test, browser, and documentation checks; known Human gates may remain explicitly fail-closed
merge_pr_44_into_main: BLOCKED
blocking_issue: 25
additional_blockers:
  - trusted visual-direction admission
  - independent Storybook golden admission
  - repository-rights/Human legal admission
  - protected provider execution
  - canonical main release receipt
```

## Rerun triggers

Rerun this monitor whenever any of these change:

- PR #54 or PR #44 head SHA;
- source bytes, parser identity, extraction policy, or publication classification;
- package/model/provider revision or rights evidence;
- task contract, DAG, writeset, lease, or verifier identity;
- page graph, patch, constraint policy, screenshot bytes, or release profile;
- issue acceptance criteria or product decision;
- external provider/OAuth/credential/physical-device evidence;
- any proposal to close a parent issue, merge PR #44, or promote production.

## Required read order

1. [`README.md`](../../README.md)
2. this monitor
3. [`STACKED_PR_INDEX.md`](STACKED_PR_INDEX.md)
4. [`LOCAL_HANDOFF_EXECUTION_QUEUE.md`](LOCAL_HANDOFF_EXECUTION_QUEUE.md)
5. [`AGENTS.md`](../../AGENTS.md)
6. the owning schema, implementation, test, exact PR, and workflow artifact
