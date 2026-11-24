import type { Analysis, Edge, Step } from './types';

export function applyDraft(analysis: Analysis, step: Step, edges: Edge[]): Analysis {
  const changes = new Map(edges.map(edge => [edge.id, edge]));
  return {
    ...analysis,
    steps: analysis.steps.map(original => original.id === step.id ? step : original),
    edges: analysis.edges.map(original => changes.get(original.id) ?? original),
  };
}
