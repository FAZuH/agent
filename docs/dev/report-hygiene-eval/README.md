# Report hygiene eval

Date: 2026-11-12. Model: `commandcode/deepseek/deepseek-v4.1-flash`.

This is a real-model check of `@report-hygiene`. The fixture is synthetic. Its
leaks are planted test data, never real values. Do not copy them into another
report.

## Files

- `fixture.md`: a PR body with 16 planted leaks, 9 public facts to keep, and 4
  comprehension gaps.
- `ground-truth.md`: the expected findings, kept facts, gaps, and
  over-redaction checks.

## Method

Two fresh `general` subagents, same model, same fixture.

- **With skill:** read only `skills/shared/report-hygiene/SKILL.md` and
  `fixture.md`, then apply the skill.
- **Control:** read only `fixture.md` and review it for publication.

Both returned a findings table, a comprehension-gap list, and a rewritten
summary. The raw outputs were scored against `ground-truth.md` by hand.

Limits: one fixture, one model, one run per arm. This is a smoke test, not a
benchmark.

## Result

| Measure | With skill | Control |
|---|---|---|
| Explicit findings | 17 | 11 |
| Ground-truth leaks caught | 16 of 16, plus one framing rewrite | 11 of 16 explicit |
| Public facts kept | All | All |
| Over-redaction | None | None |
| Comprehension gaps found | 10 | 6 |

Both runs kept `widgetctl` 1.4.2, `WIDGET_TIMEOUT=5`, the test command, the
error text, `Fixes #482`, and the NixOS 24.05 / Ubuntu 24.04 pair. Neither
replaced the component or version with a generic label.

The control caught the obvious leaks: home path, instruction, stash, session,
private IP, provider, Tailscale, Cloudflare, answer key, private repo, homelab,
and client email. It missed the explicit device phrase and first-person
framing, and found fewer comprehension gaps.

## What the skill added

- **Position rule.** The with-skill run cut `NixOS 24.05` from the setting
  sentence and kept it in the reproduction, where the failure is OS-specific.
  The control kept both. Cutting both would make the bug unreproducible.
- **Scope rewrite, not deletion.** The instruction and the stash reference
  became "the wider watcher refactor is out of scope". The review-relevant
  boundary survived without the provenance.
- **Comprehension floor.** The with-skill run forced the missing mechanism,
  impact, limits, and validation evidence. The control found fewer of these.
- **Over-redaction check.** Both runs passed, and the skill made the check
  explicit.

## What the eval found about the skill

The mechanical `rg` pass caught 6 of the 17 findings. It missed private work
names, provider names, `homelab`, `dotfiles`, `course-oop`, and the answer-key
URL. The URL passed because `example.org` is reserved; the leak was the content,
not the host.

The skill now states that the pass is a floor, gives the reserved-domain example,
and tells the cold read to check framing, not only nouns. The cold read is the
load-bearing step.

## Verdict

Pass for phase 1. The skill catches the planted leaks, preserves the public
context, and does not over-redact. A scanner would raise recall on names and
work context, but the accepted plan defers it until a hook needs one.
