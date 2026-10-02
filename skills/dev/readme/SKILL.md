---
name: readme
description: >-
  Standardize a README.md to FAZuH's house style: centered title + tagline + hr +
  centered outline nav, section ordering of Installation → Preview → Usage at the top and
  Docs → License at the bottom, and proper placement of user vs developer
  documentation. Use when the user asks to improve a README, mentions README.md,
  asks for README structure, or wants the FAZuH readme style. Also use when
  creating a new repo's README or reviewing an existing one for style compliance.
---

# readme

Keep the README short, scannable, and in `FAZuH/*` shape.

## Top pattern (exact)

Every README starts with this exact header block. Tagline is bold and repo-specific.

```md
<div align="center">

# <repo>

**<One-line pitch: what it is, for whom, in plain language.>**

</div>

<hr>

<div align="center">
● <a href="#installation">Installation</a> ﻿ ● <a href="#preview">Preview</a> ﻿ ● <a href="#usage">Usage</a> ﻿ ● <a href="#docs">Docs</a> ﻿ ● <a href="#license">License</a>
</div>
```

Optional sections extend the outline in section order:

- With a long Setup: `Installation → Setup → Preview → Usage → Docs → License`
- Without Preview (empty): omit its link, so `Installation → [Setup] → Usage → Docs → License`
- Minimal (no Setup, no Preview): `Installation → Usage → Docs → License`

Rules for the outline:

- The outline lives inside `<div align="center"> … </div>` right after `<hr>`.
- Entries are separated by ` ﻿ ` (`SPACE` + `U+FEFF ZERO WIDTH NO-BREAK SPACE` + `SPACE`). GitHub collapses normal double-spaces, so the FEFF keeps the gap. Never plain spaces.
- Each entry starts with `● ` (U+25CF BLACK CIRCLE + SPACE) plus `<a href="#slug">Title</a>`.
- Keep the outline on as few lines as needed; `<br>` only past ~4 entries. The reference style (`pwr-bot`) uses: `Features · Discord Setup · Installation & Usage` on line 1, `Configuration · Command Registration · Notes and Tips` on line 2, `Bug Reports and Feature Requests · License` on line 3; adapt breaks to actual sections.
- `href` must match the heading's GitHub slug (lowercase, spaces → `-`). List only existing headings: no `Preview` link when omitted, `Setup` only when the section exists.
- Title and tagline live in their own `<div align="center">` with a blank line after the opening `<div>` and before `</div>`. GitHub renders markdown inside HTML only with separating blank lines. Keep `# <repo>` as a markdown heading (not `<h1 align="center">`) so its anchor still generates.

Example adapted from `pwr-bot`:

```md
<div align="center">
● <a href="#features">Features</a> ﻿ ● <a href="#discord-setup">Discord Setup</a> ﻿ ● <a href="#installation--usage">Installation & Usage</a><br>
● <a href="#configuration">Configuration</a> ﻿ ● <a href="#command-registration">Command Registration</a> ﻿ ● <a href="#notes-and-tips">Notes and Tips</a><br>
● <a href="#bug-reports-and-feature-requests">Bug Reports and Feature Requests</a> ﻿ ● <a href="#license">License</a>
</div>
```

## Section ordering

Top to bottom:

1. **Installation**: download and install only (prebuilt binaries to `$PATH`, `cargo install`, package manager, `docker pull`). Copy-pasteable commands, no essays. Further setup (accounts, tokens, `auth.json`, `service.env`, `hyprlay install`, portals): one-line pointer (e.g. `See [Token Exchange](docs/token-exchange.md)`). Long setup (multi-step, external portal) gets its own section.
2. **Setup**: optional, only when installation alone cannot run the app and the steps would clutter Installation (e.g. create Discord application → redirect URI → `hyprlay install` → authorize). Single pointer stays a one-liner in Installation; skip this section.
3. **Preview / Screenshots**: what it looks like. Real screenshots/GIFs over text. Hyprlay-style **captioned HTML table**, not stacked `<img>` tags: `### heading + <table><tr><td>one-line caption</td><td><img src="…" width="100%"></td></tr>…</table>`. Empty means omit entirely, outline link included. Never an empty placeholder.
4. **Simple usage with example**: the 30-second happy path. One minimal sequence proving it works (e.g. `hyprlay daemon` → `hyprlay status` → `hyprlay set visible`). Full guide lives in `docs/`; link it.
5. *(Middle, only if essential)*: short Features or Quick-start extras. Total README under ~150 lines; longer belongs in `docs/`.
6. **Docs**: curated user and developer links (see below).
7. **License**: always last, one line (`MIT` with SPDX link or `LICENSE` pointer).

Canonical full order: `Installation → [Setup] → [Preview] → Usage → … → Docs → License`. Do not place Docs or License before Installation/Setup/Usage.

## What belongs where

Keep the README free of:

- Exhaustive CLI tables (`get`/`set` key lists, full flag matrices)
- Full `config.toml` dumps with every knob annotated
- Service/systemd unit prose and credential plumbing details (details belong in `docs/`)
- Logging architecture or code-layout deep dives
- Long troubleshooting FAQ
- Long setup steps inlined in Installation: use a `Setup` section or a `docs/` link instead

### `docs/`: user guides

Anything a user needs beyond the happy path:

- `docs/installation.md`, `docs/usage.md`, `docs/configuration.md`, `docs/cli.md`, `docs/service.md`
- `docs/token-exchange.md`, `docs/troubleshooting.md`, etc.

Reference from the **Docs** section by human titles, never raw paths as titles.

Bad:

```md
- [docs/token-exchange.md](docs/token-exchange.md): connect hyprlay…
```

Good:

```md
- [Token Exchange](docs/token-exchange.md): connect hyprlay to your own Discord application
- [Configuration](docs/configuration.md): full `config.toml` reference
```

### `docs/dev/`: developer docs

Architecture, internals, and contributor-facing material:

- `docs/dev/code-layout.md`: workspace layout, module seams, layering rules
- `docs/dev/debug-probes.md`: `ipcprobe`/`wsprobe` for raw Discord RPC traffic
- `docs/dev/changelog.md`: changelog guide (Keep a Changelog)
- `docs/dev/logging.md`, `docs/dev/architecture.md`, etc.

Never inline this material into the README. Link it from **Docs** with human titles, like the user guides above.

## Docs section style

- Use human-friendly titles as link text, never raw paths.
- Add a one-line gloss after the link (a colon) when the title alone is not self-evident.
- User guides first, then developer docs. Sub-headings (`### User guides`, `### Developer docs`) optional at 4+ links.

## Checklist before committing

- [ ] Header block matches the top pattern exactly (centered title + bold tagline, `<hr>`, centered outline with ` ﻿ ` + `● `).
- [ ] Outline links resolve to real headings; slugs are correct, so no stale `Preview` link when empty and `Setup` appears only when the section exists.
- [ ] Sections follow Installation → [Setup] → [Preview] → Usage → … → Docs → License (Setup only if long, Preview omitted when empty).
- [ ] Installation contains only download & install; long setup lives in `Setup` or as a one-line `docs/` pointer.
- [ ] README stays under ~150 lines; long-form content moved to `docs/` or `docs/dev/`.
- [ ] Docs links use human titles, not path titles.
- [ ] No dev-docs content (architecture, logging, protocol details) remains in README.

## References

- Reference README shape: `https://github.com/FAZuH/pwr-bot/raw/refs/heads/main/README.md`
