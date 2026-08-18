# Website Design Compiler Pipeline

## Goal

Translate a product brief and optional design references into a deployable website with explicit design contracts, runtime verification, provenance, and release receipts.

## Pipeline

```text
natural-language brief -> brief-normalization -> structured compiler input
structured compiler input -> information-architecture
information-architecture -> content-architecture
references -> reference-intelligence
reference-intelligence -> art-direction -> design-system-compiler
information-architecture + content-architecture + design-system-compiler
  -> page-architect
  -> frontend-builder
  -> motion / 2d / 3d / media specialists
  -> browser-visual-qa
  -> accessibility-performance
  -> originality-gate
  -> license-provenance-gate
  -> release-receipt
```

## Contract boundaries

### Brief normalization

Converts natural-language requirements into a structured compiler input. Required facts, hard constraints, and evidence-sensitive content requests remain explicit; missing or contradictory inputs produce `NEEDS_INPUT` rather than guessed values.

Required output:
- `brief-normalization.json`

### Information architecture

Produces a page-family-specific section graph. Every section records its supporting brief evidence, required content, missing content, fallback, and `READY | NEEDS_INPUT` status. A brief objective can inform planning intent, but it cannot silently become publishable headline, action, proof, or product copy.

Required output:
- `information-architecture.json`

### Content architecture

Turns each IA content requirement into a provenance-bound authoring field with a source classification, publishability decision, responsive length budget, locale policy, and quality findings. Brief objectives remain planning evidence; they are not publishable headlines, product claims, or action labels. Missing authored content produces `NEEDS_INPUT` in the artifact and `ABSENT` in the runtime stage receipt.

Required output:
- `content-architecture.json`

### Reference intelligence
Produces observable facts only. It may describe layout, typography, motion, assets, hierarchy, and interaction patterns, but must not claim unknown implementation details as facts.

Required outputs:
- `reference-manifest.json`
- `reference-analysis.md`
- `originality-plan.md`

### Art direction
Exactly one primary art-direction policy is active per build. Other taste systems may review but must not compete as equal authorities.

Required outputs:
- `design-read.json`
- `DESIGN.md`

### Design system compiler
Converts visual direction into semantic tokens, states, responsive rules, motion policy, and media treatment.

Required outputs:
- `semantic-tokens.json`
- `component-state-matrix.json`
- `motion-spec.json`
- `scene-spec.json`

### Implementation specialists
The semantic DOM and primary actions must remain functional independently of decorative WebGL, heavy video, or generated media. 2D, 3D, and cinematic motion are opt-in specialist layers.

### Verification
Verification must execute the built artifact. Source inspection alone cannot yield PASS.

Minimum gates:
- typecheck/build
- browser smoke
- desktop/tablet/mobile screenshots
- keyboard path
- reduced-motion path
- WebGL failure/static fallback path when applicable
- console/network errors
- accessibility
- performance budget
- originality
- dependency and asset provenance

### Receipt
A release receipt binds the tested commit, selected skill versions, commands, artifacts, gate results, known deviations, and unresolved risks.

## Evidence states

`PASS | FAIL | ABSENT | NOT_IMPLEMENTED | NOT_EXERCISED | SKIPPED_BY_POLICY`

## Public/private boundary

`skills-shared` is private and canonical for shared procedures. This public repository stores only explicit binding metadata and repo-owned website-design compiler skills. Private skill bodies, live machine paths, credentials, and private runtime state must never be published here.
