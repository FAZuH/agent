---
name: teach
description: Teach the user anything so it actually locks in and is understood, not just memorized. Use ANY time you're explaining or teaching him something, even a quick explanation. Built on two teaching principles he has personally verified over years.
---

# Teaching

Two principles for every explanation, one-liner to deep dive.

The goal is never "he can recite the fact." The goal is **understanding**:
the fact derivable from foundations he accepts, wired into his mental model,
self-preserving. Memorized facts rot. Understood ones persist.

## The philosophy (why this works: internalize it)

Two brains can answer identically while holding different structures: a pile
of **disconnected lone facts** (A) versus a few **core truths** the facts
derive from (B). That connection *is* understanding.

Connected knowledge beats disconnected: graph over lonely nodes, understanding over memorizing.

Understanding preserves and compresses knowledge. Every move below builds that
dependency graph in his head: **nodes** (Principle i), **edges** (Principle ii).

The felt goal is **the click**: lonely facts collapsing into a few generating
ideas. Aim for it.

A key mechanism: **the brain will not lock in a fact it is unsure is safe.**
A deeper contradiction later would force an expensive update, so it hedges and
the fact never lands. Both principles remove that risk differently.

## Principle i: Unconditional truths first

Start from the ground. Lock in the core, **always-true** unconditional truths before anything built on top of them.

Why start here? Not because bottom-up is the "correct" order, but because
unconditional truths are the *easiest* to lock in: safe, instant, first solid
ground. Most valuable on brand-new subjects with little to connect to yet.

**Terminology: keep these distinct, and do not overuse "axiom."** An *unconditional truth* is held **as-is, no caveats** (a property of holding). An *axiom* **follows from nothing** (a graph root, no incoming edges). They overlap, never synonyms: plenty of unconditional truths derive from deeper things without needing the derivation. Default to **"unconditional truth"**; reserve **"axiom"** for genuine bottom-outs, never as a fancy word for foundational.

- Find the few hard facts he can take at face value, often first principles, though they need not be true roots. Few is fine; small and solid beats large and shaky.
- Simple enough to accept **as-is, no nuance or caveats**. "Well, usually…" disqualifies it. Dig down further.
- Committed to *instantly and safely*: nothing deeper will contradict them. That safety is what locks them in.
- Build everything else up from these, explicitly, each new fact visibly resting on the foundation.

**Confirm the foundation first.** Each core truth must read as obviously true
to him before anything builds on it. Shaky: stop and fix it. Never build on
sand.

**Two especially strong forms of unconditional truth to reach for:**
- **Universal statements**: *"all X are Y"* or *"no X is Y"*. No exceptions to hedge against, so they lock in fast. The atomic-unit form (*"ALL X is done through {____}"*) is one strong special case: surface it where the domain has one, never force it.
- **Real definitions**: only actual definitions, never vague property lists dressed up as one. "Things that tend to be true of X" anchors nothing.

Don't force either where there isn't a clean one.

## Principle ii: "How could I have discovered this?"

Facts with no visible reason feel arbitrary, and the brain will not commit to
them. Make each one feel discovered, not decreed.

Walk him through how he **could have discovered the thing himself**. Every step must be *motivated*:

- Start from square one: **why are we even doing this?** What core problem sends us down this path?
- Motivate every intermediate step: why *this* formula, why manipulate *this* way, what could have led someone here?
- Output: **disconnected propositions → connected propositions**, edges added to the graph.

3Blue1Brown is the reference: nothing from nowhere, every move within the learner's reach.

### Socratic vs expository, adaptive

Choose per topic and per his apparent energy:
- **Socratic**: pose the motivating problem; he attempts the discovery before you reveal. Costlier, locks in harder. Default where he can plausibly reason there. "Attempt" is about *who* speaks first, not grading: a question with a definite right answer stays gradable, so pose it as a chat quiz (see *Quizzes*). Reserve the `question` tool for genuine no-right-answer forks (preferences, direction, what next).
- **Expository**: narrate the motivated path yourself (3B1B style), no back-and-forth. Use past cold-reasoning reach, or low energy.

When unsure, lean Socratic for things he can clearly reason about; otherwise narrate.

## The process: probe → plan → teach

The two principles are *how* you teach. This is *when*: three phases in order,
every time. Scale each phase's *size* to the topic, never its *shape*.

**Accuracy is non-negotiable.** One confident hallucination poisons his trust.
The moment you are unsure of any fact, name, date, formula, definition, or
claim, verify with a `research-synthesis` subagent before saying it. Accuracy
beats flow. If a check corrects you, say so plainly. A wrong root corrupts
every node above it.

### Quizzes: plain chat, never the answer in the asking

A quiz is a chat message: pose the question with numbered options, then **end
the turn**. No answer, verdict, or hint in the asking; the reveal waits for
your *next* message, after he answers (a number, the option, or "I don't
know"). Then grade against your stated correct answer (multi-select: the whole
set): verdict, correct answer, short explanation.

**Pacing is natural in chat:** the question is the pause. Nothing times out,
nothing submits by accident. If he wants to keep reading instead, he says so
and the check waits.

### Writing quiz options: a construction procedure (applies to every quiz)

Even options by construction, never post-hoc audit. A good answer plus
throwaway wrongs bakes the tell in before any check runs. **Build so evenness
is automatic**:

1. **Every option a bare claim, no justification.** Reasoning in the correct option ("…, because it preserves X") while distractors stand bare makes it longer and more specific. Zero "why" in any option; all reasoning waits for the grading message.
2. **Correct claim first, then mutate it into each distractor.** Take one misconception or easily-confused neighbour and state what its holder would claim, in the *same* skeleton, grain, and register. Parallelism falls out by construction instead of policing.
3. Each distractor must still be a real error he might actually make (so which one he picks is diagnostic), yet unambiguously wrong on the intended reading. Tempting, not tricky.
4. **No asymmetric bolding.** Don't bold the key concept in one option and not the others. Highlighting the term you're testing only in the correct answer flags it instantly. Either bold nothing, or bold the parallel term in every option.

If, reading the finished set cold, you can still tell which is right without knowing the material, you skipped step 1 or 2. Regenerate, don't patch.

### Phase 1: Probe (never skip this)

**Start from the record, not zero.** Read related lesson records first (*Lesson
records*): green nodes are floor (skip or one spot-check each), red
misconceptions under today's material get re-checked first, probing starts at
the recorded frontier. Spend questions only where no record answers.

Two unknowns, two tools, boundary kept clean:

**1a. His level, via chat quizzes: a mapping job, not a spot-check.** Locate
the *edge* per strand the lesson depends on. It takes as long as it takes. One
probe per message; the question ends the turn, his answer starts the next. Pace
to his energy.

**Bracket the edge.** Per strand you need *both*: something he gets **right**
(floor) and something he gets **wrong** or does not know (ceiling). One side
alone says almost nothing.

- **All-correct means too easy, not done.** Right answers with no miss give floor without ceiling: proven he knows *at least* this much, nothing about where it ends. Do not advance. Escalate until something breaks.
- **Binary-search the edge.** Nailed it: jump difficulty *sharply*, never inch. Missed it: the edge is bracketed from above, narrow back in. Fast frontier, no timid hundred questions.
- **One miss is not done, and never a cue to teach.** A single miss is one coordinate of unknown kind: slip, narrow gap, or systematic misconception. Probe *around* it first. Misconceptions matter most: a confidently-held wrong model gets dislodged, not topped up. Caught one: dig into its extent.
- **Map every strand the lesson rests on.** The edge is a frontier across threads, not a point. Probe each thread the explanation leans on, bounded by *relevance to the goal*.

Advance only when every goal-relevant strand has a stated floor and ceiling.
Nuance comes from many small graded questions adapted to each answer, never
one big caveated one. Pin the correct answer before learning his, to see
*exactly where* he goes wrong.

**1b. His goal, via the `question` tool.** Interrogate vague goals
("understand LLMs") until concrete; the reading changes everything taught. No
right answer exists, so `question` tool, never `quiz`.

### Phase 2: Plan (think hard here)

This step decides whether the rest works. With level and goal in hand, reason
out the best path for *this thing* to *this person*:

- **Scope the field with a `research-synthesis` subagent.** Before planning the graph, map the topic: core concepts, real first principles, standard framings, common gotchas. Cheap, and it keeps the plan off half-remembered versions while surfacing genuine unconditional truths.
- What are the unconditional truths this rests on? Is there a clean atomic unit ("ALL X is done through {____}")?
- Which of those does he already hold (from Phase 1a)? Build from there. Not below it, not above it.
- What's the motivated discovery path from those truths to his goal? Where does each step come from. Why would anyone reach for it?
- Socratic or expository per stretch, given topic and energy?

**Present the plan in chat, always, before any teaching.** Two parts:

1. **The approach, in prose.** What we'll cover, in what order, and why this way. Given where his edge sits (Phase 1a) and what he's reaching for (Phase 1b). A few freeform sentences.
2. **The dependency map.** The plan's backbone as a DAG: unconditional truths at the roots, each derived node hanging off what it depends on, his goal as the sink. Draw it as a small ```mermaid``` graph (Obsidian renders mermaid natively in the log). This map *is* the teaching order: Phase 3 builds it node by node. Keep it small: few nodes, short labels. A map, not the territory.
   **Color every node, and keep the colors true all session**: the current map is also his "where are we" instrument:
   - gray = untouched · yellow = current / in progress · green = verified (he passed the check) · red = misconception detected
   Start with everything gray except yellow on the first node, and re-draw the map each time a state changes:

   ```mermaid
   flowchart TD
       classDef untouched fill:#e5e7eb,stroke:#94a3b8,color:#334155
       classDef current fill:#fef08a,stroke:#ca8a04,color:#713f12
       classDef verified fill:#86efac,stroke:#16a34a,color:#052e16
       classDef wrong fill:#fca5a5,stroke:#dc2626,color:#450a0a

       A[unconditional truth]:::verified --> B[derived step]:::current
       B --> C[goal]:::untouched
       B -.-> X[holds a misconception]:::wrong
   ```

**Stress-test the roots before presenting.** Per foundational node: genuinely
unconditional *for him*, or a disguised theorem with a simpler face-value
parent? Derives: push down and extend. Never found on mid-level facts; roots
audit cheapest in the drawn map.

**Stop for his go-ahead.** Wrong roots and scopes fix cheap now, expensive
mid-lesson. No Phase 3 without his okay.

### Phase 3: Teach (the loop)

Build the graph one **node** at a time, same treatment for truths and derived
steps:

1. **Motivate.** Why this node, why now: what problem it solves, what gap it closes. Truths too: never bare-assert one.
2. **Establish.**
   - Foundational truth: state it plainly, at face value, no caveats. Surface an atomic unit where one fits.
   - Derived step: build from established nodes via a motivated move (Socratic or expository). A Socratic step with a gradable answer goes as a chat quiz; the `question` tool only where no right answer exists.
3. **Connect.** Show exactly how the node hangs off established ones: understood, not memorized.
4. **Quiz-check.** Close the turn with the check (chat-quiz format. Question now, verdict after he answers). Foundations count like derived steps: an unconfirmed truth is as dangerous as an unconfirmed derivation, so failing nodes stay provisional (yellow). Deferred: redraw yellow, continue, leave the check open.

Full loop per node, never front-load all foundations at the start. A mid-session
truth runs motivate → establish → connect → quiz-check like any derived step.

**The map is alive: recolor it, and edit it when reality disagrees.** After
every iteration, re-draw: checked → green, missed → red with the misconception
labeled, next → yellow. The DAG is a starting hypothesis, not a contract: a
missing prerequisite mid-loop is expected, not failure. Stop the node, insert
what sits beneath, stress-test newly exposed roots, redraw with colors kept,
resume. Removing or reordering on new evidence is fair game. Never plow past a
gap to keep the plan.

A fact he must take on faith: stop. Motivate and confirm it, or ground it in
established nodes. Unmotivated, unconfirmed facts never lock in.

## Lesson records: resolve the learn dir before persisting

Teaching leaves artifacts worth carrying forward, but persistence is opt-in.
**Resolve the learn dir before writing anywhere**: in order, stop at the first
hit:

1. **Declared**: the project's AGENTS.md declares a learn/lesson directory: use it.
2. **Discovered**: no declaration: `ls` the project root. If one directory looks like a learn dir (subject folders, PLAN.md / NOTES.md, lessons/…), ask him whether to save this subject's learn stuff there; his yes makes it the learn dir.
3. **None found**: ask whether to create the base template at a `teach/` dir in the project. On yes: scaffold `teach/` (`LEARNER.md`; subject dirs appear per the tree below as subjects start) and document it as the learn dir in AGENTS.md. Create AGENTS.md if missing.
4. Otherwise persist nothing. (If he asks mid-session to save something anyway, write wherever he points.)

Once a learn dir is resolved, keep one folder per subject under it, ordinally numbered:

```
<learn-dir>/
  LEARNER.md                    global learner profile (workspace-owned)
  0001-<subject-slug>/          NNNN = zero-padded ordinal; next = max existing + 1
    PLAN.md                     the subject graph. See boundaries below
    NOTES.md                    the learner record for this subject
    RESOURCES.md                sources used + candidate backlog
    assets/                     shared media for this subject. Subject-global only,
                                no per-lesson asset dirs
    lessons/
      0001-<lesson-slug>/       kebab slug of the sitting's topic; next = max existing + 1
        session.md              live log of one sitting (+ frontmatter `date: YYYY-MM-DD HH:mm`)
        quiz.md                 graded Q&A detail for that sitting
```

Dates live in frontmatter and dated section headers, never in filenames. Date-titled notes collide with his Obsidian daily notes.

**Create each file from the skeleton in this skill's `reference/<file>.template.md`; keep every heading verbatim after.** PLAN.md, NOTES.md, RESOURCES.md, quiz.md stay rigid; `session.md` narrative between title and `## Wrap-up` is free-form, and Wrap-up always closes the sitting.

**File boundaries, or content scatters back:**

- **`PLAN.md`**: the durable artifact, updated in place across sessions. Unconditional truths, strands table with status, the current **colored DAG**, open gaps not yet taught. Contains *no* prose about the learner: evidence lives elsewhere, cited by reference (`0002-badges q3 ✓`: lesson number + slug prefix + question id).
- **`NOTES.md`**: everything about him as a learner of this subject: misconception list (each entry states the wrong belief itself, never "missed Q3"), probe edge findings from Phase 1, protocol quirks and preferences.
- **`RESOURCES.md`**: sources actually used (with what each contributed) plus a backlog of candidates.
- **`lessons/<NNNN-slug>@session.md`**: today's live log: motivated and established nodes, sidetracks, status flips.
- **`lessons/<NNNN-slug>/quiz.md`**: per-question items: options, selection, his note, verdict, explanation.
- Media lives in `<subject>/assets/`, the subject's shared pool.

**New lesson dir?** New material or a planned major check, numbered `max+1`.
**Micro-sessions merge:** pure requizzes and patch follow-ups append to the
latest `quiz.md` under `## YYYY-MM-DD HH:mm: <label>`. A requiz turned
teaching promotes to a fresh dir; note the split in both.

**Distill at session end:** quiz verdicts → evidence refs in PLAN.md, misconception changes → NOTES.md, sources used → RESOURCES.md. The session.md stays as history.

Read-back: a later Phase 1 starts from PLAN.md + NOTES.md and the newest
session/quiz files, never re-probing mastered ground. His time is scarcest in
probing; records stop spending it.

## Formatting: math renders as LaTeX

Sessions render through Obsidian, which renders LaTeX natively. All math
notation (explanations, questions, options) goes in LaTeX, never plain-text
approximations:

- Inline math: `\(f(x)\)`
- Centered display math, always multiline:

$$
f(x)
$$

If LaTeX can be used, it should be. Write \(f(x) = x^2\), not `f(x) = x^2`.
