# Shared LLM Wiki component

This separately built GPL-3.0 program reuses `nashsu/llm_wiki` version 0.6.13,
commit `e08cfce65aad8b76b13546a081c1a8d4422b70c3`. Copyright Yong Su and
upstream contributors. The complete upstream license is in `LICENSE`;
`UPSTREAM.json` binds each included original file to its SHA-256 digest.

Original graph, relevance, frontmatter, path and community modules are kept
unchanged in `upstream/lib/`. The semantic projection calls the original
`detectCommunities` implementation with its own evidence-backed semantic graph;
it does not call the upstream Markdown page-network or relevance builder.
The original `ingest.ts` is retained as the
corresponding source for the analysis prompt. `scripts/build-llm-wiki.mjs`
extracts its analysis function, bounds and dependencies using the TypeScript
AST. Generated prompt declarations retain the upstream text. The output
language bridge uses the hosting project's Simplified Chinese policy.
The original browser community worker source is also retained for provenance;
the Node subprocess uses the upstream synchronous community implementation
because it has no browser `Worker` global.

Local adaptations are `engine.ts`, `adapters/virtual-fs.ts`, the JSON-lines
protocol, and `web/`. They are part of this GPL-3.0 component. The engine sees
only the authorized snapshot and source text in one JSON request and generates
its reading pages in memory; it does not open knowledge files or arbitrary
local paths. The virtual-filesystem adapter remains corresponding source for
the earlier page-network integration. Page IDs incorporate the full knowledge-space identity
and record type. Source data and immutable B/C snapshots are not modified.

**Modified 2026-10-24 for Composable Digital Workforce.** Added the read-only
virtual filesystem, authorized A/B/C-to-Markdown projection, opaque page IDs,
semantic-direction metadata, JSON-lines daemon, and standalone build. Added
the generated analysis-prompt bridge, whose Simplified Chinese language rule
replaces the desktop language preference; the selected upstream declarations
remain unchanged. Added the sandbox `web/` interface and its parent-window
JSON protocol. The host lifecycle adapter in `src/knowledge/wiki-runtime.ts`
is separate, data-only code and contains no upstream implementation imports.

**Semantic projection revision, 2026-10-24.** The local adapter now returns
`graph.kind = "semantic"`. This is this integration's graph contract, not a
restriction imposed by the original upstream project. One unordered endpoint
pair has one display edge whose `relations` array preserves all distinct
directed predicates, explicit/inferred basis, article IDs and exact
source-version/line evidence. Edge weight is the number of those relations;
node link count is the number of semantic relations touching that node.
Isolated concepts remain visible. A legacy snapshot without `conceptGraph`
has an empty main graph and still-readable articles; the adapter does not
invent concepts from document structure. Projection performs no model call
and does not rewrite A/B/C snapshots.

Louvain can have multiple valid partitions. A process-local cache holds at most
16 semantic-topology results, keyed only by opaque node IDs, labels, semantic
degrees, endpoint pairs and weights. Adding reading pages reuses that choice
while it is cached; returned assignments and community metadata are cloned.
The unchanged upstream analysis runs on a cache miss. A restart or cache
eviction may select another valid partition; this is not a promise of
deterministic community IDs across restarts.

Install the component's one shared dependency set with
`npm --prefix third_party/llm-wiki ci`, then build with
`node scripts/build-llm-wiki.mjs`. The standalone engine is
`lib/llm-wiki/engine.cjs`; the sandbox webpage is `lib/llm-wiki/web.html`.
The host communicates through JSON only and never imports GPL implementation
code into its existing host/client bundles. Sharing a runtime does not grant
one employee access to another employee's data. Full project identity and
version travel with every request and response.

To rebuild from the npm archive, first restore the root build-tool lock with
`cp build-support/dependencies.lock.json package-lock.json`, run
`npm ci --legacy-peer-deps --ignore-scripts`, and install the component dependency
set as above. Root `esbuild` and `typescript` then build this program without
requiring a Harness source checkout. The component's own package-lock.json is
included directly. No node_modules directory is part of the archive.

The full page projection remains the read-only article, overview and source
navigation index. The main canvas is a separate semantic graph: only validated
concept/entity nodes and explicitly recorded semantic relationships are drawn.
Page links, shared citations and relevance scores cannot introduce canvas edges.
Different predicates and directions between one pair share an edge while retaining
their individual evidence; the displayed relation count counts those statements,
not just endpoint pairs. Degree and Louvain communities use only this semantic
graph. Sources, articles and overview pages stay accessible through the reader
directory and exact citation controls, including when no concepts were extracted.

The original page-network/relevance modules remain unchanged as upstream source
for provenance; they do not generate the main semantic graph.
This integration reuses Louvain analysis and the first-stage analysis prompt. It does not run
the upstream Tauri desktop, agents, auto-updater, or its complete ingest,
research, vector-search, and multimodal pipelines. Models and credentials
remain behind the host's official DSH LLM service.
