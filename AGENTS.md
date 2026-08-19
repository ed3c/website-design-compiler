# Repository Agent Contract

## Mission

Build and verify an evidence-first website design compiler that converts briefs and observed references into original, accessible, performant, commercially governable website artifacts.

This repository is the product-specific code and routing center. Shared procedures remain in the private `ed3c/skills-shared` repository and are consumed only through exact public-safe bindings. Never vendor, quote, paraphrase in bulk, or reconstruct private shared skill bodies here.

## Required control-plane bindings

The canonical control-plane binding is `.agents/bindings/repository-control-plane.json`. Required methods include:

- `shared-skills-infra`
- `procedural-shadow-runtime`
- `agentic-tech-lead-orchestration`
- `spatial-loop-systems-engineering`
- `git-town-stacked-pr-worker`
- `dual-forge-repository-loop` only when a local Forgejo plane is explicitly configured

Broader repository methods remain listed in `.skill-bindings/skills-shared.json`.

A missing, stale, or mismatched binding is `ABSENT`. Do not silently fall back to remembered prompt text.

## Exact-subject rule

Before analysis or side effects, bind all applicable fields:

```yaml
repository: ed3c/website-design-compiler
canonical_main_sha: <sha>
base_ref: <ref>
base_sha: <sha>
head_ref: <ref-or-ABSENT>
head_sha: <sha-or-ABSENT>
issue: <number-and-url>
pull_request: <number-and-url-or-ABSENT>
program_id: <id>
phase_id: <P0-P9>
task_id: <id>
attempt_id: <id>
lease_id: <id-or-NOT_APPLICABLE>
source_manifest_digest: <sha256-or-ABSENT>
task_contract_digest: <sha256-or-ABSENT>
control_plane_binding_digest: <sha256>
```

A changed SHA, source byte identity, parser, policy, model/provider revision, task contract, writeset, or command set is a new subject. Previous receipts do not transfer automatically.

## Evidence states

Use these repository evidence states exactly:

`PASS | FAIL | ABSENT | NOT_IMPLEMENTED | NOT_EXERCISED | SKIPPED_BY_POLICY | NEEDS_INPUT | BLOCKED`

Rules:

- documentation, prompts, schemas, branches, pull requests and sample code do not prove runtime behavior;
- `PASS` requires exact-subject execution plus independently checkable artifacts;
- an optional capability not required by the active profile is `SKIPPED_BY_POLICY`, not fake `PASS`;
- missing required evidence is `ABSENT` or `BLOCKED`;
- a real external/local/Human action not performed is `NOT_EXERCISED`;
- unsupported or absent code is `NOT_IMPLEMENTED`;
- contradictory or missing business/source input is `NEEDS_INPUT`.

## Source intake boundary

Article, PDF, repository, URL, model, provider, package, font, asset, and service inputs must enter through a source manifest.

Required source fields:

```yaml
source_id: <stable-id>
source_class: <ARTICLE|PDF|URL|GIT_REPOSITORY|PACKAGE|MODEL|PROVIDER|ASSET|OTHER>
locator: <public-safe-locator>
access_classification: <PUBLIC|PRIVATE|USER_PROVIDED|PROTECTED>
publication_classification: <PUBLIC_BYTES|DIGEST_ONLY|PRIVATE_FIXTURE|PROHIBITED>
byte_or_commit_identity: <sha256-or-git-identity>
parser_or_observer_identity: <name-version-config>
anchors: <page-line-section-path-ranges>
extraction_warnings: []
captured_at: <timestamp>
```

Observation and inference are different records. Product analogies, inferred implementation details, performance claims, cost claims and license claims remain hypotheses until independently verified.

Never commit user-provided/private source bytes merely because the Agent can read them. Publication requires an explicit source-owner decision.

## Shadow Architect Monitor

The Shadow monitor is read-only. Run it:

1. after exact-subject freeze;
2. after source normalization;
3. before worker admission;
4. after every convergence point;
5. before PR publication;
6. before issue closure or release promotion.

It must check:

- stale or ambiguous refs;
- architecture claims without source anchors;
- problem → invariant → contract → implementation → runtime → release/handoff closure;
- documentation-only evidence promotion;
- missing negative controls;
- hidden product-scope expansion;
- false dependency edges;
- overlapping writesets without a convergence owner;
- private skill/source/credential leakage;
- license/model/output/service-right conflation;
- local or physical-runtime claims represented as cloud proof;
- cleanup, failure, cancellation, retry and fallback paths.

The Shadow monitor never edits code, closes issues, resolves conflicts, merges, waives rights, supplies credentials or promotes production.

## Tech Lead orchestration

The Tech Lead controller owns:

- exact problem and invariant extraction;
- global objective retention;
- source/unknown inventory;
- typed task contracts;
- true dependency DAG and separate start-eligibility graph;
- writeset and resource leases;
- worker/attempt identity;
- independent verification assignment;
- convergence ownership;
- Stack PR topology;
- Local Handoff Execution Queue compilation.

Do not use one mega-prompt or one mega-branch for the whole program.

## Ten phases

| Phase | Required owner | Exit artifact |
|---|---|---|
| P0 Subject/authority freeze | Tech Lead controller | exact-subject envelope and authority matrix |
| P1 Source normalization | source steward | immutable manifests and anchored observations |
| P2 Shadow audit | read-only Shadow monitor | closure matrix and negative controls |
| P3 Task/DAG compilation | Tech Lead planner | task packets, dependency/start graphs, leases |
| P4 Contract foundation | bounded contract worker + verifier | schemas, invariants, fixtures, state transitions |
| P5 Parallel implementation | leased workers | molecular results and test artifacts |
| P6 Convergence | named integration owner | integrated tree and overlap decisions |
| P7 Runtime verification | independent verifier | exact-subject runtime receipts |
| P8 Stacked delivery | Stack PR worker | branch/PR lineage and review artifacts |
| P9 Local/Human admission | local operator/Human authority | protected/local receipts or truthful blocker |

Full system prompts live in `docs/architecture/PHASE_SYSTEM_PROMPTS.md`.

## Task packet contract

Every worker receives a task packet containing:

```yaml
task_id: <id>
role: <worker-role>
program_issue: <number>
owning_issue: <number>
subject: <exact repo/ref/source identities>
goal: <one behavior>
invariants: []
prerequisites:
  receipts: []
  states: []
allowed_writeset: []
excluded_paths: []
allowed_commands: []
forbidden_side_effects: []
positive_fixtures: []
negative_controls: []
expected_artifacts: []
verification_owner: <different-role>
convergence_owner: <role-or-NOT_APPLICABLE>
time_budget: <bounded>
stop_conditions: []
handoff_schema: <version>
```

A task packet with unresolved placeholders, missing prerequisites, unknown writeset, no verifier, or no stop condition is not admitted.

## Parallel worker admission

Parallel work is allowed only when:

- prerequisites independently pass;
- each worker has a unique attempt and lease;
- writesets are disjoint, or overlap has one declared convergence owner;
- shared resource and external quota limits are explicit;
- output contracts are compatible;
- workers cannot independently promote their result to accepted/release state.

Independent workstreams do not become fake linear stacks. Dependent behavior does not become sibling branches merely to maximize concurrency.

## Execution lease rules

Keep these records separate:

`plan -> attempt -> lease -> checkpoint -> worker result -> verifier receipt -> convergence decision -> terminal state`

A plan is not a lease. A branch is not a running attempt. A worker result is not a verifier receipt. A passed PR merge-ref is not a canonical main receipt.

Lease rules:

- lease binds task, attempt, subject, writeset, resources, owner and expiry;
- stale/lost/revoked lease cannot write;
- collision stops both workers unless one read-only observer is explicitly allowed;
- retries use new attempt/lease IDs;
- failed and rejected attempts remain traceable;
- active local carrier state must stay local/private.

## Compiler architecture rules

The compiler kernel is:

```text
source manifest
  -> normalized brief / reference observations
  -> IA and content architecture
  -> visual direction and semantic tokens
  -> governed section grammar
  -> responsive composition
  -> complete page graph
  -> motion/media/2D/3D strategies
  -> typed authoring/CMS projections
  -> built semantic runtime
  -> independent gates and receipts
```

Hard invariants:

- primary content and actions exist in semantic DOM;
- unsupported raw markup/props fail closed;
- observed reference facts are separated from implementation inference;
- publishable claims require provenance and policy;
- responsive/mobile/reduced-motion/coarse-pointer behavior is explicit;
- 2D/3D/generated media are optional enhancements with static/semantic fallbacks;
- deterministic IDs/digests bind graph, projections, screenshots and receipts;
- external provider failure cannot break core authoring or navigation;
- source inspection alone cannot pass browser/runtime gates.

## Technology and rights admission

Do not import an entire article/PDF library list.

Before adding a package/repository/model/provider/asset:

1. state the measured missing capability;
2. test whether the current repository already satisfies it;
3. pin exact version/commit/revision/distribution hash;
4. capture primary license/terms evidence;
5. separate software, model-weight, generated-output, hosted-service, data-use and asset/font/media subjects;
6. evaluate compound SPDX expressions rather than substring matching;
7. record transitive/SBOM/notice impact;
8. define security, data, resource and fallback boundaries;
9. add deterministic positive and negative fixtures;
10. require an exact admission receipt and revocation path.

Unknown, changed, review-required or denied product-core subjects fail closed. The Agent may prepare evidence but may not make legal conclusions.

All open-source/public project files remain Apache-2.0 unless an imported upstream component requires separate third-party notices or a distinct source-preserving boundary.

## Bidirectional authoring and constraints

The canonical page graph owns semantic identity. Puck, Payload and future canvas/collaboration adapters are projections.

A page-graph patch must record:

- operation and target node identity;
- expected base digest and preconditions;
- provenance and author/agent identity;
- deterministic result digest;
- conflict/stale/unsupported refusal state;
- reversible history without erasing provenance;
- constraint results and unresolved violations.

Hard semantic/accessibility/provenance/rights constraints dominate soft aesthetic scores.

Do not add a general solver merely because a source uses the phrase “constraint solver.” Introduce a bounded solver adapter only when a measured layout/text case cannot be handled by deterministic passes. Record version, configuration, seed if applicable, timeout, non-convergence and fallback.

CRDT, undo history, Yoga layout and similar systems are optional adapters until an admitted product requirement and exact technology receipt exist.

## Verification independence

A worker cannot accept its own result.

The independent verifier must:

- check exact base/head/ref/source/task identities;
- rerun declared commands;
- execute negative controls;
- inspect generated artifacts and hashes;
- distinguish deterministic fixture proof, local physical proof, provider proof and Human admission;
- preserve `FAIL`, `ABSENT`, `NOT_EXERCISED`, `NEEDS_INPUT` and `BLOCKED` rather than coercing them to `PASS`;
- return the result to the convergence owner, not merge it.

## Convergence

Only the named integration owner may edit shared convergence files.

The owner must:

- validate every predecessor receipt;
- check that worker heads descend from admitted bases;
- resolve semantic overlap explicitly;
- retain the program objective and all hard invariants;
- preserve rejected alternatives and reasons;
- rerun integration-level positive and negative tests;
- emit a convergence receipt before PR publication.

Automatic conflict resolution is forbidden.

## Stacked PR delivery

Use `docs/architecture/STACKED_PR_INDEX.md`.

Rules:

- one independently reviewable behavior per branch;
- true dependencies use parent/child PRs;
- independent leaves use separate stacks;
- branches target their real parent branch until the parent is merged;
- PR body links issue/task, exact base/head, writeset, commands, negative controls, artifacts and evidence state;
- merge oldest-first;
- after parent movement, synchronize and reverify every child;
- Git Town is a local branch-management aid, not evidence by itself;
- automatic merge and automatic conflict resolution remain disabled.

## Local Handoff Execution Queue

Use `docs/architecture/LOCAL_HANDOFF_EXECUTION_QUEUE.md` when work requires:

- source publication permission;
- local/private source bytes;
- legal/license/model/output/service-right review;
- credentials, protected variables, quotas, billing or trusted signing authority;
- private-network, local Forgejo, physical browser/GPU/device execution;
- Google Workspace OAuth/permission setup;
- final conflict, merge or production release authority.

A queue item names required secret/hardware **names**, never values. It includes exact subject, owner, blocker, prerequisites, commands, expected artifacts, negative controls, completion gate and resume target.

## Document routing

Canonical order:

1. Git commits and machine-readable repository artifacts;
2. GitHub Issues and Pull Requests;
3. exact bindings to `skills-shared`;
4. optional Google Docs/Sheets/CodeXdoc projections;
5. local/private carrier for protected state.

External documents must record source artifact digest, target document ID, template version, access classification, write result and drift state. Start one-way. An external edit never silently mutates canonical repository truth.

External document outage must not block core build/test/release.

## Safety and publication

Agents must not:

- change visibility, owner, collaborators or permissions;
- expose credentials, tokens, private paths, protected source bytes or private skill bodies;
- weaken fail-closed rights/provider/release gates;
- infer waivers, credential values, Human decisions, physical device evidence or production readiness;
- merge, resolve conflicts automatically, close Human-bound issues or promote production without authority;
- add optional product dependencies before a product and technology admission decision;
- claim another company’s private implementation from product resemblance;
- repeat unverified source performance/cost/commercial-safety claims as fact;
- merge or release without Human authority.

All open-source/public project files remain Apache-2.0 unless an imported upstream component requires separate third-party notices or a distinct source-preserving boundary.

## Required handoff packet

Every phase ends with:

```yaml
program_id: <id>
phase_id: <id>
subject_digest: <sha256>
source_manifest_digest: <sha256 or ABSENT>
task_contract_digest: <sha256>
base_sha: <sha>
head_sha: <sha or ABSENT>
produced_artifacts:
  - path: <path>
    sha256: <digest>
verification:
  state: <evidence state>
  commands: []
  receipt_paths: []
open_findings: []
writeset: []
overlap_decisions: []
next_owner: <role/task>
human_actions: []
resume_command: <command or NOT_APPLICABLE>
```

The next phase must validate this packet before doing work.
