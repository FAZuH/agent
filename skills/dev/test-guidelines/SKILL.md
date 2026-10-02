---
name: test-guidelines
description: >-
  Write, review, or critique unit and integration tests: falsifiability,
  isolation, determinism, AAA structure, the Meszaros doubles taxonomy,
  mocking rules, anti-patterns, and coverage. Use whenever the user asks
  about tests, testing strategy, TDD, coverage, assertions, mocks, stubs, or
  fixtures, and for "flaky tests", "mutation testing", or "property-based
  testing". Do NOT write tests blindly: consult these guidelines and
  reference them. For GUI, browser, or native-desktop tests load
  @gui-test-guidelines.
---

# Test Writing Guidelines

When invoked, you MUST:

1. **Reference these guidelines explicitly** (e.g., "Per the test writing guidelines, a test must be falsifiable...")
2. **Apply them to the task**: new tests, reviews, strategy
3. **Quote relevant rules**, not summaries

## Foundational Validity
- **A test must be falsifiable.** If no plausible code change could make it fail, it is not a test, it is dead code. Delete it.
- **Write the test before the fix.** When a bug is found, the first commit is a failing test that reproduces it. If you cannot write one, you do not understand the bug.
- **A unit is a behavior, not a method.** Tests target the public-facing ports or interfaces of a system. Never test private methods or internal implementation details directly. If a test breaks when you rename a private method or restructure an internal loop without changing behavior, the test is wrong.
- **Test error paths, not just happy paths.** Every branch that can fail (invalid input, missing state, error responses, edge cases) requires a test. Untested branches are untested code.

## The Trilemma (Know the Tradeoffs)
Three properties, never all maximized at once:
- **Protection against regressions**: how much real code does it execute?
- **Resistance to refactoring**: does it break when behavior is unchanged but internals change?
- **Fast feedback**: how quickly does it run?

An E2E test maximizes the first two and sacrifices the third. A heavily mocked unit test inverts that. Balance consciously; name the pillar you trade away.

## What Disqualifies a Unit Test
Per Feathers, a test is categorically *not* a unit test if it:
- Talks to a database (relational or otherwise)
- Communicates across a network or over out-of-process boundaries
- Touches the filesystem
- Cannot run correctly at the same time as any other test (shared mutable state)
- Requires environment changes (config file edits, env vars set externally) to run

Tests that violate these are integration tests: separate suite, separate performance budget, separate CI stage.

## Isolation & Determinism
- **Tests must not share state.** No global variables, no singleton mutation, no shared DB rows. Each test sets up and tears down its own world.
- **Tests must not depend on execution order.** Any test must pass in isolation and in any order. If B requires A first, they are one test.
- **Eliminate non-determinism.** Clocks, RNGs, network: inject, seed, stub at the boundary. A flaky test is worse than none; it trains the team to ignore failures.

## Measurement validity
- **A measurement must be falsifiable.** If no plausible change could flip the result, it is not a measurement. A number with no baseline, no error bar, and no named knob is an anecdote.
- **Hold every input constant across an A/B.** Vary exactly one knob and name it in the write-up. Any other difference invalidates the comparison, including build state and cache state.
- **Verify the run measured what you think it measured.** Changing an env var that reaches the compiler (`CARGO_INCREMENTAL`, `RUSTFLAGS`, `CARGO_PROFILE_*`) flips codegen flags and dirties build fingerprints, so the next run rebuilds the whole dependency graph. A cold full build then gets reported as a single-crate number. Check whether a full rebuild happened before quoting any timing.
- **State warm or cold.** Cold-build and warm-build figures are not comparable, and neither is comparable to an incremental one.

## Structure
- **One concept per test.** Assert one logical thing. Multiple unrelated assertions in a single test obscure which behavior failed.
- **Use Arrange-Act-Assert (AAA) / Given-When-Then.** Setup, execute, assert. Keep phases minimal and separated.
- **No logic in tests.** `if`, `for`, `while`, `switch`, `try/catch`, random generators in a test body are a smell. The test becomes its own bug surface. Use parameterized or table-driven tests instead of loops.
- **Prefer DAMP over DRY in tests.** Duplication is tolerable when it keeps a test readable and self-contained. Shared setup abstractions cost more readability than they save repetition. Inline what the reader needs.
- **Name tests as executable specifications.** `returns_empty_list_when_no_matching_items`, not `test1`. A failing name identifies the break without reading the body.

## Test Doubles: Use the Right Tool
Use the Meszaros taxonomy precisely:
- **Dummy**: passed to satisfy a signature, never actually invoked. Use when the parameter is irrelevant to the test.
- **Stub**: returns a pre-configured value to control the SUT's control flow. Does not assert anything itself.
- **Spy**: a stub that also records interactions (call count, arguments). Use when you need to verify a side effect without a full mock.
- **Mock**: pre-programmed with expectations; fails the test if not called exactly as specified. Use sparingly, only at true boundaries.
- **Fake**: a lightweight real implementation (in-memory database, fake filesystem). High trust, higher maintenance cost.

Prefer state verification (asserting what the SUT returned or what state changed) over behavior verification (asserting that specific calls were made). Behavior verification ties tests to implementation.

## Mocking Rules
- **Only mock at true external boundaries:** network, filesystem, third-party services, time, external databases. Do not mock internal collaborators or domain objects.
- **Do not mock what you don't own.** Never mock third-party libraries, vendor APIs, or framework internals. Upgrades break production while mocked tests stay green. Wrap third-party code behind an interface you own, mock the wrapper, verify the wrapper with narrow integration tests.
- **Prefer real objects over mocks** wherever Feathers' constraints permit. Real objects test actual behavior; mocks test that you set up the mock correctly.

## Data
- **Use realistic test data.** `"foo"`, `"test"`, `id=1` hide bugs that appear with real inputs: unicode, empty strings, negative numbers, max values, special characters. Use data that resembles what production will send.
- **Test boundary values explicitly.** Zero, negative, empty string, null, max integer, empty collection; this is where bugs live.
- **Do not use production data in tests.** It is a privacy violation, it makes tests environment-dependent, and it will eventually be unavailable.
- **Avoid the General Fixture.** Do not create a single massive shared setup object for all tests. Initialize only what the specific test needs. Excess fixture setup obscures the causal link between Given and Then.

## Anti-Patterns: Named and Defined
- **Tautological Test / Ugly Mirror**: the test replicates the production logic line for line, so it passes whether or not the logic is correct. Verify output against independently computed expected values, not re-derived ones.
- **Assertion Roulette**: multiple unrelated assertions in one test with no distinct messages. When it goes red, you cannot tell which assertion failed without debugging. One concept per test.
- **Erratic Test (Flaky)**: passes and fails intermittently. Timing, shared mutable state, uncontrolled external resources. Fix or delete; do not retry.
- **Fragile Fixture**: breaks on unrelated data or environmental changes. Coupled to too much context.
- **Overspecified Test**: mocks a dependency, dictates what it returns, then asserts the SUT returned that same value. This verifies only that the mocking framework works.
- **Logic in Tests**: conditional or dynamic code (`if`, `for`, `try/catch`) in the test body. The test itself becomes a bug surface. Use parameterized tests.
- **Line Hitter**: written to hit coverage numbers, not verify behavior. Zero behavioral guarantees.
- **Literal Value Confusion**: unexplained constants where readers cannot tell inputs relevant to the assertion from dummy values that only satisfy the compiler.

## Integration Tests
- **Integration tests must test real integrations.** If you mock the database in an integration test, it is not an integration test.
- **Integrated tests (cross-service) have combinatorial explosion problems.** Two services with N behaviors each need N² tests for full permutation coverage. Use collaboration tests (how a client calls a dependency) plus contract tests (the dependency behaves as assumed) separately.
- **Integration tests own their data.** Each test seeds what it needs and cleans up after. Never assume the environment is in a known state.

## Coverage
- **Coverage is not correctness.** A test that executes every line but asserts nothing will reach 100% coverage. High coverage is a necessary condition for a good suite, not a sufficient one.
- **Low coverage is a reliable signal** of an under-tested codebase. High coverage is not a reliable signal of an effective one. (Inozemtseva & Holmes, ICSE 2014: coverage is not strongly correlated with test suite effectiveness when suite size is controlled for.)
- **Do not write tests to hit a coverage number.** Write tests to specify behavior.
- **Mutation testing is the superior metric** when precision matters. Mutants (e.g., `>` to `>=`, flipped booleans) run against the suite; a survivor means a behavioral gap. Expensive, so run periodically, not per commit.

## Advanced
- **Property-based testing complements example-based testing.** Define invariants for all inputs (sorting is idempotent, double-reverse returns the original). Let a generator find counter-examples. Use for algorithms, transformations, state machines, serialization round-trips: where human examples systematically miss edges.
- **Characterization tests for legacy code.** Capture current behavior (even if wrong) before changing anything. Safety net first; correctness after.
