// Baixa as fotos e modelos 3D de IA da demonstração para public/demo/ai/ (só os que faltam)
// e deixa todo .glb da demo no tamanho real de mesa (src/glb-scale.js; idempotente).
// Roda no build da Vercel e no iniciar.bat do PC. Uso: npm run assets
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { REMOTE, remoteUrl } from '../src/demo-assets.js';
import { realScale, targetSize } from '../src/glb-scale.js';

const dir = resolve(ROOT, 'public/demo/ai');
mkdirSync(dir, { recursive: true });
let fail = 0;
for (const file of Object.keys(REMOTE)) {
  const dest = resolve(dir, file);
  if (existsSync(dest)) continue;
  try {
    const r = await fetch(remoteUrl(file));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    console.log(`+ ${file}`);
  } catch (e) { fail++; console.error(`x ${file}: ${e.message}`); }
}

for (const sub of ['public/demo/ai', 'public/demo/brasa-nobre', 'public/models']) {
  const d = resolve(ROOT, sub);
  if (!existsSync(d)) continue;
  for (const file of readdirSync(d).filter(f => f.endsWith('.glb'))) {
    const p = resolve(d, file), buf = readFileSync(p), out = realScale(buf, targetSize(file));
    if (!out.equals(buf)) { writeFileSync(p, out); console.log(`~ ${sub}/${file} no tamanho de mesa`); }
  }
}
if (fail) { console.error(`${fail} arquivo(s) não baixaram`); process.exit(1); }
