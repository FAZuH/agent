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

## [0.15.1](https://github.com/FAZuH/agent/compare/v0.15.0...v0.15.1) (2026-11-08)


### Features

* **plugin:** add desktop GUI views for aside and dispatch ([4069d37](https://github.com/FAZuH/agent/commit/4069d3731e1c32563d21766d5ef71e577ae5faf4))
* **plugin:** add the report plugin ([1cf43c3](https://github.com/FAZuH/agent/commit/1cf43c3a5e8924b3a9b1784bb87d1230fbafbbae))
* **plugin:** bind ctrl+a to the attention-only view ([192a21a](https://github.com/FAZuH/agent/commit/192a21a125426912b755407d123f6830388c8c34))
* **plugin:** dismiss a prompt without answering it ([366cb5d](https://github.com/FAZuH/agent/commit/366cb5ddaa22dbf94ddd9ef12056d309e15ee0a8))
* **plugin:** filter a history to what needs attention ([0f4ffad](https://github.com/FAZuH/agent/commit/0f4ffade706a33fd709baa25b0bd459f34857c67))
* **plugin:** offer prompts as an inline form ([9d1304b](https://github.com/FAZuH/agent/commit/9d1304b5ca863d03cf6fe75ac8a293e4a4750f0c))
* **plugin:** rule the record dialog above and below its content ([5a63b21](https://github.com/FAZuH/agent/commit/5a63b21455dbb1166bd6f936ba672ab311b3f24e))
* **plugin:** show relative ages in the record dialogs ([fdc1923](https://github.com/FAZuH/agent/commit/fdc1923580f8ef5fd219ddfbd38cbc2f6b3ecf1a))
* **plugin:** switch history sessions with ctrl+up/down ([307a871](https://github.com/FAZuH/agent/commit/307a871a2a1da5fe41ce6fcce02f94f6dd555a44))
* **skill:** route reports through the report plugin ([581557f](https://github.com/FAZuH/agent/commit/581557f5c13534494770b1d0df2c4f824629bc5d))
* **tell:** sort the picker by most recent session ([07797de](https://github.com/FAZuH/agent/commit/07797de5288967237bb619273b3dec439eb4e45f))


### Bug Fixes

* **plugin:** center the record dialog vertically ([6ee5f2b](https://github.com/FAZuH/agent/commit/6ee5f2b8cfc47ea7bf4115cdee26e9340f3c5790))
* **plugin:** keep a slot lit while its history has open items ([d1319a9](https://github.com/FAZuH/agent/commit/d1319a9d5b7e977b587d31b758cffbe430c100d6))
* **plugin:** keep the attention toggle off the global keymap ([1b430d4](https://github.com/FAZuH/agent/commit/1b430d4b64918ea3549349024a288a901f3aa89d))
* **plugin:** keep the prompt dialog open when dismissing ([8f6f5c7](https://github.com/FAZuH/agent/commit/8f6f5c74f61f154be4df685c23610dbe9d902d33))
* **plugin:** read reports while the attention filter is on ([c778581](https://github.com/FAZuH/agent/commit/c7785813aa9782151bfa95e5d1e5e02a03ccde13))

## [0.15.0](https://github.com/FAZuH/agent/compare/v0.14.2...v0.15.0) (2026-11-06)


### Features

* **plugin:** add closed-loop desktop control ([1461422](https://github.com/FAZuH/agent/commit/1461422ad737639256ee71140ce3589e4f315f50))
* **plugin:** add the desktop-ask screenshot bridge ([669656c](https://github.com/FAZuH/agent/commit/669656c6dcb50ab335eeaae21fe6f1f9c5e0f397))
* **plugin:** add the session tree viewer ([a179c6b](https://github.com/FAZuH/agent/commit/a179c6b124ef9e4ca712ca7e95a526649a6eae7b))
* **script:** add the desktop-ask trigger helper ([500a659](https://github.com/FAZuH/agent/commit/500a65933e9aa623d2077469bd2d40d4236f8609))

## [0.14.2](https://github.com/FAZuH/agent/compare/v0.14.1...v0.14.2) (2026-11-03)


### Features

* **plugin:** let agents fork with aside and report back by tool ([2618fe6](https://github.com/FAZuH/agent/commit/2618fe64558ff6d0ebe189fc3d1c9affc37a92be))


### Bug Fixes

* **skill:** sweep lessons — upsert recipe, gh timeout, background resume ([95f0537](https://github.com/FAZuH/agent/commit/95f0537d1d319732a3a2b5dcf6fa76a0cb6ceb8d))
* **sync:** skip stale prune on top-filtered pushes (-t) ([d44dc34](https://github.com/FAZuH/agent/commit/d44dc34d1ba180d61923da3301f772da46ceb8fd))

