# Jev port to OpenCode: build record

Written before any code, then kept current as the port landed. Everything here
was verified against the live machine or a primary source on 2026-09-30;
anything unverified is marked as such.

> **2026-10 update:** the four LLM-invoked tools (`jev_pick_skill`,
> `jev_check`, `jev_review_rank`, `jev_pick_control`) and the `@jev-use` skill
> were removed. The judgement is that Jev's power is automatic hooks, not tools
> an LLM has to decide to call: the plugin is now two hooks (`pick_skill`,
> `risk_hook`) and per-feature config replacing the global thresholds. The
> tool-era records below are kept as the build history they are.

For how to *use* the plugin, see [Jev](../jev.md). This file is why it is built
the way it is, what was checked with real requests, and what is still unproven.

## Host

| Fact | Value | How verified |
| --- | --- | --- |
| OpenCode | v2.0.20 | `opencode --version` |
| Plugin SDK | `@opencode-ai/plugin` 0.0.0-beta-17963 | `plugins/package.json` |
| Plugin load | auto-discovered per `plugins/<name>/` by `sync.sh` | `sync.sh:307` |
| TUI load | `<plugin-dir>/tui` resolved by the CLI | `plugins/viz/tui.ts:1` |

## The v2 plugin contract (the published docs are wrong)

`https://opencode.ai/docs/plugins` documents a v1 shape. v2.0.20 uses this
instead, read off `plugins/viz/src/index.ts`:

| Concern | v1 (docs) | v2.0.20 (actual) |
| --- | --- | --- |
| Export | `export const X: Plugin = async (ctx) => ({...})` | `export default { id, tui?, setup: async (ctx) => {} }` |
| Hooks | `return { "tool.execute.before": fn }` | `ctx.tool.hook("execute.before", async (event) => {})`, keyed `event.tool` |
| Custom tools | `tool({ args: ZodSchema, execute(args, ctx) })` | `ctx.tool.transform((tools) => tools.add({ name, description, input: <JSON Schema>, execute: async (input, tctx) => ({ content }) }))` |
| Commands | n/a | `ctx.command.transform((draft) => draft.add({ name, description, execute }))` |
| TUI registration | n/a | `ctx.ui.slot({ append: "app", render })` + `ctx.keymap.layer(...)` |

`execute` returns `{ content: string }` and takes a single JSON-Schema `input`,
not `(args, context)` with a Zod schema. A bare string returns throws
`s is not an Object` at the harness while the call itself still succeeds, so
read the call log rather than the error. Filed as papercut `pc_2a38bf0f51a4`.

### The TUI surface is wrong in the type definitions too

`@opencode-ai/plugin/dist/tui.d.ts` declares `ui.DialogSelect`,
`ui.DialogPrompt`, and `TuiDialogStack.replace`. Measured from a live panel open
on v2.0.20, none of them exist:

```
ctx keys:  options, location, app, renderer, client, data, attention, theme,
           themeMode, markdown, keymap, storage, ui
ui keys:   dialog, toast, format, router, panel, tabs, model, slot
dialog:    show, set, clear, alert, confirm, prompt, select
```

So `dialog.select` and `dialog.prompt` are real and documented nowhere;
`dialog.replace` and the JSX components are documented and absent. The
consequence is concrete: a plugin cannot build a dialog that survives a
selection, because the only non-closing primitive (`replace`, or possibly
`set`) is unreachable, and every host dialog component is unreachable too.
`@opentui/solid` and therefore `createComponent` is not installed for local dir
plugins, only for npm plugins. That is why `/jev-features` closes on every
change, and it is tracked in
[issue #3](https://github.com/FAZuH/agent/issues/3).

`plugins/jev/src/tui.ts` dumps this shape to
`~/.config/fazuh-agent/data/jev-tui.log` on every panel open, because guessing
from the type definitions wasted most of the debugging time.

## How Jev is called

Jev is a decision model, not a chat model. Request is the prompt: a `state` plus
named `questions`, each with a `type` and `instructions`.

```
POST <endpoint>/systemone
Authorization: Bearer <key>
Content-Type: application/json

{ "model": "<wire id>", "state": <string|object|array>,
  "questions": { "<id>": { "type": "noul|choice|score", "instructions": "...",
                            "criteria": ... } } }
```

| Fact | Value | How it was established |
| --- | --- | --- |
| Decisions path | a `/systemone` path under the provider's API root | provider docs; an unauthenticated probe returned 401, which proves the route exists |
| Dead path | a sibling `/decisions` path under an older `alpha` root → **404** | live probe |
| Wire model id | provider-specific, e.g. `typesafe/jev` | the provider's model page, not any list endpoint |
| Host-facing model id | namespaced, e.g. `<provider>/typesafe/jev` | `opencode2 models`, **not** the wire value |
| Auth header | `Authorization: Bearer <key>` | provider API docs |
| Plan gate | provider-specific: some tiers cannot reach the model at all | provider FAQ |
| Price | provider-specific, per million input tokens, output free | provider pricing |
| Context | 32K (state plus the longest question) | provider model page |
| Interactive use | **Never**: absent from `/model`, cannot drive a session | provider FAQ |

The wire id and the host-facing id are different strings. The provider's
catalogue list (86 OpenAI-style entries on the one verified) omits the model
entirely, so the wire id is only discoverable from the model page. Papercut
`pc_bb8d10bce66a`.

None of this is in the plugin. Endpoint, wire model id, key env var, and key
file are all settings and all ship **empty**, so the code names no provider and
carries nobody's billing details. The concrete values live in
`~/.config/fazuh-agent/data/jev-state.json` on the machine that configured them.

### Answer shapes

| Type | `criteria` in | Answer out |
| --- | --- | --- |
| `noul` | optional `{true, false}` | `{ type, noul }`, the probability of **yes** |
| `choice` | `{ label: meaning }`, 2–255 labels | `{ type, choice, probabilities, confidence }` |
| `score` | ordered `string[]`, 2–10 levels | `{ type, score, probabilities, legend, confidence }` |

For `noul` there is no separate confidence field: distance from 0.5 *is* the
uncertainty. For `choice`, the `score`-style confidence and the top probability
are different quantities and must not be compared to one threshold.

## Credential

Not a separate mechanism: the provider is a normal OpenCode credential, the
same shape as `opencode-go`. But OpenCode will not hand it to a plugin:

| Store | Contents |
| --- | --- |
| `~/.local/share/opencode/auth.json` | `google`, `openai`, `opencode-go` only |
| `~/.local/share/opencode/opencode.db` → `credential` table | 12 rows, including the provider's own `integration_id`, `active=1` |

So a plugin calling the provider API directly needs the key in hand. Resolution
order, read fresh per call: each env var in `keyEnv` (default `JEV_API_KEY`) in
order, then `keyFile` (default
`~/.config/fazuh-agent/secrets/jev_api_key`, mode 0600), then fail open with a
message naming the setting to fix. Both are settable in `/jev-settings`.

The user pastes the key themselves. There is deliberately no command that takes
a key as an argument: anything after a slash command lands in the transcript, so
`/jev-key` is a TUI dialog and the server-side route only reports the path.

## Upstream sources read

| Repo | What it gave |
| --- | --- |
| `wuyoscar/jev-skill` | `scripts/jev.py`: the validation rules ported into `ask()`; the install doc is OpenCode-aware but its five-skill release is a source preview, not the published v0.2.0 (11 skills) |
| `n23eos/jev-skills` | catalog-then-choose shape for the skill picker; `--live` / `--private` / `--follow-up` split; confirms TypeSafe Choice caps at 255 with one reserved for `none` |
| `shitianfang/jev-use` | `src/dispatch.ts`: the pre-call/post-call escalation contract. Its central idea: `producesContent` and non-enumerable options are the LLM's, everything else is Jev's |
| `Kmasterrr/use-jev` | confirmed the request/response wire shapes; notes the endpoint moved to `/systemone` |
| `ellipsis-dev/blink` | not used (jegrep chosen instead) |
| `can1357/jegrep` | `--endpoint local` + `JEGREP_ENDPOINT_URL` sends **no** Authorization header, which is why a shim is needed; withholds credential files by name *and* content |
| `devagrawal09/jev-review` | staged Noul→Choice→Score review shape |
| `cobanov/awesome-jev`, `wuyoscar` catalog | the use-case leads; confirmed no "digest priority" repo exists |
| `aaronshaf/opencode-jev-orchestrator` | the only pre-existing OpenCode Jev plugin; it is a *model* orchestrator, not a decision tool, so nothing to reuse |

## Decision: what Jev is and is not allowed to do here

- Jev is advisory and fail-open. On error, timeout, or low confidence the host
  proceeds without it. Nothing is blocked by a Jev answer alone.
- Jev never executes anything. Every tool returns a decision for the agent to
  weigh.
- **Review priority only.** `jev_review_rank` returns every item with its score
  and sorts; it never filters. A low score cannot remove code from review,
  because there is no code path that drops an item.
- **The one exception is explicit.** The `risk_hook` feature can block a tool
  call, and only when the answer is both confident and above `gateProbability`.
  It ships off, and it is the reason a Jev answer is not *always* inert.

## Use-case status

| # | Use case | Status |
| --- | --- | --- |
| 1 | Skill decision | **live**: `jev_pick_skill` over SKILL.md frontmatter |
| 2 | Digest priority | **deferred**: recurring $ cost against $0 value; [issue #2](https://github.com/FAZuH/agent/issues/2) |
| 3 | File explorer | **live**: upstream `jegrep` + auth shim, bonus-tier install |
| 4 | Review | **live**: `jev_review_rank`, sorted not filtered |
| 5 | Browser use | **live**: `jev_pick_control` over extracted control text |
| 6 | Tool hooks | **live**: advisory, `risk_hook` off by default, subagent reach tested |

## What was verified with real requests

Each tool was run against a live endpoint, not just type-checked. Schema-valid
is not a correct decision, so the checks that matter are the answers:

| Tool | What a real run showed |
| --- | --- |
| `jev_check` | Answered **no** to "is the root cause confirmed or still a hypothesis?", confidently. Correct: a repeated failure is not confirmation. |
| `jev_pick_skill` | Picked the right skill with P=1.00 on a real roster. Given a near-duplicate decoy it returned the same pick at P=0.54 and **reported low confidence**. The abstention is the feature working, not failing. |
| `jev_review_rank` | Ranked four real files with the two containing real logic at the top. All four came back; none were dropped. |
| `jev_pick_control` | Picked the right control on a real sign-in page, and the click was confirmed to land on the page it named. |
| `jegrep` via the shim | Returned ranked hits across the repo and found the two agent files a permissions question pointed at. |

A `score` answer is fractional, so the review tool reports the band between two
adjacent rubric levels rather than an index. Latency and per-call cost are
provider-specific; `/jev-status` reports both for whichever provider is
configured.

## #5894 does not reproduce on v2.0.20

[anomalyco/opencode#5894](https://github.com/anomalyco/opencode/issues/5894)
reported that `tool.execute.before` hooks do not intercept tool calls made by
subagents spawned through `task`, letting a plugin policy be bypassed. It was
filed against **1.0.182** and is now closed.

Tested live against 2.0.20, driven over the HTTP API so the session is
independent of this one:

1. `POST /api/session` created a fresh session; `GET /api/plugin` confirmed
   `fazuh.jev` is `active` with `server` and `tui` both true.
2. Model switched to `opencode/muse-spark-1.3-contributor-free` so the test
   costs nothing.
3. The `risk_hook` feature turned on, then prompted the session to spawn a
   `general` subagent via `task` and have it run a bash command.
4. The hook fired **twice** on tool calls from that session, including one from
   inside the subagent: `risk` P=0.06 on a `write` of 557 tokens, allowed
   through. The earlier `write` had failed open on a closed socket, which is the
   intended behaviour.

So the hook does reach subagent tool calls on this version. The reported bypass
is not reproducible here. One session, one subagent, one call is enough to
contradict the claim, not enough to call the boundary airtight.

## Not verified

- The risk hook's **block** path has still never executed end to end in a live
  session. Every observed call scored below the threshold, so the hook has only
  ever been observed failing open, correctly. `blocksCall` (the block decision)
  and the hook's fail-open catch are unit-tested; the wiring around them is not.
  To prove the block, turn the `risk_hook` feature on in `/jev-features` and
  make a call that genuinely warrants refusal.
- Two bugs found by review are fixed and unit-tested but not re-proven live: the
  hook used to fail *closed* when the response body died after headers, and it
  used to block on answers the plugin itself called low confidence.
- `dialog.set` is the one untested candidate for a panel that survives a
  selection. See [issue #3](https://github.com/FAZuH/agent/issues/3).
- `apply_patch` args use `patchText`, not `filePath`. Handle both.
- The TUI panels have never been seen rendered by anything but a person. Their
  structure, state writes, and dialog lifecycle are exercised against a fake
  `ctx`; the pixels are not.
- The wire model id was confirmed by live authenticated calls (see the results
  above). What was once open here was whether the *host-facing* namespaced id was
  the value to put in `state.model`: it is not. The wire value is.
