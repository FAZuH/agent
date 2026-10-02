---
name: oop
description: >-
  Standard OOP and software-architecture vocabulary: principles, smells,
  patterns, and metrics. Use when you want findings, reviews, or design
  discussions phrased in standard OOP terms (use oop terms, SRP,
  encapsulation, dependency inversion, god object, etc.) instead of metaphor
  vocabulary.
---

# OOP vocabulary

Loaded: every finding title, benefit, recommendation, and diagram label uses the terms below. Never metaphor vocabulary ("deep/shallow module", "seam", "leverage", "locality", "deletion test"). Restate metaphor-speaking sources silently in standard terms; never quote them back.

## Rules

- Lead each finding with the most specific term below.
- Never coin metaphors. The lists are closed: no exact fit means plain descriptive language ("this class mixes parsing and persistence"), never a new coinage.
- Language only: wording changes, work does not.

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
- **DRY (Don't Repeat Yourself)**: duplicated knowledge amplifies change, so every copy must be edited in sync.
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

- **Test through the public API**: tests exercise the interface, never internals, so internals may change freely.
- **Injection point**: a replaceable collaborator enabling test doubles.
- **Hidden dependency**: a collaborator obtained internally, impossible to substitute in tests.
- **Test double**: stand-in implementation used to isolate the unit under test.
- **Cyclomatic complexity**: branch count as a size proxy for a unit.
- **Change amplification**: how many edits one concept-change costs, the inverse of DRY payoff.
