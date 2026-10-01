## [0.13.0](https://github.com/FAZuH/agent/compare/v0.12.8...v0.13.0) (2026-10-01)


### Features

* **ocv2:** add the jev-use skill ([b7f8710](https://github.com/FAZuH/agent/commit/b7f871019a9a2487d132b4196df72465fa2d2d1d))
* **ocv2:** add the ocv2-plugins skill for writing v2 plugins ([190bbee](https://github.com/FAZuH/agent/commit/190bbee7df61242f588e23d01ed259854ea1d2a4))
* **plugin:** add a chat wire protocol and drop provider names ([8d43e74](https://github.com/FAZuH/agent/commit/8d43e744dfeb2ceeb12a1b678bf462a2df9a7a7f))
* **plugin:** add a master switch and drop the commands it replaces ([a48f55a](https://github.com/FAZuH/agent/commit/a48f55ac5ce88350656c6bba1bbcdbbca825dd42)), closes [#3](https://github.com/FAZuH/agent/issues/3)
* **plugin:** add the jev decision plugin ([a40f5e4](https://github.com/FAZuH/agent/commit/a40f5e4adc8010055f14ab9e72356ce7effcf89c))
* **script:** install jegrep in the bonus tier ([ccc157f](https://github.com/FAZuH/agent/commit/ccc157ff179f779a9b1b8908e35778ead2a088fa))
* **skill:** ask the user with numbered questions at the bottom of the message ([34ee589](https://github.com/FAZuH/agent/commit/34ee58940ea99512ab4c80d1d46889de1d9f9442))
* **skill:** extract the prompt shapes into a prompt-user skill ([f38d264](https://github.com/FAZuH/agent/commit/f38d2648da8e77c050ffba03b0efaeaa7054b3c0))
* **skill:** register the jev-use skill in the load table ([b297a35](https://github.com/FAZuH/agent/commit/b297a35be6aaa5a6c7acae10a47dbd887dd8195b))
* **skill:** rework post-task report, add decision section ([4ac09da](https://github.com/FAZuH/agent/commit/4ac09dadddc18ac83d108e51e11810ebae178133))


### Bug Fixes

* **script:** embed the common rules at the bottom of the host AGENTS.md only ([5e1d3bc](https://github.com/FAZuH/agent/commit/5e1d3bc1699988b2edea2ad3ed328f069002750e))
* **script:** strip the embedded AGENTS.md rules only with --embedded-rules ([658079e](https://github.com/FAZuH/agent/commit/658079e04879f917e799b375b39bef00cfeab90c))
* **script:** strip the embedded rules from the host AGENTS.md on uninstall ([d89dea1](https://github.com/FAZuH/agent/commit/d89dea1a6e62705403ecb0efbfbceeb329fbf3aa))

## [0.12.8](https://github.com/FAZuH/agent/compare/v0.12.7...v0.12.8) (2026-09-30)


### Features

* **script:** embed the common rules in the host AGENTS.md ([cff09cd](https://github.com/FAZuH/agent/commit/cff09cd91d3d93655cb09dd5ccab7338915c452e))
* **skill:** add the global-instruction rules skill ([c3b0858](https://github.com/FAZuH/agent/commit/c3b08583666720b88e51bba85d9b6ba616b3fe1f))
* **skill:** pdf-write assembles PDFs to a matching page width ([0c9340a](https://github.com/FAZuH/agent/commit/0c9340a24b9e8f11be1f215e23bc3bb7557777cf))

## [0.12.7](https://github.com/FAZuH/agent/compare/v0.12.6...v0.12.7) (2026-09-30)


### Bug Fixes

* **agent:** keep audit papercuts out of the audited repo ([a77cc5a](https://github.com/FAZuH/agent/commit/a77cc5a4770a068e3f10c3ff1c271bbecfbeef5c))
* **ocv2:** the plugin-health probe path did not exist ([b069421](https://github.com/FAZuH/agent/commit/b0694214a455d66b4dce56e83b1204ea783018cb))
* **plugin:** the mermaid compiler passed a flag v12 removed ([9411322](https://github.com/FAZuH/agent/commit/9411322339b0b1b06f855903f16f27fc745a06e0))
* **script:** pdf-build passes --size, the v12 diagram width ([5e334ee](https://github.com/FAZuH/agent/commit/5e334ee0616d4520a4df04ff0eb6792f30c2d22a))
* **script:** require mmdc v12 ([dfe12c4](https://github.com/FAZuH/agent/commit/dfe12c42e4a426792b8b65020f5910db2b5e6779))
* **script:** say why npx skills is unavailable ([23cf633](https://github.com/FAZuH/agent/commit/23cf6339d4678ed8df08fb53bc6eaeabe3500f61))
* **skill:** a resumed subagent can return no text ([9f5eb4d](https://github.com/FAZuH/agent/commit/9f5eb4dceafbe0b344bf16e578b029849915ea8a))
* **skill:** cargo jobs flags belong before -- ([3598af7](https://github.com/FAZuH/agent/commit/3598af7471ec9d4111dd2a8b3674f49e95b1f495))
* **skill:** sweep the untagged papercuts too ([bfe371a](https://github.com/FAZuH/agent/commit/bfe371a5c70446db61f317981f57d41c940f0809))
* **skill:** the omarchy install and quickshell traps ([3bc6f70](https://github.com/FAZuH/agent/commit/3bc6f70a47413b276a075b4bfa2756370de65dd4))

## [0.12.6](https://github.com/FAZuH/agent/compare/v0.12.5...v0.12.6) (2026-09-30)


### Bug Fixes

* **agent:** advise rotation only for a committed credential ([d65cbae](https://github.com/FAZuH/agent/commit/d65cbae0c8275b57eaaac107f576bb759294e405))
* **ocv2:** the model list is a local catalog, not the API's ([8b4faa6](https://github.com/FAZuH/agent/commit/8b4faa66dc995f9b3ac62af918814f3e8a069ba8))
* **skill:** exclude target without a trailing slash ([c21bb71](https://github.com/FAZuH/agent/commit/c21bb713e1d871a5ca28a5bf9171255e4e9de1ad))
* **skill:** keep prose, table and algorithm on one page flow ([4d96e3c](https://github.com/FAZuH/agent/commit/4d96e3c42a426e4b9fb75ea94979c39673a787e5))
* **skill:** skip the finish steps a merge already satisfied ([a3b011c](https://github.com/FAZuH/agent/commit/a3b011cc1626352ef62fbd07c18e56f02c8faf39)), closes [#7](https://github.com/FAZuH/agent/issues/7)

## [0.12.5](https://github.com/FAZuH/agent/compare/v0.12.4...v0.12.5) (2026-09-30)


### Bug Fixes

* **skill:** stop claiming research-discovery waits for approval ([ba1c4e2](https://github.com/FAZuH/agent/commit/ba1c4e211f6e05e1e495b9cbcb60b60709fc3611))

