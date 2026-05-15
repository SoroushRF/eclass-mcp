import type { SelectorCandidate } from './registry';

export interface DomSelectorMatch<T extends Element = Element> {
  candidateId: string;
  selector: string;
  count: number;
  elements: T[];
}

export type SelectorCounts = Record<string, number>;

export function collectSelectorCounts(
  root: ParentNode,
  candidates: readonly SelectorCandidate[]
): SelectorCounts {
  const counts: SelectorCounts = {};
  for (const candidate of candidates) {
    counts[candidate.selector] = root.querySelectorAll(
      candidate.selector
    ).length;
  }
  return counts;
}

export function queryAllFromFirstWinningGroup<T extends Element = Element>(
  root: ParentNode,
  candidates: readonly SelectorCandidate[]
): DomSelectorMatch<T> | null {
  for (const candidate of candidates) {
    const elements = Array.from(root.querySelectorAll<T>(candidate.selector));
    if (elements.length > 0) {
      return {
        candidateId: candidate.id,
        selector: candidate.selector,
        count: elements.length,
        elements,
      };
    }
  }
  return null;
}

export function queryFirstFromGroup<T extends Element = Element>(
  root: ParentNode,
  candidates: readonly SelectorCandidate[]
): (Omit<DomSelectorMatch<T>, 'elements'> & { element: T }) | null {
  const match = queryAllFromFirstWinningGroup<T>(root, candidates);
  if (!match) return null;
  return {
    candidateId: match.candidateId,
    selector: match.selector,
    count: match.count,
    element: match.elements[0],
  };
}
