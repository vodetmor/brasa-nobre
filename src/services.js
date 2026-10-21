// Regras de negócio. As rotas só validam acesso e chamam estas funções.
import { all, get, run, tx, newToken } from './db.js';
import { HttpError } from './lib/http.js';
import { publish, staffChannel, tableChannel } from './lib/realtime.js';
import { charge } from './lib/payments.js';

export const ORDER_STATUSES = ['received', 'preparing', 'ready', 'delivered', 'canceled'];
const PAYMENT_METHODS = ['dinheiro', 'pix', 'cartao', 'outro'];

// ---------- restaurante ----------
export async function restaurantBySlug(slug) {
  const r = await get('SELECT * FROM restaurants WHERE slug = ?', slug);
  if (!r) throw new HttpError(404, 'Restaurante não encontrado');
  return r;
}

export async function publicRestaurant(r) {
  const { staff_pin, ...rest } = r;
  return rest;
}

export async function listRestaurants() {
  return await all(`SELECT r.id, r.slug, r.name, r.tagline, r.primary_color, r.logo_url, r.cover_url, r.theme, r.bg_color,
    (SELECT COUNT(*) FROM tables t WHERE t.restaurant_id = r.id) AS tables,
    (SELECT COUNT(*) FROM products p WHERE p.restaurant_id = r.id) AS products,
    (SELECT token FROM tables t WHERE t.restaurant_id = r.id AND t.active = 1 ORDER BY t.number LIMIT 1) AS first_token
    FROM restaurants r ORDER BY r.name`);
}

// Link do cardápio aberto em "/": mesa 1 do restaurante padrão (ou do primeiro que existir).
export async function defaultMenuToken(slug) {
  const row = await get(`SELECT t.token FROM tables t JOIN restaurants r ON r.id = t.restaurant_id
    WHERE t.active = 1 ORDER BY (r.slug = ?) DESC, r.id, t.number LIMIT 1`, slug);
  return row?.token || null;
}

const RESTAURANT_FIELDS = ['name', 'tagline', 'logo_url', 'cover_url', 'primary_color', 'accent_color', 'bg_color',
  'text_color', 'whatsapp', 'address', 'instagram', 'tiktok', 'facebook', 'ifood', 'website', 'staff_pin', 'require_open_table', 'accepting_orders', 'service_fee_pct', 'theme'];

export async function createRestaurant({ slug, name, staff_pin, tables = 10, ...rest }) {
  slug = String(slug || '').toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw new HttpError(400, 'Slug inválido (use letras minúsculas, números e hífen)');
  if (!name) throw new HttpError(400, 'Informe o nome');
  if (!/^\d{4,8}$/.test(String(staff_pin || ''))) throw new HttpError(400, 'PIN da equipe deve ter de 4 a 8 números');
  if (await get('SELECT id FROM restaurants WHERE slug = ?', slug)) throw new HttpError(409, 'Já existe um restaurante com esse slug');
  return await tx(async () => {
    const { lastInsertRowid } = await run('INSERT INTO restaurants (slug, name, staff_pin) VALUES (?, ?, ?)', slug, name, String(staff_pin));
    const id = Number(lastInsertRowid);
    await updateRestaurant(id, rest);
    await addTables(id, Number(tables) || 0);
    return await get('SELECT * FROM restaurants WHERE id = ?', id);
  });
}

export async function updateRestaurant(id, data) {
  for (const f of RESTAURANT_FIELDS) {
    if (data[f] === undefined) continue;
    let v = data[f];
    if (['require_open_table', 'accepting_orders'].includes(f)) v = v ? 1 : 0;
    if (f === 'theme' && !['premium', 'claro'].includes(v)) v = 'premium';
    if (f === 'service_fee_pct') v = Math.max(0, Math.min(30, Number(v) || 0));
    if (f === 'staff_pin' && !/^\d{4,8}$/.test(String(v))) throw new HttpError(400, 'PIN deve ter de 4 a 8 números');
    await run(`UPDATE restaurants SET ${f} = ? WHERE id = ?`, typeof v === 'string' ? v.trim() : v, id);
  }
}

// ---------- mesas ----------
export async function tableByToken(token) {
  const t = await get('SELECT * FROM tables WHERE token = ? AND active = 1', token);
  if (!t) throw new HttpError(404, 'Mesa não encontrada. Peça ajuda ao atendente.');
  const r = await get('SELECT * FROM restaurants WHERE id = ?', t.restaurant_id);
  return { table: t, restaurant: r };
}

export async function listTables(restaurantId) {
  // nº 0 é a mesa virtual dos pedidos do WhatsApp (src/whatsapp.js): não aparece no caixa, cadastro nem QR
  return await all('SELECT * FROM tables WHERE restaurant_id = ? AND number > 0 ORDER BY number', restaurantId);
}

export async function addTables(restaurantId, count) {
  const max = (await get('SELECT COALESCE(MAX(number), 0) AS n FROM tables WHERE restaurant_id = ?', restaurantId)).n;
  for (let i = 1; i <= Math.min(count, 200); i++) {
    await run('INSERT INTO tables (restaurant_id, number, token) VALUES (?, ?, ?)', restaurantId, max + i, newToken());
  }
}

export async function updateTable(restaurantId, id, { label, active, regenerate }) {
  const t = await get('SELECT * FROM tables WHERE id = ? AND restaurant_id = ?', id, restaurantId);
  if (!t) throw new HttpError(404, 'Mesa não encontrada');
  if (label !== undefined) await run('UPDATE tables SET label = ? WHERE id = ?', String(label).trim(), id);
  if (active !== undefined) await run('UPDATE tables SET active = ? WHERE id = ?', active ? 1 : 0, id);
  if (regenerate) await run('UPDATE tables SET token = ? WHERE id = ?', newToken(), id);
  return await get('SELECT * FROM tables WHERE id = ?', id);
}

export async function deleteTable(restaurantId, id) {
  await run('DELETE FROM tables WHERE id = ? AND restaurant_id = ?', id, restaurantId);
}

// ---------- cardápio ----------
export async function menuFor(restaurantId, { all: includeHidden = false } = {}) {
  const categories = await all('SELECT * FROM categories WHERE restaurant_id = ? ORDER BY position, id', restaurantId);
  const products = await all(`SELECT * FROM products WHERE restaurant_id = ? ${includeHidden ? '' : 'AND available = 1'}
    ORDER BY position, id`, restaurantId);
  return { categories, products: products.map(p => ({ ...p, option_groups: parseOptions(p.options) })) };
}

// Destaques do cardápio: mais pedidos (últimos 30 dias, ou o selo "mais pedido") e econômicos (mais baratos).
export async function highlights(restaurantId, products) {
  const top = (await all(`SELECT i.product_id AS id, SUM(i.qty) AS n FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.restaurant_id = ? AND o.status != 'canceled' AND o.created_at >= datetime('now', '-30 days') AND i.product_id IS NOT NULL
    GROUP BY i.product_id ORDER BY n DESC LIMIT 6`, restaurantId)).filter(r => r.n >= 3).map(r => r.id);
  const badged = products.filter(p => /mais pedido/i.test(p.badge || '')).map(p => p.id);
  const popular = [...new Set([...top, ...badged])].filter(id => products.some(p => p.id === id)).slice(0, 6);
  const prices = products.map(p => p.price_cents).sort((a, b) => a - b);
  const cut = prices[Math.floor(prices.length * 0.3)] ?? 0;
  const cheap = products.filter(p => p.price_cents <= cut).map(p => p.id);
  return { popular, cheap };
}

export async function saveCategory(restaurantId, { id, name, position }) {
  if (!name) throw new HttpError(400, 'Informe o nome da categoria');
  if (id) {
    await run('UPDATE categories SET name = ?, position = ? WHERE id = ? AND restaurant_id = ?', name, Number(position) || 0, id, restaurantId);
    return await get('SELECT * FROM categories WHERE id = ?', id);
  }
  const { lastInsertRowid } = await run('INSERT INTO categories (restaurant_id, name, position) VALUES (?, ?, ?)', restaurantId, name, Number(position) || 0);
  return await get('SELECT * FROM categories WHERE id = ?', lastInsertRowid);
}

export async function deleteCategory(restaurantId, id) {
  await run('DELETE FROM categories WHERE id = ? AND restaurant_id = ?', id, restaurantId);
}

const PRODUCT_FIELDS = ['category_id', 'name', 'description', 'price_cents', 'image_url', 'model_glb_url', 'model_usdz_url', 'badge', 'ingredients', 'options', 'available', 'position'];

// Escolhas do prato ("monte do seu jeito"): uma linha por grupo, o cliente escolhe uma opção de cada.
//   Arroz: Arroz branco, Arroz com brócolis
//   Carne: Bife de cupim, Parmegiana de frango +5
// "+5" (ou "+5,50") soma ao preço do prato.
export function parseOptions(text) {
  return String(text || '').split(/\r?\n/).map(line => {
    const i = line.indexOf(':');
    if (i < 1) return null;
    const choices = line.slice(i + 1).split(',').map(c => c.trim()).filter(Boolean).map(c => {
      const m = c.match(/^(.*?)\s*\+\s*(\d+(?:[.,]\d{1,2})?)$/);
      return m ? { name: m[1].trim(), add_cents: Math.round(Number(m[2].replace(',', '.')) * 100) } : { name: c, add_cents: 0 };
    });
    return choices.length ? { name: line.slice(0, i).trim(), choices } : null;
  }).filter(Boolean);
}

export async function saveProduct(restaurantId, data) {
  const p = {};
  for (const f of PRODUCT_FIELDS) if (data[f] !== undefined) p[f] = data[f];
  if (p.price_cents !== undefined) {
    p.price_cents = Math.round(Number(p.price_cents));
    if (!(p.price_cents >= 0)) throw new HttpError(400, 'Preço inválido');
  }
  if (p.available !== undefined) p.available = p.available ? 1 : 0;
  if (p.category_id === '' ) p.category_id = null;
  if (data.id) {
    const cur = await get('SELECT id FROM products WHERE id = ? AND restaurant_id = ?', data.id, restaurantId);
    if (!cur) throw new HttpError(404, 'Produto não encontrado');
    for (const [k, v] of Object.entries(p)) await run(`UPDATE products SET ${k} = ? WHERE id = ?`, v, data.id);
    return await get('SELECT * FROM products WHERE id = ?', data.id);
  }
  if (!p.name || p.price_cents === undefined) throw new HttpError(400, 'Informe nome e preço');
  const keys = Object.keys(p);
  const { lastInsertRowid } = await run(`INSERT INTO products (restaurant_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`,
    restaurantId, ...keys.map(k => p[k]));
  return await get('SELECT * FROM products WHERE id = ?', lastInsertRowid);
}

export async function deleteProduct(restaurantId, id) {
  await run('DELETE FROM products WHERE id = ? AND restaurant_id = ?', id, restaurantId);
}

// ---------- comanda (sessão da mesa) ----------
export async function openSessionFor(tableId) {
  return await get("SELECT * FROM table_sessions WHERE table_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1", tableId);
}

export async function openSession(restaurantId, tableId) {
  const cur = await openSessionFor(tableId);
  if (cur) return cur;
  const { lastInsertRowid } = await run('INSERT INTO table_sessions (restaurant_id, table_id) VALUES (?, ?)', restaurantId, tableId);
  const s = await get('SELECT * FROM table_sessions WHERE id = ?', lastInsertRowid);
  await publish(staffChannel(restaurantId), 'session', { id: s.id, table_id: tableId, status: 'open' });
  return s;
}

export async function sessionSummary(sessionId) {
  const session = await get('SELECT * FROM table_sessions WHERE id = ?', sessionId);
  if (!session) return null;
  const r = await get('SELECT service_fee_pct FROM restaurants WHERE id = ?', session.restaurant_id);
  const orders = await Promise.all((await all('SELECT * FROM orders WHERE session_id = ? ORDER BY id', sessionId)).map(withItems));
  const subtotal = orders.filter(o => o.status !== 'canceled').reduce((s, o) => s + o.total_cents, 0);
  const service = Math.round(subtotal * (r.service_fee_pct || 0) / 100);
  // conta separada por pessoa (quem pôs o nome no pedido); sem nome, fica como "Mesa N"
  const people = new Map();
  for (const o of orders) if (o.status !== 'canceled') people.set(o.customer_name, (people.get(o.customer_name) || 0) + o.total_cents);
  const by_customer = [...people].map(([name, subtotal_cents]) => ({ name, subtotal_cents }));
  return { session, orders, by_customer, subtotal_cents: subtotal, service_cents: service, total_cents: subtotal + service, service_fee_pct: r.service_fee_pct };
}

export async function listOpenSessions(restaurantId) {
  return await all(`SELECT s.*, t.number AS table_number, t.label AS table_label,
      (SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o WHERE o.session_id = s.id AND o.status != 'canceled') AS subtotal_cents,
      (SELECT COUNT(*) FROM orders o WHERE o.session_id = s.id AND o.status != 'canceled') AS orders_count,
      (SELECT MAX(o.created_at) FROM orders o WHERE o.session_id = s.id) AS last_order_at
    FROM table_sessions s JOIN tables t ON t.id = s.table_id
    WHERE s.restaurant_id = ? AND s.status = 'open' ORDER BY t.number`, restaurantId);
}

export async function closeSession(restaurantId, sessionId, paymentMethod, { useTerminal = false } = {}) {
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new HttpError(400, 'Forma de pagamento inválida');
  const sum = await sessionSummary(sessionId);
  if (!sum || sum.session.restaurant_id !== restaurantId) throw new HttpError(404, 'Comanda não encontrada');
  if (sum.session.status !== 'open') throw new HttpError(409, 'Comanda já fechada');
  // cartão ou Pix na maquininha: só fecha a conta se a cobrança for aprovada
  const pay = useTerminal && ['cartao', 'pix'].includes(paymentMethod)
    ? await charge({ amount_cents: sum.total_cents, method: paymentMethod }) : null;
  await tx(async () => {
    await run(`UPDATE table_sessions SET status = 'closed', closed_at = datetime('now'), payment_method = ?,
      subtotal_cents = ?, service_cents = ?, total_cents = ?, payment_provider = ?, payment_ref = ? WHERE id = ?`,
      paymentMethod, sum.subtotal_cents, sum.service_cents, sum.total_cents, pay?.provider || '', pay?.ref || '', sessionId);
    // pedidos não cancelados viram "entregue" ao fechar a conta
    await run("UPDATE orders SET status = 'delivered', updated_at = datetime('now') WHERE session_id = ? AND status NOT IN ('canceled', 'delivered')", sessionId);
    await run("UPDATE service_calls SET status = 'done' WHERE table_id = ? AND status = 'open'", sum.session.table_id);
  });
  await publish(staffChannel(restaurantId), 'session', { id: sessionId, table_id: sum.session.table_id, status: 'closed' });
  await publish(tableChannel(sum.session.table_id), 'session', { id: sessionId, status: 'closed' });
  return await sessionSummary(sessionId);
}

// ---------- pedidos ----------
export const splitList = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);

// Cada item vai com os ingredientes do prato (para a cozinha) e o que o cliente pediu para tirar.
async function withItems(o) {
  const items = await all(`SELECT i.*, COALESCE(p.ingredients, '') AS ingredients, COALESCE(p.image_url, '') AS image_url FROM order_items i
    LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id`, o.id);
  return { ...o, items: items.map(i => ({ ...i, ingredients: splitList(i.ingredients), removed: splitList(i.removed),
    choices: String(i.choices || '').split(';').map(x => x.trim()).filter(Boolean) })) };
}

export async function orderFull(id) {
  const o = await get(`SELECT o.*, t.number AS table_number, t.label AS table_label FROM orders o
    JOIN tables t ON t.id = o.table_id WHERE o.id = ?`, id);
  if (!o) return null;
  // fila: pedidos do mesmo restaurante ainda na cozinha que chegaram antes deste
  o.ahead = ['received', 'preparing'].includes(o.status) ? (await get(`SELECT COUNT(*) AS n FROM orders WHERE restaurant_id = ?
    AND status IN ('received', 'preparing') AND id < ?`, o.restaurant_id, o.id)).n : 0;
  return await withItems(o);
}

export async function createOrder({ table, restaurant }, body, ip) {
  if (!restaurant.accepting_orders) throw new HttpError(409, 'O restaurante não está recebendo pedidos agora');
  // nome é opcional: sem nome, o pedido fica identificado só pela mesa
  const name = String(body.customer_name || '').trim().slice(0, 40) || `Mesa ${table.number}`;
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  if (!items.length) throw new HttpError(400, 'Carrinho vazio');

  let session = await openSessionFor(table.id);
  if (!session && restaurant.require_open_table) {
    throw new HttpError(409, 'Esta mesa ainda não foi aberta. Chame o atendente.');
  }

  // preço sempre vem do banco, nunca do celular do cliente
  const lines = [];
  for (const it of items) {
    const p = await get('SELECT * FROM products WHERE id = ? AND restaurant_id = ? AND available = 1', Number(it.product_id), restaurant.id);
    if (!p) throw new HttpError(409, 'Um item do carrinho não está mais disponível. Atualize o cardápio.');
    const qty = Math.max(1, Math.min(50, Math.round(Number(it.qty) || 1)));
    // só aceita tirar ingredientes que o prato realmente tem
    const known = splitList(p.ingredients);
    const removed = (Array.isArray(it.removed) ? it.removed : []).map(String).filter(x => known.includes(x));
    // escolhas: uma opção válida por grupo; o acréscimo também vem do banco
    let unit = p.price_cents;
    const picked = [];
    for (const g of parseOptions(p.options)) {
      const c = g.choices.find(c => c.name === String(it.choices?.[g.name] ?? ''));
      if (!c) throw new HttpError(400, `Escolha ${g.name.toLowerCase()} em ${p.name}`);
      unit += c.add_cents;
      picked.push(`${g.name}: ${c.name}`);
    }
    lines.push({ p, qty, unit, note: String(it.note || '').trim().slice(0, 140), removed: removed.join(', '), choices: picked.join('; ') });
  }
  const total = lines.reduce((s, l) => s + l.unit * l.qty, 0);
  const source = ['qr', 'nfc', 'garcom', 'whatsapp'].includes(body.source) ? body.source : 'qr';

  const id = await tx(async () => {
    session = session || await openSession(restaurant.id, table.id);
    const { n } = await get(`SELECT COUNT(*) AS n FROM orders WHERE restaurant_id = ?
      AND date(created_at, 'localtime') = date('now', 'localtime')`, restaurant.id);
    const { lastInsertRowid } = await run(`INSERT INTO orders (restaurant_id, table_id, session_id, number, customer_name, note, total_cents, source, client_ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, restaurant.id, table.id, session.id, n + 1, name,
      String(body.note || '').trim().slice(0, 200), total, source, ip);
    for (const l of lines) {
      await run('INSERT INTO order_items (order_id, product_id, name, unit_price_cents, qty, note, removed, choices) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        lastInsertRowid, l.p.id, l.p.name, l.unit, l.qty, l.note, l.removed, l.choices);
    }
    return Number(lastInsertRowid);
  });
  const order = await orderFull(id);
  await publish(staffChannel(restaurant.id), 'order', order);
  await publish(tableChannel(table.id), 'order', order);
  return order;
}

export async function listOrders(restaurantId, { active = true, limit = 200 } = {}) {
  const where = active ? "AND o.status IN ('received', 'preparing', 'ready')" : '';
  const rows = await all(`SELECT o.*, t.number AS table_number, t.label AS table_label FROM orders o JOIN tables t ON t.id = o.table_id
    WHERE o.restaurant_id = ? ${where} ORDER BY o.id DESC LIMIT ?`, restaurantId, limit);
  return Promise.all(rows.map(withItems));
}

export async function setOrderStatus(restaurantId, id, status) {
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Status inválido');
  const o = await get('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?', id, restaurantId);
  if (!o) throw new HttpError(404, 'Pedido não encontrado');
  await run("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
  const order = await orderFull(id);
  await publish(staffChannel(restaurantId), 'order', order);
  await publish(tableChannel(o.table_id), 'order', order);
  return order;
}

// Pedido lançado pelo garçom/caixa (cliente sem celular, pedido do WhatsApp).
export async function createStaffOrder(restaurant, tableId, body) {
  const table = await get('SELECT * FROM tables WHERE id = ? AND restaurant_id = ?', tableId, restaurant.id);
  if (!table) throw new HttpError(404, 'Mesa não encontrada');
  return await createOrder({ table, restaurant: { ...restaurant, require_open_table: 0, accepting_orders: 1 } },
    { ...body, source: body.source || 'garcom', customer_name: body.customer_name || 'Garçom' }, 'equipe');
}

// ---------- chamados ----------
export async function createCall({ table, restaurant }, kind, customerName) {
  if (!['garcom', 'conta'].includes(kind)) throw new HttpError(400, 'Chamado inválido');
  const open = await get("SELECT id FROM service_calls WHERE table_id = ? AND kind = ? AND status = 'open'", table.id, kind);
  if (open) return await get('SELECT * FROM service_calls WHERE id = ?', open.id);
  const { lastInsertRowid } = await run('INSERT INTO service_calls (restaurant_id, table_id, kind, customer_name) VALUES (?, ?, ?, ?)',
    restaurant.id, table.id, kind, String(customerName || '').slice(0, 40));
  const call = { ...(await get('SELECT * FROM service_calls WHERE id = ?', lastInsertRowid)), table_number: table.number };
  await publish(staffChannel(restaurant.id), 'call', call);
  return call;
}

export async function listCalls(restaurantId) {
  return await all(`SELECT c.*, t.number AS table_number FROM service_calls c JOIN tables t ON t.id = c.table_id
    WHERE c.restaurant_id = ? AND c.status = 'open' ORDER BY c.id`, restaurantId);
}

export async function resolveCall(restaurantId, id) {
  await run("UPDATE service_calls SET status = 'done' WHERE id = ? AND restaurant_id = ?", id, restaurantId);
  await publish(staffChannel(restaurantId), 'call', { id, status: 'done' });
}

// ---------- relatório do dia ----------
export async function dayReport(restaurantId, date) {
  const d = date || (await get("SELECT date('now', 'localtime') AS d")).d;
  const sessions = await all(`SELECT payment_method, COUNT(*) AS n, SUM(total_cents) AS total FROM table_sessions
    WHERE restaurant_id = ? AND status = 'closed' AND date(closed_at, 'localtime') = ? GROUP BY payment_method ORDER BY total DESC`, restaurantId, d);
  const top = await all(`SELECT i.name, SUM(i.qty) AS qty, SUM(i.qty * i.unit_price_cents) AS total FROM order_items i
    JOIN orders o ON o.id = i.order_id WHERE o.restaurant_id = ? AND o.status != 'canceled'
    AND date(o.created_at, 'localtime') = ? GROUP BY i.name ORDER BY qty DESC LIMIT 10`, restaurantId, d);
  const orders = await get(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS total,
    COUNT(DISTINCT session_id) AS tabs FROM orders WHERE restaurant_id = ?
    AND status != 'canceled' AND date(created_at, 'localtime') = ?`, restaurantId, d);
  const canceled = await get(`SELECT COUNT(*) AS n FROM orders WHERE restaurant_id = ? AND status = 'canceled'
    AND date(created_at, 'localtime') = ?`, restaurantId, d);
  // pessoas identificadas = nomes diferentes por comanda (pedido sem nome conta como a mesa)
  const people = await get(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT session_id, customer_name FROM orders
    WHERE restaurant_id = ? AND status != 'canceled' AND date(created_at, 'localtime') = ?) x`, restaurantId, d);
  const open = await get(`SELECT COUNT(*) AS n FROM table_sessions WHERE restaurant_id = ? AND status = 'open'`, restaurantId);
  const closed = sessions.reduce((a, p) => ({ n: a.n + p.n, total: a.total + (p.total || 0) }), { n: 0, total: 0 });
  return {
    date: d, by_payment: sessions, top_items: top, orders,
    summary: {
      received_cents: closed.total, closed_tabs: closed.n, avg_ticket_cents: closed.n ? Math.round(closed.total / closed.n) : 0,
      orders: orders.n, orders_cents: orders.total, tabs: orders.tabs, people: people.n, canceled: canceled.n, open_tabs: open.n,
    },
  };
}

// ---------- dashboard (hoje, 7 dias, 30 dias) ----------
// Busca os pedidos e contas do período atual e do anterior (para comparar) e agrega aqui; volume de restaurante é pequeno.
const PERIODS = { hoje: 1, '7d': 7, '30d': 30 };
const localDay = (d, tz) => d.toLocaleDateString('sv-SE', { timeZone: tz });
const localHour = (utcText, tz) => Number(new Date(String(utcText).replace(' ', 'T') + 'Z')
  .toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).slice(0, 2)) % 24;
const localDayOf = (utcText, tz) => localDay(new Date(String(utcText).replace(' ', 'T') + 'Z'), tz);

export async function dashboard(restaurantId, period = 'hoje', tz = 'America/Sao_Paulo') {
  const days = PERIODS[period] || 1;
  const now = new Date();
  const dayList = n => Array.from({ length: n }, (_, i) => localDay(new Date(now - (n - 1 - i) * 86400_000), tz));
  const all2 = dayList(days * 2);
  const cur = all2.slice(days), prev = all2.slice(0, days);
  const from = all2[0], to = all2[all2.length - 1];

  const orders = await all(`SELECT id, status, total_cents, session_id, customer_name, created_at FROM orders
    WHERE restaurant_id = ? AND date(created_at, 'localtime') BETWEEN ? AND ?`, restaurantId, from, to);
  const tabs = await all(`SELECT payment_method, total_cents, closed_at FROM table_sessions
    WHERE restaurant_id = ? AND status = 'closed' AND date(closed_at, 'localtime') BETWEEN ? AND ?`, restaurantId, from, to);
  const top = await all(`SELECT i.name, SUM(i.qty) AS qty, SUM(i.qty * i.unit_price_cents) AS total FROM order_items i
    JOIN orders o ON o.id = i.order_id WHERE o.restaurant_id = ? AND o.status != 'canceled'
    AND date(o.created_at, 'localtime') BETWEEN ? AND ? GROUP BY i.name ORDER BY qty DESC LIMIT 8`, restaurantId, cur[0], to);
  const open = await get(`SELECT COUNT(*) AS n FROM table_sessions WHERE restaurant_id = ? AND status = 'open'`, restaurantId);

  const inCur = new Set(cur);
  const kpis = list => {
    const os = list.o, ts = list.t;
    const valid = os.filter(o => o.status !== 'canceled');
    const received = ts.reduce((s, t) => s + (t.total_cents || 0), 0);
    return {
      received_cents: received,
      orders: valid.length,
      orders_cents: valid.reduce((s, o) => s + o.total_cents, 0),
      delivered: os.filter(o => o.status === 'delivered').length,
      canceled: os.filter(o => o.status === 'canceled').length,
      closed_tabs: ts.length,
      avg_ticket_cents: ts.length ? Math.round(received / ts.length) : 0,
      people: new Set(valid.map(o => `${o.session_id}|${o.customer_name}`)).size,
    };
  };
  const split = pred => ({ o: orders.filter(o => pred(localDayOf(o.created_at, tz))), t: tabs.filter(t => pred(localDayOf(t.closed_at, tz))) });
  const now_ = kpis(split(d => inCur.has(d)));
  const before = kpis(split(d => !inCur.has(d)));
  const curO = orders.filter(o => o.status !== 'canceled' && inCur.has(localDayOf(o.created_at, tz)));

  // gráfico: por hora (hoje) ou por dia (7/30 dias)
  const series = days === 1
    ? Array.from({ length: 24 }, (_, h) => {
        const os = curO.filter(o => localHour(o.created_at, tz) === h);
        return { label: `${String(h).padStart(2, '0')}h`, orders: os.length, cents: os.reduce((s, o) => s + o.total_cents, 0) };
      })
    : cur.map(d => {
        const os = curO.filter(o => localDayOf(o.created_at, tz) === d);
        return { label: `${d.slice(8, 10)}/${d.slice(5, 7)}`, orders: os.length, cents: os.reduce((s, o) => s + o.total_cents, 0) };
      });
  const pays = {};
  for (const t of tabs) if (inCur.has(localDayOf(t.closed_at, tz))) {
    const p = (pays[t.payment_method] ||= { payment_method: t.payment_method, n: 0, total: 0 });
    p.n++; p.total += t.total_cents || 0;
  }
  return {
    period, from: cur[0], to, kpis: now_, previous: before, series,
    by_payment: Object.values(pays).sort((a, b) => b.total - a.total),
    top_items: top, open_tabs: open.n,
    status: Object.fromEntries(['received', 'preparing', 'ready', 'delivered', 'canceled']
      .map(s => [s, orders.filter(o => o.status === s && inCur.has(localDayOf(o.created_at, tz))).length])),
  };
}
