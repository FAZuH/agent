## [0.10.2](https://github.com/FAZuH/agent/compare/v0.10.1...v0.10.2) (2026-09-15)


### ⚠ BREAKING CHANGES

* **plugin:** remove the quiz tool pair
* **skill:** teach quizzes are plain chat Q&A

### Features

* render mail-digest bullets as Discord markdown lists ([bb36f65](https://github.com/FAZuH/agent/commit/bb36f65b32fd35021b377dfce854aceec1f9476b))
* **skill:** teach quizzes are plain chat Q&A ([6501996](https://github.com/FAZuH/agent/commit/650199612bb261cb2be2f83d3d3505388039e8e0))


### Miscellaneous Chores

* **plugin:** remove the quiz tool pair ([05a0b30](https://github.com/FAZuH/agent/commit/05a0b300a01b55bdcf04c0c4b0d6a6fdbd8c8da0))

## [0.10.1](https://github.com/FAZuH/agent/compare/v0.10.0...v0.10.1) (2026-09-15)


### Bug Fixes

* keep the ingest bind host out of the published source ([a8d751f](https://github.com/FAZuH/agent/commit/a8d751f4ba2e9a451edadb3cf43037d0c5b22824))
* **skill:** replace the internal litellm hostname with a placeholder ([1aaa90e](https://github.com/FAZuH/agent/commit/1aaa90ee3a3b929e8611bead50ce1ece7671a852))

## [0.10.0](https://github.com/FAZuH/agent/compare/v0.9.4...v0.10.0) (2026-09-14)


### Features

* **agent:** digest agents read standing instructions and decide --ping ([555f14f](https://github.com/FAZuH/agent/commit/555f14f45451521de61149b4e1e8bcd989c9bf6a))
* mail-digest --ping mentions the user, key file resolves under $HOME ([2ee9fa1](https://github.com/FAZuH/agent/commit/2ee9fa1891ce654af7d5bb435c28648a2ecd796d))
* **ocv2:** probe plugin loading out of process ([2f1d095](https://github.com/FAZuH/agent/commit/2f1d095aeff5d971b014f8a8f48b5334e53a2acc))
* phone-digest post --ping mentions the user ([76bd572](https://github.com/FAZuH/agent/commit/76bd5722739e69162344752de3f91ba9b8428444))
* **plugin:** make md-link mirrors readable, live and manageable ([405b74a](https://github.com/FAZuH/agent/commit/405b74a56d28ef1d60b64980e31660e01279b5aa))
* **skill:** graduate omarchy-plugin-install to personal-public ([a807d83](https://github.com/FAZuH/agent/commit/a807d830b8a13e4a368b84e9e390b2d3bccbda86))
* **skill:** session-retro audits repo-local agent config too ([bfefd72](https://github.com/FAZuH/agent/commit/bfefd72c1e309d8210eca84037fac58f67c4d2e6))


### Bug Fixes

* **ocv2:** drop the personal home path from the pluginhealth evidence ([d978ad0](https://github.com/FAZuH/agent/commit/d978ad00538ba921c2ef3bef458cb7fd244479c5))
* **ocv2:** report idiom hits on their real lines, and self-test the scanner ([97bebd8](https://github.com/FAZuH/agent/commit/97bebd89dca608dd2a82af579e5c1aafc4a14ec0))
* **plugin:** make quiz option order deterministic so mirrors agree ([c9baf32](https://github.com/FAZuH/agent/commit/c9baf32bb82ae34bdfdd406ec9257a32fa49e50b))
* **plugin:** resolve mermaid and viz project paths from the session ([c29af1f](https://github.com/FAZuH/agent/commit/c29af1f7f2fe6390421717b054afe62c2fd221f1))
* **plugin:** resolve playwright with import() so doctor can find an on-disk install ([c35a15d](https://github.com/FAZuH/agent/commit/c35a15d3a535277d588ccede3c8d2964a43a393b))
* **plugin:** tell the reader where playwright can actually be installed ([ceb018e](https://github.com/FAZuH/agent/commit/ceb018ec81508d5af4e782dc2f7ff3d2ee33d350))
* **script:** keep the template USER_HOME machine-neutral ([2cd1e36](https://github.com/FAZuH/agent/commit/2cd1e36c1046dba27d4a50b6e9b6caff40ce8352))
* **skill:** center readme title with tagline in header block ([7c45dcc](https://github.com/FAZuH/agent/commit/7c45dcc11712f9d253415b3f3924a6299b7f5bca))
* **skill:** drop the personal fazuh-agent reference from external-skills ([113ed4f](https://github.com/FAZuH/agent/commit/113ed4fcf21aa6129f23da85e7939351433cb584))
* **skill:** drop the personal vault path from the scheduled-agent example ([96d969b](https://github.com/FAZuH/agent/commit/96d969ba44d543597bd73b0a8c0716cbf4072453))

## [0.9.4](https://github.com/FAZuH/agent/compare/v0.9.3...v0.9.4) (2026-09-13)


### Features

* **agent:** approval-gated shell for malware-check ([6206a81](https://github.com/FAZuH/agent/commit/6206a81eb573df60eb3a24df9b1ce704c97b993b))
* **skill:** add omarchy-plugin-install with mandatory malware-check delegation ([a38754d](https://github.com/FAZuH/agent/commit/a38754da45b44c9aa4b37e1b204f6f730bc7e28e))

## [0.9.3](https://github.com/FAZuH/agent/compare/v0.9.2...v0.9.3) (2026-09-11)


### Features

* cargo workspace — octask subtree, phone-digest and mail-digest crates ([9576e9a](https://github.com/FAZuH/agent/commit/9576e9ae374ed0e92bb607a0d59d86f7a621e126))
* cutover digest tooling onto the workspace binaries ([f72ac71](https://github.com/FAZuH/agent/commit/f72ac7157fe921ba1df3ec98676891777b47e25c))
* port octask CLI to Rust ([a8a4190](https://github.com/FAZuH/agent/commit/a8a419071ce7960ad3e28bed0b4a5d169253909b))

