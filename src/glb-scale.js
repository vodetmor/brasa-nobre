// Tamanho real dos pratos no AR: grava no próprio .glb um nó-raiz "escala-real" que deixa a maior
// medida horizontal (x/z) no tamanho de mesa. Idempotente: mede sempre o modelo original (ignora a
// escala que este script já gravou) e só troca o valor, então rodar de novo não reduz outra vez.

// Maior medida horizontal, em metros, por prato (nome do arquivo sem .glb).
const SIZES = {
  jantinha: 0.32, pf: 0.32,
  carne: 0.30, frango: 0.30, linguica: 0.30, coracao: 0.30, misto: 0.30, queijo: 0.30,
  mandioca: 0.20, tropeiro: 0.20, vinagrete: 0.20,
  avocado: 0.12,
};
const NODE = 'escala-real';

export const targetSize = file => SIZES[file.replace(/^.*[\\/]/, '').replace(/\.glb$/i, '')];

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function parse(buf) {
  if (buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('não é .glb');
  const len = buf.readUInt32LE(12);
  return { j: JSON.parse(buf.subarray(20, 20 + len).toString()), rest: buf.subarray(20 + len) };
}

// Caixa do modelo no espaço da cena, a partir dos nós informados (cantos de cada malha transformados).
function bounds(j, roots) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const walk = (i, parent) => {
    const n = j.nodes[i], m = mul(parent, local(n));
    if (n.mesh != null) for (const pr of j.meshes[n.mesh].primitives) {
      const a = j.accessors[pr.attributes.POSITION];
      for (let c = 0; c < 8; c++) {
        const p = [0, 1, 2].map(k => (c >> k) & 1 ? a.max[k] : a.min[k]);
        for (let k = 0; k < 3; k++) {
          const v = m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k];
          mn[k] = Math.min(mn[k], v); mx[k] = Math.max(mx[k], v);
        }
      }
    }
    for (const c of n.children || []) walk(c, m);
  };
  for (const r of roots) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
}

// Medida horizontal do jeito que o arquivo está hoje (com a escala gravada).
export function measure(buf) {
  const { j } = parse(buf), d = bounds(j, j.scenes[j.scene || 0].nodes);
  return Math.max(d[0], d[2]);
}

export function realScale(buf, size) {
  if (!size) return buf;
  const { j, rest } = parse(buf), scene = j.scenes[j.scene || 0];
  let wrap = scene.nodes.length === 1 && j.nodes[scene.nodes[0]].name === NODE ? j.nodes[scene.nodes[0]] : null;
  const original = wrap ? wrap.children : scene.nodes;
  const d = bounds(j, original), big = Math.max(d[0], d[2]);
  if (!(big > 0)) return buf;
  const s = +(size / big).toFixed(6);
  if (!wrap) {
    wrap = { name: NODE, children: original };
    j.nodes.push(wrap);
    scene.nodes = [j.nodes.length - 1];
  }
  wrap.scale = [s, s, s];
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length + rest.length, 8);
  head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4E4F534A, 16);
  return Buffer.concat([head, json, rest]);
}
