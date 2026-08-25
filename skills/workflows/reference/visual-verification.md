# Visual verification / image work

> **Load the `following-procedures` skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Gates* section at
> the bottom.

## When to use

A web page/UI must be visually verified, or an image file needs reading/transcribing.

## State machine

```
START (visual check / image)
  ├─ web page or UI  → WEB    delegate to web-viewer
  └─ still image     → IMAGE  delegate to image-viewer
        ↓
  → TRUST  act on the visual report
  → DONE
```

## Steps

| # | State | Owner | Action |
|---|---|---|---|
| 1 | WEB | `web-viewer` | Web pages and UI: delegate to `web-viewer` (Playwright, visual judgment). If it reports the dev server is down, hand off to `dev-server`, then re-run `web-viewer`. |
| 2 | IMAGE | `image-viewer` | Still images (screenshots, diagrams, manga, math): delegate to `image-viewer`. |
| 3 | TRUST | you | Trust the subagent's visual report; only re-run if the environment changed. |

## Dependency graph

- step1
- step2
- step3 -> step1, step2

## Gates

- Step1 and step2 are alternatives: exactly one dispatches per invocation (web page/UI → step1, still image → step2). Step3 consumes whichever ran; the unused alternative being skipped is not a failure.
- Re-run WEB only after `dev-server` reports the environment is up again.