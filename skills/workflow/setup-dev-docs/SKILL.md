---
name: setup-dev-docs
description: Bootstrap, audit, or update the repo's durable developer docs under docs/dev/ (index, development, testing, architecture, operations). Use ONLY when the user explicitly asks to set up or bootstrap docs/dev, audit or check the developer docs for stale content, or update one named docs/dev page — never during ordinary feature work.
---

# setup-dev-docs

`docs/dev/` is the repo's durable developer documentation: the shared source
of truth for how humans and agents build, test, and operate the codebase.
This skill establishes it, keeps it true, and repairs it. Task facts stay in
`.scratch/`, decisions in `docs/adr/`, vocabulary in `CONTEXT.md`.

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report.

## Invocation

The user drives this skill: they name it, or ask plainly for docs/dev work.
OpenCode reads only `name` and `description` from skill frontmatter, so a
true user-invoked skill is not expressible there; the description holds to
one branch — an explicit user request — and ordinary feature work never
fires it.

## Mode

Skills cannot parse arguments; the user states the mode in the prompt. Read
it from their words. Exactly one of steps 3–5 runs.

| Mode | Prompt says | Default when |
|---|---|---|
| bootstrap | "bootstrap/set up docs/dev" | `docs/dev/` is missing or empty |
| audit | "audit/check the dev docs" | `docs/dev/` has content |
| update `<topic>` | "update docs/dev testing" | never inferred |

No mode in the prompt: state the default you picked and continue. An update
topic the repo cannot support is reported, not written.

## 1. Inspect before writing

- List `docs/` (including `docs/dev/`, `docs/adr/`, `docs/research/`); read
  `CONTEXT.md`, `AGENTS.md` / `CLAUDE.md`, and every existing `docs/dev/`
  file.
- Read the repo's command surface: `package.json` scripts, `Makefile`,
  `justfile`, `pyproject.toml`, `Cargo.toml`, CI workflow files, the dev
  script (`dev.sh` or equivalent), and the test layout.
- Note what already exists, so you preserve it.

Done when: you can name every command the repo actually defines, and every
`docs/dev/` file already present.

## 2. Classify before placing

Each candidate fact goes to exactly one home:

| Information | Home |
|---|---|
| Stable repository workflow: build, test, release, conventions | `docs/dev/` |
| Domain vocabulary and term definitions | `CONTEXT.md` (@domain-modeling owns it) |
| Architecture decisions with rationale | `docs/adr/` |
| Current ticket facts: objective, status, deviations | `.scratch/` (@session, @task-context) |
| External research findings | `docs/research/` |
| Generated navigation or index data | disposable task context — never a durable doc |

Done when: every fact you plan to write sits in the row that owns it.

## 3. Bootstrap

Create only the documents the repository supports — evidence from step 1,
not a fixed set:

| Doc | Write it when the repo has |
|---|---|
| `docs/dev/README.md` | two or more docs to index (always first) |
| `docs/dev/development.md` | a verified build/run/lint path |
| `docs/dev/testing.md` | a test runner or test directory |
| `docs/dev/architecture.md` | a module map worth navigating — it points at `docs/adr/` and the code, and restates neither |
| `docs/dev/operations.md` | deploy, release, or runbook steps |

Rules:

- `docs/dev/README.md` is the index; it states the source-of-truth rules —
  what lives in `docs/dev/`, `CONTEXT.md`, `docs/adr/`, `.scratch/`.
- Every command you write comes from step 1 evidence.
- A doc with no evidence-backed content stays unwritten; say so in the
  report.

Skeletons and the audit checklist: [`templates.md`](templates.md).

Done when: every created doc rests on verified evidence.

## 4. Audit

Check every existing `docs/dev/` file:

- **Stale claims** — a documented command, path, or step that contradicts
  the repo config or tree: fix it in place.
- **Command verification** — re-check each documented command against the
  manifests and CI. A command you cannot verify is flagged `unverified`,
  never presented as valid.
- **Broken links** — resolve every relative link and referenced path; fix
  or flag.
- **Duplication** — content that belongs to `CONTEXT.md`, `docs/adr/`, or
  `.scratch/`: point at its home instead of restating it.

**GATE doc-fix-approval (normal → apply each proposed fix in place):** every
fix is proposed with file, line, and evidence, and applied only after the
user approves that fix. In auto mode, apply the proposed fixes and list
them. (Vocabulary: the @gate skill.)

Done when: every `docs/dev/` file was checked against the repo, and every
finding is fixed or reported.

## 5. Update

Targeted update (`testing`, `development`, …): edit that one doc in place.
Preserve its structure and voice; change only what the evidence changed. A
wholesale rewrite needs the user's approval first.

Done when: the named doc matches the repo's current state, and no other doc
moved.

## Boundaries

- Preserve existing docs: append, correct, and restructure locally. A
  whole-file replacement goes through the approval in step 5.
- Human-only steps: document what a human must do and where the credential
  lives (env var, secret store, owner); the secret value never enters a doc.
  @wizard can generate the interactive steps when the user asks.
- No invented conventions: if the repo does not do it, the doc does not say
  it.

## Report

List: docs created, docs updated, findings fixed, facts flagged unverified,
and content that belongs in `CONTEXT.md`, `docs/adr/`, or `.scratch/`
instead (point there; do not move it).

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step2
- step5 -> step2
