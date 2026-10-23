// Redundancy detection: finds assets that solve the same problem. Combines the curated
// capability tags (strong signal) with TF-IDF similarity over free text (weak signal),
// so it also works when teams describe the same thing in different words.

export interface SimilarityInput {
  id: number;
  name: string;
  type: string;
  description: string;
  purpose: string;
  capabilities: string[];
  tags: string[];
}

export interface SimilarityMatch {
  id: number;
  score: number;
  sharedCapabilities: string[];
  sharedTerms: string[];
}

export interface RedundancyPair extends SimilarityMatch {
  otherId: number;
}

const STOPWORDS = new Set(
  (
    "und oder der die das den dem des ein eine einer eines einem einen mit für fur von vom zum zur im in ist sind wird werden " +
    "auf aus bei als auch an es sich nicht noch nur über uber unter wie wir ihr sie er so zu dass damit durch nach per " +
    "the a an and or of for to in on at by with from is are be this that it as via into using use used based tool tools " +
    "automatisch automatisiert automatische automated agent agents app application anwendung"
  ).split(/\s+/),
);

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

function stem(word: string): string {
  if (word.length > 6 && /(ungen|ieren)$/.test(word)) return word.slice(0, -5);
  if (word.length > 5 && /(en|er|es|ing)$/.test(word)) return word.replace(/(en|er|es|ing)$/, "");
  if (word.length > 4 && word.endsWith("s")) return word.slice(0, -1);
  if (word.length > 4 && word.endsWith("e")) return word.slice(0, -1);
  return word;
}

/** Tokenizes and stems; `surface` (optional) collects a readable word for each stem. */
export function tokenize(text: string, surface?: Map<string, string>): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map((w) => {
      const s = stem(w);
      if (surface && !surface.has(s)) surface.set(s, w);
      return s;
    });
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

interface Doc {
  input: SimilarityInput;
  caps: Set<string>;
  tags: Set<string>;
  vector: Map<string, number>;
  norm: number;
}

function buildDocs(items: SimilarityInput[], surface: Map<string, string>): Doc[] {
  const termLists = items.map((i) =>
    tokenize([i.name, i.name, i.description, i.purpose, i.capabilities.join(" ")].join(" "), surface),
  );
  const df = new Map<string, number>();
  for (const terms of termLists) for (const t of new Set(terms)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = items.length;

  return items.map((input, idx) => {
    const tf = new Map<string, number>();
    for (const t of termLists[idx]) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vector = new Map<string, number>();
    for (const [t, count] of tf) {
      const idf = Math.log((1 + n) / (1 + (df.get(t) ?? 0))) + 1;
      vector.set(t, (1 + Math.log(count)) * idf);
    }
    const norm = Math.sqrt([...vector.values()].reduce((s, v) => s + v * v, 0));
    return {
      input,
      caps: new Set(input.capabilities.map(normalizeTag)),
      tags: new Set(input.tags.map(normalizeTag)),
      vector,
      norm,
    };
  });
}

function compare(a: Doc, b: Doc, surface: Map<string, string>): SimilarityMatch {
  let dot = 0;
  const contributions: [string, number][] = [];
  for (const [t, w] of a.vector) {
    const w2 = b.vector.get(t);
    if (w2) {
      dot += w * w2;
      contributions.push([t, w * w2]);
    }
  }
  const cosine = a.norm && b.norm ? dot / (a.norm * b.norm) : 0;
  const capScore = jaccard(a.caps, b.caps);
  const tagScore = jaccard(a.tags, b.tags);
  const sameType = a.input.type === b.input.type ? 1 : 0;

  // Without curated capabilities fall back to text similarity alone.
  const hasCaps = a.caps.size > 0 && b.caps.size > 0;
  const score = hasCaps
    ? 0.45 * capScore + 0.35 * cosine + 0.1 * tagScore + 0.1 * sameType
    : 0.75 * cosine + 0.15 * tagScore + 0.1 * sameType;

  return {
    id: b.input.id,
    score: Math.round(score * 100) / 100,
    sharedCapabilities: [...a.caps].filter((c) => b.caps.has(c)),
    sharedTerms: contributions
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([t]) => surface.get(t) ?? t),
  };
}

/** Top matches for one (possibly unsaved) asset against the existing inventory. */
export function findSimilar(
  target: SimilarityInput,
  candidates: SimilarityInput[],
  { threshold = 0.25, limit = 5 } = {},
): SimilarityMatch[] {
  const others = candidates.filter((c) => c.id !== target.id);
  const surface = new Map<string, string>();
  const docs = buildDocs([target, ...others], surface);
  const [t, ...rest] = docs;
  return rest
    .map((d) => compare(t, d, surface))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** All pairs above the threshold across the inventory (O(n²) – fine for thousands of assets). */
export function findRedundancyPairs(items: SimilarityInput[], threshold: number): RedundancyPair[] {
  const surface = new Map<string, string>();
  const docs = buildDocs(items, surface);
  const pairs: RedundancyPair[] = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const m = compare(docs[i], docs[j], surface);
      if (m.score >= threshold) pairs.push({ ...m, id: docs[i].input.id, otherId: docs[j].input.id });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}
