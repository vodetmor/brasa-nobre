// Limite simples em memória (janela deslizante). Protege contra trote e clique repetido.
const hits = new Map();

export function allow(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(now);
  hits.set(key, list);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) if (!list.some(t => now - t < 10 * 60_000)) hits.delete(k);
}, 60_000).unref();
