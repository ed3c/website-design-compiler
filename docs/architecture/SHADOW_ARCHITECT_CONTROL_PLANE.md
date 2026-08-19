# Shadow Architect Control Plane

## Purpose

This document defines the public-safe architecture review and delivery control plane for program [#45](https://github.com/ed3c/website-design-compiler/issues/45).

It answers one question:

> Does an architecture claim from an article, PDF, repository, prompt, or technology list correspond to a real problem, a repository contract, an implemented path, independent runtime evidence, and a release/handoff boundary?

A “yes” requires a closed loop. Similar naming, sample code, a passing unit test, or a plausible product analogy is insufficient.

## Exact review subject

```yaml
repository: ed3c/website-design-compiler
canonical_main:
  ref: refs/heads/main
  sha: 4a79d9635911690950f02edda4505672ba7544f6
convergence_parent:
  pull_request: 44
  ref: refs/heads/codex/pr42-delivery-v2
  sha: 9e67222dea5580b1f807266162909422771da99e
program_issue: 45
production_provider_issue: 25
shared_control_plane_binding:
  path: .agents/bindings/repository-control-plane.json
  mode: reference-only
authority:
  automatic_merge: false
  automatic_conflict_resolution: false
  visibility_change: false
  credential_values: false
```

Any later run must replace stale SHAs and revalidate every dependent receipt.

## Reviewed source framing

The supplied PDF, *現代網頁設計架構擴充建議*, contains several layers that must remain distinct:

### Source sections

| Source area | Architecture claim | Review treatment |
|---|---|---|
| PDF pp. 1–2 | DSL/AST + constraints + bidirectional editing + deterministic rendering | map to repository contracts and tests |
| PDF pp. 2–17 | 3D product placement, depth/mask passes and isolated generation | optional product track; no provider execution before #25 |
| PDF pp. 7–9 and 27–31 | browser CV, geometry, collaboration, text, storage, queue, auth and rendering candidates | exact version/hash/SPDX/transitive admission through #48 |
| PDF pp. 18–27 | audio DSP, beat analysis, MIDI and DJ state machine | separate product decision under #51 |
| PDF pp. 30–34 | dependency list and license-check CI example | design input only; naive license matching is not authoritative |

The PDF itself is not copied into the public repository. Its planning subject is frozen as `1878749` bytes with `sha256:7350f0e3d29ace70a6c92343e5501b34763f452e057d9b8acef3829f57230ef6`. Issue #46 must still generate a repository-runtime source manifest that binds the exact parser/version, extraction warnings, page anchors and publication classification; this review does not promote the source adapter to runtime `PASS`.

## Closed-loop definition

For each architecture claim, record:

```text
source identity and anchor
  -> observable problem
  -> hard invariant / success metric
  -> typed contract and state machine
  -> implementation path
  -> positive fixture
  -> negative controls
  -> independent runtime receipt
  -> exact commit / branch / PR
  -> release receipt or Local Handoff Queue
```

Classification:

| State | Meaning |
|---|---|
| `CLOSED` | implementation and exact-subject runtime evidence exist through release/handoff |
| `PARTIAL` | a meaningful implementation exists, but one or more required links are absent |
| `OPEN` | real problem is accepted, but the required contract or implementation is absent |
| `HYPOTHESIS` | source claim may be useful but the real product problem has not been established |
| `OUT_OF_SCOPE` | not part of this product baseline |
| `BLOCKED_HUMAN` | mechanics exist, but legal/credential/hardware/merge authority is missing |

These review states do not replace repository runtime evidence states.

## Architecture closure matrix

### Product compiler kernel

| Architecture problem | Repository evidence | Closure assessment | Remaining boundary |
|---|---|---|---|
| Natural-language requirements become governed input rather than prompt-only prose | brief normalization, schemas, fixtures, issue #37 and v2 benchmark receipts | `CLOSED` on canonical main subject | source-plane inputs must link normalized requirements to article/PDF/repo anchors |
| Page-family information architecture and claim-safe content | IA/content architecture, provenance and `NEEDS_INPUT` behavior | `CLOSED` | no change unless source-plane provenance adds new input classes |
| Multiple art directions and deterministic selection | visual-direction search, semantic token compilation and design-quality gates | `CLOSED` on admitted fixtures | source-observed visual fingerprints still need typed article/PDF/repo adapters |
| Governed section grammar rather than arbitrary HTML | rich section registry, projection tests, Storybook/browser gates | `CLOSED` | patch semantics must preserve the registry contract |
| Responsive composition is compiled rather than generic CSS only | responsive-composition artifacts and browser evidence | `CLOSED` | edited graphs need stale/conflict and revalidation rules |
| Page-level motion/media/2D/3D strategy | choreography/orchestration contracts, capability fallbacks and browser gates | `CLOSED` for current baseline capability profiles | optional product tracks remain separate decisions |
| Complete multi-section graph | page graph compiler, Puck/Payload round-trip, generated-page evidence | `CLOSED` | general typed patch/conflict history is not yet a first-class contract |
| High-quality evaluation beyond functional PASS | design-quality calibration/evaluation and exact evidence binding | `CLOSED` for current calibrated fixtures | model-assisted or new source-domain judges need separate identity/admission |
| Reference analysis separates observation from implementation inference | live-reference adapter, reference manifests, SSRF negative controls and issue #22 closure | `CLOSED` on canonical main subject | article/PDF/repository typed adapters remain #46 |
| WebGPU path degrades safely | real headed local WebGPU receipt and forced fallback/device-loss controls from issue #23 | `CLOSED` for that exact local subject | future hardware/device claims need new local receipts |
| Release policy binds exact SHA and profiles | v1/v2 release receipts and canonical-main policy | `CLOSED` for existing profiles | `COMMERCIAL_PRODUCTION` still needs #25 |
| Real production generative provider and rights | fail-closed adapter/status/release boundaries on PR #44 | `BLOCKED_HUMAN` / `NOT_EXERCISED` | exact rights, provider/model, protected credentials and canonical-main execution under #25 |

### Architecture thesis gaps

| Claim/problem | Existing foundation | Missing closure | State / owner |
|---|---|---|---|
| Immutable multi-source intake | URL/live-reference and internal brief/reference manifests | typed article/PDF/repository adapters, parser identity and publication controls | `NOT_IMPLEMENTED` → #46 |
| General bidirectional AST edits | Puck/Payload projections and page-graph round-trip | typed patch operations, base digest, stale/conflict behavior, reversible provenance | `OPEN` → #47 |
| Explicit constraint solver boundary | deterministic design/section/responsive/media passes | constraint classification and measured decision whether a solver is needed | `OPEN` → #47 |
| Technology list admission | repository rights/provenance and #25 model admission policy | exact candidate registry, SPDX expressions, transitive/SBOM/notice and revocation | `OPEN` → #48 |
| Executable multi-session Tech Lead plane | shared binding and planning artifacts | repository runtime for task packets, leases, worker/verifier/convergence and local queue | `OPEN` → #49 |
| Google Docs/Sheets/CodeXdoc routing | GitHub artifacts can be exported | digest-bound one-way adapters, access classification and drift receipts | `OPTIONAL` → #50 |
| Flair-like 3D product photoshoot | existing R3F/WebGPU/media/provider seams | product decision, exact spatial-pass contracts, admitted provider and output proof | `HYPOTHESIS/DEFER` → #51/#25 |
| Video compositor/export | current motion/media strategy | explicit export use case, timeline/frame/audio/encoder contracts and rights | `HYPOTHESIS/DEFER` → #51 |
| DJ/audio product | shared state-machine/canvas pattern only | separate product problem, AudioWorklet/WASM/device contracts and product release profile | `OUT_OF_SCOPE` by default → #51 |

## Real-problem assessment

### Problems already closed in the current baseline

1. **Prompt drift** — the build is governed by schemas, artifacts, exact digests and release gates rather than one unbounded prompt.
2. **Reference imitation risk** — observation, originality planning and design-quality/originality gates are separated from implementation inference.
3. **Generic page generation** — IA, content, visual direction, tokens, section grammar, responsive composition and complete page graphs form a typed pipeline.
4. **Decorative GPU failure** — semantic DOM ownership and deterministic GPU/static fallbacks preserve primary use.
5. **Evidence laundering** — repository evidence states and exact SHA/ref binding prevent documentation-only promotion.
6. **Optional capability inflation** — release profiles can distinguish required from non-required capability receipts.

### Problems that remain open

1. **Input heterogeneity** — the system needs one typed source plane for attached PDFs, articles and exact repository refs.
2. **User/Agent edit concurrency** — the system needs deterministic patch preconditions, conflict/stale refusal and provenance-preserving history.
3. **Constraint transparency** — the current passes need an explicit inventory of hard/soft constraints and a falsifiable solver-adoption decision.
4. **Technology-list risk** — package/model/provider names must become exact, independently revocable rights subjects rather than a copied dependency list.
5. **Cross-session execution** — prompt splitting needs machine-readable task, lease, verifier and convergence receipts so chat history is not the scheduler.
6. **External projections** — Docs/Sheets/CodeXdoc need drift and permission boundaries if adopted.
7. **Production provider admission** — issue #25 remains a real Human/legal/credential/runtime boundary.

## Control-plane planes

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Plane 0: Authority                                                  │
│ Human repository maintainer / legal-rights reviewer / provider admin│
└───────────────────────────────┬─────────────────────────────────────┘
                                │ admission only
┌───────────────────────────────v─────────────────────────────────────┐
│ Plane 1: GitHub canonical ledger                                   │
│ commits + issues + PRs + Actions receipts + release artifacts       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ exact binding / routing
┌───────────────────────────────v─────────────────────────────────────┐
│ Plane 2: website-design-compiler                                   │
│ product contracts, source/tech registry, DAG, stack index, handoff  │
└───────────────┬───────────────────────────────┬─────────────────────┘
                │                               │
                │ shared procedure              │ optional projection
┌───────────────v──────────────┐   ┌────────────v────────────────────┐
│ Plane 3: skills-shared       │   │ Plane 4: Docs / Sheets /       │
│ exact private bindings only  │   │ CodeXdoc, one-way digest bound │
└───────────────┬──────────────┘   └─────────────────────────────────┘
                │
                │ public-safe contracts
┌───────────────v─────────────────────────────────────────────────────┐
│ Plane 5: Local/private execution carrier                           │
│ active leases, worktrees, secrets, private sources, hardware       │
└─────────────────────────────────────────────────────────────────────┘
```

The repository is the routing center for this product, not the owner of shared process bodies or secret-bearing local state.

## Program phases and handoffs

### P0 — Subject and authority freeze

Input:
- user request;
- repository and source locators;
- current issues/PRs;
- requested side effects.

Output:
- exact-subject envelope;
- authority matrix;
- source inventory;
- explicit non-authorities.

Stop on ambiguous branch, stale SHA, unknown source identity or unauthorized side effect.

### P1 — Source normalization

Input:
- P0 subject envelope;
- source bytes/refs permitted for processing.

Output:
- source manifest and observations;
- source/inference separation;
- publication classification;
- extraction warnings.

No architecture conclusion may outrun its source anchor.

### P2 — Shadow audit

Input:
- exact source manifests;
- repository tree, issues, PRs and runtime receipts.

Output:
- closure matrix;
- real problems, contradictions and unknowns;
- negative controls;
- `CLOSED/PARTIAL/OPEN/HYPOTHESIS/OUT_OF_SCOPE/BLOCKED_HUMAN` classifications.

This phase is read-only.

### P3 — Tech Lead DAG

Input:
- P2 findings and global objective.

Output:
- typed task packets;
- true dependency DAG;
- start-eligibility graph;
- writesets, excluded paths and resource leases;
- verifier and convergence owners;
- Stack PR topology.

A dependency means “cannot correctly start,” not “belongs to the same initiative.”

### P4 — Contract foundation

Input:
- admitted task packet.

Output:
- schema;
- state machine;
- hard invariants;
- deterministic positive/negative fixtures;
- receipt shape and verifier.

No large implementation before this foundation is independently verified.

### P5 — Parallel workers

Input:
- accepted P4 contracts;
- active unique leases.

Output:
- molecular implementation results;
- tests and artifacts;
- worker receipts and retained failures.

Workers cannot merge or accept themselves.

### P6 — Convergence

Input:
- all required independently verified leaf receipts.

Output:
- integrated tree;
- explicit overlap/conflict decisions;
- global objective/invariant retention;
- convergence receipt.

Only one owner edits shared convergence files.

### P7 — Runtime verification

Input:
- exact integrated head.

Output:
- build, browser, accessibility, performance, originality, rights and release receipts as applicable;
- local/physical/provider receipt distinction;
- unresolved risks.

A different SHA/ref/device/provider identity is a different subject.

### P8 — Stack delivery

Input:
- independently verified integration result.

Output:
- focused branches and draft PRs;
- parent/child relationships;
- issue/task/receipt links;
- oldest-first review order.

Git Town assists branch topology. It does not create evidence or merge authority.

### P9 — Local/Human admission

Input:
- protected/local queue item.

Output:
- local runtime, source permission, legal/right, credential, hardware, conflict, merge or release decision;
- public-safe receipt and resume pointer.

The Agent names required input names and commands, never secret values or invented Human decisions.

## Handoff packet

Every phase and worker returns:

```json
{
  "schema": "website-design-compiler/handoff-packet/v1",
  "programId": "<id>",
  "phaseId": "<P0-P9>",
  "taskId": "<id>",
  "attemptId": "<id>",
  "subjectDigest": "<sha256>",
  "sourceManifestDigest": "<sha256-or-ABSENT>",
  "taskContractDigest": "<sha256-or-ABSENT>",
  "baseSha": "<sha>",
  "headSha": "<sha-or-ABSENT>",
  "writeset": [],
  "producedArtifacts": [],
  "verification": {
    "state": "<evidence-state>",
    "commands": [],
    "receiptPaths": []
  },
  "openFindings": [],
  "overlapDecisions": [],
  "nextOwner": "<role-or-task>",
  "humanActions": [],
  "resumeCommand": "<command-or-NOT_APPLICABLE>"
}
```

The next owner validates the packet and all referenced artifacts. Chat history is not accepted as a prerequisite receipt.

## Separate-session topology

Use a controller conversation for P0–P3 and separate conversations for bounded tasks.

```text
Controller / Tech Lead
    |
    +-- Source foundation #46
    |      +-- article adapter session
    |      +-- PDF adapter session
    |      +-- repository adapter session
    |      `-- source convergence session
    |
    +-- Compiler patch/constraint #47
    |      +-- patch/conflict/history session
    |      +-- constraint model session
    |      `-- measured solver decision/adapter session
    |
    +-- Technology admission #48
    |      +-- SPDX evaluator session
    |      +-- SBOM/notice session
    |      `-- rights convergence session
    |
    +-- Control-plane runtime #49
    |      +-- DAG/start-gate session
    |      +-- lease lifecycle session
    |      +-- worker/verifier session
    |      `-- convergence/local-handoff session
    |
    +-- Projection #50 (optional)
    |      +-- local export session
    |      +-- Google Docs session
    |      +-- Google Sheets session
    |      `-- CodeXdoc session
    |
    `-- Capability decision #51
           +-- 3D photoshoot decision
           +-- video composition decision
           `-- DJ/audio separate-product decision
```

Do not start #47 before #46 source convergence. Do not start provider execution from #51 before #48 and #25 admission. Projection adapters do not block any core workstream.

## Technology selection policy

### Use existing repository capabilities first

Prefer:

- current TypeScript/Ajv schema and receipt infrastructure;
- existing brief, IA, content, visual, tokens, section, responsive, motion, media and page graph contracts;
- existing Puck/Payload projections;
- existing Playwright/browser/Storybook/evaluation/release gates;
- existing live-reference, rights and provider seams;
- current Next.js/React/Three/WebGPU paths when already admitted.

Do not add XState, Temporal, Yjs, Yoga, ONNX, Rapier, LanceDB, BullMQ or any PDF candidate merely to mirror the source diagram.

### Triggered candidate examples

| Trigger | Candidate family | Required evidence before adoption |
|---|---|---|
| complex PDF extraction cannot be handled by current source preprocessing | PDF parser adapter | exact license/version/hash, page anchor fidelity, malformed/encrypted fixtures |
| deterministic text/layout passes cannot satisfy measured case | Yoga or bounded solver | failing fixture, solver identity/config, timeout/non-convergence/fallback |
| concurrent/offline authoring is a product requirement | Yjs/zundo/Dexie family | convergence/conflict semantics, storage/privacy/deletion and exact admission |
| browser-side product matting is adopted | ONNX Runtime Web plus exact model | package and model/output terms, capability fallback, device budgets |
| physical product placement is adopted | Three/R3F/Rapier/BVH family | spatial invariants, teardown/fallback, performance and exact rights |
| durable distributed render jobs are needed | BullMQ/pg-boss family | delivery/retry/idempotency/retention and infrastructure operating decision |
| local asset retrieval has measured value | LanceDB/HNSW family | retrieval eval, data lifecycle/privacy and platform/build proof |
| media export is a product requirement | WebCodecs/muxers/encoders | codec/container/browser matrix, licensing, deterministic frame/audio mapping |
| DJ/audio becomes a separate product | AudioWorklet/WASM/MIR/MIDI family | latency/device matrix, DSP correctness, teardown, licensing and product release profile |

Every adopted exact subject goes through #48. Every real generative provider/model also goes through #25.

## Document and URL routing

```text
Git commit/artifact    canonical source of code and machine truth
GitHub issue/PR        canonical execution and review ledger
skills-shared binding  canonical shared procedure identity
Google Doc             optional narrative/review projection
Google Sheet           optional registry/status/queue projection
CodeXdoc               optional documentation projection
local/private carrier  secrets, private bytes, active leases, hardware state
```

External projections start one-way. They record source digest, provider document ID, template version, access classification, write result and drift state. External edits never silently change canonical GitHub state.

## Automation assessment

### Can be automated

- source hashing, parsing, anchoring and drift detection under policy;
- repository/issue/PR/runtime receipt inventory;
- architecture closure matrix generation;
- task packet and DAG compilation;
- branch/worktree creation and Stack PR publication;
- code/test generation within bounded writesets;
- deterministic and browser verification;
- evidence packaging and issue-safe summaries;
- local handoff queue generation;
- Docs/Sheets/CodeXdoc export and drift detection after permission setup.

### Cannot be delegated as autonomous authority

- source copyright/publication permission;
- legal interpretation or license/model/output/service-right waiver;
- credentials, secrets, quotas, billing or provider account decisions;
- physical/private-network proof without exact local execution;
- automatic conflict resolution, merge or production promotion;
- product decision to turn optional 3D/video/DJ tracks into baseline scope.

The target is automatic mechanics plus fail-closed Human admission.

## Failure handling

| Failure | Required response |
|---|---|
| source bytes/ref drift | new source identity; invalidate dependent receipts |
| parser partial/error | preserve warnings; do not claim complete observation |
| architecture contradiction | `NEEDS_INPUT` or explicit decision task |
| false dependency | remove edge; preserve separate issue relation if useful |
| writeset collision | revoke/stop conflicting leases and route to convergence owner |
| worker failure | retain failed attempt; retry with new attempt/lease if justified |
| verifier disagreement | no promotion; return exact findings to convergence owner |
| local/provider/credential boundary | compile queue item; never infer values or completion |
| projection outage | mark projection failed/drifted; core remains available |
| optional capability rejected | remove from baseline dependency/CI plan |
| Human gate absent | `NOT_EXERCISED` or `BLOCKED`, never `PASS` |

## Decision

Use `website-design-compiler` as the canonical architecture and delivery router for this product. Use `skills-shared` as the shared procedure registry. Use GitHub issues/PRs as the execution ledger. Add Google Docs/Sheets/CodeXdoc only as digest-bound projections. Keep active local carrier state, credentials, legal decisions and protected provider evidence outside the public repository.

This creates a closed management loop without pretending the whole product, every source hypothesis, or production provider is already closed.
