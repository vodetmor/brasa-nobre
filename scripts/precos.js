// Troca de preços em lote, a partir de uma planilha (CSV "Produto;Preço"). O cardápio digital e o robô do
// WhatsApp leem o preço do mesmo banco, então mudar aqui muda os dois.
// Sem --aplicar só mostra o que vai mudar. Para se algum nome da planilha não existir no cardápio.
// Uso:
//   node scripts/precos.js --exportar precos.csv                 (gera a planilha com os preços de hoje)
//   node scripts/precos.js precos.csv                            (confere: mostra antes -> depois)
//   node scripts/precos.js precos.csv --aplicar                  (grava)
//   --criar: item que não existe e tem Categoria na linha vira produto novo (e a categoria, se faltar)
// Opções: --url https://brasa-nobre.vercel.app  --slug central-do-espeto  --pin 1234 (ou PIN=... no ambiente)
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const BASE = opt('url', 'https://brasa-nobre.vercel.app').replace(/\/$/, '');
const SLUG = opt('slug', 'central-do-espeto');
const PIN = opt('pin', process.env.PIN || '1234');
const exportar = opt('exportar', null);
const aplicar = args.includes('--aplicar');
const criar = args.includes('--criar');
const arquivo = args.find(a => !a.startsWith('--'));

const brl = c => (c / 100).toFixed(2).replace('.', ',');
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

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
const catName = id => categories.find(c => c.id === id)?.name || '';

if (exportar) {
  const linhas = ['Categoria;Produto;Preço', ...products.map(p => `${catName(p.category_id)};${p.name};${brl(p.price_cents)}`)];
  writeFileSync(exportar, linhas.join('\n') + '\n');
  console.log(`${products.length} produtos em ${exportar}. Mude só a coluna Preço e rode de novo com o arquivo.`);
  process.exit(0);
}
if (!arquivo) { console.log('Informe a planilha (ou --exportar arquivo.csv).'); process.exit(1); }

// aceita "Produto;Preço" ou "Categoria;Produto;Preço"; preço "12", "12,50" ou "R$ 12,50"
const linhas = readFileSync(arquivo, 'utf8').split(/\r?\n/).map(l => l.split(';').map(c => c.trim())).filter(c => c.length >= 2 && c.some(Boolean));
if (linhas.length && !/\d/.test(linhas[0].at(-1))) linhas.shift(); // cabeçalho
const erros = [], mudancas = [], novos = [];
for (const c of linhas) {
  const nome = c.at(-2), cat = c.length >= 3 ? c.at(-3) : '';
  const preco = Math.round(Number(c.at(-1).replace(/r\$\s*/i, '').replace(/\./g, '').replace(',', '.')) * 100);
  if (!(preco > 0)) { erros.push(`preço inválido: "${c.join(';')}"`); continue; }
  const achados = products.filter(p => norm(p.name) === norm(nome) && (!cat || norm(catName(p.category_id)) === norm(cat)));
  if (!achados.length && criar && cat) { novos.push({ nome, cat, preco }); continue; }
  if (achados.length !== 1) { erros.push(`${achados.length ? 'nome repetido (informe a categoria)' : 'não existe no cardápio'}: "${nome}"`); continue; }
  const p = achados[0];
  if (p.price_cents !== preco) mudancas.push({ p, preco });
}

for (const m of mudancas) console.log(`${m.p.name}: R$ ${brl(m.p.price_cents)} -> R$ ${brl(m.preco)}`);
for (const n of novos) console.log(`NOVO em "${n.cat}"${categories.some(c => norm(c.name) === norm(n.cat)) ? '' : ' (categoria nova)'}: ${n.nome} R$ ${brl(n.preco)}`);
console.log(`${mudancas.length} preço(s) mudam, ${novos.length} item(ns) novo(s), ${linhas.length - mudancas.length - novos.length - erros.length} iguais.`);
if (erros.length) { console.log(`\nNada foi gravado. Corrija a planilha:\n- ${erros.join('\n- ')}`); process.exit(1); }
if (!aplicar) { console.log('Conferência apenas. Para gravar, rode de novo com --aplicar.'); process.exit(0); }

for (const m of mudancas) await call(`/api/r/${SLUG}/products/${m.p.id}`, { method: 'PUT', body: { price_cents: m.preco } });
for (const n of novos) {
  let c = categories.find(c => norm(c.name) === norm(n.cat));
  if (!c) categories.push(c = await call(`/api/r/${SLUG}/categories`, { method: 'POST', body: { name: n.cat, position: categories.length } }));
  await call(`/api/r/${SLUG}/products`, { method: 'POST', body: { category_id: c.id, name: n.nome, price_cents: n.preco, available: 1, position: 99 } });
}
const depois = (await call(`/api/r/${SLUG}/admin`)).products;
const falhou = [...mudancas.filter(m => depois.find(p => p.id === m.p.id)?.price_cents !== m.preco).map(m => m.p.name),
  ...novos.filter(n => !depois.some(p => norm(p.name) === norm(n.nome) && p.price_cents === n.preco)).map(n => n.nome)];
console.log(falhou.length ? `ATENÇÃO: não gravou ${falhou.join(', ')}` : `Gravado e conferido: ${mudancas.length} preço(s), ${novos.length} item(ns) novo(s).`);
process.exit(falhou.length ? 1 : 0);
