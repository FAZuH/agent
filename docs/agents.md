# Agents

Agent definitions live in `agents/<category>/<name>.md` and install flat as
`agents/<name>.md`. IDs are path-derived, so the flat install keeps the names
the orchestrator and the subagent tool reference. ⭐ marks the agents the
orchestrator routes work to.

## Primary

- ⭐ **[orchestrator](../agents/primary/orchestrator.md)**: routes work to the subagents below and owns delegation and run mode.
- **[autocommit](../agents/primary/autocommit.md)**: commits pending changes, auto-discovering the repository's commit convention.
- **[chat](../agents/primary/chat.md)**: exploration and general discussion.

Digest agents live in `digest/<name>/` and deploy to
`~/.config/fazuh-agent/digest/<name>/` (not the opencode agents dir), with the
definition at `.opencode/agents/<name>.md` so the octask workdir lookup finds
it. Each binary owns its schedule: `<name> setup --model <m>` creates the
octask timer or edits the model on the existing one.

- **[phone-digest](../digest/phone-digest/.opencode/agents/phone-digest.md)**: posts a digest of phone notifications to Discord.
- **[mail-digest](../digest/mail-digest/.opencode/agents/mail-digest.md)**: posts a daily digest of inbox mail to Discord.

## Build

- ⭐ **[implement](../agents/build/implement.md)**: implementation, test/lint/typecheck suites, and dev servers. Never finishes or commits.

## Review

- ⭐ **[review](../agents/review/review.md)**: the permission scope for the [review-agent](../skills/meta/review-agent/SKILL.md) skill, which supplies the method. Reads everything, writes only the handoff.
- **[malware-check](../agents/review/malware-check.md)**: scans repositories for malware and malicious code patterns.
- **[pii-check](../agents/review/pii-check.md)**: scans repositories for PII and leaked secrets.

## Research

- ⭐ **[research-discovery](../agents/research/research-discovery.md)**: maps repository code to file:line pointers, or writes one cited findings file.
- **[research-synthesis](../agents/research/research-synthesis.md)**: searches several web sources and returns a cited brief in chat.

## Document

- ⭐ **[document](../agents/document/document.md)**: writes ADRs, glossaries, runbooks, README sections, and changelogs. Never touches source code.

See [workflows](../skills/orchestration/workflows/SKILL.md) for the full routing
table and [skills](skills.md) for the skills these agents load.
