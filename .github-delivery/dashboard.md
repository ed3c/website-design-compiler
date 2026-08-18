# website-design-compiler delivery dashboard

> Snapshot: `2026-08-18T22:40:49Z`。本頁是 GitHub event truth 的時間點快照，
> 不是 registry 的第二份真相，也不是個人生產力排名。

## Truth boundary

```text
┌───────────────┐    ┌──────────────┐    ┌────────────────────────┐
│ GitHub events │ ─→ │ metrics.json │ ─→ │ Markdown decision view │
└───────────────┘    └──────────────┘    └────────────────────────┘
         │
         ├─→ GitHub Project (status projection only)
         └─→ publication attestation ─→ human visibility gate
```

## Current decision

- Repository: `ed3c/website-design-compiler` (`PUBLIC`)
- Remote tree: `9e524b79e19d7b6792484de786afdcddd2407625` (321 files, orphan root: `YES`)
- Public ready: `NO`
- Blockers: `license-missing, export-tree-drift, open-delivery-slices, open-delivery-prs`
- Project: [Website Design Compiler](https://github.com/users/ed3c/projects/6)

## Flow health

| Signal | Value |
|---|---:|
| accepted slices | 0 |
| WIP | 1 |
| blocked | 0 |
| throughput 7d / 28d | 0 / 0 |
| closed_without_merge | 34 |

## Project projection

| Status | Items |
|---|---:|
| In Progress | 1 |
| Todo | 1 |

`closed_without_merge` 是證據缺口，不計入 throughput。p50/p85 只在有 merge event 樣本時顯示。

## Slice evidence

| Issue | State | Started PR | Accepted PR | Lead | Blocked |
|---:|---|---:|---:|---:|---:|
| #1 | CLOSED | — | — | UNKNOWN | 0 |
| #2 | CLOSED | — | — | UNKNOWN | 0 |
| #3 | CLOSED | — | — | UNKNOWN | 0 |
| #4 | CLOSED | — | — | UNKNOWN | 0 |
| #6 | CLOSED | — | — | UNKNOWN | 0 |
| #7 | CLOSED | — | — | UNKNOWN | 0 |
| #8 | CLOSED | — | — | UNKNOWN | 0 |
| #9 | CLOSED | — | — | UNKNOWN | 0 |
| #10 | CLOSED | — | — | UNKNOWN | 0 |
| #11 | CLOSED | — | — | UNKNOWN | 0 |
| #12 | CLOSED | — | — | UNKNOWN | 0 |
| #13 | CLOSED | — | — | UNKNOWN | 0 |
| #14 | CLOSED | — | — | UNKNOWN | 0 |
| #15 | CLOSED | — | — | UNKNOWN | 0 |
| #16 | CLOSED | — | — | UNKNOWN | 0 |
| #17 | CLOSED | — | — | UNKNOWN | 0 |
| #18 | CLOSED | — | — | UNKNOWN | 0 |
| #19 | CLOSED | — | — | UNKNOWN | 0 |
| #20 | CLOSED | — | — | UNKNOWN | 0 |
| #22 | CLOSED | — | — | UNKNOWN | 0 |
| #23 | CLOSED | — | — | UNKNOWN | 0 |
| #24 | CLOSED | — | — | UNKNOWN | 0 |
| #26 | CLOSED | — | — | UNKNOWN | 0 |
| #27 | CLOSED | — | — | UNKNOWN | 0 |
| #28 | CLOSED | — | — | UNKNOWN | 0 |
| #29 | CLOSED | — | — | UNKNOWN | 0 |
| #30 | CLOSED | — | — | UNKNOWN | 0 |
| #31 | CLOSED | — | — | UNKNOWN | 0 |
| #32 | CLOSED | — | — | UNKNOWN | 0 |
| #33 | CLOSED | — | — | UNKNOWN | 0 |
| #34 | CLOSED | — | — | UNKNOWN | 0 |
| #35 | CLOSED | — | — | UNKNOWN | 0 |
| #36 | CLOSED | — | — | UNKNOWN | 0 |
| #37 | CLOSED | — | — | UNKNOWN | 0 |
| #43 | OPEN | 44 | — | UNKNOWN | 0 |

## Human gate

只有 blockers 清空、publication attestation 與遠端 HEAD 對齊後，人類才可執行 PR merge 與 PRIVATE→PUBLIC。

## MVP extraction

| Step | Direct? | Undecided dependency | Permission | Measurable change | Size |
|---|---|---|---|---|---|
| Clear mechanical blockers | direct | none | repository scope | blockers count decreases | small |
| Human visibility decision | direct | owner review | owner only | visibility becomes PUBLIC | human gate |

Rejected now: custom daemon (extra operational surface); personal ranking (Goodhart risk); automatic merge/public toggle (violates human gate).
