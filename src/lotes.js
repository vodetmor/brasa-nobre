// Lotes de mudança de cardápio aplicados sozinhos ao subir o app (Vercel), uma vez cada (marca em meta).
// Serve para trocar preço, nome e foto, ou criar item, sem seed (o seed apaga pedidos) e sem precisar
// do painel. Itens são achados pelo nome; o que não for achado é pulado e anotado no log.
import { readFileSync } from 'node:fs';
import { get, all, run, tx, engine } from './db.js';
import * as S from './services.js';

const LOTES = [
  { id: 'central-2026-11-03', slug: 'central-do-espeto', file: 'central-2026-11-03.json' },
  { id: 'central-2026-11-03-espetos-13', slug: 'central-do-espeto', file: 'central-2026-11-03-espetos-13.json' },
  { id: 'central-2026-11-05', slug: 'central-do-espeto', file: 'central-2026-11-05.json' },
  { id: 'central-2026-11-06-fotos', slug: 'central-do-espeto', file: 'central-2026-11-06-fotos.json' },
];

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function applyLotes({ log = console.log } = {}) {
  for (const l of LOTES) {
    await tx(async () => {
      if (engine === 'postgres') await run('SELECT pg_advisory_xact_lock(4244)');
      if (await get('SELECT value FROM meta WHERE key = ?', `lote:${l.id}`)) return;
      const r = await get('SELECT id FROM restaurants WHERE slug = ?', l.slug);
      if (!r) return;
      const ops = JSON.parse(readFileSync(new URL(`./lotes/${l.file}`, import.meta.url), 'utf8'));
      const cats = await all('SELECT id, name FROM categories WHERE restaurant_id = ?', r.id);
      const catIds = name => cats.filter(c => norm(c.name).startsWith(norm(name))).map(c => c.id);
      const skipped = [];
      for (const op of ops) {
        const products = await all('SELECT * FROM products WHERE restaurant_id = ?', r.id);
        const inCat = p => !op.categoria || catIds(op.categoria).includes(p.category_id);
        const byName = n => products.filter(p => norm(p.name) === norm(n) && inCat(p));
        const data = {};
        if (op.preco != null) data.price_cents = Math.round(Number(op.preco) * 100);
        if (op.nome) data.name = op.nome;
        if (op.foto) data.image_url = op.foto;
        if (op.opcoes != null) data.options = op.opcoes;
        if (op.disponivel != null) data.available = op.disponivel ? 1 : 0;
        if (op.criar && !products.some(p => norm(p.name) === norm(op.produto))) {
          const [category_id] = catIds(op.categoria);
          if (!category_id) { skipped.push(op.produto); continue; }
          await S.saveProduct(r.id, { category_id, name: op.produto, description: op.descricao || '', available: 1, position: 99, ...data });
          continue;
        }
        const alvo = op.produto ? (byName(op.produto).length || !op.nome ? byName(op.produto) : byName(op.nome)) : products.filter(inCat);
        if (!alvo.length || (op.produto && alvo.length > 1)) { skipped.push(op.produto || op.categoria); continue; }
        for (const p of alvo) await S.saveProduct(r.id, { id: p.id, ...data });
      }
      await run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        `lote:${l.id}`, new Date().toISOString() + (skipped.length ? ` pulados: ${skipped.join(', ')}` : ''));
      log(`lote ${l.id} aplicado${skipped.length ? ` (pulados: ${skipped.join(', ')})` : ''}`);
    });
  }
}
