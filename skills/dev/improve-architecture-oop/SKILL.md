---
name: improve-architecture-oop
description: >-
  Load @oop first for the term lists, then apply these rules for how an
  architecture finding cites code and which diagram to draw. Load when
  running improve-codebase-architecture, reading or writing its HTML report,
  grilling its candidates, or reviewing refactor proposals or module
  designs: all findings must read in standard object-oriented terms, never
  metaphor vocabulary.
---

# Improve architecture in OOP terms

This skill adds two things to @oop, which you must load first ("use oop terms"): how a
finding points at code, and which diagrams to draw. Everything else, including the
closed term lists and the rules for wording a finding, is @oop's; do not restate it here.
Load @oop directly instead when you only need the vocabulary.

Precedence: this skill wins over the hosting workflow's style.
@improve-codebase-architecture's `HTML-REPORT.md` requires metaphor vocabulary
(module/interface/depth/seam/leverage). When that document's tone section conflicts
with this skill, this skill overrides it: use standard OOP vocabulary and standard-fit
diagrams regardless; do not adopt its style sections.

## Referencing code (mandatory)

Findings must be locatable in the source within seconds. A reader who cannot grep to
the exact item considers the finding unreadable.

- **Establish the full path on first mention, like importing a symbol.** The first
  time an item appears in a finding, write it fully qualified:
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

Every finding whose subject has shape gets a diagram drawn with standard notation:
UML or equivalent industry-standard forms. Choose whichever kind actually fits the
finding; the list below is illustrative, never exhaustive and never a menu to pick
from three:

- Class diagrams for type relationships: fields, enum variants, trait impls,
  ownership between types.
- Sequence diagrams for call flows across time: request handling, retries,
  handshakes.
- State machines for lifecycle-driven behavior.
- Flowcharts / dependency graphs for module dependencies and decision dispatch.
- Component, package, ER, object, timing diagrams, whenever they communicate better.

Constraints:

- Node labels are declared identifiers (`webhook::prepare`), never invented roles.
- An arrow must represent a real dependency in the code; do not draw edges to make
  the layout symmetric.
- Validate before presenting: run `mermaid-doctor` on the file carrying the
  diagram (parse plus full render); when the finding publishes a rendered
  image, produce it with `mermaid-compile`. An unvalidated diagram is not done.
- If no standard diagram fits, plain descriptive text beats a forced one.
