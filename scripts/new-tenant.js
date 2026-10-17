// Cria um novo restaurante (cliente) na plataforma.
// Uso: npm run novo-cliente -- <slug> "<Nome>" <PIN> [mesas]
// Ex.: npm run novo-cliente -- pizzaria-do-ze "Pizzaria do Zé" 5678 15
import { get } from '../src/db.js';
import * as S from '../src/services.js';

const [slug, name, staff_pin, tables = '10'] = process.argv.slice(2);
if (!slug || !name || !staff_pin) {
  console.log('Uso: npm run novo-cliente -- <slug> "<Nome>" <PIN> [mesas]');
  process.exit(1);
}
try {
  const r = await S.createRestaurant({ slug, name, staff_pin, tables: Number(tables) });
  const t = await get('SELECT token FROM tables WHERE restaurant_id = ? ORDER BY number LIMIT 1', r.id);
  console.log(`Criado: ${r.name}`);
  console.log(`  Admin:    /r/${r.slug}/admin   (PIN ${r.staff_pin})`);
  console.log(`  Cozinha:  /r/${r.slug}/cozinha`);
  console.log(`  Caixa:    /r/${r.slug}/caixa`);
  console.log(`  QR Codes: /r/${r.slug}/qrcodes`);
  if (t) console.log(`  Mesa 1:   /m/${t.token}`);
} catch (e) {
  console.error('Erro:', e.message);
  process.exit(1);
}
