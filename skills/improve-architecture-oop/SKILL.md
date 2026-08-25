---
name: improve-architecture-oop
description: Standard OOP/architecture vocabulary for codebase analysis. Load whenever running improve-codebase-architecture, reading or writing its HTML report, grilling its candidates, reviewing refactor proposals or module designs, or doing any architecture deep-dive — all findings are described in standard object-oriented terms instead of metaphor vocabulary.
---

# Improve architecture in OOP terms

When this skill is loaded, every finding title, benefit statement, recommendation, and
diagram label uses standard object-oriented and software-architecture terminology.
Metaphor vocabulary — "deep/shallow module", "seam", "leverage", "locality", "deletion
test" — never appears in output. If a source document speaks in metaphors, restate its
points silently in standard terms; do not quote the metaphors back.

## Rules

- Lead each finding with the most specific applicable term from the list below.
- Do not coin new metaphor names. The list below is closed: if nothing fits exactly,
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
- If no standard diagram fits, plain descriptive text beats a forced one.

## Principles

- **Encapsulation / information hiding**: implementation details hidden behind a minimal interface.
- **Single Responsibility Principle (SRP)**: a module has exactly one reason to change.
- **Open/Closed Principle**: behavior extends by adding code, not editing existing code.
- **Liskov Substitution Principle**: subtypes are substitutable for their base types without surprises.
- **Interface Segregation Principle**: clients depend on small, specific interfaces rather than one general one.
- **Dependency Inversion Principle**: high-level policy depends on abstractions, not concretions.
- **Dependency Injection**: collaborators are supplied from outside rather than constructed internally.
- **High cohesion, low coupling**: related logic lives together; unrelated logic minimally connected.
- **Single source of truth**: each piece of knowledge is represented in exactly one place.
- **DRY (Don't Repeat Yourself)**: duplicated knowledge amplifies change — every copy must be edited in sync.
- **Separation of concerns**: distinct responsibilities live in distinct modules.
- **Law of Demeter**: an object talks only to its immediate collaborators, not to strangers reached through them.
- **Composition over inheritance**: behavior is assembled from parts instead of inherited hierarchies.
- **Tell, Don't Ask**: tell objects what to do instead of pulling their state out to decide for them.
- **Command–Query Separation**: operations either return data or mutate state, not both.
- **YAGNI**: no flexibility built before a concrete need exists.
- **KISS**: prefer the simplest structure that satisfies current requirements.
- **Principle of least surprise**: interfaces behave the way their names and shapes suggest.

## Structural smells

- **God object**: one class accumulates many unrelated responsibilities.
- **Feature envy**: a method reaches into another object's data more than its own.
- **Anemic domain model**: data holders with no behavior; logic lives in external services.
- **Primitive obsession**: domain concepts modeled as bare strings/ints instead of types.
- **Data clump**: fields that always travel together but form no named abstraction.
- **Shotgun surgery**: one conceptual change requires edits across many modules.
- **Divergent change**: one module changes for many unrelated reasons.
- **Speculative generality**: hooks and parameters with no current user.
- **Leaky abstraction**: an abstraction exposes details it was supposed to hide.
- **Inappropriate intimacy**: modules know each other's internals.
- **Temporal coupling**: correctness depends on methods being called in a specific order.
- **Circular dependency**: modules depend on each other in a cycle; none can change or test alone.

## Boundaries & patterns

- **Layer violation**: a dependency points the wrong way across architectural layers.
- **Acyclic Dependencies Principle**: the dependency graph of modules has no cycles.
- **Stable-dependencies principle**: depend toward stable, away from volatile modules.
- **Port** (hexagonal): an interface owned by the core through which the outside world plugs in.
- **Adapter**: translates between incompatible interfaces at a boundary.
- **Facade**: a simplified front over a subsystem's complexity.
- **Repository**: a collection-like interface over persistence.
- **Strategy**: polymorphic dispatch replaces branching on type or mode.
- **Decorator**: behavior added by wrapping rather than subclassing.
- **Pub/sub decoupling**: producers and consumers connected through events, not direct calls.

## Testability & metrics

- **Test through the public API**: tests exercise the interface, never internals — internals may then change freely.
- **Injection point**: a replaceable collaborator enabling test doubles.
- **Hidden dependency**: a collaborator obtained internally, impossible to substitute in tests.
- **Test double**: stand-in implementation used to isolate the unit under test.
- **Cyclomatic complexity**: branch count as a size proxy for a unit.
- **Change amplification**: how many edits one concept-change costs — the inverse of DRY payoff.
