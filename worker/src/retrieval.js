/* Small BM25 search so each question only sends the few relevant chunks to the model.
 * This keeps every request tiny, which matters on Groq's free tier (8K tokens per minute). */

const STOP = new Set(('a an the and or but of to in on for with at by from as is are was were be been being ' +
  'do does did you your yours i me my we our it its this that these those what which who whom how when where why ' +
  'can could would should will shall have has had having about tell any some more most very also into than then ' +
  'there their they them he she his her if so not no yes please give show list know like want vedanshi').split(' '));
const IRREGULAR = { built: 'build', building: 'build', builds: 'build', used: 'use', using: 'use', uses: 'use',
  worked: 'work', working: 'work', works: 'work', studied: 'study', studies: 'study' };

export function stem(w) {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
const words = (t) => String(t).toLowerCase().match(/[a-z0-9+#]+/g) || [];
const terms = (t) => words(t).filter((w) => !STOP.has(w)).map(stem);

export function buildIndex(chunks) {
  const docs = chunks.map((c) => {
    const counts = new Map();
    let len = 0;
    for (const t of terms(`${c.title} ${c.text}`)) { counts.set(t, (counts.get(t) || 0) + 1); len++; }
    return { chunk: c, counts, len };
  });
  const df = new Map();
  let total = 0;
  for (const d of docs) {
    total += d.len;
    for (const t of d.counts.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  return { docs, df, avg: docs.length ? total / docs.length : 1 };
}

export function search(index, query, limit = 5) {
  const K1 = 1.3, B = 0.7, N = index.docs.length;
  const q = [...new Set(terms(query))];
  const scored = [];
  for (const d of index.docs) {
    let score = 0;
    for (const t of q) {
      const f = d.counts.get(t);
      if (!f) continue;
      const n = index.df.get(t);
      score += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / index.avg))));
    }
    if (score > 0) scored.push({ chunk: d.chunk, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
