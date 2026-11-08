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

## [0.14.1](https://github.com/FAZuH/agent/compare/v0.14.0...v0.14.1) (2026-10-22)


### Features

* **agent:** point the orchestrator at agent-talk ([1de855f](https://github.com/FAZuH/agent/commit/1de855f37aa495b39bb93439ac80c462db460c40))
* **plugin:** add tell plugin for messaging subagent sessions ([ce0c7da](https://github.com/FAZuH/agent/commit/ce0c7daecd5fbdb4bbc1979dc3d3dd67e295184c))
* **plugin:** add the tell picker and a tested descendant rule ([6d409b5](https://github.com/FAZuH/agent/commit/6d409b5c1c706cc589674ff3adc464c1e30c522c))
* **skill:** add agent-talk skill ([14f3b50](https://github.com/FAZuH/agent/commit/14f3b50a61956f08371b97be98f3e9299642f8a0))


### Bug Fixes

* **plugin:** the fork owns its question and its report ([1c943f0](https://github.com/FAZuH/agent/commit/1c943f0938a1ca7c0adccd68f6cd71923f8f6670))

## [0.14.0](https://github.com/FAZuH/agent/compare/v0.13.19...v0.14.0) (2026-10-21)


### Features

* **plugin:** a jev section in the tui sidebar ([1a98f9c](https://github.com/FAZuH/agent/commit/1a98f9c4336af90d88ea434d1afd3c1ba029f79a))
* **plugin:** jev gates tool calls through the host permission hook ([242f797](https://github.com/FAZuH/agent/commit/242f7972320069f2f84dbfae7ad766c327cb6035))
* **plugin:** one aside command with fork and finish notices ([00cb467](https://github.com/FAZuH/agent/commit/00cb467905fda05522ac5304117d5ee57a7f622f))
* **plugin:** the host's words, a folding sidebar, and a disposable plugin ([cbea07d](https://github.com/FAZuH/agent/commit/cbea07d3240d69e49d6ab61d5f6f20f079cdad58))
* **script:** install the chat-room plugin ([b186d53](https://github.com/FAZuH/agent/commit/b186d534010e425a73c180bfe153f69b42341ca4))
* **skill:** add parallel-lanes workflow, reuse lane sessions ([ffa7aaa](https://github.com/FAZuH/agent/commit/ffa7aaa94509bdb726b9d93e43f82b65e3499f66))


### Bug Fixes

* **plugin:** a failed jev call shows in the sidebar ([4db3938](https://github.com/FAZuH/agent/commit/4db39384d927336425964b5d3e75a993942a508d))
* **plugin:** an unsure answer is recorded as what it became ([1a9be05](https://github.com/FAZuH/agent/commit/1a9be0594ba6694166e9f32f14e531205bb7785a))
* **plugin:** an unsure answer is recorded as what it became ([27acb90](https://github.com/FAZuH/agent/commit/27acb90bee1b5be480c10f3f74877ba15c16ffa1))
* **plugin:** aside notices ride as steer prompts ([b7dad17](https://github.com/FAZuH/agent/commit/b7dad17346e0ac299b47a7b137c1a1e827abd190))
* **plugin:** one owner per slash name ([63f1ca3](https://github.com/FAZuH/agent/commit/63f1ca3d8ceb49fc267845133f94ca6b1e3c48d6))
* **plugin:** readable feature groups and a masked webhook url ([7bb857d](https://github.com/FAZuH/agent/commit/7bb857d0d58f80b68de9b5647509cc27994c7356))
* **plugin:** the first live run of the jev tool hooks ([50cc7a0](https://github.com/FAZuH/agent/commit/50cc7a039e90f1bbb88d14f7d59164a714b80b1d))
* **skill:** fold the fork boundary into session reuse ([8a3787c](https://github.com/FAZuH/agent/commit/8a3787caafbd0440d595a9bb3bf961ac53b88f0c))

