---
name: readme
description: >-
  Standardize a README.md to FAZuH's house style: top tagline + hr + centered
  outline nav, section ordering of Installation → Preview → Usage at the top and
  Docs → License at the bottom, and proper placement of user vs developer
  documentation. Use when the user asks to improve a README, mentions README.md,
  asks for README structure, or wants the FAZuH readme style. Also use when
  creating a new repo's README or reviewing an existing one for style compliance.
---

# readme

Every repo's front door is its README. This skill keeps it short, scannable,
and in the same shape as every other `FAZuH/*` repo.

## Top pattern (exact)

Every README starts with this exact header block, including the tagline, rule,
and centered outline. The tagline is bold and repo-specific.

```md
# <repo>

**<One-line pitch — what it is, for whom, in plain language.>**

<hr>

<div align="center">
● <a href="#installation">Installation</a> ﻿ ● <a href="#preview">Preview</a> ﻿ ● <a href="#usage">Usage</a> ﻿ ● <a href="#docs">Docs</a> ﻿ ● <a href="#license">License</a>
</div>
```

When optional sections are used, extend the outline in the same order as the
sections:

- With a long Setup: `Installation → Setup → Preview → Usage → Docs → License`
- Without Preview (empty): omit its link — `Installation → [Setup] → Usage → Docs → License`
- Minimal (no Setup, no Preview): `Installation → Usage → Docs → License`

Rules for the outline:

- The outline lives inside `<div align="center"> … </div>` immediately after `<hr>`.
- Entries are separated by ` ﻿ ` — that is `SPACE` + `U+FEFF ZERO WIDTH NO-BREAK SPACE` + `SPACE`. GitHub's markdown renderer collapses normal double-spaces, so the FEFF keeps the gap visible. Do not replace it with plain spaces.
- Each entry starts with `● ` (U+25CF BLACK CIRCLE + SPACE) followed by an `<a href="#slug">Title</a>`.
- Keep the outline on as few lines as needed; wrap with `<br>` only if there are more than ~4 entries. The reference style (e.g. `pwr-bot`) uses: `Features · Discord Setup · Installation & Usage` on line 1, `Configuration · Command Registration · Notes and Tips` on line 2, `Bug Reports and Feature Requests · License` on line 3 — adapt line breaks to the repo's actual sections.
- Link `href` must match the heading's GitHub-generated slug (lowercase, spaces → `-`). Only list headings that actually exist — do not keep a `Preview` link when the section is omitted, and add `Setup` only when you add the section.

Example adapted from `pwr-bot`:

```md
<div align="center">
● <a href="#features">Features</a> ﻿ ● <a href="#discord-setup">Discord Setup</a> ﻿ ● <a href="#installation--usage">Installation & Usage</a><br>
● <a href="#configuration">Configuration</a> ﻿ ● <a href="#command-registration">Command Registration</a> ﻿ ● <a href="#notes-and-tips">Notes and Tips</a><br>
● <a href="#bug-reports-and-feature-requests">Bug Reports and Feature Requests</a> ﻿ ● <a href="#license">License</a>
</div>
```

## Section ordering

Order matters — readers skim top to bottom:

1. **Installation** — only how to download and install the app to the user's machine (prebuilt binaries to `$PATH`, `cargo install`, package manager, `docker pull`, etc.). Keep it runnable: copy-pasteable commands only, no essays. When the app requires further setup (accounts, tokens, `auth.json`, `service.env`, `hyprlay install`, Discord Developer Portal, etc.), do not detail it here beyond a one-line pointer — e.g. `See [Token Exchange](docs/token-exchange.md)`. If that setup is long (multi-step or requires an external portal), give it its own dedicated section instead.
2. **Setup** — optional, only when installation alone is not enough to run the app and the steps would clutter Installation. Contains the multi-step setup (e.g. create Discord application → add redirect URI → `hyprlay install` → authorize). If setup is a single pointer, keep it as a one-liner in Installation and skip this section.
3. **Preview / Screenshots** — what it looks like. Prefer real screenshots/GIFs over text. If empty (no images/GIFs and nothing meaningful to show), omit the section entirely and drop it from the outline. Do not keep an empty placeholder.
4. **Simple usage with example** — the 30-second happy path. One minimal command sequence that proves it works (e.g. `hyprlay daemon` → `hyprlay status` → `hyprlay set visible`). Link to the full guide in `docs/` instead of dumping every flag here.
5. *(Middle — only if essential)* — short Features or Quick-start extras. Keep total README under ~150 lines; anything longer belongs in `docs/`.
6. **Docs** — curated links to user and developer docs (see below).
7. **License** — always last, one line (`MIT` with SPDX link or `LICENSE` file pointer).

Canonical full order: `Installation → [Setup] → [Preview] → Usage → … → Docs → License`. Do not place Docs or License before Installation/Setup/Usage.

## What belongs where

### README (front door, ~100–150 lines)

- Tagline + outline nav (only sections that exist — drop `Preview` when empty, add `Setup` when needed)
- Installation — download & install only (runnable); further setup → one-line `docs/` link, or dedicated `Setup` section if long
- Setup — optional, only for long multi-step setup (otherwise a one-liner in Installation)
- Preview — optional, only if non-empty (real screenshots/GIFs or meaningful demo); omit entirely when empty
- Usage (minimal example, 3–5 commands)
- Docs (links with human-friendly titles — not raw paths)
- License

Keep the README free of:

- Exhaustive CLI tables (`get`/`set` key lists, full flag matrices)
- Full `config.toml` dumps with every knob annotated
- Service/systemd unit prose and credential plumbing details (details belong in `docs/`)
- Logging architecture or code-layout deep dives
- Long troubleshooting FAQ
- Long setup steps inlined in Installation — use a `Setup` section or a `docs/` link instead

### `docs/` — user guides

Anything a user needs to operate the software beyond the happy path:

- `docs/installation.md`, `docs/usage.md`, `docs/configuration.md`, `docs/cli.md`, `docs/service.md`
- `docs/token-exchange.md`, `docs/troubleshooting.md`, etc.

These are referenced from the README's **Docs** section by human titles, not by raw file paths as titles.

Bad:

```md
- [docs/token-exchange.md](docs/token-exchange.md) — connect hyprlay…
```

Good:

```md
- [Token Exchange](docs/token-exchange.md) — connect hyprlay to your own Discord application
- [Configuration](docs/configuration.md) — full `config.toml` reference
```

### `docs/dev/` — developer docs

Architecture, internals, and contributor-facing material:

- `docs/dev/code-layout.md` — workspace layout, module seams, layering rules
- `docs/dev/debug-probes.md` — `ipcprobe`/`wsprobe` for raw Discord RPC traffic
- `docs/dev/changelog.md` — changelog guide (Keep a Changelog)
- `docs/dev/logging.md`, `docs/dev/architecture.md`, etc.

Never inline this material into the README. The README's **Docs** section links to it with human titles as well.

Bad:

```md
- [docs/dev/code-layout.md](docs/dev/code-layout.md) — workspace layout…
```

Good:

```md
- [Code Layout](docs/dev/code-layout.md) — workspace layout, module seams, and layering rules
- [Debug Probes](docs/dev/debug-probes.md) — the `ipcprobe` / `wsprobe` examples
```

## Docs section style

The **Docs** section is a tight link hub, grouped but not verbose:

```md
## Docs

- [Token Exchange](docs/token-exchange.md) — connect hyprlay to your own Discord application
- [Configuration](docs/configuration.md) — full `config.toml` reference
- [Code Layout](docs/dev/code-layout.md) — workspace layout, module seams, and layering rules
- [Debug Probes](docs/dev/debug-probes.md) — the `ipcprobe` / `wsprobe` examples for raw Discord RPC traffic
```

- Use human-friendly titles as link text, never the raw path.
- Add a one-line gloss after the link (em dash) when the title alone is not self-evident.
- Group user guides first, then developer docs. A sub-heading (`### User guides`, `### Developer docs`) is optional when there are 4+ links.

## Checklist before committing

- [ ] Header block matches the top pattern exactly (tagline bold, `<hr>`, centered outline with ` ﻿ ` + `● `).
- [ ] Outline links resolve to real headings; slugs are correct — no stale `Preview` link when empty, `Setup` link present only when the section exists.
- [ ] Sections follow Installation → [Setup] → [Preview] → Usage → … → Docs → License (Setup only if long, Preview omitted when empty).
- [ ] Installation contains only download & install; long setup lives in `Setup` or as a one-line `docs/` pointer.
- [ ] README stays under ~150 lines; long-form content moved to `docs/` or `docs/dev/`.
- [ ] Docs links use human titles, not path titles.
- [ ] No dev-docs content (architecture, logging, protocol details) remains in README.

## References

- Reference README shape: `https://github.com/FAZuH/pwr-bot/raw/refs/heads/main/README.md`
