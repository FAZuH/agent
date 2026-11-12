---
name: report-hygiene
description: >-
  Keep an artifact that leaves the device clear and free of private context.
  Triggers: writing or reviewing a commit, PR, issue, doc, comment, report,
  screenshot, or log for publication.
---

# report-hygiene

A report is any artifact that leaves the machine that produced it: a commit,
PR, issue, doc, review comment, screenshot, or pasted log. The private circle
is the agents, the user, and that machine. A report must be clear to a public
reader and must not expose that circle.

Provenance is where the report came from: the session, the instruction, the
machine, the accounts, and the private work behind it.

Secrets and PII are a separate scan. Prose quality is a separate pass. This
skill owns provenance.

## The window

A report sits between two limits.

- **Floor: comprehension.** A stranger must understand and act on it.
- **Ceiling: provenance.** It must not identify the device, accounts, session,
  private work, or people.

One rule: **a private detail stays only if it is the subject of the report.**

| Detail | Verdict |
|---|---|
| A distro named in a portability bug | Subject, keep |
| The same distro named in a cleanup bug | Setting, cut |
| A hypervisor named in a network bug | Setting, cut |
| "the user asked to keep it" | Conversation, cut or state the result |
| `ses_0000000000000000` | Agent residue, cut |
| An account count in a mail-tooling note | The count can be the subject; the addresses are not |

## The private circle

**Agent residue.** The session behind the report.

- Session IDs (`ses_...`), message IDs, model and agent names.
- Tool and subagent narration: "I ran", "the subagent found".
- The user's instruction, quoted or paraphrased.
- Stash entries, branch state, unmerged work.

**User residue.** The user's accounts, work, and people.

- Mailbox addresses, client names, course names, private repo names.
- Answer keys, eval sets, private tickets.
- Customer data, calendar entries, Discord IDs.
- Unrelated projects and homelab.

**Device residue.** The machine that produced the report.

- Username, home path, hostname.
- Private IPs, tailnets, VPNs, SSH hosts.
- OS, window manager, hardware, and the combination that fingerprints them.
- Local logs, screenshots, terminal prompts, and file paths.

## Replace, do not delete

If a private detail is load-bearing, replace it. Use the least specific form
that still passes the comprehension floor.

1. **Exact:** `admin@client-a.example`
2. **Role:** "the admin account"
3. **Class:** "an account"
4. **Omit**

Examples (the values are placeholders):

| Before | After |
|---|---|
| `/home/alice/project` | `$HOME/project` or `$REPO` |
| `10.0.0.5` | "the host" |
| `<host>.ts.net` | "a private network" |
| A provider router behind a VPN | "a provider on a private network" |
| "I ran the tests on my machine" | "Tests: 20 passed (`python3 ...`)" |
| "the user asked to stash it" | "the change is kept off the branch" |
| "the answer key is at <url>" | "the reference implementation" |

A redacted report that no longer makes sense is also a failure.

## Comprehension floor

Before publishing, confirm the report has:

- The subject: the public component and its version or commit.
- The behavior: what changed and why.
- Reproduction: the steps or commands, with public paths.
- Expected versus actual.
- Evidence: the command and its result, not the act of running it.
- Impact, scope, and what was not tested.
- Every term or abbreviation defined at first use.

## Provenance ceiling

The report must not contain any item from "The private circle", except the one
detail that is the subject.

Common residue to remove:

- "on this machine", "in this client", "my setup".
- "the user asked", "per your instruction", "as requested".
- Session IDs, stash refs, branch names, local commit hashes.
- Model, provider, agent, and skill names, unless the report is about them.
- Private repo, client, course, and answer-key names.
- Real addresses, names, IDs, and customer data.
- Unrelated projects and homelab details.

## Mechanical pass

Run this on the target before the cold read. It finds candidates, not verdicts.
Set `TARGET` to the file, directory, or diff you are about to publish. The pass
is a floor: it will miss private work names, provider names, and device
fingerprints. The cold read is the real check.

```bash
rg -n --hidden -g '!*.lock' -g '!vendor/**' -g '!node_modules/**' \
  -e '/home/[^/ ]+' \
  -e 'C:\\Users\\[^\\ ]+' \
  -e '\b10\.[0-9]+\.[0-9]+\.[0-9]+' \
  -e '\b192\.168\.[0-9]+\.[0-9]+' \
  -e '\b172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+' \
  -e '\b[a-z0-9-]+\.ts\.net\b' \
  -e '\bses_[A-Za-z0-9]{16,}\b' \
  -e 'stash@\{[0-9]+\}' \
  -e '\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b' \
  -e '(?i)(in|on) this (client|machine|host|laptop|desktop|device)' \
  -e '(?i)my (machine|setup|host|laptop|desktop|device)' \
  -e '(?i)the user (asked|said|wants|requested|told)' \
  -e '(?i)(as|per) (instructed|requested)' \
  "$TARGET"
```

Add repo-specific names when you know them: providers, hypervisors, private
repos, client domains. Keep an allowlist for intentional public identities,
such as the author address in release workflows. Put the allowlist in the
repo's review notes or the target's config, one exact value per line with the
reason. Never allowlist a pattern. Every entry needs a reason.

Reserved domains never identify a real account: `example.com`,
`example.org`, `.example`, and `.test`. The local part still matters:
`admin@example.com` is a safe fixture; `admin@client-a.example` fails because
`client-a` looks like a real engagement label. A reserved domain does not make
the content safe: `https://example.org/answer-key` passes the address pattern
and still leaks private work.

Reserved IP ranges for documentation are `192.0.2.0/24`, `198.51.100.0/24`,
`203.0.113.0/24`, and `2001:db8::/32`. Private ranges such as `10.0.0.0/8` are
not documentation ranges; replace them.

## Cold read

With a subagent: give it the artifact and nothing else. Without one: read the
artifact in a fresh session or after a break, and answer as a stranger would.

1. Read the artifact with no conversation history.
2. List every proper noun, path, host, ID, version, and first-person sentence.
3. Read for framing, not only nouns: first-person narration, instruction
   fragments, and "this fixes the thing you reported" are provenance.
4. For each, ask: is it the subject? Does the reader need it? Can it be
   replaced? Should it be cut?
5. Check images and logs separately.
6. Return two lists: comprehension gaps and provenance hits.

## Publish gate

Run the gate before any of these:

- `git commit` or `git push`.
- `gh pr create` or `gh issue create`.
- Publishing a doc, README, changelog, or dev note.
- Posting a review comment or a report.
- Sharing a screenshot or a log.

The gate is: mechanical pass, cold read, fix, then publish.

If a leak is already pushed, remove it from HEAD and report the history
exposure to the repository owner in the session: the commit, the exposed value,
and whether it is still reachable. Do not rewrite public history without the
repository owner's decision.

## Artifact notes

Use the subset the artifact needs. A commit message needs the subject and the
behavior. A PR or issue needs the full floor. A doc needs the subject, behavior,
and limits. A comment needs the finding and its evidence. A screenshot needs
its caption and crop.

| Artifact | Extra check |
|---|---|
| Commit | The message states behavior, not the session. No stash, branch, session, or instruction. |
| PR or issue | The full comprehension floor. Publish the command and result, not "verified on this machine". |
| Doc | The subject only. Examples are synthetic, never real identities. |
| Review comment | The finding and its evidence. No session provenance. |
| Screenshot | Prompt, paths, tabs, notifications, and EXIF. Crop or blur. |
| Log | Keep the error. Replace the user, host, path, and token. |

## Test the gate

All values below are synthetic. A sanitized migration note with roles instead
of identities is the negative fixture: it must pass.

| Fixture | Expected |
|---|---|
| `admin@example.com` | Pass, reserved |
| `example.org` | Pass, reserved |
| `admin@client-a.example` | Replace with "the admin account"; the label looks like a client |
| `/home/alice/project` | Replace with `$HOME/project` |
| `10.0.0.5` | Replace with "the host" |
| `<host>.ts.net` | Replace with "a private network" |
| `ses_0000000000000000` | Cut |
| `stash@{0}` | Cut |
| "on this machine" | Replace with the command and result |
| "my setup" | Replace with the public component or omit |
| "the user asked to stash it" | Report the state or cut |
| A sanitized migration note | Pass, negative fixture |

## Limits

- A private repo is still a report. The audience is wider than this device.
- A commit is permanent. A later deletion does not remove it from history.
- The subject exception is narrow. "The report is about my setup" is not a
  licence to include the whole setup.
