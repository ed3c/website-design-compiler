# Repository Agent Contract

## Mission
Build an evidence-first website design compiler that converts briefs and references into original, accessible, performant, commercially governable website artifacts.

## Shared-skill integration
This public repository consumes shared procedures from the private `ed3c/skills-shared` repository through explicit bindings. Do not vendor or quote private shared skill bodies here.

Required shared methods:
- `repo-agent-native`
- `sdlc-plan-composer`
- `unknown-discovery-composer`
- `truth-verify-loop`
- `external-verify`
- `knowledge-continuity`
- `git-town-stacked-pr-worker`
- `github-delivery-loop`
- `dual-forge-repository-loop` when a local Forgejo implementation plane is configured

Repository-specific website design behavior belongs in this repository under `skills/` and must remain domain-specific rather than being promoted to `skills-shared` without an explicit registry decision.

## Evidence boundary
Only runtime evidence can promote a capability to PASS. Use these states exactly:

`PASS | FAIL | ABSENT | NOT_IMPLEMENTED | NOT_EXERCISED | SKIPPED_BY_POLICY`

Documentation, plans, prompts, or schemas alone do not prove runtime behavior.

## Safety and publication
- Never change repository visibility, ownership, collaborators, credentials, or secrets.
- Never expose private `skills-shared` content in this public repository.
- Keep generated runtime receipts free of credentials, machine-private paths, and tokens.
- Work through feature branches and draft PRs.
- Unknown license or provenance fails closed for product-core dependencies and generated assets.

## Architecture direction
The compiler is organized as:

`reference intelligence -> art direction -> design contracts -> implementation -> motion/2D/3D/media specialists -> browser verification -> accessibility/performance/originality/license gates -> runtime receipts`

No single mega-prompt owns the whole pipeline. Specialist skills have explicit input/output contracts and stop conditions.
