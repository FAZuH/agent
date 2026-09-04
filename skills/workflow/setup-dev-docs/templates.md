# docs/dev templates

Skeletons for bootstrap and update modes. Keep each doc short: purpose,
verified commands, rules, checklist. Replace the angle brackets; delete any
section the repo cannot support. Every command line you keep must come from
repo evidence (manifest, Makefile, CI workflow), and each doc names where
that evidence lives.

## docs/dev/README.md (index — always first)

```markdown
# Developer docs

Source of truth for how this repo is built, tested, and operated.

| Doc | Covers |
|---|---|
| [development.md](development.md) | setup, build, run, lint |
| [testing.md](testing.md) | suites, single tests, CI behavior |

## Where information lives

- Stable workflow → `docs/dev/` (this index and its pages)
- Domain vocabulary → `CONTEXT.md`
- Architecture decisions → `docs/adr/`
- Current ticket facts → `.scratch/`
- External research → `docs/research/`

Update rule: a workflow change lands here in the same branch that changes it.
```

## development.md

```markdown
# Development

<One paragraph: what a contributor does day to day.>

## Setup
1. <prerequisite> — `<verified install command>`
2. First run — `<verified command>`

## Daily loop
- `<command>` — <what it does> (source: <manifest or CI file>)

## Conventions
- <a rule the repo actually follows, with an example path>
```

## testing.md

```markdown
# Testing

## Run
- All: `<command>` (source: <config>)
- One file: `<command pattern>`
- One test: `<command pattern>`

## Write
- Tests live in `<dir/pattern>`
- <fixture, selector, or naming conventions that exist in the repo>

## CI
- <which suites CI runs> — <link to the workflow file>
```

## architecture.md (navigation only)

```markdown
# Architecture

Navigation, not design history: decisions live in `docs/adr/`, terms in
`CONTEXT.md`.

## Modules
- `<path>` — <one line: responsibility>

## Read next
- `docs/adr/` — decisions with their rationale
- <entry point file(s)>
```

## operations.md

```markdown
# Operations

## Deploy / release
- `<verified command or CI job link>`

## Human-only steps
- <step> — performed by <role>; the credential lives in <env var or store>,
  never in this doc.

## Runbook
- <symptom> → `<first check command>`
```

## Audit checklist (copy into the run report)

- [ ] Every command in every `docs/dev/` file exists in repo config
      (manifest, Makefile, CI workflow).
- [ ] Every relative link and referenced path resolves.
- [ ] No claim contradicts the current tree.
- [ ] No content restated from `CONTEXT.md`, `docs/adr/`, or `.scratch/`.
- [ ] No credential or token value in any doc.
- [ ] Unverified facts are listed in the report, not asserted.
