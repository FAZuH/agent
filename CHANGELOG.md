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

## [0.7.2](https://github.com/FAZuH/agent/compare/v0.7.1...v0.7.2) (2026-09-03)


### Features

* **skill:** add offload skill for remote builds, checks, and agent batches ([1bde961](https://github.com/FAZuH/agent/commit/1bde96163cddbd562b1cec0c5bcadd64fefa3893))
* **skill:** extract commit and self-improve from finish, add retro new-skill candidates ([5b5d12b](https://github.com/FAZuH/agent/commit/5b5d12ba8f06484625f1f7d3c501b9fb7bbb16c1))

## [0.7.1](https://github.com/FAZuH/agent/compare/v0.7.0...v0.7.1) (2026-09-02)


### Features

* **skill:** add rust-idioms skill — type-driven design patterns for Rust ([9ed01b6](https://github.com/FAZuH/agent/commit/9ed01b6bf90f8d9b1a4267e91affa127b1e2799e))
* **skill:** declare fix-approval gate in skill-doctor ([938539e](https://github.com/FAZuH/agent/commit/938539e321fe3f5c44e07babe44cba9f927f7027))

## [0.7.0](https://github.com/FAZuH/agent/compare/v0.6.11...v0.7.0) (2026-09-02)


### Features

* **agent:** require explicit [@gate](https://github.com/gate) load in gate dependents ([3387a39](https://github.com/FAZuH/agent/commit/3387a396c16f382b6d5f6b8fa05d60a60e4141ee))
* **script:** add utils tag for scheduling and parsing skills ([c3a8174](https://github.com/FAZuH/agent/commit/c3a8174d2c6bbbd621cf49d8c3e0d20cb201e70f))
* **skill:** add gate skill — gate classes and auto run mode ([0366948](https://github.com/FAZuH/agent/commit/0366948623734cfba5371cf9f4d0aa857a679671))
* **skill:** add read-pdf skill (port of personal fazuh-read-pdf) ([d9d06d5](https://github.com/FAZuH/agent/commit/d9d06d59de6df5788c5a298443beff8427d26fbd))
* **skill:** add rust-tea skill — The Elm Architecture for Rust ([65b4850](https://github.com/FAZuH/agent/commit/65b48504bac85690346de7b78ef0cf15c1956289))
* **skill:** require explicit [@gate](https://github.com/gate) load in gate dependents ([c87f6b0](https://github.com/FAZuH/agent/commit/c87f6b0faf57406d908c83dbc193214a232b2d7e))
* **skill:** teach resolves learn dir via discovery and scaffold fallback ([96b0e10](https://github.com/FAZuH/agent/commit/96b0e109b9d1cdd24812e3cd81ac96709a87dc8c))


### Bug Fixes

* **script:** include gate in utils tag ([485ac9a](https://github.com/FAZuH/agent/commit/485ac9aa1632eba4d56d4f865705e058b80b8b5b))
* **skill:** skill-doctor ignores gate ids ([9438166](https://github.com/FAZuH/agent/commit/94381663319ee1db8ee3807e39d83327761f48e3))
* **skill:** trust gh over stale symbolic-ref for default branch ([547a466](https://github.com/FAZuH/agent/commit/547a4660451e7a1c39e26efe05d3e3e971f9e8b6))

