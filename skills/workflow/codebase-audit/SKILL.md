---
name: codebase-audit
description: >-
  Sweep a whole repository for what is broken, contradictory, inefficient, or
  no longer needed, and report every finding with path:line evidence. Confident
  findings are grouped by severity; findings that need a decision are listed
  separately for the user. Read-only: fixes are listed, never applied. Restrict
  the sweep to one section when the user names one. Triggers: audit the
  codebase, find what is broken, dead code, stale config, what can be deleted,
  full project sweep. Not a diff review, a security audit, or a one-bug
  diagnosis.
---

# codebase-audit

A whole-repository defect sweep of the current tree. Changes since a fixed point
belong to @review-agent and @code-review. Trust boundaries belong to
@security-audit. One failing behaviour belongs to @diagnosing-bugs. Architecture
redesign belongs to @improve-codebase-architecture. This skill reads and reports;
it does not fix.

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report.

## Invocation

User-driven only: named or plainly asked for ("audit this repo", "find what is
broken", "what can we delete"). A request carrying a diff, a PR, a branch, or
one failing behaviour routes to the skills above instead.

## Scope

| Scope | The prompt names | Sweep |
|---|---|---|
| Whole project | no path | the repo root, minus the default exclusions |
| Section | a path, directory, package, module, or "only the …" | that subtree only |

Rules:

- Print `Scope:` and `Commit:` in the report header. A section sweep never grows
  into a whole-repo sweep.
- Default exclusions: `.git/`, `node_modules/`, `target/`, `dist/`, `build/`,
  `.venv/`, `__pycache__/`, `vendor/`, lockfiles, generated and minified
  assets. Add an exclusion only with a reason, and list it under Coverage.
- Cover every top-level source root, manifest, CI file, script, and doc. When
  the tree does not fit one pass, sweep directory by directory and record what
  was not read. A partial sweep is reported as partial.

Done when: the scope and exclusions are fixed and can be printed in the report.

## Item IDs

Every kept finding carries one ID, so the user can name it in a reply without
quoting the path.

| Prefix | List |
|---|---|
| `B` | Confident / Blocker |
| `M` | Confident / Major |
| `L` | Confident / Minor |
| `D` | Needs your call |

`L`, not `m`, so it cannot be misread as `M`.

Rules:

- Number within the namespace in report order: `B1`, `M1`, `M2`, `L1`, `D1`.
- Allocate once, when the report is written. Never renumber, never reuse.
- A finding raised after the report takes the next free number in its namespace.
- A withdrawn finding keeps its ID, marked `withdrawn: <reason>`.
- One root cause with many sites is one ID. Add `.a`, `.b` to the site only when
  that site needs its own fix.
- A ticket or TODO that comes from a finding names its ID (`M2: ...`), so the
  report and the later work stay linked.

Done when: every kept finding has exactly one ID and no ID repeats.

## 1. Establish the baseline

- Read the manifests and CI to find the commands the repo actually defines:
  `package.json`, `Cargo.toml`, `pyproject.toml`, `Makefile`, `justfile`,
  `.github/workflows/`, `dev.sh`, or their equivalents.
- Run the build, test, lint, and typecheck commands. Their failures are the
  strongest broken evidence. Time-box a hanging check and record the exact
  error instead.
- Record the commit SHA.

No manifest or CI file: say so. The sweep continues from the tree.

Done when: every defined check has a result and the report can name the exact
commands run.

## 2. Sweep the four classes

Complete each class over the whole scope. Finish the class, not the first hit.

| Class | Look for |
|---|---|
| Broken | failing build, test, or lint; unresolved imports; scripts and CI steps pointing at missing files; invalid or contradictory config; broken relative links; an entry point that throws |
| Inconsistent | one rule implemented twice with different behaviour; duplicated constants that disagree; docs, config, and code stating different contracts; two names for one concept in the same layer |
| Inefficient | repeated work per call; N+1 queries; full-file reads where a range would do; a blocking call on a live path; rebuilding or recopying unchanged artifacts; a dependency pulled in for one trivial function |
| No longer needed | dead code; unused exports and dependencies; superseded scripts; commented-out blocks; orphaned files; docs describing removed behaviour; config for a removed target |

An inconsistency and a removal often share a root cause. Report the cause once,
with every site, not once per site.

Done when: each class was swept across the whole scope and every hit is either
kept with evidence or dropped in step 3.

## 3. Verify before listing

Every finding survives three checks:

- The location exists at the reported line in the working tree.
- The defect is demonstrable: failing output, a greppable second definition, a
  contract stated two ways, or a reference search that proves no use.
- "No longer needed" is not "no static references". Dynamic loading, string
  dispatch, plugins, and external users do not appear in grep. Report the search
  used and its result, not the conclusion "dead".

Drop a finding you cannot demonstrate. Drop a style preference unless it
contradicts a documented standard in the repo. Edit nothing.

Done when: every kept finding has a location, evidence, and a stated
consequence.

## 4. Triage: confident or needs your call

Every kept finding goes into exactly one list. The split keeps the report
honest: an assertion the agent can defend, and a decision that belongs to the
owner, are not the same thing.

| List | Test |
|---|---|
| Confident | The defect is reproduced (failing output, grep proof, two contracts stated side by side) and the fix is local with one right answer. Nothing is left for the user to decide. |
| Needs your call | The evidence is real but the answer is a decision: intended behaviour is unclear, the fix changes a public surface, stored data, or a documented contract; two valid designs exist; the "dead" verdict depends on external or dynamic users; or the severity is a judgement between two levels. |

Rules:

- Default to Confident only when the fix is obvious and behavior-preserving.
  When in doubt, move it to Needs your call.
- A Needs-your-call item states the question, the evidence, and the options with
  their costs. It does not prescribe a fix.
- Never use Needs your call to park a finding you did not verify. Unproven
  findings are dropped in step 3.
- When the same evidence supports a certain defect and an uncertain fix, list
  the defect as Confident and the decision separately.
- Triage fixes the namespace: `D`, or confident pending the level in step 5.

Done when: every kept finding sits in exactly one list, every item carries its
namespace, and every discussion item carries a question.

## 5. Classify severity

| Level | Test |
|---|---|
| Blocker | the project cannot build, test, or run; a live path returns a wrong result; data loss; a security hole |
| Major | correct on the happy path but wrong or fragile elsewhere; two live paths contradict each other; dead code still wired into a live path; a documented command or path that does not work; a measurable avoidable cost |
| Minor | duplication, a stale comment, naming drift, an unused local, dead code with no live path |

The failing path sets the level, not how ugly the code is. No failing path, no
blocker. Within a level, order by blast radius: live paths first.

Severity applies to Confident findings. A discussion item may carry a
provisional level, but it is not counted in the totals.

Done when: every confident finding takes its level from one of these rows, which
fixes its `B`, `M`, or `L` prefix.

## 6. Report

```text
Scope: <path or "whole repo"> @ <sha>
Checks: <commands and result>
Excluded: <paths and patterns>
Findings: <N> confident (<B> blocker, <M> major, <L> minor), <D> for your call

## Confident

### Blocker
- **B1** `path:line` defect. Consequence. Smallest fix.

### Major
...

### Minor
...

## Needs your call
- **D1** `path:line` <question>. Evidence. Options: <A and its cost>;
  <B and its cost>. (provisional: <level>, because <reason>.)

## Coverage
Read: <top-level areas>.
Not read: <anything skipped, and why>.
```

Rules:

- One finding per bullet: location, defect, consequence, smallest fix. No
  severity inflation and no padding.
- Group confident findings by severity. Never merge levels.
- Discussion items are not severity-grouped: order by blast radius, one question
  per bullet, options with their costs.
- One root cause with many sites is one finding listing the sites.
- Every bullet starts with its ID, numbered in report order within its list.
- A reply that names IDs refers to this report: resolve it and do not re-sweep.
  An ID that is not in the report: ask, never guess.
- Nothing found in a class or list: say so. An empty report is a valid result;
  never invent a finding to fill a section.
- Report only. Fixes are listed, not applied. Turn them into tickets or a
  `.scratch/` spec only when asked.

Done when: the report accounts for every kept finding in both lists and every
swept class, each bullet carrying exactly one unique ID.

## Boundaries

- Read-only: no edits, formatters, renames, or deletions during the scan.
- Builds and tests may write their normal artifacts. No destructive commands,
  no installs, no dependency upgrades.
- A generated or vendored tree stays out of scope even when it looks broken;
  name it as excluded.
- The report is the deliverable. Fixing starts a new task with its own scope and
  approval. An ID-named reply sets that task's scope; it is not a new sweep.

## Dependency graph

- 1. baseline
- 2. sweep -> 1
- 3. verify -> 2
- 4. triage -> 3
- 5. severity -> 4
- 6. report -> 5
