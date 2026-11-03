// Mudanças de cardápio em lote (preço, nome, foto, item novo) a partir de um JSON, pela API do painel.
// Cardápio digital e robô do WhatsApp leem o mesmo banco, então mudam juntos. Nunca usa seed.
// Sem --aplicar só mostra o que vai mudar; para se algum item não for achado.
// Uso: node scripts/cardapio-lote.js src/lotes/arquivo.json [--aplicar] [--url ...] [--slug ...] [--pin ...] (ou PIN=...)
// lote.json: [{ "produto": "Alcatra", "categoria": "Espetos", "preco": 14, "nome": "novo nome", "foto": "/demo/...webp" },
//             { "categoria": "Espetos", "preco": 14 },                     (todos da categoria)
//             { "criar": true, "categoria": "Bebidas", "produto": "Corona long neck", "preco": 11 }]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const BASE = opt('url', 'https://brasa-nobre.vercel.app').replace(/\/$/, '');
const SLUG = opt('slug', 'central-do-espeto');
const PIN = opt('pin', process.env.PIN || '1234');
const aplicar = args.includes('--aplicar');
const arquivo = args.find(a => !a.startsWith('--'));
if (!arquivo) { console.log('Informe o lote.json'); process.exit(1); }

const brl = c => (c / 100).toFixed(2).replace('.', ',');
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
let cookie = '';
async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error || ''}`);
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return data;
}

await call(`/api/r/${SLUG}/login`, { method: 'POST', body: { pin: PIN } });
const { products, categories } = await call(`/api/r/${SLUG}/admin`);
const catOf = p => categories.find(c => c.id === p.category_id)?.name || '';
const inCat = (p, cat) => !cat || norm(catOf(p)).startsWith(norm(cat));

const lote = JSON.parse(readFileSync(arquivo, 'utf8'));
const erros = [], updates = [], novos = [];
for (const op of lote) {
  const cents = op.preco != null ? Math.round(Number(op.preco) * 100) : null;
  if (cents != null && !(cents > 0)) { erros.push(`preço inválido: ${JSON.stringify(op)}`); continue; }
  // item novo que já existe (lote rodado de novo): vira mudança comum
  if (op.criar && !products.some(p => norm(p.name) === norm(op.produto))) {
    if (!op.categoria || cents == null) { erros.push(`item novo precisa de categoria e preço: "${op.produto}"`); continue; }
    novos.push({ ...op, cents }); continue;
  }
  const porNome = n => products.filter(p => norm(p.name) === norm(n) && inCat(p, op.categoria));
  // renomeado numa rodada anterior: acha pelo nome novo
  const alvo = op.produto ? (porNome(op.produto).length || !op.nome ? porNome(op.produto) : porNome(op.nome)) : products.filter(p => inCat(p, op.categoria));
  if (!alvo.length || (op.produto && alvo.length > 1)) { erros.push(`${alvo.length ? 'repetido' : 'não achei'}: "${op.produto || op.categoria}"`); continue; }
  for (const p of alvo) {
    const body = {};
    if (cents != null && cents !== p.price_cents) body.price_cents = cents;
    if (op.nome && op.nome !== p.name) body.name = op.nome;
    if (op.foto && op.foto !== p.image_url) body.image_url = op.foto;
    if (Object.keys(body).length) updates.push({ p, body });
  }
}

for (const { p, body } of updates) console.log(`${p.name}: ` + [
  body.price_cents != null && `R$ ${brl(p.price_cents)} -> R$ ${brl(body.price_cents)}`,
  body.name && `nome -> "${body.name}"`, body.image_url && `foto -> ${body.image_url.split('/').pop()}`].filter(Boolean).join(', '));
for (const n of novos) console.log(`NOVO em "${n.categoria}": ${n.produto} R$ ${brl(n.cents)}${n.foto ? ` (foto ${n.foto.split('/').pop()})` : ''}`);
console.log(`${updates.length} item(ns) mudam, ${novos.length} novo(s).`);
if (erros.length) { console.log(`\nNada foi gravado. Corrija o lote:\n- ${erros.join('\n- ')}`); process.exit(1); }
if (!aplicar) { console.log('Conferência apenas. Para gravar, rode de novo com --aplicar.'); process.exit(0); }

for (const { p, body } of updates) await call(`/api/r/${SLUG}/products/${p.id}`, { method: 'PUT', body });
for (const n of novos) {
  const c = categories.find(c => norm(c.name).startsWith(norm(n.categoria)));
  if (!c) throw new Error(`categoria não existe: ${n.categoria}`);
  await call(`/api/r/${SLUG}/products`, { method: 'POST', body: { category_id: c.id, name: n.produto, price_cents: n.cents,
    description: n.descricao || '', image_url: n.foto || '', available: 1, position: 99 } });
}
const depois = (await call(`/api/r/${SLUG}/admin`)).products;
const falhou = [...updates.filter(({ p, body }) => { const d = depois.find(x => x.id === p.id);
  return !d || Object.entries(body).some(([k, v]) => d[k] !== v); }).map(u => u.p.name),
  ...novos.filter(n => !depois.some(p => p.name === n.produto && p.price_cents === n.cents)).map(n => n.produto)];
console.log(falhou.length ? `ATENÇÃO: não gravou ${falhou.join(', ')}` : `Gravado e conferido: ${updates.length} mudança(s), ${novos.length} novo(s).`);
process.exit(falhou.length ? 1 : 0);
