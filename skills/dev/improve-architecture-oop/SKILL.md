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

Load @oop first. This skill adds two things: how a finding points at code, and which diagrams to draw. Everything else is @oop's; do not restate it. Need only vocabulary: load @oop instead.

Precedence: this skill beats the hosting workflow's style. Against @improve-codebase-architecture's `HTML-REPORT.md` metaphor vocabulary, use OOP terms and standard-fit diagrams regardless.

## Referencing code (mandatory)

Findings must be greppable to the exact item within seconds.

- **Establish the full path on first mention, like importing a symbol.** First
  appearance is fully qualified:
  `pwr_viewgen::model::ParsedMessage`, `pwr_ext::components::SelectKindDe`. Short names after that within the finding.
- **Name declared items, never roles.** Write `webhook::send`,
  `server::parse_message`. Never "the payload twin", "the front door", "one home for
  the rule", "the gate owner". If you cannot name the identifier, you have not
  finished the analysis.
- **Cite every claim**: `path/file.rs:LINE` beside the statement it supports. Verify
  line numbers against the working tree before publishing.
- **Quote the problem site.** Each finding carries a ≤10-line verbatim excerpt (signature plus the lines that hurt). Prose refers back to it.
- **Show the proposed signature**, not a paraphrase: exact before/after signature in the implementation language.

## Diagrams (standard, fit-for-purpose)

Every finding whose subject has shape gets a standard-notation diagram (UML or equivalent). Pick what fits; the list is illustrative, never a menu:

- Class diagrams for type relationships: fields, enum variants, trait impls,
  ownership between types.
- Sequence diagrams for call flows across time: request handling, retries,
  handshakes.
- State machines for lifecycle-driven behavior.
- Flowcharts / dependency graphs for module dependencies and decision dispatch.
- Component, package, ER, object, timing diagrams, whenever they communicate better.

Constraints:

- Node labels are declared identifiers (`webhook::prepare`), never invented roles.
- An arrow is a real code dependency; never draw edges for symmetry.
- Validate before presenting: `mermaid-doctor` on the carrying file (parse plus full render); rendered images via `mermaid-compile`. Unvalidated is unfinished.
- No fitting standard diagram: plain text beats a forced one.
