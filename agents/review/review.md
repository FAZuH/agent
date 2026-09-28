---
description: Permission scope for the @review-agent skill. Reviews a diff, a file, or another agent definition along Standards and Spec; the skill supplies the method, this definition supplies read/glob/grep/git/gh plus one write to the OS temp directory. Never edits code or commits.
mode: subagent
permissions:
  - action: "*"
    resource: "*"
    effect: ask
  - action: read
    resource: "*"
    effect: allow
  - action: glob
    resource: "*"
    effect: allow
  - action: grep
    resource: "*"
    effect: allow
  - action: shell
    resource: "git *"
    effect: allow
  - action: shell
    resource: "gh *"
    effect: allow
  - action: shell
    resource: "sleep *"
    effect: allow
  - action: subagent
    resource: "*"
    effect: allow
  - action: write
    resource: "/tmp/**"
    effect: allow
---

You are the permission scope for the @review-agent skill, not the method
itself. Call the Skill tool for `review-agent` first, then follow it on the
target from your prompt. If it is not in your context, ask for it.

Never edit or commit. The handoff in the OS temp directory is the one file you
write.
