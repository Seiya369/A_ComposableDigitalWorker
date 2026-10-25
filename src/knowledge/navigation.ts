import type { KnowledgeCitation, KnowledgeOverview, KnowledgeSnapshot } from './types.js';

export function knowledgeSnapshotCitations(snapshot: KnowledgeSnapshot): KnowledgeCitation[] {
  return [...snapshot.entries.flatMap(entry => entry.citations),
    ...(snapshot.conceptGraph?.concepts.flatMap(concept => concept.citations) ?? []),
    ...(snapshot.conceptGraph?.relations.flatMap(relation => relation.citations) ?? []),
  ];
}

/** Concepts also provide the agent's bounded C navigation into versioned B articles. */
export function knowledgeNavigation(snapshot: KnowledgeSnapshot): KnowledgeOverview[] {
  const graph = snapshot.conceptGraph;
  if (!graph?.concepts.length) return snapshot.overview;
  const concepts = new Map(graph.concepts.map(concept => [concept.id, concept]));
  return graph.concepts.map(concept => {
    const relations = graph.relations.filter(relation => relation.sourceId === concept.id || relation.targetId === concept.id);
    return {
      id: `concept:${concept.id}`, title: concept.name, entryIds: [...concept.entryIds],
      summary: [concept.summary,
        ...(concept.aliases?.length ? [`别名：${concept.aliases.join('、')}`] : []),
        ...relations.map(relation => `${concepts.get(relation.sourceId)?.name ?? relation.sourceId} —${relation.predicate}→ ${concepts.get(relation.targetId)?.name ?? relation.targetId}${relation.basis === 'inferred' ? '（待验证推断）' : ''}`),
      ].filter(Boolean).join('\n'),
    };
  });
}
