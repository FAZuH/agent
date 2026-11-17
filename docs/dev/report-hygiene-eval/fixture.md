# fix(watcher): retry reload when the watcher races

## Summary

This fixes the intermittent timeout in widgetctl 1.4.2 when the config reload
races the watcher. I hit it on my machine, a Proxmox guest running NixOS 24.05
with Hyprland, at /home/alice/projects/widgetctl. The user asked me to keep the
change small, so I stashed the refactor in stash@{0} and left session
ses_0000000000000000 open.

## Reproduction

1. Start the service on 10.0.0.5.
2. Set WIDGET_TIMEOUT=5 in the config.
3. Run `go test ./internal/watcher -run TestReloadRace`.

Expected: the reload completes.
Actual: it sometimes returns `context deadline exceeded`.
The failure only appears on NixOS 24.05; on Ubuntu 24.04 it passes.

## Validation

I ran the suite on this machine and it passed. I also checked the litellm
router behind Tailscale, but that is unrelated. The Cloudflare free tier was
rate limiting me, so I retried later.

## Notes

The answer key for the course is at https://example.org/answer-key and the
private repo is `course-oop`. My homelab and dotfiles are not involved.
Contact admin@client-a.example for access.

Fixes #482.
