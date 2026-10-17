// Baixa as fotos e modelos 3D de IA da demonstração para public/demo/ai/ (só os que faltam).
// Roda no build da Vercel e no iniciar.bat do PC. Uso: npm run assets
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { REMOTE, remoteUrl } from '../src/demo-assets.js';

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
if (fail) { console.error(`${fail} arquivo(s) não baixaram`); process.exit(1); }
