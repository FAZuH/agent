# ADR 0002: Jev supervisor for held permission checks

- Status: accepted (2026-11-16)
- Scope: `plugins/jev/src/` (`hook_supervisor`)

## Context

A Jev `ask` left the call to the native human permission prompt. The plugin had
no bounded way to resolve an ordinary ask without a human, and the preliminary
check judged a call from its arguments alone, without recent task history.
Human-only gates and a confident Jev `deny` had to stay absolute.

## Decision

1. `hook_supervisor` is opt-in and off until a separate supervisor model and
   endpoint are configured. It adds no second permission hook. It reuses the
   `ask` effect the risk and rules hooks already set and resolves that hold
   through the permission surface; the evaluate hook never waits on it.
2. The supervisor returns `allow`, `deny`, `abort` or `ask_user`. In trial mode
   (the default) `allow` still needs the human's `once`; outside trial a recheck
   of identity, arguments, policy and liveness runs before a self-reply. A
   failure, an uncertain or malformed answer, unusable history and budget
   exhaustion all escalate to the native prompt. No path silently allows.
   Verdicts combine by strength: `abort` over `deny` over `ask_user` over
   `allow`.
3. Each round gets a bounded, redacted, role-labelled history snapshot and
   read-only project evidence. Evidence stays inside the session root, with
   real-path checks and byte caps, limited to file reads, search and
   constrained Git. The budget is 30 seconds, three rounds and six evidence
   calls, each configurable; the first limit reached ends the run.
4. The host applies a `reject` reply to every pending permission in the
   session, so self-deny runs only when the held call is the only pending one.
   Every audit entry is a redacted summary; no evidence bodies or model
   payloads are stored.
5. The supervisor is a workflow guardrail, not a security sandbox. It shares
   the human's credentials, adds no host patch and performs no deployment.

## Consequences

- Ordinary asks can be resolved without a human after trial, while the human
  keeps final authority and every failure reaches the native prompt.
- A same-authority actor can approve its own action. Authenticated enforcement
  against an agent with the same credentials is out of scope.
- With siblings pending, deny and abort escalate instead of self-rejecting, so
  one call's decision cannot silently reject unrelated prompts.
- Redacted audit summaries lose exact evidence reconstruction after source
  changes. The existing Jev call log is a separate surface.
- A paid real-model end-to-end run passed cases 1, 4 and 5 plus the trial
  allow. Cases 2 (`deny`) and 3 (`abort`) passed for the resolution path with a
  test-only fixture supplying the verdict token, because a real model correctly
  judged the sandbox-safe calls as `allow`; the reject on the wire, caller
  denial, no tool effect and the abort cascade with its fence and audit ran on
  the real host with real plugin code. The raw systemone endpoint accepts only
  `typesafe/jev` models for supervisor decisions; native sessions used
  `commandcode/deepseek/deepseek-v4.1-flash` with the default variant. Result:
  `.scratch/2026-11-16_jev-supervisor-feature/probes/e2e/REPORT.md`.
