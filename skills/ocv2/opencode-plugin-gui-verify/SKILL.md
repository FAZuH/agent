---
name: opencode-plugin-gui-verify
description: >-
  Visually verify OpenCode plugin GUI changes without controlling the desktop.
  Covers the browser check when a panel is reachable, faithful static renders
  and headless screenshots when it is not, credential handling, and evidence
  hand-off to a critic. Triggers: verify plugin GUI, visual check plugin panel,
  screenshot plugin settings, cannot control desktop, GUI verification.
---

# Verify a plugin GUI visually

Check a plugin panel or settings tab by sight without taking over the desktop.
Never send desktop input or capture while the desktop is in use. Choose one of
two paths from where the surface lives.

## Decision gate

1. Is the panel reachable in the OpenCode web UI? Use the browser path.
2. Is it a side-region plugin panel with no web-UI route? Use the static-render
   path.

Panels registered through `@opencode/plugin/gui` render in the Desktop side
region, outside the web UI. Default to the static-render path for them.

## Browser path

Open a tab, snapshot before acting, and act only on refs from the latest
snapshot. Screenshots need a visible tab. If the target tab sits on a hidden
window, switch to the static-render path instead of retrying.

When login needs a service password, read it from the local service config
through a short-lived loopback endpoint and feed it to the form in the browser
only. Never print, log, or embed the value. Stop the endpoint and delete the
helper as soon as login succeeds, then close the tab when done.

## Static-render path

Build a standalone HTML file that renders the shipped markup and CSS.

1. Copy the component's CSS declarations verbatim into a `<style>` block. Keep
   selector names and custom properties exact.
2. Reproduce the real markup structure: `data-component`, `data-slot`, card and
   row layout, control placement. The screenshot must exercise the shipped
   selectors.
3. Fill rows with representative values. Show secrets only as `set` or
   `MISSING`; never use a real value.
4. State in the evidence that this is a render of markup plus CSS, not a live
   desktop capture.

## Headless capture

Find an installed headless browser first:

```sh
command -v chromium
```

Capture with a fixed viewport:

```sh
chromium --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --window-size=1240,1100 \
  --screenshot=<out.png> file://<render.html>
```

Confirm the PNG exists and is readable before using it as evidence.

## Evidence hand-off

Give the critic three things together:

- The screenshot, captioned as a live capture or a static render.
- The source files and exact CSS values the render came from.
- Test counts and bundle check results.

Say which claims came from the screenshot and which from source inspection, so
design fidelity and correctness are judged separately. Plugin files hot-reload;
no Desktop or service restart is needed.

## Hygiene gate

Run the residue scan and a cold read on the skill and each screenshot before
they leave the machine.

```sh
rg -n --hidden -g '!*.lock' -g '!vendor/**' -g '!node_modules/**' \
  -e '/home/[^/ ]+' \
  -e '\bses_[A-Za-z0-9]{16,}\b' \
  -e '(?i)(in|on) this (client|machine|host|laptop|desktop|device)' \
  -e '(?i)my (machine|setup|host|laptop|desktop|device)' \
  -e '(?i)the user (asked|said|wants|requested|told)' \
  "$TARGET"
```

Use `$REPO` and `$HOME` instead of absolute home paths. Cut identifiers,
model and agent names, and first-person narration. Crop screenshots so no
paths, tabs, or notifications show. Describe credentials by role only.

## See also

Build the panel with `opencode-plugin-gui`. Keep labels and descriptions
factual, with no raw config keys shown to the reader.
