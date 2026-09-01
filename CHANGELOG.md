## [0.6.9](https://github.com/FAZuH/agent/compare/v0.6.8...v0.6.9) (2026-09-01)


### Features

* **script:** selective deploys by tag via tags.conf ([1042a21](https://github.com/FAZuH/agent/commit/1042a2173f61ba771d9aa2a12e9bf31685b43926))

## [0.6.8](https://github.com/FAZuH/agent/compare/v0.6.7...v0.6.8) (2026-09-01)


### Features

* **skill:** add ocv2-api and ocv2-fork, promote ocv2-findings/move/pluginhealth to public ([6f250b1](https://github.com/FAZuH/agent/commit/6f250b1e8da56fa13ca8f1aae5c5491297624a17))

## [0.6.7](https://github.com/FAZuH/agent/compare/v0.6.6...v0.6.7) (2026-08-31)


### Features

* **agent:** template agent model lines ([d671c8e](https://github.com/FAZuH/agent/commit/d671c8e6b6bc4400e66527203dc9ff0e7a28d838))
* **script:** rewrite set-agent-model.sh as values-file wrapper ([6ca3ded](https://github.com/FAZuH/agent/commit/6ca3dedaf3db8af85c03f3d586db4fa294bffc2c))
* **script:** substitute {{KEY}} placeholders from gitignored .agent-values on push ([a302ac1](https://github.com/FAZuH/agent/commit/a302ac174f9c7aba0df7b75e99caa737b82a9498))

## [0.6.6](https://github.com/FAZuH/agent/compare/v0.6.5...v0.6.6) (2026-08-31)


### Features

* **agent:** switch build/review subagents to cline/z-ai/glm-5.3-flash ([42fad70](https://github.com/FAZuH/agent/commit/42fad70c4223ff30c8654ee1a13c2b08602436d9))
* **command:** allow auto-prefixed finish arguments ([c723e3f](https://github.com/FAZuH/agent/commit/c723e3f52c9337d47c1ae53d91dd0e9e8ebd2af3))
* **script:** add set-agent-model.sh to swap subagent models and push ([488b687](https://github.com/FAZuH/agent/commit/488b687026143ebc60b15c75e91950a2b58029c3))
* **script:** default sync target to global when a top is given ([62afca6](https://github.com/FAZuH/agent/commit/62afca695508796c04e2e9685866c2034f83e065))
* **skill:** grant finish orchestrator auto-commit via command wrapper ([cc9c3bf](https://github.com/FAZuH/agent/commit/cc9c3bffe06469ca868b1cb14d4ddeccf3c942d4))


### Bug Fixes

* **agent:** make vision makers permissive-by-default for plugin tools ([17eac59](https://github.com/FAZuH/agent/commit/17eac59f8eaf3703476a042fd8742f5d7056c9ce))

## [0.6.5](https://github.com/FAZuH/agent/compare/v0.6.4...v0.6.5) (2026-08-30)


### Features

* **skill:** add fazuh-scopes skill ([97b2df0](https://github.com/FAZuH/agent/commit/97b2df0719dda4f6f723c20f9fc7c8c4087a17a5))
* **skill:** gate session-retro papercuts behind approval ([b8eb78b](https://github.com/FAZuH/agent/commit/b8eb78bc74d7930a73eacfea9f669f0fb3e66820))
* **skill:** run gated retro and doctor from finish, offer sweep ([a86edd3](https://github.com/FAZuH/agent/commit/a86edd348932f6e04f4a478f787e88cbefa50e22))

