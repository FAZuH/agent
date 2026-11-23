# Watchdog rollout status

This record states what exists in source and synthetic tests, and what stays
blocked. It is not host evidence and does not open the rollout gate.

Watchdog is the authority that coordinates action review and owns enforcement.
The review chain runs a Decision model (Jev) stage, then a Parent or Supervisor
stage, then Human when the action needs exact approval. Each stage returns a
Verdict. The chain stays off until you set `WATCHDOG_CHAIN=1` and a real-host
`chain-gate.json` records a passed gate. A missing, malformed, or synthetic gate
file fails closed.

## Code and synthetic test coverage

Each area below has source and synthetic tests. Synthetic means no host, no
network, and no model.

The suite needs the plugin dev dependencies. Run `cd plugins && bun install
--frozen-lockfile` before the tests. After that install, the full suite reports
`1105 pass / 0 fail / 3667 expect() calls; Ran 1105 tests across 30 files` and
exits 0. Without the install, only `gui-bundle.test.ts` fails with `Cannot find
module 'solid-js'`. One uninstalled run also showed eight order-dependent
failures. Those failures did not reproduce in four later runs, and each failing
file passed in isolation. That is consistent with test-state leakage. No
product defect was identified. None of these checks proves host behavior.

- Authority, routing, and coverage. Admission, node selection, host rules, and
  the `execute.before` boundary have code and tests in `chain.ts`, `index.ts`,
  `chain.test.ts`, `chain-wiring.test.ts`, and `session-ban-host.test.ts`.
- Transient generation, context, and result protocol. Snapshot building, role
  filtering, generation, reply parsing, repair, and failure categories have
  code and tests in `context.ts`, `chain.ts`, `context.test.ts`, and
  `capability-gate.test.ts`.
- Timing, batching, and budget. The Admission budget, Review item batching,
  partial flush, retry bounds, and the restart ledger have code and tests in
  `chain.ts`, `watchdog-config.ts`, and `chain.test.ts`.
- Abort operations and recovery. Abort scope, Effective ban, Release, queued
  deny containment, and restart reconciliation have code and tests in
  `abort.ts`, `session-ban-state.ts`, `session-ban-host.ts`, and `abort.test.ts`.
- Receipts, notices, and audit. One redacted receipt per Abort operation,
  bounded retries, a queue-only parent notice, and incomplete-containment
  vocabulary have code and tests in `delivery.ts` and `delivery.test.ts`.
- Dedicated page and migration. The page, controller, an RPC (remote procedure
  call) contract, and fill-on-read migration have source and surface guards in
  `gui.tsx`, `watchdog-controller.ts`, `watchdog-settings.ts`, `gui-rpc.ts`,
  `gui-watchdog.test.ts`, and `gui-bundle.test.ts`.
- Rollout gate. Eight required capabilities, a real-host-only run sheet, and
  fail-closed parsing have code and tests in `capability-gate.ts` and
  `capability-gate.test.ts`.

## Blocked and unverified

- Bounded speculation is deliberately held. A started transient generation
  cannot be cancelled (capability `c3_cancellation`), and stopping a started
  tool is unconfirmed. The code reports the nonblocking selection but holds the
  call for authorization (`chain.ts:1158-1174`). No speculation path is live.
- The gate is closed. Its path is
  `~/.local/state/opencode/jev/chain-gate.json`. A file exists at that path,
  written 2026-11-22, but it is `blocked`. Four capabilities are not passed:
  `c3_cancellation` and `c5b_human_only_absolute` failed, and `c2_isolation`
  and `c4_native_coverage` are partial. `WATCHDOG_CHAIN` is unset, so
  `chainStatus()` reports `off` and `chainEnabled()` is false. No gate file,
  `CAPABILITY-REPORT.md`, or `EVIDENCE.md` is tracked in the repo. All built
  behavior stays off. Do not fabricate a passing gate.
- Tool-surface coverage is unverified. Only `execute.before` is gated. Native,
  plugin, MCP (a tool-connector protocol), and code-mode reachability is
  unmeasured (`c4_native_coverage`).
- Parent context and transcript isolation are unverified. The host projection
  of inherited context is unmeasured, and synthetic user-role messages cannot
  be told from real ones.
- No-wake notices are recorded verified in the gate file
  (`c6_no_wake_notices`). A live probe showed the queued notice did not wake the
  parent. Cancellation of started work is recorded failed after live interrupt
  probes (`c3_cancellation`). Webhook delivery has no gate capability and was
  not probed.
- The rendered page is unverified. The page tests are source guards and static
  bundle evaluation. No desktop, web, or mobile rendering inspection exists.
- Legacy tool-risk enforcement can coexist with the chain. Host ordering
  decides whether this conflicts with Watchdog owning enforcement. This is not
  asserted as a defect.

## Test seams

Install the plugin dev dependencies first:

```bash
cd plugins && bun install --frozen-lockfile
```

Run the whole suite:

```bash
bun test plugins/watchdog/src
```

Run one file with `bun test plugins/watchdog/src/<file>.test.ts`. The four seams
use these files:

- Admission, routing, and enforcement: `bun test plugins/watchdog/src/chain.test.ts`,
  `bun test plugins/watchdog/src/chain-wiring.test.ts`,
  `bun test plugins/watchdog/src/session-ban-host.test.ts`,
  `bun test plugins/watchdog/src/capability-gate.test.ts`.
- Per-item lifecycle and budget: `bun test plugins/watchdog/src/chain.test.ts`,
  `bun test plugins/watchdog/src/abort.test.ts`,
  `bun test plugins/watchdog/src/supervisor-batch.test.ts`,
  `bun test plugins/watchdog/src/delivery.test.ts`.
- Transient generation context and protocol: `bun test plugins/watchdog/src/context.test.ts`,
  `bun test plugins/watchdog/src/chain.test.ts`,
  `bun test plugins/watchdog/src/evidence.test.ts`,
  `bun test plugins/watchdog/src/capability-gate.test.ts`.
- Public page and remote control abort and recovery: `bun test plugins/watchdog/src/watchdog-controller.test.ts`,
  `bun test plugins/watchdog/src/watchdog-settings.test.ts`,
  `bun test plugins/watchdog/src/gui-rpc.test.ts`,
  `bun test plugins/watchdog/src/abort.test.ts`,
  `bun test plugins/watchdog/src/gui-watchdog.test.ts`,
  `bun test plugins/watchdog/src/gui-bundle.test.ts`.

The wiring suite spawns a child process. Run it with
`bun test plugins/watchdog/src/chain-wiring.test.ts`. It starts
`bun test --timeout 20000 <cases>`.

## Gate rule

A synthetic test or a fabricated artifact cannot pass the gate. Only a
real-host run sheet that verifies all eight required capabilities can set the
gate to passed. A missing, corrupt, or synthetic sheet fails closed. Do not add
a gate file, an evidence file, or a report to pass the gate locally. That does
not open the chain and it hides what still needs a host.
