// Teste de ponta a ponta da API: sobe o servidor com banco temporário e simula mesa, cozinha e caixa.
// Uso: npm test
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';

const PORT = 3990 + Math.floor(Math.random() * 9);
const DB = 'data/smoke-test.db';
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, PORT: String(PORT), DB_PATH: DB, STAFF_PIN: '1' }; // testa também o modo com PIN
const node = ['--disable-warning=ExperimentalWarning'];
const clean = () => { for (const s of ['', '-wal', '-shm']) rmSync(resolve(ROOT, DB + s), { force: true }); };

let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failed++; };

clean();
await new Promise((res, rej) => spawn(process.execPath, [...node, 'scripts/seed.js', '--reset'], { cwd: ROOT, env, stdio: 'ignore' })
  .on('exit', c => (c ? rej(new Error('seed falhou')) : res())));
const server = spawn(process.execPath, [...node, 'src/server.js'], { cwd: ROOT, env, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null), res };
}

try {
  const slug = 'brasa-nobre';
  const login = await call(`/api/r/${slug}/login`, { method: 'POST', body: { pin: '1234' } });
  const cookie = login.res.headers.get('set-cookie')?.split(';')[0];
  ok(login.status === 200 && cookie, 'login da equipe com PIN');
  ok((await call(`/api/r/${slug}/login`, { method: 'POST', body: { pin: '0000' } })).status === 401, 'PIN errado é recusado');
  ok((await call(`/api/r/${slug}/orders`)).status === 401, 'cozinha exige login');

  const admin = (await call(`/api/r/${slug}/admin`, { cookie })).data;
  const table = admin.tables[2];
  const menu = (await call(`/api/m/${table.token}`)).data;
  ok(menu.highlights?.popular.length > 0 && menu.highlights.cheap.length > 0, 'destaques: mais pedidos e econômicos');
  ok(menu.table.number === table.number && menu.products.length > 5, `cardápio da mesa ${table.number} carrega`);
  ok(!('staff_pin' in menu.restaurant), 'PIN não vaza no cardápio público');

  // escuta a cozinha em tempo real
  const events = [];
  const ctrl = new AbortController();
  const poll = process.env.REALTIME === 'poll';
  const first = poll ? (await call(`/api/r/${slug}/events`, { cookie })).data : null;
  if (!poll) fetch(`${BASE}/api/r/${slug}/stream`, { headers: { Cookie: cookie }, signal: ctrl.signal }).then(async r => {
    const reader = r.body.getReader(); const dec = new TextDecoder();
    for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(dec.decode(value)); }
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 200));

  const p = menu.products;
  const o1 = await call(`/api/m/${table.token}/orders`, { method: 'POST',
    body: { customer_name: 'Ana', items: [{ product_id: p[0].id, qty: 2, note: 'bem passado', removed: ['Farofa', 'Inventado'] }, { product_id: p[1].id, qty: 1 }] } });
  ok(o1.status === 200 && o1.data.total_cents === p[0].price_cents * 2 + p[1].price_cents, 'pedido criado com total calculado no servidor');
  const it0 = o1.data.items[0];
  ok(it0.removed.join() === 'Farofa' && it0.ingredients.includes('Alcatra') && it0.note === 'bem passado',
    'cozinha recebe ingredientes, o que tirar e a observação');
  const fake = await call(`/api/m/${table.token}/orders`, { method: 'POST',
    body: { customer_name: 'Bruno', items: [{ product_id: p[2].id, qty: 1, price_cents: 1 }] } });
  ok(fake.data.total_cents === p[2].price_cents, 'preço enviado pelo celular é ignorado');
  ok((await call(`/api/m/${table.token}/orders`, { method: 'POST', body: { customer_name: 'x', items: [] } })).status === 400, 'pedido sem itens é recusado');
  const anon = await call(`/api/m/${table.token}/orders`, { method: 'POST', body: { items: [{ product_id: p[3].id, qty: 1 }] } });
  ok(anon.status === 200 && anon.data.customer_name === `Mesa ${table.number}` && anon.data.ahead >= 1, 'pedido sem nome vira "Mesa N" e mostra a fila');
  await call(`/api/r/${slug}/orders/${anon.data.id}`, { method: 'PATCH', cookie, body: { status: 'canceled' } });
  await new Promise(r => setTimeout(r, 200));
  if (poll) {
    const ev = (await call(`/api/r/${slug}/events?after=${first.last}`, { cookie })).data;
    ok(ev.events.some(e => e.type === 'order'), 'cozinha recebeu o pedido em tempo real (consulta a cada 2 s)');
  } else ok(events.join('').includes('event: order'), 'cozinha recebeu o pedido em tempo real (SSE)');

  const st = await call(`/api/r/${slug}/orders/${o1.data.id}`, { method: 'PATCH', cookie, body: { status: 'preparing' } });
  ok(st.data.status === 'preparing', 'cozinha muda status para preparando');
  await call(`/api/r/${slug}/orders/${fake.data.id}`, { method: 'PATCH', cookie, body: { status: 'canceled' } });

  const call1 = await call(`/api/m/${table.token}/call`, { method: 'POST', body: { kind: 'conta', customer_name: 'Ana' } });
  ok(call1.status === 200, 'mesa pede a conta');

  const comanda = (await call(`/api/m/${table.token}/comanda`)).data;
  ok(comanda.subtotal_cents === o1.data.total_cents, 'comanda soma só pedidos não cancelados');

  const sessions = (await call(`/api/r/${slug}/sessions`, { cookie })).data;
  const sess = sessions.find(s => s.table_id === table.id);
  ok(!!sess, 'caixa vê a mesa aberta');
  const closed = await call(`/api/r/${slug}/sessions/${sess.id}/close`, { method: 'POST', cookie, body: { payment_method: 'pix' } });
  ok(closed.data.session.status === 'closed' && closed.data.total_cents === comanda.total_cents, 'caixa fecha a conta');
  ok((await call(`/api/r/${slug}/calls`, { cookie })).data.length === 0, 'chamados da mesa somem ao fechar');
  const rep = (await call(`/api/r/${slug}/report`, { cookie })).data;
  ok(rep.by_payment[0]?.payment_method === 'pix', 'relatório do dia registra o pagamento');

  // anti-trote: mesa só aceita pedido se aberta pelo caixa
  await call(`/api/r/${slug}/settings`, { method: 'PUT', cookie, body: { require_open_table: true } });
  const blocked = await call(`/api/m/${table.token}/orders`, { method: 'POST', body: { customer_name: 'Ana', items: [{ product_id: p[0].id, qty: 1 }] } });
  ok(blocked.status === 409, 'modo anti-trote bloqueia mesa não aberta');
  await call(`/api/r/${slug}/tables/${table.id}/open`, { method: 'POST', cookie });
  const allowed = await call(`/api/m/${table.token}/orders`, { method: 'POST', body: { customer_name: 'Ana', items: [{ product_id: p[0].id, qty: 1 }] } });
  ok(allowed.status === 200, 'após o caixa abrir a mesa, o pedido passa');

  const slug2 = `teste-${PORT}-${Date.now()}`;
  const created = await fetch(`${BASE}/api/platform/restaurants`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-platform-key': process.env.PLATFORM_KEY || 'admin' },
    body: JSON.stringify({ slug: slug2, name: 'Teste Novo', staff_pin: '9999', tables: 3 }) });
  ok(created.status === 200, 'plataforma cria novo restaurante');

  // outro restaurante não enxerga dados deste (multi-cliente)
  const other = await call(`/api/r/${slug2}/orders`, { cookie });
  ok(other.status === 401, 'login de um restaurante não vale em outro');

  // maquininha (simulada): cobra, aprova e fecha a conta sozinha
  const s2 = (await call(`/api/r/${slug}/sessions`, { cookie })).data.find(x => x.table_id === table.id);
  const paid = await call(`/api/r/${slug}/sessions/${s2.id}/close`, { method: 'POST', cookie, body: { payment_method: 'cartao', terminal: true } });
  ok(paid.status === 200 && paid.data.session.payment_ref?.startsWith('SIM-'), 'cobrança na maquininha fecha a conta com o código da transação');
  const rep2 = (await call(`/api/r/${slug}/report`, { cookie })).data.summary;
  const dash = (await call(`/api/r/${slug}/dashboard?period=7d`, { cookie })).data;
  ok(dash.series.length === 7 && dash.kpis.received_cents === rep2.received_cents && dash.status.delivered >= 1, 'dashboard de 7 dias bate com o relatório do dia');
  ok(rep2.closed_tabs === 2 && rep2.received_cents > 0 && rep2.avg_ticket_cents > 0, 'relatório soma contas, faturamento e ticket médio');
  ctrl.abort();
} catch (e) {
  console.error(e); failed++;
} finally {
  server.kill();
  await new Promise(r => setTimeout(r, 200));
  clean();
}
console.log(failed ? `\n${failed} falha(s)` : '\nTudo certo.');
process.exit(failed ? 1 : 0);
