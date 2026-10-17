// Baixa as fotos e modelos 3D de IA da demonstração para public/demo/ai/ (só os que faltam).
// Roda no build da Vercel e no iniciar.bat do PC. Uso: npm run assets
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { REMOTE, remoteUrl } from '../src/demo-assets.js';

// Modelos de IA vêm com ~1 m: reduz para o maior lado horizontal ter 28 cm (tamanho real no AR, inclusive no Scene Viewer).
function realScale(buf) {
  const len = buf.readUInt32LE(12), j = JSON.parse(buf.subarray(20, 20 + len).toString()), rest = buf.subarray(20 + len);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const m of j.meshes || []) for (const pr of m.primitives) {
    const a = j.accessors[pr.attributes.POSITION];
    a.min.forEach((v, i) => { mn[i] = Math.min(mn[i], v); mx[i] = Math.max(mx[i], a.max[i]); });
  }
  const big = Math.max(mx[0] - mn[0], mx[2] - mn[2]);
  if (!(big > 0.5)) return buf;
  const s = +(0.28 / big).toFixed(4), scene = j.scenes[j.scene || 0];
  j.nodes.push({ name: 'escala-real', scale: [s, s, s], children: scene.nodes });
  scene.nodes = [j.nodes.length - 1];
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length + rest.length, 8);
  head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4E4F534A, 16);
  return Buffer.concat([head, json, rest]);
}

const dir = resolve(ROOT, 'public/demo/ai');
mkdirSync(dir, { recursive: true });
let fail = 0;
for (const file of Object.keys(REMOTE)) {
  const dest = resolve(dir, file);
  if (existsSync(dest)) continue;
  try {
    const r = await fetch(remoteUrl(file));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(dest, file.endsWith('.glb') ? realScale(buf) : buf);
    console.log(`+ ${file}`);
  } catch (e) { fail++; console.error(`x ${file}: ${e.message}`); }
}
if (fail) { console.error(`${fail} arquivo(s) não baixaram`); process.exit(1); }
