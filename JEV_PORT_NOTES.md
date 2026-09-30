# Jev port to OpenCode — Phase 0 findings

Read before writing code. Everything here was verified against the live machine
or a primary source on 2026-09-30; anything not verified is marked as such.

## Host

| Fact | Value | How verified |
| --- | --- | --- |
| OpenCode | v2.0.20 | `opencode --version` |
| Plugin SDK | `@opencode-ai/plugin` 0.0.0-beta-17963 | `plugins/package.json` |
| Plugin load | auto-discovered per `plugins/<name>/` by `sync.sh` | `sync.sh:307` |
| TUI load | `<plugin-dir>/tui` resolved by the CLI | `plugins/viz/tui.ts:1` |

## The v2 plugin contract (the published docs are wrong)

`https://opencode.ai/docs/plugins` documents a v1 shape. v2.0.20 uses this
instead, read off `plugins/viz/src/index.ts` and `plugins/md-link/src/index.ts`:

| Concern | v1 (docs) | v2.0.20 (actual) |
| --- | --- | --- |
| Export | `export const X: Plugin = async (ctx) => ({...})` | `export default { id, tui?, setup: async (ctx) => {} }` |
| Hooks | `return { "tool.execute.before": fn }` | `ctx.tool.hook("execute.before", async (event) => {})`, keyed `event.tool` |
| Custom tools | `tool({ args: ZodSchema, execute(args, ctx) })` | `ctx.tool.transform((tools) => tools.add({ name, description, input: <JSON Schema>, execute: async (input, tctx) => ({ content }) }))` |
| Commands | n/a | `ctx.command.transform((draft) => draft.add({ name, description, execute }))` |
| TUI | n/a | `ctx.ui.slot({ append: "app", render })` + `ctx.keymap.layer(...)`; `ctx.ui.dialog.prompt({...})`, `ctx.ui.toast.show({...})` |

`execute` returns `{ content: string }` and takes a single JSON-Schema `input`,
not `(args, context)` with a Zod schema. Filed as papercut `pc_2a38bf0f51a4`.

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

| Fact | Value | Source |
| --- | --- | --- |
| Endpoint | `https://api.commandcode.ai/provider/v1/systemone` | `commandcode.ai/models/jev`; probe returned 401 (route exists) |
| Dead path | `/provider/v1/alpha/decisions` → **404** | live probe |
| **Wire model id** | **`typesafe/jev`** | `commandcode.ai/models/jev` response block |
| OpenCode model id | `commandcode/typesafe/jev` | `opencode2 models` — **not** the wire value |
| Auth header | `Authorization: Bearer $CMD_API_KEY` | Command Code provider API docs |
| Plan gate | GOAT and above | Command Code FAQ |
| Price | $0.04 / M input, output free | Command Code pricing block |
| Context | 32K (state + longest question) | Command Code model page |
| Interactive use | **Never** — not in `/model`, cannot drive a session | Command Code FAQ |

The wire id and the OpenCode id are different strings. The public
`GET /provider/v1/models` (86 OpenAI-style entries) omits jev entirely, so the
wire id is only discoverable from the model page. Papercut `pc_bb8d10bce66a`.

### Answer shapes

| Type | `criteria` in | Answer out |
| --- | --- | --- |
| `noul` | optional `{true, false}` | `{ type, noul }` — the probability of **yes** |
| `choice` | `{ label: meaning }`, 2–255 labels | `{ type, choice, probabilities, confidence }` |
| `score` | ordered `string[]`, 2–10 levels | `{ type, score, probabilities, legend, confidence }` |

For `noul` there is no separate confidence field: distance from 0.5 *is* the
uncertainty. For `choice`, the `score`-style confidence and the top probability
are different quantities and must not be compared to one threshold.

## Credential

Not a separate mechanism — `commandcode` is a normal OpenCode credential, the
same shape as `opencode-go`. But OpenCode will not hand it to a plugin:

| Store | Contents |
| --- | --- |
| `~/.local/share/opencode/auth.json` | `google`, `openai`, `opencode-go` only |
| `~/.local/share/opencode/opencode.db` → `credential` table | 12 rows incl. `integration_id='commandcode'`, `active=1` |

A plugin calling the provider API directly needs the key in hand, so resolution
order is: `CMD_API_KEY` env var → `~/.config/fazuh-agent/secrets/commandcode_api_key`
(mode 0600) → fail open with a message. The user pastes the key themselves.

## Upstream sources read

| Repo | What it gave |
| --- | --- |
| `wuyoscar/jev-skill` | `scripts/jev.py` — the validation rules ported into `ask()`; the install doc is OpenCode-aware but its five-skill release is a source preview, not the published v0.2.0 (11 skills) |
| `n23eos/jev-skills` | catalog-then-choose shape for the skill picker; `--live` / `--private` / `--follow-up` split; confirms TypeSafe Choice caps at 255 with one reserved for `none` |
| `shitianfang/jev-use` | `src/dispatch.ts` — the pre-call/post-call escalation contract. Its central idea: `producesContent` and non-enumerable options are the LLM's, everything else is Jev's |
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
- **Review priority only.** `jev_score` returns every item with its score and
  sorts; it never filters. A low score cannot remove code from review, because
  there is no code path that drops an item.

## Use-case status

| # | Use case | Status |
| --- | --- | --- |
| 1 | Skill decision | build — `jev_pick` over SKILL.md frontmatter |
| 2 | Digest priority | **deferred** — recurring $ cost against $0 value; filed as a `FAZuH/agent` issue |
| 3 | File explorer | build — upstream `jegrep` + auth shim, bonus-tier install |
| 4 | Review | build — `jev_score`, sorted not filtered |
| 5 | Browser use | build — `jev_pick` over extracted control text |
| 6 | Tool hooks | build — advisory, gate off by default, pending the subagent test |

## Live results (2026-09-30, Command Code, GOAT plan)

Ten calls, 4682 input tokens, **$0.000187** total. The wire model id
`typesafe/jev` is confirmed against a live endpoint; the OpenCode-facing
`commandcode/typesafe/jev` is not the wire value.

| Use case | Result |
| --- | --- |
| `jev_check` — "is the root cause confirmed or still a hypothesis?" | `P(true)=0.09` → **no**, confident. Correct: a repeated failure is not confirmation. |
| `jev_pick_skill` — first GitHub deploy, real candidates | `fazuh-gh-deploy`, P=1.00, confident |
| `jev_pick_skill` — same, with a near-duplicate decoy | `fazuh-gh-deploy`, P=0.54, **low confidence**. Correct abstention on an ambiguous roster. |
| `jev_review_rank` — 4 real files from this change | `index.ts` 1.94 → `jev.ts` 1.78 → `install.sh` 0.73 → docs 0.18. All 4 returned, none dropped. The top two are the two files with real logic. |
| `jev_pick_control` — live GitHub sign-in page | `a#491` "Forgot password?", P=1.00. Verified: the click landed on `github.com/password_reset`. |
| `jegrep` via the shim | 7–9 ranked hits, 20 files read, ~$0.003/run, 1.8–3.7s. Found `agents/primary/mail-digest.md` and `phone-digest.md` for a permissions query. |

Latency is 0.6–2.0s per call. A score answer is fractional (e.g. 1.94), so the
review tool reports the band between the two adjacent rubric levels rather than
an index.

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
3. `/jev-gate on`, then prompted the session to spawn a `general` subagent via
   `task` and have it run a bash command.
4. The hook fired **twice** on tool calls from that session, including one from
   inside the subagent: `risk` P=0.06 on a `write` of 557 tokens, allowed
   through. The earlier `write` had failed open on a closed socket, which is the
   intended behaviour.

So the hook does reach subagent tool calls on this version. The reported bypass
is not reproducible here. One session, one subagent, one call — enough to
contradict the claim, not enough to call the boundary airtight.

## Not verified

- The gate's **block** path has still never executed end to end in a live
  session. Every observed call scored below the threshold, so the hook has only
  ever been observed failing open — correctly. `blocksCall` (the block decision)
  and the hook's fail-open catch are unit-tested; the wiring around them is not.
  To prove the block, `/jev-on` plus a call that genuinely warrants refusal.

- `apply_patch` args use `patchText`, not `filePath`. Handle both.
- The wire model id `typesafe/jev` is confirmed by live authenticated calls
  (see the live results above). What was once open here was whether the
  *OpenCode-facing* id `commandcode/typesafe/jev` was the value to put in
  `state.model` — it is not; the wire value is.
