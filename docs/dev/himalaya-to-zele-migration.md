# Himalaya to zele migration

Status: reading path executed 2026-11-11. Digest migration deferred.
Scope: repo mail tooling only. OmaMail, the mail servers, and the IMAP data are unchanged.

## Done

- zele 0.11.0 installed. Five accounts authenticate over IMAP and SMTP:
  `admin@fazuh.com`, `admin@bimbel-bci.com`, `admin@kros-anevasi.com`,
  `admin@arthaenergi.id`, `fazuhhh@gmail.com`.
- `admin@arthaenergi.id` uses the mailcow app token from
  `~/.secrets/mailcow-admin-tokens.env`; its old env password was stale.
- `krosanevasi.com` is an alias domain, not a mailbox. Its env file is now
  `mail_admin@krosanevasi.com.env.disabled`; use `admin@kros-anevasi.com`.
- Secrets live in `~/.secrets/mail/*.env` (dir 0700, files 0600). The old
  directory and its symlinks are gone.
- `scripts/himalaya-gen-config` and `~/.local/bin/himalaya-gen-config` are
  deleted. `~/.config/himalaya/config.toml` remains as a static fallback.
- `scripts/crates/octask/tests/{unit_text,transfer}.rs` use `~/.secrets/mail`.
- `install.sh` lists `zele` in `required_packages`.
- `fazuh-email` documents zele first and the five accounts; `agent-map` lists
  `zele` and no longer lists the retired generator.

## Deferred: digest

Phases 2, 6, and 7 are paused. The current 24h inbox digest duplicates other
notification channels and is not worth porting as-is. Decide its purpose or
replace it before choosing a client. Himalaya stays installed and configured
for it in the meantime.

When the digest is reworked:

1. Rewrite `digest/mail-digest/.opencode/agents/mail-digest.md` for the chosen
   client. If zele: allow `zele whoami*`, `zele * mail list *`,
   `zele * mail read *`; deny send and flag commands.
2. Deploy one manual run and compare its content against the current digest.
3. Retire Himalaya after the replacement is stable.

## Command mapping

| Himalaya | zele |
|---|---|
| `himalaya --json account list` | `zele whoami` |
| `himalaya --json -a "<alias>" envelope list -s 50` | `zele mail list --limit 50 --account "<alias>"` |
| `himalaya -a "<alias>" message read <id>` | `zele mail read <thread-id> --account "<alias>"` |
| numeric IDs | `INBOX:<uid>` thread IDs |
| JSON | YAML |

## Open decisions

- Credential isolation. zele cannot read `$CREDENTIALS_DIRECTORY`; it needs
  `~/.zele/sqlite.db`, which holds credentials and cached bodies. Accept the
  0600 DB, or add a wrapper that logs in from `$CREDENTIALS_DIRECTORY/mail`.
- YAML parsing. `yq` is not installed. The digest agent can read the fields it
  needs from the YAML text; install `go-yq` only if a script needs structured
  parsing.
- Version pin. zele is 0.x with one maintainer. Pin `0.11.0` and re-test after
  upgrades; output and flags can change.
- Digest purpose. Resolve this before porting anything.

## Rollback

The reading path can fall back to Himalaya without data changes: restore
`scripts/himalaya-gen-config` from git history, regenerate
`~/.config/himalaya/config.toml`, and re-enable the alias env file if needed.
The digest was never changed.

## Verification

- `zele whoami` lists five non-test accounts, all Authenticated.
- `rg -n himalaya` in the repo returns the digest agent, this plan, and
  `CHANGELOG.md`. No repo script invokes it. The `fazuh-email` skill documents
  Himalaya only as the digest fallback.
- `cargo test -p octask` passes with the new credential path.
- `zele mail list` and `zele mail read` leave the Seen flag unchanged.
