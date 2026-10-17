// Busca fotos reais no Pexels para os pratos sem foto própria e salva em uploads/<restaurante>/.
// Uso: npm run fotos                (todos os restaurantes)
//      npm run fotos -- brasa-nobre (só um)   --force refaz todas
// Precisa de PEXELS_API_KEY no .env (chave grátis em https://www.pexels.com/api/).
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { all, run } from '../src/db.js';
import { ROOT } from '../src/config.js';

const KEY = process.env.PEXELS_API_KEY;
if (!KEY) console.log('Fotos: sem PEXELS_API_KEY no .env; só os modelos 3D serão baixados.');
const force = process.argv.includes('--force');
const only = process.argv.slice(2).find(a => !a.startsWith('--'));

// Termos de busca que funcionam melhor que o nome do prato (o Pexels é mais forte em inglês).
// Prato sem termo aqui é buscado pelo próprio nome.
const QUERY = {
  'Espetinho de carne': 'beef skewer grill',
  'Espetinho de frango': 'chicken skewers grilled',
  'Espetinho de linguiça': 'grilled sausage skewer',
  'Queijo coalho': 'grilled cheese skewer',
  'Coração de frango': 'chicken hearts skewer',
  'Espetinho misto': 'mixed meat skewers barbecue',
  'Jantinha da casa': 'brazilian food plate rice beans meat',
  'Jantinha dupla': 'barbecue plate rice beans',
  'Prato executivo': 'steak rice beans salad plate',
  'Mandioca na manteiga': 'cassava',
  'Feijão tropeiro': 'feijoada beans dish',
  'Vinagrete': 'pico de gallo',
  'Guacamole com chips': 'guacamole chips',
  'Guacamole com nachos': 'guacamole nachos',
  'Refrigerante lata': 'soda can ice',
  'Água mineral': 'water bottle glass',
  'Suco de maracujá': 'passion fruit juice',
  'Cerveja long neck': 'beer bottle cold',
};
const COVER_QUERY = 'barbecue grill fire night';

async function search(q, orientation = 'square') {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=8&orientation=${orientation}&locale=pt-BR`;
  const r = await fetch(url, { headers: { Authorization: KEY } });
  if (!r.ok) throw new Error(`Pexels respondeu ${r.status}`);
  return (await r.json()).photos || [];
}

const creditsFile = resolve(ROOT, 'uploads', 'CREDITOS-PEXELS.json');
const credits = existsSync(creditsFile) ? JSON.parse(readFileSync(creditsFile, 'utf8')) : {};
// fotos já usadas nesta execução (as baixadas antes ficam em disco e são reaproveitadas)
const used = new Set();

async function save(slug, photo, size) {
  const dir = resolve(ROOT, 'uploads', slug);
  mkdirSync(dir, { recursive: true });
  const file = `pexels-${photo.id}.jpg`;
  if (!existsSync(resolve(dir, file))) {
    const r = await fetch(photo.src[size]);
    if (!r.ok) throw new Error(`download ${r.status}`);
    writeFileSync(resolve(dir, file), Buffer.from(await r.arrayBuffer()));
  }
  credits[`${slug}/${file}`] = { foto: photo.url, autor: photo.photographer };
  used.add(String(photo.id));
  return `/uploads/${slug}/${file}`;
}

// Evita repetir a mesma foto em dois pratos.
const pick = photos => photos.find(p => !used.has(String(p.id))) || photos[0];
const isLocal = u => String(u || '').startsWith('/uploads/') || String(u || '').startsWith('/models/');

const restaurants = (await all('SELECT id, slug, name, cover_url FROM restaurants')).filter(r => !only || r.slug === only);
let n = 0, fail = 0;
for (const r of restaurants) {
  try {
    if (KEY && (force || !isLocal(r.cover_url))) {
      const p = pick(await search(COVER_QUERY, 'landscape'));
      if (p) { await run('UPDATE restaurants SET cover_url = ? WHERE id = ?', await save(r.slug, p, 'large2x'), r.id); n++; }
    }
  } catch (e) { fail++; console.log(`  capa de ${r.name}: ${e.message}`); }
  for (const p of await all('SELECT id, name, image_url, model_glb_url FROM products WHERE restaurant_id = ?', r.id)) {
    // modelo 3D hospedado fora: baixa para uploads/ (o navegador e o AR carregam do próprio servidor)
    if (/^https?:/.test(p.model_glb_url || '')) {
      try {
        const file = `3d-${p.id}-${p.model_glb_url.split('/').pop().replace(/[^\w.-]/g, '').slice(-60)}`;
        const dir = resolve(ROOT, 'uploads', r.slug);
        mkdirSync(dir, { recursive: true });
        if (!existsSync(resolve(dir, file))) {
          const res = await fetch(p.model_glb_url);
          if (!res.ok) throw new Error(`download ${res.status}`);
          writeFileSync(resolve(dir, file), Buffer.from(await res.arrayBuffer()));
        }
        await run('UPDATE products SET model_glb_url = ? WHERE id = ?', `/uploads/${r.slug}/${file}`, p.id);
        console.log(`  ${r.name} · ${p.name}: modelo 3D baixado`);
      } catch (e) { fail++; console.log(`  3D de ${p.name}: ${e.message}`); }
    }
    if (!KEY || (!force && isLocal(p.image_url))) continue;
    try {
      const photo = pick(await search(QUERY[p.name] || p.name));
      if (!photo) { console.log(`  sem resultado: ${p.name}`); continue; }
      await run('UPDATE products SET image_url = ? WHERE id = ?', await save(r.slug, photo, 'large'), p.id);
      n++;
      console.log(`  ${r.name} · ${p.name}: foto de ${photo.photographer}`);
    } catch (e) { fail++; console.log(`  ${p.name}: ${e.message}`); }
  }
}
mkdirSync(resolve(ROOT, 'uploads'), { recursive: true });
writeFileSync(creditsFile, JSON.stringify(credits, null, 2));
console.log(`Fotos: ${n} baixadas${fail ? `, ${fail} com erro (sem internet?)` : ''}.`);
