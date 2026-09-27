## [0.11.4](https://github.com/FAZuH/agent/compare/v0.11.3...v0.11.4) (2026-09-27)


### Features

* **agent:** hand review findings to the fixing agent ([deb5ae3](https://github.com/FAZuH/agent/commit/deb5ae378ece920b685c54c8d5e87f0b2cb6f6ff))
* **script:** add ponytail skill to install script ([b8820ec](https://github.com/FAZuH/agent/commit/b8820eca49f9313af4a9e8eef6975c14f986c8b3))
* **skill:** verify PR contains only branch work before push ([40ee78e](https://github.com/FAZuH/agent/commit/40ee78e31bfcc61658a2a4d823ff88368c461fda))


### Bug Fixes

* **ci:** stop the release run from half-pushing a tag ([4be96b7](https://github.com/FAZuH/agent/commit/4be96b7a8b3652739a5d068277b2a3362c88b438))
* **ci:** upload the release binary from the scripts/ workspace ([ad008a4](https://github.com/FAZuH/agent/commit/ad008a4f0b1bc62713d96426bc2454d6205daaa2))
* **ocv2:** correct session wait endpoint path ([0087d76](https://github.com/FAZuH/agent/commit/0087d7695655eb5e7c8eaaa6447b068327d14542))
* **skill:** hash rendered skill sources to avoid false drift ([7dc9584](https://github.com/FAZuH/agent/commit/7dc95846568aceddc57ef1eec376003a62d9f25f))
* **skill:** warn against broad git clean across sessions ([9bdf703](https://github.com/FAZuH/agent/commit/9bdf703897c1d94ad581586ad8bb8f43d51fc5ae))

## [0.11.3](https://github.com/FAZuH/agent/compare/v0.11.2...v0.11.3) (2026-09-27)


### Features

* add the update-pins skill ([fc00e69](https://github.com/FAZuH/agent/commit/fc00e69c801469dc276f8f1e19a656cbc6ccb817))
* **script:** pin the npm, cargo, and git versions install.sh fetches ([2d5316a](https://github.com/FAZuH/agent/commit/2d5316a054165d8ea5662d4b25fad0147401352d))
* **skill:** add update-fazuh-agent and record the repo path on push ([5e0a5fa](https://github.com/FAZuH/agent/commit/5e0a5fa620dc7ee56a243bfdb601b45a44ced789))


### Bug Fixes

* **script:** find a self-installed opencode off the PATH ([d1272d4](https://github.com/FAZuH/agent/commit/d1272d46e123ac31c42527e5a6f1449f28b5b849))
* **script:** find cargo in a non-login shell ([6a786d3](https://github.com/FAZuH/agent/commit/6a786d324bb7089cfa08db48bf5a21f8b1338314))

## [0.11.2](https://github.com/FAZuH/agent/compare/v0.11.1...v0.11.2) (2026-09-25)


### Features

* add owned uninstaller ([674f3f2](https://github.com/FAZuH/agent/commit/674f3f28bbfe9ddb26640d6159765d3a2a44a2e1))


### Bug Fixes

* **ocv2:** require explicit opencode subcommands ([e48d81f](https://github.com/FAZuH/agent/commit/e48d81f229ff7e90261d4c1df947302ceb4163ee))
* **skill:** guard gh --body-file against empty replacement files ([303262b](https://github.com/FAZuH/agent/commit/303262b273d87536d563392a49248d15b7c9412b))
* **skill:** harden delegation and worktree guidance ([8648385](https://github.com/FAZuH/agent/commit/8648385c9e96316e6400cc991691bbb4972e7c6d))

## [0.11.1](https://github.com/FAZuH/agent/compare/v0.11.0...v0.11.1) (2026-09-25)


### Features

* add ImageScan notification workflow ([82a8db6](https://github.com/FAZuH/agent/commit/82a8db67c780c621edcdffdfe7fef13c89b52fa8))
* **command:** add image scanning commands ([59e1d06](https://github.com/FAZuH/agent/commit/59e1d06c89ec54d97c3af43f7cb224799fe3400c))

## [0.11.0](https://github.com/FAZuH/agent/compare/v0.10.3...v0.11.0) (2026-09-25)


### Features

* add idempotent setup installer ([c84439f](https://github.com/FAZuH/agent/commit/c84439f28ab34fba48402bc234ff688a6083a0c2))
* **skill:** add agent map ([b41d784](https://github.com/FAZuH/agent/commit/b41d784dbc828b2165da24b1612bccc2cd282480))

