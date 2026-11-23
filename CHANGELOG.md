## Unreleased

These Watchdog changes are in the source. The review chain stays off by
default. It activates only when you set `WATCHDOG_CHAIN=1` and a real-host
`chain-gate.json` passes the rollout gate. The gate did not pass. See
[Watchdog rollout status](docs/watchdog-rollout-status.md).

### Features

* **plugin:** capability gate, composed race evidence, delivery panel state ([4c2a441](https://github.com/FAZuH/agent/commit/4c2a441))
* **plugin:** dedicated watchdog page and migration ([579df92](https://github.com/FAZuH/agent/commit/579df92))
* **plugin:** abort receipts and parent notices ([a805d41](https://github.com/FAZuH/agent/commit/a805d41))
* **plugin:** operation-scoped release and overlapping recovery ([3025b02](https://github.com/FAZuH/agent/commit/3025b02))
* **plugin:** unified abort operations with honest receipts ([0996bc6](https://github.com/FAZuH/agent/commit/0996bc6))
* **plugin:** harden judge result protocol ([a00588d](https://github.com/FAZuH/agent/commit/a00588d))

## [0.16.1](https://github.com/FAZuH/agent/compare/v0.16.0...v0.16.1) (2026-11-20)


### Features

* **agent:** add advisor and critique review agents ([d773786](https://github.com/FAZuH/agent/commit/d773786b133cffe31793867cf54f0423bda58bc8))
* **ocv2:** add opencode-plugin-gui skill ([1cc26f1](https://github.com/FAZuH/agent/commit/1cc26f17adfd87694f2c162d5d4f1c3dfa637306))
* **ocv2:** add plugin GUI verification skill ([de882fb](https://github.com/FAZuH/agent/commit/de882fb73144b1a66939436b2149599202ad793d))
* **plugin:** add announce plugin for session broadcasts ([6ec0c01](https://github.com/FAZuH/agent/commit/6ec0c01584d45b18224e3ef666fef686bda05a2a))
* **plugin:** add board bridge for session wakes ([f8081c8](https://github.com/FAZuH/agent/commit/f8081c8ca37028c7d135839ba4acc67fd915061c))
* **plugin:** add OpenCode-style Settings tab to Prompt panel ([dd03533](https://github.com/FAZuH/agent/commit/dd03533b9f8622da352778892b2dec19773e93de))
* **plugin:** add session bans, tool bans, and batch supervisor ([f3156cf](https://github.com/FAZuH/agent/commit/f3156cf6ee28f428720b098a252e53d0769b76c2))
* **plugin:** dismiss prompts from cards and default calls to non-blocking ([88101bb](https://github.com/FAZuH/agent/commit/88101bbd0c8ff89bf704bed4d2f82b630675bc0c))
* **plugin:** expose octask scheduling as agent tools ([928a707](https://github.com/FAZuH/agent/commit/928a707fbdbfc0943b37c27ae069c354d0b355d9))
* **plugin:** persist board cursor across restarts ([972ee03](https://github.com/FAZuH/agent/commit/972ee031700fd7dd1d43a9d8f62942b7c800e84e))
* **plugin:** revamp Jev Desktop panel with tabs and bulk actions ([e553eae](https://github.com/FAZuH/agent/commit/e553eae192f6af2d98a9a81198285f9d58b14815))
* **plugin:** revamp Prompts panel with tabs and full-prompt view ([99d7018](https://github.com/FAZuH/agent/commit/99d7018d3fea69e98e4f06fdf87d2bdf0ea46983))
* **script:** add octask TUI, bulk toggles and JSON output ([3d28513](https://github.com/FAZuH/agent/commit/3d28513bd037837d7f603ee295108b5f792c9275))
* **script:** install board skill with external skills ([4a68405](https://github.com/FAZuH/agent/commit/4a684051bce26961c8a93ad6ebce1ea387a98dd6))
* **skill:** publish plan and progress as a state diagram ([1f5f7b9](https://github.com/FAZuH/agent/commit/1f5f7b9b69f97a72318a5b9af1baddfaeea5c2f0))
* **skill:** render plan diagrams top down ([270e03a](https://github.com/FAZuH/agent/commit/270e03a00ab930592d16551bc7d5d030c09b735f))
* **skill:** wire issue closeout into the merge flow ([cd53ac5](https://github.com/FAZuH/agent/commit/cd53ac58fdf1d27f0fa6426e9660af24de99c945))
* stage new mail for the digest gate and post idempotently ([614184c](https://github.com/FAZuH/agent/commit/614184c4fe40e28c886c17075e94ab0fd544f070))


### Bug Fixes

* **plugin:** show "Not answered" instead of taking the recommendation ([2f620cb](https://github.com/FAZuH/agent/commit/2f620cb024014b5fb7847817eb508ad6c8384fba))
* **plugin:** show the question title on the native question card ([5776133](https://github.com/FAZuH/agent/commit/577613349407bd3210ecfde424145ca5289485c4))

## [0.16.0](https://github.com/FAZuH/agent/compare/v0.15.4...v0.16.0) (2026-11-17)


### Features

* **agent:** add the router primary agent ([f470970](https://github.com/FAZuH/agent/commit/f470970221cc6a902fb86e1803a281b54d7a25d5))
* **agent:** allow agents to act without a prompt ([32d0e0a](https://github.com/FAZuH/agent/commit/32d0e0a37308ba5e41196ef8d961063fa2c98636))
* **agent:** route from the compact dossier to the target session ([9d030a2](https://github.com/FAZuH/agent/commit/9d030a2cb890a318ae92c6cd2474efdc2501da8b))
* **agent:** route the privacy scan through provenance ([7d92ac6](https://github.com/FAZuH/agent/commit/7d92ac65509894f1b4bf482c4023c614a2657819))
* **agent:** treat route-watch notices as completion reports ([086a94c](https://github.com/FAZuH/agent/commit/086a94c70bf57e9e11be5cb32339a5312dcc770a))
* **command:** add fin to forward to finish in auto mode ([0346beb](https://github.com/FAZuH/agent/commit/0346beb91529ff6935e77cd69988c3fd4ce8a97f))
* load the global rules from instructions/ via the OpenCode config ([4f3dab2](https://github.com/FAZuH/agent/commit/4f3dab2b0c760adc034e1488f5f235aa60554cd3))
* **plugin:** add a Desktop panel for prompts ([4c0694c](https://github.com/FAZuH/agent/commit/4c0694c0dfe7d01c2c138f3c414922d0957332d3))
* **plugin:** add awaiting filter and bulk dismiss to Prompts panel ([28a8437](https://github.com/FAZuH/agent/commit/28a8437a24e06ff0334853a4405bd8fde5c60382))
* **plugin:** add background fork option to branch_ask ([64300be](https://github.com/FAZuH/agent/commit/64300be9baa156d03b01601576b92588c0ad38fc))
* **plugin:** add Jev Desktop panel over RPC ([5493044](https://github.com/FAZuH/agent/commit/54930443c41f56a57b72c1e2893fa611f6560c20))
* **plugin:** add supervisor for held permission asks ([6deb621](https://github.com/FAZuH/agent/commit/6deb6216200cfaaac16fb7f7e270afaeb3a3a6a3))
* **plugin:** add the no-respawn task key, verdict table, store and frontier ([082ca3a](https://github.com/FAZuH/agent/commit/082ca3a04c6f8965f2652746352921b1f67e8ee8))
* **plugin:** enforce no-respawn on subagent admission, with the hold and the abort ([d68d3f5](https://github.com/FAZuH/agent/commit/d68d3f5d5f1eb52fdffd2dfc0ffaa19a5e82604e))
* **plugin:** fork subagents and gate branch_ask to primary sessions ([5979e76](https://github.com/FAZuH/agent/commit/5979e7636a4694acd258195153903846898a065f))
* **plugin:** serve prompt_user cards on every client and redesign the history panel ([8376257](https://github.com/FAZuH/agent/commit/8376257fa09cda620811489c9851191763b741f6))
* **plugin:** wire the no-respawn switch and expose /jev-abort ([08b921e](https://github.com/FAZuH/agent/commit/08b921ed543cec545b23b9cf7b56cc73408f0f2a))
* **script:** add the project and session router CLI ([96c7367](https://github.com/FAZuH/agent/commit/96c7367b7aecfc9687dbee2a864fab062a25174d))
* **script:** compact the route brief and resume a session in place ([3285caa](https://github.com/FAZuH/agent/commit/3285caa27c1b1b255ccbb47fa48d9bcd165cdf7c))
* **script:** find sessions by whole transcript, not just the tail ([ada81bc](https://github.com/FAZuH/agent/commit/ada81bca0ab37a71cdbb9ac1d75768f060f59c41))
* **script:** preload terse and antislop-copywriting as instructions ([9abbb8a](https://github.com/FAZuH/agent/commit/9abbb8a47995610d2a4f50ad9ab5e368191e9172))
* **script:** wake the caller when a dispatched session goes idle ([7f744e9](https://github.com/FAZuH/agent/commit/7f744e967881dc4347811ed3f1a131f40fc03b82))
* **skill:** add the report hygiene gate ([c56741b](https://github.com/FAZuH/agent/commit/c56741bc834684810f20be00e9afa42fd3ec618b))
* **skill:** add the routing procedure ([f1e3af1](https://github.com/FAZuH/agent/commit/f1e3af16603061466b99e982b46fc0341fa0f423))
* **skill:** teach the routing procedure the session candidates ([1b17266](https://github.com/FAZuH/agent/commit/1b17266121805771c356f5f893b96b07e06c82dc))


### Bug Fixes

* **agent:** let pii-check read the commit history ([ec6e9ff](https://github.com/FAZuH/agent/commit/ec6e9ff3e4230c7047751de4ed7f9d011a32271e))
* **plugin:** fence the desktop-ask window title as data ([b34916a](https://github.com/FAZuH/agent/commit/b34916a1f9a6833dd62e08efda1edbf5dcb399b4))
* **plugin:** load large session families in batches under the list limit ([a60e8d8](https://github.com/FAZuH/agent/commit/a60e8d82a99a1bbd7e46335747df8ae29b35bf61))
* **plugin:** name the report answer delivery modes steer and queue ([be4ebd1](https://github.com/FAZuH/agent/commit/be4ebd12380e42cb3536f1dff6e9e0ffd7dffde9))
* **plugin:** pass the feature key to the jev numeric settings ([eb5b53a](https://github.com/FAZuH/agent/commit/eb5b53a71e8c6fe2e608bc4cd988d1705786f96f))
* **plugin:** redact the tool text before the jev log and alert ([fafb39c](https://github.com/FAZuH/agent/commit/fafb39cf2f5daf87139918eb9aaa8243b56dec6b))
* **plugin:** write the desktop-ask and report files with 0600 ([397faba](https://github.com/FAZuH/agent/commit/397fabaaf4e5c0ff72f3d5c1cf0e14e30456bf26))
* **skill:** drop the dangling pr reference from pr-creator ([93d10c9](https://github.com/FAZuH/agent/commit/93d10c973ef87213834cda2b8e208454c6cb761f))

## [0.15.4](https://github.com/FAZuH/agent/compare/v0.15.3...v0.15.4) (2026-11-11)


### Features

* **plugin:** cap branch forks and batch their reports ([1b300ec](https://github.com/FAZuH/agent/commit/1b300ececd11439911140e4968cf9481ebb4318d))
* **plugin:** capture one window without switching workspace ([fc91c85](https://github.com/FAZuH/agent/commit/fc91c851ef458854c74f80d5a5b9d6e876d2aca2))
* **skill:** give audit findings stable IDs ([9245a84](https://github.com/FAZuH/agent/commit/9245a84f11490e559ae76ec4df70f44d831bf0b6))
* **skill:** split audit findings into confident and your call ([a929a07](https://github.com/FAZuH/agent/commit/a929a07bef66026dccbb2917376570c5c6ac503b))


### Bug Fixes

* **desktop-control:** keep click coordinates in image pixels ([53887ce](https://github.com/FAZuH/agent/commit/53887ce3a038439cf0d4ef99816ce9a601bb8542))
* drop the retired alias from the digest ([7f6f41c](https://github.com/FAZuH/agent/commit/7f6f41cff1c7cac79bc9cef046e2338e4b12d8e8))
* **plugin:** bound long prompt bodies in forms and answers ([ddd0f65](https://github.com/FAZuH/agent/commit/ddd0f65430292f3d1b271ed6c4ba0b16044eab2e))
* **plugin:** capture ask shots in image pixels ([9947275](https://github.com/FAZuH/agent/commit/99472750074683ba8c957d593680c2778ff94e83))
* **plugin:** capture regions in image pixels ([64203f3](https://github.com/FAZuH/agent/commit/64203f3a2fb99da72ba11c2433bd3fa222636deb))
* **plugin:** deliver each prompt answer once ([666c15c](https://github.com/FAZuH/agent/commit/666c15cc894ee7000705ee585d325de5bd25ba68))
* **plugin:** move jev state to the opencode state root ([1b936c5](https://github.com/FAZuH/agent/commit/1b936c5e0ba0ebec9c6f9675d8e25ed92f0b0b9d))
* **plugin:** move report state to the opencode state root ([4d1e7a6](https://github.com/FAZuH/agent/commit/4d1e7a6bfdf512e32e62f5eff7b56082f469557a))
* **plugin:** resolve blocking prompts across plugin instances ([484678d](https://github.com/FAZuH/agent/commit/484678de5307da58ed8acd6fce1cb3389020aeeb))

## [0.15.3](https://github.com/FAZuH/agent/compare/v0.15.2...v0.15.3) (2026-11-10)


### Features

* **skill:** add codebase-audit skill ([ad5437e](https://github.com/FAZuH/agent/commit/ad5437efe279a3e0e6a50620c7a9fb395107baf5))

## [0.15.2](https://github.com/FAZuH/agent/compare/v0.15.1...v0.15.2) (2026-11-09)


### Features

* **plugin:** add bulk read and dismiss commands ([0378406](https://github.com/FAZuH/agent/commit/0378406e1fd30668d0ba9f99e51c0081515f47ac))
* **plugin:** let prompt_user block for the answer ([283c261](https://github.com/FAZuH/agent/commit/283c26151fc8e60ff5e3c46c4c9c746e8827b368))
* **plugin:** show context status and sidebar settings in reports ([e38c5c0](https://github.com/FAZuH/agent/commit/e38c5c010df0585fadb62c26133e64a9fe97f3cb))
* **plugin:** title prompt answers like the question card ([9403d76](https://github.com/FAZuH/agent/commit/9403d763c93bf64fe3c649020eeb0f7f4979d15f))


### Bug Fixes

* **plugin:** align the context watch line and poll its status ([d73691d](https://github.com/FAZuH/agent/commit/d73691de913f31b7c943bb7e0b69c05ea5cf60e4))
* **plugin:** read fork markers written under the old aside key ([d211e7d](https://github.com/FAZuH/agent/commit/d211e7dd82cc7e5daff606f5ad4947509eea1e21))
* **plugin:** title the context section Context Watch ([d2a9b79](https://github.com/FAZuH/agent/commit/d2a9b79e0983ee6824f680afd007602f37a11ceb))

