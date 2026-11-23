---
name: opencode-plugin-gui
description: >-
  Build OpenCode plugin Desktop panels that match OpenCode's own Preferences
  UI. Covers the two-column settings screen, CSS tokens, data-component and
  data-slot row structure, a SolidJS row template, friendly setting labels,
  and the build and deploy path. Triggers: plugin GUI, Desktop panel, settings
  tab, match OpenCode Preferences, GUI design.
---

# OpenCode plugin GUI

Build plugin Desktop panels that look like OpenCode's Preferences screen. The
app's UI components live inside the Desktop bundle and are not exported to
`@opencode/plugin/gui`. Mirror their structure and tokens in your own scoped
CSS. One `Style` string per plugin is the existing pattern.

## Screen structure

Two columns: a sticky left nav and a content column. These are host-app
conventions to mirror where the panel has room. A side-region panel cannot
build the 240px nav; reuse the header, card, row, and token rules below
instead of recreating it.

- Screen: raised card, `--v2-background-bg-base`, 10px radius, flex row.
- Nav: 240px wide (328px at large widths), sticky; groups 16px apart;
  selected trigger uses `--v2-background-bg-layer-03` and
  `--v2-text-text-base`.
- Content: flex column, max-width 720px.
- Header: sticky top, `padding:40px 40px 0`, `--v2-background-bg-base`, fade
  below. Title 15px/640 `--v2-text-text-base`; subtitle is the page's
  one-sentence description.
- Body: `padding:24px 40px`, column, 32px gaps.
- Section: column, 16px gaps; heading 13px/530 `--v2-text-text-base`.

## Rows and cards

- Card: `background:--v2-background-bg-layer-01`,
  `box-shadow:inset 0 0 0 .5px --v2-border-border-muted`, 8px radius,
  `padding-inline:20px`.
- Row: flex, 16px gap, center align, `padding-block:20px`,
  `border-bottom:.5px solid --v2-border-border-base`. Remove the border on
  `:last-child`.
- Copy column: flex 1, `min-width:0`, column, 8px gap.
- Title: 13px/530 `--v2-text-text-base`.
- Description: 13px/440, `line-height:20px`, `--v2-text-text-muted`.
- Control: right-aligned, `flex-shrink:0` at desktop width.

## Tokens

Mirror these custom properties; keep their names exact.

`--v2-background-bg-base`, `--v2-background-bg-layer-01`,
`--v2-background-bg-layer-03`, `--v2-border-border-base`,
`--v2-border-border-muted`, `--v2-border-border-focus`,
`--v2-text-text-base`, `--v2-text-text-muted`, `--v2-elevation-input`.

Inputs use `--v2-elevation-input`, `--v2-background-bg-base`, 6px radius,
28px height, and `--v2-border-border-focus` as the focus outline color.

## Names

OpenCode builds settings UI with SolidJS templates compiled to
`data-component` and `data-slot` attributes. Mirror that naming:

- `data-component="settings-row"` on each row.
- `data-slot="settings-row-copy"`, `settings-row-title`,
  `settings-row-description`, `settings-row-control` inside the row.

## Row template

```tsx
import type { Component, JSX } from "solid-js";

export const SettingsRow: Component<{
  title: string;
  description: string;
  children: JSX.Element;
}> = (props) => (
  <div class="myplugin-settings" data-component="settings-row">
    <div data-slot="settings-row-copy">
      <div data-slot="settings-row-title">{props.title}</div>
      <div data-slot="settings-row-description">{props.description}</div>
    </div>
    <div data-slot="settings-row-control">{props.children}</div>
  </div>
);
```

Scope every rule under a plugin-specific class:

```css
.myplugin-settings [data-component="settings-row"] {
  display: flex;
  gap: 16px;
  align-items: center;
  padding-block: 20px;
  border-bottom: 0.5px solid var(--v2-border-border-base);
}
.myplugin-settings [data-component="settings-row"]:last-child {
  border-bottom: 0;
}
.myplugin-settings [data-slot="settings-row-copy"] {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.myplugin-settings [data-slot="settings-row-title"] {
  font-size: 13px;
  font-weight: 530;
  color: var(--v2-text-text-base);
}
.myplugin-settings [data-slot="settings-row-description"] {
  font-size: 13px;
  font-weight: 440;
  line-height: 20px;
  color: var(--v2-text-text-muted);
}
.myplugin-settings [data-slot="settings-row-control"] {
  display: flex;
  justify-content: flex-end;
}
```

## Name settings

Show friendly labels and one-sentence descriptions. Never render raw config
keys or feature prefixes, such as `hook_tool_risk.toastOutcomes`, as visible
text. Keep the raw key only as the persisted RPC value behind the control.

## Build and deploy

```sh
bun run build:gui          # in the plugin dir; runs vite build
# output: dist/gui-experimental.cjs (the package's GUI export)
./sync.sh diff             # compare the clone with the promoted branch
```

Commit reviewed work to `deploy`, then run `./sync.sh deploy`. Use `-t` to
filter by `tags.conf`. Deploy is global only. OpenCode hot-reloads plugin files
immediately. Plugin `setup()` re-runs on edit, but old closures keep firing
until restart. No Desktop or service restart.

## Verify

Take a screenshot of the panel and compare it against OpenCode Preferences.

## Sources

Conventions extracted from the installed OpenCode Desktop app
(`opencode-desktop-bin` 2.3.0, `app.asar`):

- `/tmp/opencode/ocsettings/settings.expanded.css` — layout, rows, tokens.
- `/tmp/opencode/ocapp/out/renderer/assets/main-CEQaLS28.js` — header JSX,
  section titles, i18n strings.
- `/tmp/opencode/ocapp/out/renderer/assets/row-DNmPmLTO.js` — `SettingsRow`
  helper with the exact `data-component` / `data-slot` template.
