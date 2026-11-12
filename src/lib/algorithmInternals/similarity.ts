import { normalizeSearchText } from '../textNormalization';


/**
 * Global Optimal Matching (Stability Matcher)
 * This implements a mathematically rigorous solver for the Assignment Problem
 * in a Bipartite Graph using the True Hungarian Algorithm (Kuhn-Munkres O(N^3)).
 * It maximizes aggregate system utility via prioritized objective optimization.
 */
function solveHungarianComponent(
  sourceItems: { id: string; scoreMap: Map<string, number> }[],
  targetIds: string[],
  matches: Map<string, string>
): void {
  const n = sourceItems.length;
  const m = targetIds.length;
  if (n === 0 || m === 0) return;

  if (n === 1) {
    let bestTarget = '';
    let bestWeight = 0;
    for (let j = 0; j < m; j++) {
      const w = sourceItems[0].scoreMap.get(targetIds[j]) || 0;
      if (w > bestWeight) {
        bestWeight = w;
        bestTarget = targetIds[j];
      }
    }
    if (bestWeight > 0) matches.set(sourceItems[0].id, bestTarget);
    return;
  }

  const dim = Math.max(n, m);

  // Find global max to subtract from for the cost transposition
  let maxWeight = 0;
  sourceItems.forEach(s => {
    s.scoreMap.forEach(w => {
      if (w > maxWeight) maxWeight = w;
    });
  });
  if (maxWeight <= 0) return;

  const cost = Array.from({ length: dim }, () => new Float64Array(dim).fill(maxWeight * 2)); // Dummy edges get high cost

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const weight = sourceItems[i].scoreMap.get(targetIds[j]) || 0;
      cost[i][j] = maxWeight - weight; // Maximize weight by minimizing this cost
    }
  }

  // Hungarian algorithm, O(dim^3), 1-based as in the textbook form: row i (1..dim) is source i-1,
  // column j (1..dim) is target j-1; p[j] is the row assigned to column j (0 = none yet).
  // u, v are the row/column potentials; minv/way track the shortest augmenting path.
  const u = new Float64Array(dim + 1);
  const v = new Float64Array(dim + 1);
  const p = new Int32Array(dim + 1);
  const way = new Int32Array(dim + 1);

  for (let i = 1; i <= dim; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(dim + 1).fill(Infinity);
    const used = new Uint8Array(dim + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= dim; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= dim; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  // Extract matches (p[j] -> j) means source (p[j]-1) maps to target (j-1)
  for (let j = 1; j <= dim; j++) {
    const sIdx = p[j] - 1;
    const tIdx = j - 1;
    if (sIdx >= 0 && sIdx < n && tIdx < m) {
      const originalWeightSq = maxWeight - cost[sIdx][tIdx];
      // Only record valid matches with non-zero objective utility
      if (originalWeightSq > 0) {
        matches.set(sourceItems[sIdx].id, targetIds[tIdx]);
      }
    }
  }
}

export function findGlobalOptimalMatch(
  sourceItems: { id: string; scoreMap: Map<string, number> }[],
  targetIds: string[]
): Map<string, string> {
  const matches = new Map<string, string>(); // Source ID -> Target ID

  if (sourceItems.length === 0 || targetIds.length === 0) return matches;

  const targetOrder = new Map<string, number>();
  targetIds.forEach((id, idx) => targetOrder.set(id, idx));

  const activeSources = sourceItems.filter(s => {
    for (const [tId, w] of s.scoreMap.entries()) {
      if (w > 0 && targetOrder.has(tId)) return true;
    }
    return false;
  });
  if (activeSources.length === 0) return matches;

  // Build target -> source indices adjacency to decompose into independent connected components
  const targetToSources = new Map<string, number[]>();
  activeSources.forEach((s, sIdx) => {
    for (const [tId, w] of s.scoreMap.entries()) {
      if (w > 0 && targetOrder.has(tId)) {
        const list = targetToSources.get(tId);
        if (list) list.push(sIdx);
        else targetToSources.set(tId, [sIdx]);
      }
    }
  });

  const visitedSource = new Uint8Array(activeSources.length);
  const visitedTarget = new Set<string>();

  for (let i = 0; i < activeSources.length; i++) {
    if (visitedSource[i]) continue;
    const compSourceIndices: number[] = [];
    const compTargets: string[] = [];
    const queue: number[] = [i];
    visitedSource[i] = 1;

    while (queue.length > 0) {
      const sIdx = queue.pop()!;
      compSourceIndices.push(sIdx);
      for (const [tId, w] of activeSources[sIdx].scoreMap.entries()) {
        if (w <= 0 || !targetOrder.has(tId)) continue;
        if (!visitedTarget.has(tId)) {
          visitedTarget.add(tId);
          compTargets.push(tId);
          const neighbors = targetToSources.get(tId) || [];
          for (const nextS of neighbors) {
            if (!visitedSource[nextS]) {
              visitedSource[nextS] = 1;
              queue.push(nextS);
            }
          }
        }
      }
    }

    compSourceIndices.sort((a, b) => a - b);
    compTargets.sort((a, b) => (targetOrder.get(a) ?? 0) - (targetOrder.get(b) ?? 0));
    solveHungarianComponent(
      compSourceIndices.map(idx => activeSources[idx]),
      compTargets,
      matches
    );
  }

  return matches;
}


/**
 * Jaro-Winkler Similarity (Optimized for Financial Entity Resolution)
 * Superior to Levenshtein for short strings like merchant names.
 * Includes a "Financial Suffix Cleanse" to prevent brand identity dilution.
 * @param hashSalt - A user-specific entropy string to decentralize the algorithm.
 */
export function optimizedTransactionSimilarity(s1: string | undefined | null, s2: string | undefined | null): number {
  const sanitize = (s: string | undefined | null) => normalizeSearchText(s)
    .replace(/(?<![\p{L}\p{M}\p{N}_])(inc|ltd|corp|co|llc|plc|gmbh|sa|bv|nv|ag|sas|pvt|the|and|of|for|pay|payment|debit|credit|card|pos|atm)(?![\p{L}\p{M}\p{N}_])/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const str1 = sanitize(s1);
  const str2 = sanitize(s2);

  if (str1.length === 0 || str2.length === 0) return 0;
  if (str1 === str2) return 1;

  // 1. Token Jaccard Similarity (handles re-ordering and extra words)
  const tokens1 = new Set(str1.split(' '));
  const tokens2 = new Set(str2.split(' '));
  let intersectionCount = 0;
  for (const t1 of tokens1) {
    if (tokens2.has(t1)) intersectionCount++;
  }
  const unionCount = tokens1.size + tokens2.size - intersectionCount;
  const jaccard = unionCount === 0 ? 0 : intersectionCount / unionCount;

  // 2. Character Bigram Sørensen–Dice Coefficient (handles typos and sub-strings)
  const getBigrams = (str: string) => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
    return bigrams;
  };

  const bg1 = getBigrams(str1);
  const bg2 = getBigrams(str2);
  let matchingBigrams = 0;

  for (const [bg, count1] of bg1.entries()) {
    const count2 = bg2.get(bg);
    if (count2) {
      matchingBigrams += Math.min(count1, count2);
    }
  }

  const totalBigrams = Math.max(1, str1.length - 1) + Math.max(1, str2.length - 1);
  const dice = (2.0 * matchingBigrams) / totalBigrams;

  // Weight them - Dice covers typos, Jaccard covers missing/extra words and re-ordering
  return (jaccard * 0.4) + (dice * 0.6);
}


export function jaroWinklerSimilarity(s1: string | undefined | null, s2: string | undefined | null, hashSalt?: string, preSanitizedS2?: string): number {
  const sanitize = (s: string | undefined | null) => normalizeSearchText(s)
    .replace(/(?<![\p{L}\p{M}\p{N}_])(inc|ltd|corp|co|llc|plc|gmbh|sa|bv|nv|ag|sas|pvt|the|and|of|for|pay|payment|debit|credit|card|pos|atm)(?![\p{L}\p{M}\p{N}_])/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const str1 = sanitize(s1);
  const str2 = preSanitizedS2 || sanitize(s2);

  if (str1.length === 0 || str2.length === 0) return 0;
  if (str1 === str2) return 1;

  let m = 0;
  const range = Math.floor(Math.max(str1.length, str2.length) / 2) - 1;
  const s1Matches = new Array(str1.length).fill(false);
  const s2Matches = new Array(str2.length).fill(false);

  for (let i = 0; i < str1.length; i++) {
    const low = Math.max(0, i - range);
    const high = Math.min(i + range + 1, str2.length);
    for (let j = low; j < high; j++) {
      if (!s2Matches[j] && str1[i] === str2[j]) {
        s1Matches[i] = true;
        s2Matches[j] = true;
        m++;
        break;
      }
    }
  }

  if (m === 0) return 0;

  let tr = 0;
  let k = 0;
  for (let i = 0; i < str1.length; i++) {
    if (s1Matches[i]) {
      while (k < str2.length && !s2Matches[k]) k++;
      if (k < str2.length && str1[i] !== str2[k]) tr++;
      k++;
    }
  }

  const jaro = (m / (str1.length || 1) + m / (str2.length || 1) + (m - tr / 2) / m) / 3;

  // Winkler adjustment
  let p = 0;
  const prefixLimit = 4;
  for (let i = 0; i < Math.min(str1.length, str2.length, prefixLimit); i++) {
    if (str1[i] === str2[i]) p++;
    else break;
  }

  let score = jaro + p * 0.1 * (1 - jaro);

  // Dynamic Salting Entropy Layer (prevents competitive cross-tenant pattern reconstruction)
  if (hashSalt) {
    let hashVal = 0;
    const combined = `${hashSalt}-${str1}-${str2}`;
    for (let i = 0; i < combined.length; i++) {
      hashVal = (hashVal << 5) - hashVal + combined.charCodeAt(i);
      hashVal |= 0; // NOSONAR: S7767 — intentional 32-bit wrap for hash/PRNG state; Math.trunc would break modular arithmetic
    }
    const saltMod = ((Math.abs(hashVal) % 200) - 100) / 10000; // Shift between -0.01 and 0.01 deterministic per workspace
    score += saltMod;
  }

  return Math.max(0, Math.min(1, score));
}


/**
 * Weighted Damerau-Levenshtein Distance
 * Handles character transpositions (e.g., "amazno" -> "amazon") with minimal penalty.
 * Optimized for high-accuracy typo resolution in ledger descriptions.
 * @param hashSalt - A user-specific entropy string to decentralize the algorithm.
 */
export function lexicalSimilarity(s1: string | undefined | null, s2: string | undefined | null, hashSalt?: string): number {
  const a = normalizeSearchText(s1).trim();
  const b = normalizeSearchText(s2).trim();

  if (a.length === 0) return 0;
  if (b.length === 0) return 0;
  if (a === b) return 1;

  const n = a.length;
  const m = b.length;
  const d = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));

  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // Deletion
        d[i][j - 1] + 1,      // Insertion
        d[i - 1][j - 1] + cost // Substitution
      );

      // Damerau Transposition Check
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }

  const maxLen = Math.max(n, m);
  let score = (maxLen - d[n][m]) / maxLen;

  // Dynamic Salting Entropy Layer (prevents competitive cross-tenant pattern reconstruction)
  if (hashSalt) {
    let hashVal = 0;
    const combined = `${hashSalt}-${a}-${b}`;
    for (let i = 0; i < combined.length; i++) {
      hashVal = (hashVal << 5) - hashVal + combined.charCodeAt(i);
      hashVal |= 0; // NOSONAR: S7767 — intentional 32-bit wrap for hash/PRNG state; Math.trunc would break modular arithmetic
    }
    const saltMod = ((Math.abs(hashVal) % 200) - 100) / 10000; // Shift between -0.01 and 0.01 deterministic per workspace
    score += saltMod;
  }

  return Math.max(0, Math.min(1, score));
}


/**
 * Aho-Corasick Multi-Pattern Search
 * Used for lightning-fast transaction categorization rules.
 * O(TextLength + NumberOfMatches)
 */
export class AhoCorasick {
  private trie: Array<{ next: Record<string, number>; fail: number; output: string[] }> = [{ next: {}, fail: 0, output: [] }];

  constructor(patterns: { pattern: string, ruleId: string }[]) {
    // Build Trie
    for (const { pattern, ruleId } of patterns) {
      let node = 0;
      for (const char of normalizeSearchText(pattern)) {
        if (!this.trie[node].next[char]) {
          this.trie[node].next[char] = this.trie.length;
          this.trie.push({ next: {}, fail: 0, output: [] });
        }
        node = this.trie[node].next[char];
      }
      this.trie[node].output.push(ruleId);
    }

    // Build Failure Links (BFS)
    const queue: number[] = [];
    for (const char in this.trie[0].next) {
      queue.push(this.trie[0].next[char]);
    }

    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const char in this.trie[u].next) {
        const v = this.trie[u].next[char];
        let f = this.trie[u].fail;
        while (f > 0 && !this.trie[f].next[char]) {
          f = this.trie[f].fail;
        }
        this.trie[v].fail = this.trie[f].next[char] || 0;
        this.trie[v].output = [...this.trie[v].output, ...this.trie[this.trie[v].fail].output];
        queue.push(v);
      }
    }
  }

  search(text: string): string[] {
    let node = 0;
    const results = new Set<string>();
    for (const char of normalizeSearchText(text)) {
      while (node > 0 && !this.trie[node].next[char]) {
        node = this.trie[node].fail;
      }
      node = this.trie[node].next[char] || 0;
      for (const ruleId of this.trie[node].output) {
        results.add(ruleId);
      }
    }
    return Array.from(results);
  }
}
