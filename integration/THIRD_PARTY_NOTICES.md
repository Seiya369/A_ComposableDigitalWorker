# Third-party notices

The distributed plugin uses DeepSeek Harness through public plugin contracts.
It does not embed the host workspace UI, clsx, or a host source patch. Its
runtime `yaml` dependency is distributed separately by npm under its own ISC
license. Original plugin code is covered by the root `LICENSE`.

Uploaded-document text extraction uses separately installed, unmodified npm
dependencies: `pdfjs-dist` 6.4.299 (Apache-2.0), `fflate` 0.8.3 (MIT), and
`saxes` 6.0.0 (ISC). Their transitive packages retain their own notices, including
`xmlchars` 2.2.0 (MIT) and optional `@napi-rs/canvas` 1.0.13/platform packages
(MIT). These implementations are external dependencies, not bundled into the
plugin JavaScript. Their license files are distributed in the respective npm
packages; the lockfile records the exact dependency closure.

Knowledge context retention calls the public DeepSeek Harness Session surface
replacement protocol and imports the public token-meter estimate module as an
external runtime peer. `@deepseek-ai/dsh-token-meter` and
`@deepseek-ai/dsh-compaction` version `0.2.1-alpha.2` remain supplied by the host
profile; their MIT-licensed implementation is not embedded or patched here.

The notice below is retained for the historical integration patch in the source
repository. That patch is excluded from the npm archive and must not be applied
to prepare a current installation.

## DeepSeek Harness integration patch

Source: <https://github.com/deepseek-ai/deepseek-harness>, commit
`d743267388641bc76f17c45ce8b4c231aed1d32c`, `packages/client/ui-workspace/src`.
Modified to add generic, additive workspace header and menu extension slots.

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
