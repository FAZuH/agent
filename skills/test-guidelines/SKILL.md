---
name: test-guidelines
description: >-
  Comprehensive test writing guidelines covering foundational validity,
  isolation, determinism, structure, test doubles, mocking rules, anti-patterns,
  integration tests, and coverage philosophy. Use this skill whenever the user
  asks to write, review, critique, or discuss tests — including unit tests,
  integration tests, test quality, testing strategy, TDD, coverage, assertions,
  mocking, stubs, fixtures, and test structure. Also trigger when the user talks
  about "test-driven development", "testing patterns", "test bugs", "flaky
  tests", "mutation testing", "property-based testing", "characterization
  tests", "test doubles", or any testing terminology. Do NOT just write tests
  blindly — consult these guidelines first and explicitly reference them in your
  response.
---

# Test Writing Guidelines

This skill contains authoritative test writing guidelines. When invoked, you MUST:

1. **Reference these guidelines explicitly** in your response (e.g., "Per the test writing guidelines, a test must be falsifiable...")
2. **Apply them to whatever testing task the user has** — whether writing new tests, reviewing existing ones, or discussing strategy
3. **Quote relevant rules** rather than just summarizing

## Foundational Validity
- **A test must be falsifiable.** If no plausible code change could make it fail, it is not a test — it is dead code. Delete it.
- **Write the test before the fix.** When a bug is found, the first commit is a failing test that reproduces it. If you cannot write one, you do not understand the bug.
- **A unit is a behavior, not a method.** Tests target the public-facing ports or interfaces of a system. Never test private methods or internal implementation details directly. If a test breaks when you rename a private method or restructure an internal loop without changing behavior, the test is wrong.
- **Test error paths, not just happy paths.** Every branch that can fail — invalid input, missing state, error responses, edge cases — requires a test. Untested branches are untested code.

## The Trilemma (Know the Tradeoffs)
Every test lives on a spectrum defined by three properties that cannot all be maximized simultaneously:
- **Protection against regressions** — how much real code does it execute?
- **Resistance to refactoring** — does it break when behavior is unchanged but internals change?
- **Fast feedback** — how quickly does it run?

An E2E test maximizes the first two and sacrifices the third. A heavily mocked unit test maximizes the third but destroys the second. A good suite balances these consciously rather than defaulting to one extreme. Know which pillar you are trading against when you make a structural decision.

## What Disqualifies a Unit Test
Per Feathers, a test is categorically *not* a unit test if it:
- Talks to a database (relational or otherwise)
- Communicates across a network or over out-of-process boundaries
- Touches the filesystem
- Cannot run correctly at the same time as any other test (shared mutable state)
- Requires environment changes (config file edits, env vars set externally) to run

Tests that violate these are integration tests. Label and treat them as such — separate suite, separate performance budget, separate CI stage.

## Isolation & Determinism
- **Tests must not share state.** No global variables, no singleton mutation, no shared DB rows. Each test sets up and tears down its own world.
- **Tests must not depend on execution order.** Any test must pass in isolation and in any order. If B requires A first, they are one test.
- **Eliminate non-determinism.** Wall clock time, random numbers, and network calls make tests flaky. Inject clocks, seed RNGs, stub or stub at the boundary. A flaky test is worse than no test — it erodes trust in the entire suite until failures are ignored.

## Structure
- **One concept per test.** Assert one logical thing. Multiple unrelated assertions in a single test obscure which behavior failed.
- **Use Arrange-Act-Assert (AAA) / Given-When-Then.** Set up preconditions, execute the single behavior, assert the outcome. Keep each phase minimal and clearly separated.
- **No logic in tests.** `if`, `for`, `while`, `switch`, `try/catch`, random generators inside a test body are a smell. Logic in tests means the tests themselves can have bugs. Use parameterized or table-driven tests instead of loops.
- **Prefer DAMP over DRY in tests.** Tests tolerate a degree of duplication if it makes the test readable and self-contained. Complex inheritance hierarchies and shared setup abstractions in test code reduce readability more than they reduce repetition. Inline what the reader needs to understand the test.
- **Name tests as executable specifications.** The name should read as a sentence: `returns_empty_list_when_no_matching_items`, not `test1` or `testFilter`. A failing test name should identify what broke without reading the body.

## Test Doubles — Use the Right Tool
Use the Meszaros taxonomy precisely:
- **Dummy**: passed to satisfy a signature, never actually invoked. Use when the parameter is irrelevant to the test.
- **Stub**: returns a pre-configured value to control the SUT's control flow. Does not assert anything itself.
- **Spy**: a stub that also records interactions (call count, arguments). Use when you need to verify a side effect without a full mock.
- **Mock**: pre-programmed with expectations; fails the test if not called exactly as specified. Use sparingly — only at true boundaries.
- **Fake**: a lightweight real implementation (in-memory database, fake filesystem). High trust, higher maintenance cost.

Prefer state verification (asserting what the SUT returned or what state changed) over behavior verification (asserting that specific calls were made). Behavior verification ties tests to implementation.

## Mocking Rules
- **Only mock at true external boundaries:** network, filesystem, third-party services, time, external databases. Do not mock internal collaborators or domain objects.
- **Do not mock what you don't own.** Never mock third-party libraries, external vendor APIs, or framework internals. When a framework upgrades and its behavior changes, mocked tests will stay green while production breaks. Instead, wrap third-party code behind an interface you own, and mock the wrapper. Verify the wrapper with narrow integration tests.
- **Prefer real objects over mocks** wherever Feathers' constraints permit. Real objects test actual behavior; mocks test that you set up the mock correctly.

## Data
- **Use realistic test data.** `"foo"`, `"test"`, `id=1` hide bugs that appear with real inputs — unicode, empty strings, negative numbers, max values, special characters. Use data that resembles what production will send.
- **Test boundary values explicitly.** Zero, negative, empty string, null, max integer, empty collection — this is where bugs live.
- **Do not use production data in tests.** It is a privacy violation, it makes tests environment-dependent, and it will eventually be unavailable.
- **Avoid the General Fixture.** Do not create a single massive shared setup object for all tests. Initialize only what the specific test needs. Excess fixture setup obscures the causal link between Given and Then.

## Anti-Patterns — Named and Defined
- **Tautological Test / Ugly Mirror**: the test replicates the production logic line for line, so it passes whether or not the logic is correct. Verify output against independently computed expected values, not re-derived ones.
- **Assertion Roulette**: multiple unrelated assertions in one test with no distinct messages. When it goes red, you cannot tell which assertion failed without debugging. One concept per test.
- **Erratic Test (Flaky)**: passes and fails intermittently. Caused by timing dependencies, shared mutable state, or uncontrolled external resources. Fix or delete; do not retry.
- **Fragile Fixture**: test breaks due to unrelated data or environmental changes. The test is coupled to too much context.
- **Overspecified Test**: mocks a dependency, dictates what it returns, then asserts the SUT returned that same value. This verifies only that the mocking framework works.
- **Logic in Tests**: conditional or dynamic code (`if`, `for`, `try/catch`) in the test body. The test itself becomes a bug surface. Use parameterized tests.
- **Line Hitter**: a test written to hit coverage numbers, not to verify behavior. Initializes objects in invalid states to execute lines and catch exceptions. Produces zero behavioral guarantees.
- **Literal Value Confusion**: tests filled with unexplained constants where readers cannot distinguish inputs relevant to the assertion from dummy values that only satisfy compiler requirements.

## Integration Tests
- **Integration tests must test real integrations.** If you mock the database in an integration test, it is not an integration test.
- **Integrated tests (cross-service) have combinatorial explosion problems.** Two services with N behaviors each require N² integrated tests for full permutation coverage. Instead, use collaboration tests (verifying how a client calls a dependency) plus contract tests (verifying the dependency actually behaves as assumed) separately.
- **Integration tests own their data.** Each test seeds what it needs and cleans up after. Never assume the environment is in a known state.

## Coverage
- **Coverage is not correctness.** A test that executes every line but asserts nothing will reach 100% coverage. High coverage is a necessary condition for a good suite, not a sufficient one.
- **Low coverage is a reliable signal** of an under-tested codebase. High coverage is not a reliable signal of an effective one. (Inozemtseva & Holmes, ICSE 2014: coverage is not strongly correlated with test suite effectiveness when suite size is controlled for.)
- **Do not write tests to hit a coverage number.** Write tests to specify behavior.
- **Mutation testing is the superior metric** when precision matters. Generate mutants (e.g., change `>` to `>=`, flip a boolean), run the suite against them. A surviving mutant means the suite has a gap in behavioral coverage. Mutation score is computationally expensive — run it periodically, not on every commit.

## Advanced
- **Property-based testing complements example-based testing.** Instead of fixed inputs, define invariants that must hold for all inputs (e.g., sorting is idempotent, reversing twice returns the original). Let a generator find counter-examples. Use it for algorithms, data transformations, state machines, and serialization round-trips — places where human-chosen examples systematically miss edge cases.
- **Characterization tests for legacy code.** When working with untested code, write tests that capture the current behavior (even if wrong) before changing anything. This gives you a safety net to refactor toward the correct behavior. The goal is to get the code under test first; perfection comes after.
