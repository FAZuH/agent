---
name: secrets-argv
description: Keep secrets out of process argv when running commands that take credentials (ansible task args, CLI flags, curl URLs). Use whenever writing or reviewing a command, task, or role that passes a password/token/key as a flag value — argv is world-readable via /proc/<pid>/cmdline and ps, and is captured in shell history, audit logs, and tool transcripts. Covers the private-tempfile pattern for Ansible, raw shell, and curl. Not for secrets in config files, env files, or logs (use logging-guidelines for log redaction).
---

# secrets-argv

Never pass a secret as a command-line argument. argv is world-readable
(`/proc/<pid>/cmdline`, `ps auxfw`) and captured by shell history, sudo/audit
logs, and agent transcripts.

## The pattern: secret goes in a protected file, argv carries only the path

1. Write the secret to a `mktemp` file, `chmod 600` immediately.
2. Point the command's "read from file" flag at that path.
3. Never echo, `debug:`-print, or log the secret or the file contents.
4. Always delete the file afterwards, including on failure.

### Ansible

```yaml
- name: Stage auth secret
  ansible.builtin.copy:
    content: "{{ secret_value }}"
    dest: "{{ _tmp_auth }}"
    mode: "0600"
  vars:
    _tmp_auth: "/tmp/{{ inventory_hostname }}-auth-{{ 99999999 | random }}"
  no_log: true
  diff: false

- name: Enroll using the file path, not the secret
  ansible.builtin.command:
    cmd: "{{ tool }} --auth-file={{ _tmp_auth }}"
  no_log: true
  diff: false

- name: Remove staged secret
  ansible.builtin.file:
    path: "{{ _tmp_auth }}"
    state: absent
  always: true   # inside a block, or run as its own always-cleanup task
  no_log: true
```

The essential bits:

- `no_log: true` **and** `diff: false` on every task that touches the secret —
  `no_log` alone still shows diffs.
- argv carries only the file **path** (`--auth-file=…`, `--auth-key=file:…`).
- Cleanup in an `always` block so failure paths don't leave the file behind.

### Raw shell

```sh
AUTH=$(mktemp)          # /tmp is 0700 on modern distros; chmod anyway
chmod 600 "$AUTH"
trap 'rm -f "$AUTH"' EXIT
printf '%s' "$SECRET" >"$AUTH"
tool --auth-file="$AUTH"   # not: tool --password="$SECRET"
```

### curl / HTTP

PUT the payload in a file and use `--data-binary @file`, or `-K` (config
file) for header tokens — never `curl -H "Authorization: Bearer $TOKEN"`.

## Preference order

1. The tool's native secret-file/stdin option (`--auth-key=file:…`,
   `--password-stdin`, `-K`) — no staging needed.
2. Protected tempfile + path (this pattern).
3. Prompt/askpass — only for interactive flows.

## Why not env vars?

`FOO=secret cmd` keeps the secret out of argv but it still lands in shell
history and `xtrace`; env is fine when the secret is already in a guarded
file (`ENV_FILE`) and you're careful with `set -x` — but the file/stdin
route is always safer.
