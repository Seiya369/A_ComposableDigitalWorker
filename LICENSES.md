# Licenses in this distribution

Original Composable Workforce plugin code outside `third_party/llm-wiki/` and its separately built program is licensed under the MIT terms in [LICENSE](LICENSE).

The shared LLM Wiki program under `third_party/llm-wiki/` and its object-code builds in `lib/llm-wiki/` are licensed under GNU GPL version 3. The preserved copyright and complete license are in [third_party/llm-wiki/LICENSE](third_party/llm-wiki/LICENSE). Integration modifications are dated 2026-10-24. This program contains selected modules from `nashsu/llm_wiki@0.6.13`, commit `e08cfce65aad8b76b13546a081c1a8d4422b70c3`, plus the GPL bridge and sandboxed browser program. The root MIT notice does not relicense those files.

The archive includes the exact selected upstream sources, modifications, protocol, source manifest with hashes, dependency manifest and lock, and build scripts. The root build-tool dependency lock is preserved as `build-support/dependencies.lock.json` because npm omits its root package-lock.json from published archives. Rebuild instructions are in [third_party/llm-wiki/README.md](third_party/llm-wiki/README.md). The shared program's bundled dependency copyright and license texts are collected from its actual build inputs in `third_party/llm-wiki/dependency-licenses/` and `lib/llm-wiki/licenses/`.

The main plugin and shared program communicate using JSON messages. These implementation boundaries do not remove or alter the license conditions of copied or modified upstream code. Third-party dependencies retain their respective licenses. See [integration/THIRD_PARTY_NOTICES.md](integration/THIRD_PARTY_NOTICES.md) for the complete integration scope and notices.
