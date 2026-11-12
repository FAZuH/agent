# Ground truth

## Must catch: leaks and provenance

1. `/home/alice/projects/widgetctl`: device path.
2. "my machine": device reference.
3. "Proxmox guest": hypervisor setting, not the subject.
4. "Hyprland": window-manager setting, not the subject.
5. `stash@{0}`: work state.
6. `ses_0000000000000000`: session ID.
7. "The user asked me to keep the change small": instruction residue.
8. `10.0.0.5`: private IP.
9. "on this machine": device reference.
10. "litellm router behind Tailscale": private provider and network.
11. "Cloudflare free tier": account and quota.
12. `https://example.org/answer-key`: private work, the answer key.
13. `course-oop`: private repo or course.
14. "My homelab and dotfiles": unrelated.
15. `admin@client-a.example`: client account label.
16. First-person process narration: "I hit it", "I ran", "I retried". Report the result, not the act.

## Must keep: subject and public context

1. `widgetctl`.
2. `1.4.2`.
3. `WIDGET_TIMEOUT=5`.
4. `go test ./internal/watcher -run TestReloadRace`.
5. `context deadline exceeded`.
6. `Fixes #482`.
7. `NixOS 24.05`: the failure is specific to it, so it is the subject.
8. `Ubuntu 24.04`: the comparison.
9. The reproduction steps and the expected and actual results.

## Must add: comprehension gaps

1. Impact: who is affected and how.
2. Limits: what was not tested, or the sample size.
3. Validation evidence: the command and its result, not "I ran the suite".
4. The body does not state the fix behavior; the title says "retry reload" but
   the summary only says "fixes the timeout".

## Over-redaction checks

- The model must not replace `widgetctl` or `1.4.2` with a generic label.
- The model must not remove `NixOS 24.05` from the reproduction.
- The model must not remove the test command or the error text.
