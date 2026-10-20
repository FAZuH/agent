# Parallel lanes

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Gates* section at the
> bottom.

## When to use

The work decomposes into two or more units that touch different files, and no
unit needs another unit's result to start.

## State machine

```
START (work decomposes into N independent units)
  → SCOPE     name each lane and the files it may write
  → SPLIT     separate the lanes from the shared files
  → DISPATCH  one worker per lane, all in flight
  → GATE      a shared file: predecessor's deliverable + binding check
  → COLLECT   read each lane's report
  → MERGE     reconcile lanes that landed in one tree
  → VERIFY    checks once, after the lanes land
  → DONE
```

## Steps

| # | State | Owner | Action |
|---|---|---|---|
| 1 | SCOPE | you | Name each lane and the files it may write. |
| 2 | SPLIT | you | A file two lanes need is a shared file: it leaves the lanes and becomes a chain. |
| 3 | DISPATCH | you | One worker per lane, all in flight. Each brief names its scope, its deliverable, and its run mode. |
| 4 | GATE | you | Hold a lane that needs a shared file until the predecessor's deliverable exists and the binding check passes. |
| 5 | COLLECT | you | Read each lane's report. A lane whose scope narrowed stops and reports; you re-scope it. |
| 6 | MERGE | you | Reconcile lanes that landed in one tree. |
| 7 | VERIFY | you | Run the checks once, after the lanes land. |

## Dependency graph

- lanes are independent of each other
- a shared file is a chain: `link1 -> link2 -> link3`
- the chain has no cycles, and its last link waits on a link that still exists
- every lane's own checks run before the batch's checks

## Four rules

**1. One writer per file.** A lane's scope is a file set. Two lanes whose
scopes intersect are not parallel lanes: serialise them.

**2. A file several lanes need is a chain, not a fan-out.** Give it a total
order. The order is a DAG with no cycles, and the last link waits on a link
that still exists. A link waiting on a superseded link has no gate that can
open: the lane holding it either waits forever or proceeds on a guess.

**3. A shared file's gate has two conditions.** The predecessor's deliverable
exists on disk, AND a binding check passes (the pristine and the working file
agree, or whatever binding the project uses). **Re-check the binding
immediately before the write**: a lane that waited may have been overtaken
while it waited.

**4. A tool that restores source writes.** A mutation gate that restores the
file from a pristine lands on whatever is in the tree when it runs, so it is a
write. Run it when the binding holds.

## A lane keeps one session

A lane keeps one session for its whole life: the next ticket in the same lane
resumes that session, which already holds the codebase map, the lane's
conventions, and the lane's earlier measurements. **A lane's session is the
cheapest warm context available**: a fresh spawn re-learns the codebase and
re-reads the task from zero.

Resume a lane's session when the next task continues the same unit of work, or
follows up on that lane's own report. **A long-resumed child can come back as
`Subagent completed without a text response`: check the tree against the base
commit before believing it.** A child that changed files is alive and its
report was lost; resume it with a delta brief. Confirm a session id against
the API before concluding it is gone; a stale id in a note reads as a dead
session. Spawn fresh when the id no longer resolves, or when the work is
unrelated.

**On a resume, re-POST the model.** A session that died on a provider or
free-tier error resumes cleanly on a different model; one carrying the failing
model dies again. A cold spawn omits the model field; a resume re-states it.

## Lanes in different trees

When lanes land in different copies of the tree, reconcile by common prefix:
take the shared prefix, then each side's remainder, in that order. **A blind
overwrite drops the other side's work.** Report any file whose versions
disagree on more than half their content as a conflict and leave it for a
human. Append-only logs merge by concatenation, and the tree points at which
log is the record.

## Reviews beside writers

A read-only review of a lane's output runs after that lane lands. A review of
finished work runs beside the remaining lanes. Several small tickets can
share one reviewer: one review, one verdict and one fix list per ticket, each
independent of the others.

## Gates

- A lane starts only when its scope is disjoint from every other lane's scope.
- A shared file is written by one lane at a time, in the chain's order.
- The binding check runs again immediately before the write, not only at
  dispatch.
- Checks run after the lanes land, unless a lane's own check is its
  deliverable.
- A lane that discovers its scope was narrowed stops and reports; the
  orchestrator re-scopes it.
