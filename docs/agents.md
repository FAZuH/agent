# Agents

Agent definitions live in `agents/<category>/<name>.md` and install flat as
`agents/<name>.md`. IDs are path-derived, so the flat install keeps the names
the orchestrator and the subagent tool reference. ⭐ marks the agents the
orchestrator routes work to.

## Primary

- ⭐ **[orchestrator](../agents/primary/orchestrator.md)** — routes work to the subagents below and owns delegation and run mode.
- **[autocommit](../agents/primary/autocommit.md)** — commits pending changes, auto-discovering the repository's commit convention.
- **[chat](../agents/primary/chat.md)** — exploration and general discussion.
- **[tutor](../agents/primary/tutor.md)** — the learner-facing agent of the teach workflow: direct answers for lookups, Socratic prompts for concepts.
- **[phone-digest](../agents/primary/phone-digest.md)** — posts a digest of phone notifications to Discord.
- **[mail-digest](../agents/primary/mail-digest.md)** — posts a daily digest of inbox mail to Discord.

## Build

- ⭐ **[implement](../agents/build/implement.md)** — implementation, test/lint/typecheck suites, and dev servers. Never finishes or commits.

## Review

- ⭐ **[review](../agents/review/review.md)** — reviews a diff since a fixed point along Standards and Spec. Read-only.
- **[malware-check](../agents/review/malware-check.md)** — scans repositories for malware and malicious code patterns.
- **[pii-check](../agents/review/pii-check.md)** — scans repositories for PII and leaked secrets.

## Research

- ⭐ **[research-discovery](../agents/research/research-discovery.md)** — maps repository code to file:line pointers, or writes one cited findings file.
- **[research-synthesis](../agents/research/research-synthesis.md)** — searches several web sources and returns a cited brief in chat.

## Vision

- **[image-viewer](../agents/vision/image-viewer.md)** — describes, transcribes, and analyzes image files.
- **[web-viewer](../agents/vision/web-viewer.md)** — inspects web pages in a real browser and judges the result visually.
- **[mermaid-maker](../agents/vision/mermaid-maker.md)** — authors one Mermaid diagram, renders it, and looks at the result.
- **[svg-maker](../agents/vision/svg-maker.md)** — authors one hand-written SVG for spatial and geometric visuals.

## Document

- ⭐ **[document](../agents/document/document.md)** — writes ADRs, glossaries, runbooks, README sections, and changelogs. Never touches source code.

The visual workflow routes to `mermaid-maker` and `svg-maker`. The teach
workflow routes to `tutor` and the lesson-record system. See
[workflows](../skills/orchestration/workflows/SKILL.md) for the full routing
table and [skills](skills.md) for the skills these agents load.
