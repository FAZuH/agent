## [0.8.3](https://github.com/FAZuH/agent/compare/v0.8.2...v0.8.3) (2026-09-05)

## [0.8.2](https://github.com/FAZuH/agent/compare/v0.8.1...v0.8.2) (2026-09-05)


### Bug Fixes

* **plugin:** bound quiz_ask form polling (1s interval, abort-aware, 404-terminal, 15s api timeout) ([77ceaa7](https://github.com/FAZuH/agent/commit/77ceaa7e4e55530ea87a3451d3a4e3ebe4271193))
* **plugin:** replace dropped Plugin.define helper with plain {id, setup} module ([9eb4b75](https://github.com/FAZuH/agent/commit/9eb4b7571789722e85aeda70cfa8b8cf60a9fc40))
* **plugin:** single md-link poller per process via globalThis guard ([916833c](https://github.com/FAZuH/agent/commit/916833cd8ff368b799c8f5582d286435c9b31a8c))

## [0.8.1](https://github.com/FAZuH/agent/compare/v0.8.0...v0.8.1) (2026-09-04)


### Bug Fixes

* **plugin:** add root tui.ts entrypoints for beta-19086 local dir discovery ([6a87111](https://github.com/FAZuH/agent/commit/6a87111d35c5f478c69255cd03c9c3d7033b4894))

## [0.8.0](https://github.com/FAZuH/agent/compare/v0.7.3...v0.8.0) (2026-09-04)


### Features

* **agent:** prefer forkflow for warm per-ticket delegation ([00f183e](https://github.com/FAZuH/agent/commit/00f183e234b1dc7303de0e9c9e1d96032fd6cc6d))
* **agent:** route orchestrator through task-context and docs/dev ([968d433](https://github.com/FAZuH/agent/commit/968d433cb31cd81bc26744c808a432e0aa02de23))
* **skill:** add context and docs routing to the workflows table ([d10ea4d](https://github.com/FAZuH/agent/commit/d10ea4d65bde50a7737a4b0beba5ff00620108d4))
* **skill:** add forkflow warm-delegation skill ([8d44026](https://github.com/FAZuH/agent/commit/8d44026080e3048a80265a4f473f41b222b025f9))
* **skill:** add setup-dev-docs for durable docs/dev/ ([a3eecf6](https://github.com/FAZuH/agent/commit/a3eecf612bfc39b4c819c370b9d1e46aba465849))
* **skill:** add task-context per-ticket context packets ([f71efa1](https://github.com/FAZuH/agent/commit/f71efa10e7c0e83dd02fc1f5c015a52952200a48))
* **skill:** route feature workflow through forkflow ([2f30c2e](https://github.com/FAZuH/agent/commit/2f30c2e9b4b744f231bac3b546d666499e56f727))


### Bug Fixes

* **skill:** record v2 fork findings and poll outcomes when wait is unavailable ([f051767](https://github.com/FAZuH/agent/commit/f051767349cee37ada800f7aa53f12243b6c6a16))
* **skill:** un-backtick cross-references so the relation graph captures them ([ada6c8e](https://github.com/FAZuH/agent/commit/ada6c8ecda90309363d19edffca0bac8bc28ea1a))

## [0.7.3](https://github.com/FAZuH/agent/compare/v0.7.2...v0.7.3) (2026-09-03)


### Features

* **skill:** add ocv2-unfuck skill for top-level tool availability check ([f4b0bcb](https://github.com/FAZuH/agent/commit/f4b0bcb4db361cd48a4b78bb39826d2c5ffd7f31))

