// GPL-3.0. Generated from the pinned upstream ingest.ts; source declarations are unchanged.
// Adaptation: output-language preferences use the hosting project Chinese policy instead of Tauri stores.
function languageRule(_sourceContent = ""): string { return "Write the final analysis in Simplified Chinese. Preserve original proper nouns, code identifiers, citations, and technical terms."; }

const WIKI_INDEX_PROMPT_MAX_CHARS = 32_000

const ENTITY_ANALYSIS_RULES = [
  "Apply a standalone-page significance threshold: page-worthy subjects are central to the source, recur meaningfully, carry substantive claims, or are reusable across the wiki.",
  "Do not mark passing mentions, ordinary story props, unnamed or generic-role people, chapter/part labels, or internal workflow artifacts as page-worthy unless the source makes them independently important knowledge subjects.",
  "For every candidate, output `Page-worthy: yes` or `Page-worthy: no` plus one short justification. Keep non-page-worthy candidates only as context for the source summary.",
  "Canonical naming priority: reuse the exact title of an existing wiki page first; otherwise preserve the source spelling. Widely used localized names may be recorded as aliases, but never invent or phonetically guess a name.",
] as const

const ANALYSIS_OUTPUT_LIMITS = [
  "HARD OUTPUT LIMITS: a response exceeding these limits is invalid.",
  "- Key Entities: at most 25 candidates, one compact line per candidate, no table.",
  "- Key Concepts: at most 25 entries.",
  "- Main Arguments & Findings: at most 15 entries.",
  "- Connections, Contradictions, and Recommendations: at most 8 entries per section.",
  "- Total response: at most 16,000 characters. Prefer high-value reusable knowledge over exhaustive enumeration.",
] as const

export function buildAnalysisPrompt(
  purpose: string,
  index: string,
  sourceContent: string = "",
  schema: string = "",
): string {
  return [
    "You are an expert research analyst. Read the source document and produce a structured analysis.",
    "Do not output chain-of-thought, hidden reasoning, or a thinking transcript. Reason internally and write only the concise final analysis.",
    "",
    languageRule(sourceContent),
    "",
    "Your analysis should cover:",
    ...ANALYSIS_OUTPUT_LIMITS,
    "",
    "## Key Entities",
    "List candidate named people, organizations, products, datasets, and tools. For each:",
    "- Name and type",
    "- Role and significance in the source",
    "- Whether it likely already exists in the wiki (check the index)",
    ...ENTITY_ANALYSIS_RULES,
    "",
    "## Key Concepts",
    "List theories, methods, techniques, phenomena. For each:",
    "- Name and brief definition",
    "- Why it matters in this source",
    "- Whether it likely already exists in the wiki",
    "",
    "## Main Arguments & Findings",
    "- What are the core claims or results?",
    "- What evidence supports them?",
    "- How strong is the evidence?",
    "- Which named subject is each claim about? Do not transfer claims, limits, or evaluations from one entity/model/product/method to another just because they share keywords.",
    "- Preserve structured source data verbatim in the analysis when present: include SQL DDL / CREATE TABLE statements, schema definitions, API signatures, configuration, and tables in fenced code blocks or Markdown tables. Do not reduce exact field names, types, constraints, keys, or indexes to prose.",
    "",
    "## Connections to Existing Wiki",
    "- What existing pages does this source relate to?",
    "- Does it strengthen, challenge, or extend existing knowledge?",
    "",
    "## Contradictions & Tensions",
    "- Does anything in this source conflict with existing wiki content?",
    "- Are there internal tensions or caveats?",
    "",
    "## Recommendations",
    "- What wiki pages should be created or updated?",
    "- If the project schema (below) defines page types beyond entity/concept (e.g. goal, habit, reflection, finding, decision, meeting), and the source genuinely contains matching content, recommend pages of those types — name the type explicitly. Only when the source actually supports it; never invent goals/habits/journal entries that aren't in the source.",
    "- What should be emphasized vs. de-emphasized?",
    "- Any open questions worth flagging for the user?",
    "",
    "Be thorough but concise. Focus on what's genuinely important.",
    "",
    "If a folder context is provided, use it as a hint for categorization — the folder structure often reflects the user's organizational intent (e.g., 'papers/energy' suggests the file is an energy-related paper).",
    "",
    schema
      ? `## Project Schema (page types available — map source content to schema-defined types when it fits)\n${schema}`
      : "",
    purpose ? `## Wiki Purpose (for context)\n${purpose}` : "",
    index ? `## Current Wiki Index (for checking existing content)\n${boundWikiIndexForPrompt(index)}` : "",
  ].filter(Boolean).join("\n")
}

export function boundWikiIndexForPrompt(
  index: string,
  maxChars = WIKI_INDEX_PROMPT_MAX_CHARS,
): string {
  const safeMax = Math.max(1_000, Math.floor(maxChars))
  if (index.length <= safeMax) return index
  const marker = "\n\n[...middle of wiki index omitted for prompt budget...]\n\n"
  const available = Math.max(1, safeMax - marker.length)
  const headLength = Math.floor(available * 0.6)
  const tailLength = available - headLength
  const rawHead = index.slice(0, headLength)
  const rawTail = index.slice(-tailLength)
  const head = (rawHead.includes("\n") ? rawHead.replace(/\n[^\n]*$/, "") : rawHead).trimEnd()
  const tail = (rawTail.includes("\n") ? rawTail.replace(/^[^\n]*\n?/, "") : rawTail).trimStart()
  return `${head}${marker}${tail}`
}
