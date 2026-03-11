import type { Action } from "./registry";

export interface MatchResult {
  action: Action;
  score: number;
  ranges: [number, number][]; // highlight ranges in label
}

export function fuzzyMatch(query: string, items: Action[]): MatchResult[] {
  if (!query) return items.map((a) => ({ action: a, score: 0, ranges: [] }));

  const q = query.toLowerCase();
  const results: MatchResult[] = [];

  for (const action of items) {
    const label = action.label.toLowerCase();
    const keywords = action.keywords.join(" ").toLowerCase();

    // Check substring match in label
    const labelIdx = label.indexOf(q);
    if (labelIdx !== -1) {
      results.push({
        action,
        score: 100 - labelIdx, // earlier match = higher score
        ranges: [[labelIdx, labelIdx + q.length]],
      });
      continue;
    }

    // Check substring match in keywords
    if (keywords.includes(q)) {
      results.push({ action, score: 50, ranges: [] });
      continue;
    }

    // Check category match
    if (action.category.toLowerCase().includes(q)) {
      results.push({ action, score: 30, ranges: [] });
      continue;
    }

    // Character-by-character fuzzy match on label
    let qi = 0;
    const ranges: [number, number][] = [];
    let start = -1;

    for (let i = 0; i < label.length && qi < q.length; i++) {
      if (label[i] === q[qi]) {
        if (start === -1) start = i;
        qi++;
      } else if (start !== -1) {
        ranges.push([start, i]);
        start = -1;
      }
    }
    if (start !== -1) ranges.push([start, start + (qi - (ranges.length > 0 ? ranges.reduce((s, r) => s + r[1] - r[0], 0) : 0))]);

    if (qi === q.length) {
      results.push({ action, score: 10, ranges });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

export function highlightLabel(label: string, ranges: [number, number][]): (string | { text: string; highlight: true })[] {
  if (ranges.length === 0) return [label];

  const parts: (string | { text: string; highlight: true })[] = [];
  let last = 0;

  for (const [start, end] of ranges) {
    if (start > last) parts.push(label.slice(last, start));
    parts.push({ text: label.slice(start, end), highlight: true });
    last = end;
  }
  if (last < label.length) parts.push(label.slice(last));

  return parts;
}
