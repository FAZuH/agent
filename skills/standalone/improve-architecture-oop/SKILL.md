---
name: improve-architecture-oop
description: Standard OOP/architecture vocabulary for codebase analysis — loads `oop` for terminology. Load whenever running improve-codebase-architecture, reading or writing its HTML report, grilling its candidates, reviewing refactor proposals or module designs, or doing any architecture deep-dive — all findings are described in standard object-oriented terms instead of metaphor vocabulary.
---

# Improve architecture in OOP terms

This skill loads the `oop` skill for its vocabulary. If you only need OOP terms without the report workflow, load `oop` directly ("use oop terms — read @oop").

When this skill is loaded, every finding title, benefit statement, recommendation, and
diagram label uses standard object-oriented and software-architecture terminology
(from `oop`). Metaphor vocabulary — "deep/shallow module", "seam", "leverage",
"locality", "deletion test" — never appears in output. If a source document speaks in
metaphors, restate its points silently in standard terms; do not quote the metaphors
back.

Precedence — this skill wins over the hosting workflow's style.
`improve-codebase-architecture`'s `HTML-REPORT.md` requires metaphor vocabulary
(module/interface/depth/seam/leverage). When that document's tone section conflicts
with this skill, this skill overrides it: use standard OOP vocabulary and standard-fit
diagrams regardless; do not adopt its style sections.

## Rules

- Lead each finding with the most specific applicable term from `oop`.
- Do not coin new metaphor names. The `oop` lists are closed: if nothing fits exactly,
  use plain descriptive language ("this class mixes parsing and persistence"), never a
  new coinage.
- Language only. The hosting workflow's steps remain authoritative — this skill changes
  how findings are worded, not what work is done.

## Referencing code (mandatory)

Findings must be locatable in the source within seconds. A reader who cannot grep to
the exact item considers the finding unreadable.

- **Establish the full path on first mention, like importing a symbol.** The first
  time an item appears in a finding, write it fully qualified —
  `pwr_viewgen::model::ParsedMessage`, `pwr_ext::components::SelectKindDe`. After that
  first establishment, the short name (`ParsedMessage`, `SelectKindDe`) is correct
  everywhere within that finding.
- **Name declared items, never roles.** Write `webhook::send`,
  `server::parse_message`. Never "the payload twin", "the front door", "one home for
  the rule", "the gate owner". If you cannot name the identifier, you have not
  finished the analysis.
- **Cite every claim**: `path/file.rs:LINE` beside the statement it supports. Verify
  line numbers against the current working tree before publishing.
- **Quote the problem site.** Each finding carries a ≤10-line verbatim excerpt of the
  actual offending code (signature plus the lines that hurt). The excerpt is the
  finding's anchor; prose refers back to it.
- **Show the proposed signature**, not a paraphrase: when the solution changes an
  interface, print the exact before/after signature in the implementation language.

## Diagrams (standard, fit-for-purpose)

Every finding whose subject has shape gets a diagram drawn with standard notation —
UML or equivalent industry-standard forms. Choose whichever kind actually fits the
finding; the list below is illustrative, never exhaustive and never a menu to pick
from three:

- Class diagrams for type relationships: fields, enum variants, trait impls,
  ownership between types.
- Sequence diagrams for call flows across time: request handling, retries,
  handshakes.
- State machines for lifecycle-driven behavior.
- Flowcharts / dependency graphs for module dependencies and decision dispatch.
- Component, package, ER, object, timing diagrams — whenever they communicate better.

Constraints:

- Node labels are declared identifiers (`webhook::prepare`), never invented roles.
- An arrow must represent a real dependency in the code; do not draw edges to make
  the layout symmetric.
- Validate before presenting: run `mermaid-doctor` on the file carrying the
  diagram (parse plus full render); when the finding publishes a rendered
  image, produce it with `mermaid-compile`. An unvalidated diagram is not done.
- If no standard diagram fits, plain descriptive text beats a forced one.

## Vocabulary

See the `oop` skill for the closed term lists, definitions, and usage guidance (Principles, Structural smells, Boundaries & patterns, Testability & metrics). Load it with: Skill tool → `oop`.
