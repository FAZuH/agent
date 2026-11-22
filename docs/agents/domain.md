# Domain documentation

This repository uses one domain context.

## Before exploration

Read root `GLOSSARY.md` when it exists.
Read relevant architectural decision records in `docs/adr/`.

If either is absent, proceed silently.
Do not propose empty files.
Domain modeling creates them when terms or decisions are resolved.

## Layout

- `GLOSSARY.md`: domain terms without implementation details.
- `docs/adr/`: decision context, decisions, and consequences.

## Vocabulary and conflicts

Use glossary terms in issues, proposals, hypotheses, and tests.
Do not substitute synonyms that the glossary excludes.
Identify missing concepts as domain-modeling gaps.

If a proposal contradicts an existing decision record, name the record
and explain the conflict. Do not silently override it.
