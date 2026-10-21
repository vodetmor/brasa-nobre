import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config, ROOT } from './config.js';
import { Router, HttpError, readJson, readBody, sendJson, serveStatic, clientIp } from './lib/http.js';
import { issueStaffCookie, clearStaffCookie, isStaff, requireStaff, requirePlatform } from './lib/auth.js';
import { subscribe, pollEvents, realtimeMode, staffChannel, tableChannel } from './lib/realtime.js';
import { ensureDemo } from './demo.js';
import { paymentProvider } from './lib/payments.js';
import { allow } from './lib/ratelimit.js';
import * as S from './services.js';
import * as W from './whatsapp.js';

const PUBLIC = resolve(ROOT, 'public');
const UPLOADS = resolve(ROOT, 'uploads');
const api = new Router();

// ---------- público: cliente na mesa ----------
api.get('/api/config', () => ({ public_url: config.publicUrl, realtime: realtimeMode, uploads: !config.serverless,
  default_slug: config.defaultSlug, payment_provider: paymentProvider }));
api.get('/api/restaurants', () => S.listRestaurants());

api.get('/api/m/:token', async ({ params }) => {
  const ctx = await S.tableByToken(params.token);
  const session = await S.openSessionFor(ctx.table.id);
  const menu = await S.menuFor(ctx.restaurant.id);
  return {
    restaurant: await S.publicRestaurant(ctx.restaurant),
    table: { id: ctx.table.id, number: ctx.table.number, label: ctx.table.label },
    session_open: !!session,
    ...menu,
    highlights: await S.highlights(ctx.restaurant.id, menu.products),
  };
});

api.post('/api/m/:token/orders', async ({ req, params }) => {
  const ctx = await S.tableByToken(params.token);
  const ip = clientIp(req);
  if (!allow(`order:${ctx.table.id}`, config.orderLimit.max, config.orderLimit.windowMs) || !allow(`order-ip:${ip}`, 8, 60_000)) {
    throw new HttpError(429, 'Muitos pedidos em pouco tempo. Aguarde um minuto ou chame o atendente.');
  }
  return S.createOrder(ctx, await readJson(req), ip);
});

api.get('/api/m/:token/comanda', async ({ params }) => {
  const { table } = await S.tableByToken(params.token);
  const s = await S.openSessionFor(table.id);
  return s ? S.sessionSummary(s.id) : { session: null, orders: [], subtotal_cents: 0, service_cents: 0, total_cents: 0 };
});

api.post('/api/m/:token/call', async ({ req, params }) => {
  const ctx = await S.tableByToken(params.token);
  if (!allow(`call:${ctx.table.id}`, 3, 60_000)) throw new HttpError(429, 'Chamado já enviado. Aguarde o atendente.');
  const body = await readJson(req);
  return S.createCall(ctx, body.kind, body.customer_name);
});

api.get('/api/m/:token/stream', async ({ req, res, params }) => {
  const { table } = await S.tableByToken(params.token);
  subscribe(req, res, tableChannel(table.id));
  return STREAM;
});

api.get('/api/m/:token/events', async ({ params, query }) => {
  const { table } = await S.tableByToken(params.token);
  return pollEvents(tableChannel(table.id), query.get('after'));
});

// ---------- equipe: cozinha, caixa, admin ----------
const staffCtx = async (req, slug) => { const r = await S.restaurantBySlug(slug); requireStaff(req, slug); return r; };
const staffId = async (req, slug) => (await staffCtx(req, slug)).id;

api.get('/api/r/:slug/public', async ({ req, params }) => {
  const r = await S.restaurantBySlug(params.slug);
  return { restaurant: await S.publicRestaurant(r), logged: isStaff(req, params.slug) };
});

api.post('/api/r/:slug/login', async ({ req, res, params }) => {
  const r = await S.restaurantBySlug(params.slug);
  if (!allow(`login:${clientIp(req)}`, 8, 5 * 60_000)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  const { pin } = await readJson(req);
  if (String(pin) !== r.staff_pin) throw new HttpError(401, 'PIN incorreto');
  issueStaffCookie(res, r.slug);
  return { ok: true };
});

api.post('/api/r/:slug/logout', ({ res, params }) => { clearStaffCookie(res, params.slug); return { ok: true }; });

api.get('/api/r/:slug/stream', async ({ req, res, params }) => {
  const r = await staffCtx(req, params.slug);
  subscribe(req, res, staffChannel(r.id));
  return STREAM;
});

api.get('/api/r/:slug/events', async ({ req, params, query }) =>
  pollEvents(staffChannel(await staffId(req, params.slug)), query.get('after')));

api.get('/api/r/:slug/orders', async ({ req, params, query }) =>
  S.listOrders(await staffId(req, params.slug), { active: query.get('all') !== '1' }));

api.post('/api/r/:slug/orders', async ({ req, params }) => {
  const r = await staffCtx(req, params.slug);
  const body = await readJson(req);
  return S.createStaffOrder(r, Number(body.table_id), body);
});

api.patch('/api/r/:slug/orders/:id', async ({ req, params }) =>
  S.setOrderStatus(await staffId(req, params.slug), Number(params.id), (await readJson(req)).status));

api.get('/api/r/:slug/sessions', async ({ req, params }) => S.listOpenSessions(await staffId(req, params.slug)));

api.get('/api/r/:slug/sessions/:id', async ({ req, params }) => {
  const id = await staffId(req, params.slug);
  const sum = await S.sessionSummary(Number(params.id));
  if (!sum || sum.session.restaurant_id !== id) throw new HttpError(404, 'Comanda não encontrada');
  return sum;
});

api.post('/api/r/:slug/sessions/:id/close', async ({ req, params }) => {
  const body = await readJson(req);
  return S.closeSession(await staffId(req, params.slug), Number(params.id), body.payment_method, { useTerminal: !!body.terminal });
});

api.post('/api/r/:slug/tables/:id/open', async ({ req, params }) => {
  const id = await staffId(req, params.slug);
  const t = (await S.listTables(id)).find(t => t.id === Number(params.id));
  if (!t) throw new HttpError(404, 'Mesa não encontrada');
  return S.openSession(id, t.id);
});

api.get('/api/r/:slug/calls', async ({ req, params }) => S.listCalls(await staffId(req, params.slug)));
api.post('/api/r/:slug/calls/:id/done', async ({ req, params }) => {
  await S.resolveCall(await staffId(req, params.slug), Number(params.id));
  return { ok: true };
});

api.get('/api/r/:slug/dashboard', async ({ req, params, query }) =>
  S.dashboard(await staffId(req, params.slug), query.get('period') || 'hoje', config.timezone));

api.get('/api/r/:slug/report', async ({ req, params, query }) => S.dayReport(await staffId(req, params.slug), query.get('date')));

// ---------- admin do restaurante ----------
api.get('/api/r/:slug/admin', async ({ req, params }) => {
  const r = await staffCtx(req, params.slug);
  return { restaurant: r, tables: await S.listTables(r.id), ...(await S.menuFor(r.id, { all: true })) };
});

api.put('/api/r/:slug/settings', async ({ req, params }) => {
  const r = await staffCtx(req, params.slug);
  await S.updateRestaurant(r.id, await readJson(req));
  return S.restaurantBySlug(params.slug);
});

api.post('/api/r/:slug/categories', async ({ req, params }) => S.saveCategory(await staffId(req, params.slug), await readJson(req)));
api.put('/api/r/:slug/categories/:id', async ({ req, params }) =>
  S.saveCategory(await staffId(req, params.slug), { ...(await readJson(req)), id: Number(params.id) }));
api.delete('/api/r/:slug/categories/:id', async ({ req, params }) => {
  await S.deleteCategory(await staffId(req, params.slug), Number(params.id)); return { ok: true };
});

api.post('/api/r/:slug/products', async ({ req, params }) => {
  const restaurantId = await staffId(req, params.slug);
  const { id, ...data } = await readJson(req);
  return S.saveProduct(restaurantId, data);
});
api.put('/api/r/:slug/products/:id', async ({ req, params }) =>
  S.saveProduct(await staffId(req, params.slug), { ...(await readJson(req)), id: Number(params.id) }));
api.delete('/api/r/:slug/products/:id', async ({ req, params }) => {
  await S.deleteProduct(await staffId(req, params.slug), Number(params.id)); return { ok: true };
});

api.post('/api/r/:slug/tables', async ({ req, params }) => {
  const id = await staffId(req, params.slug);
  await S.addTables(id, Math.max(1, Number((await readJson(req)).count) || 1));
  return S.listTables(id);
});
api.put('/api/r/:slug/tables/:id', async ({ req, params }) =>
  S.updateTable(await staffId(req, params.slug), Number(params.id), await readJson(req)));
api.delete('/api/r/:slug/tables/:id', async ({ req, params }) => {
  await S.deleteTable(await staffId(req, params.slug), Number(params.id)); return { ok: true };
});

// Upload de foto ou modelo 3D: corpo bruto, nome em ?name=. Em produção: Supabase Storage / S3 / R2.
const UPLOAD_TYPES = ['.jpg', '.jpeg', '.png', '.webp', '.glb', '.usdz'];
api.post('/api/r/:slug/upload', async ({ req, params, query }) => {
  const r = await staffCtx(req, params.slug);
  if (config.serverless) throw new HttpError(503, 'Envio de arquivo desligado na demonstração online. Cole o link da imagem.');
  const ext = extname(query.get('name') || '').toLowerCase();
  if (!UPLOAD_TYPES.includes(ext)) throw new HttpError(400, `Tipo não aceito. Use: ${UPLOAD_TYPES.join(', ')}`);
  const buf = await readBody(req, 40 * 1024 * 1024);
  if (!buf.length) throw new HttpError(400, 'Arquivo vazio');
  const dir = resolve(UPLOADS, r.slug);
  mkdirSync(dir, { recursive: true });
  const file = `${Date.now()}-${randomBytes(3).toString('hex')}${ext}`;
  writeFileSync(resolve(dir, file), buf);
  return { url: `/uploads/${r.slug}/${file}`, bytes: buf.length };
});

// ---------- WhatsApp: robô (n8n, chave WA_BOT_TOKEN) e tela de atendimento da equipe ----------
const botCtx = async (req, slug) => { W.requireBot(req); return S.restaurantBySlug(slug); };
api.post('/api/r/:slug/wa/bot/entrada', async ({ req, params }) => W.botInbound(await botCtx(req, params.slug), await readJson(req)));
api.post('/api/r/:slug/wa/bot/estado', async ({ req, params }) => W.botState(await botCtx(req, params.slug), await readJson(req)));
api.post('/api/r/:slug/wa/bot/vez', async ({ req, params }) => W.botTurn(await botCtx(req, params.slug), await readJson(req)));
api.post('/api/r/:slug/wa/bot/proprio', async ({ req, params }) => W.botOwn(await botCtx(req, params.slug), await readJson(req)));
api.post('/api/r/:slug/wa/bot/n8n-url', async ({ req, params }) => { await botCtx(req, params.slug); return W.botSetN8nUrl(await readJson(req)); });
api.post('/api/r/:slug/wa/bot/saida', async ({ req, params }) => W.botOutbound(await botCtx(req, params.slug), await readJson(req)));
api.post('/api/r/:slug/wa/bot/pedido', async ({ req, params }) => W.botOrder(await botCtx(req, params.slug), await readJson(req)));
api.post('/api/r/:slug/wa/bot/fila', async ({ req, params }) => W.botQueue(await botCtx(req, params.slug)));
api.post('/api/r/:slug/wa/bot/fila/ok', async ({ req, params }) => W.botQueueDone(await botCtx(req, params.slug), await readJson(req)));
api.post('/api/r/:slug/wa/bot/humano', async ({ req, params }) => W.botHuman(await botCtx(req, params.slug), await readJson(req)));

api.get('/api/r/:slug/atendimento', async ({ req, params }) => W.inbox(await staffCtx(req, params.slug)));
api.get('/api/r/:slug/atendimento/conversa', async ({ req, params, query }) =>
  W.conversation(await staffCtx(req, params.slug), query.get('phone')));
api.post('/api/r/:slug/atendimento/enviar', async ({ req, params }) => W.staffSend(await staffCtx(req, params.slug), await readJson(req)));
api.post('/api/r/:slug/atendimento/robo', async ({ req, params }) => W.setRobot(await staffCtx(req, params.slug), await readJson(req)));
api.patch('/api/r/:slug/atendimento/pedidos/:id', async ({ req, params }) =>
  W.setOrderStatus(await staffCtx(req, params.slug), Number(params.id), (await readJson(req)).status));
api.get('/api/r/:slug/atendimento/robo-config', async ({ req, params }) => W.robotConfig(await staffCtx(req, params.slug)));
api.post('/api/r/:slug/atendimento/robo-ligar', async ({ req, params }) => W.setRobotOn(await staffCtx(req, params.slug), await readJson(req)));
api.put('/api/r/:slug/atendimento/robo-config', async ({ req, params }) => W.saveBot(await staffCtx(req, params.slug), await readJson(req)));
api.get('/api/r/:slug/atendimento/midia/:id', async ({ req, res, params }) => {
  const f = await W.mediaFile(await staffCtx(req, params.slug), Number(params.id));
  res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': f.body.length, 'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `inline; filename="${encodeURIComponent(f.name)}"` });
  res.end(f.body);
  return STREAM;
});
api.get('/api/r/:slug/atendimento/reclamacoes', async ({ req, params }) => W.complaints(await staffCtx(req, params.slug)));
api.post('/api/r/:slug/atendimento/reclamacoes', async ({ req, params }) => W.staffComplaint(await staffCtx(req, params.slug), await readJson(req)));
api.put('/api/r/:slug/atendimento/info', async ({ req, params }) => W.saveInfo(await staffCtx(req, params.slug), await readJson(req)));

// ---------- agência: criar restaurantes ----------
api.get('/api/platform/restaurants', ({ req }) => { requirePlatform(req); return S.listRestaurants(); });
api.post('/api/platform/restaurants', async ({ req }) => {
  requirePlatform(req);
  const r = await S.createRestaurant(await readJson(req));
  return S.publicRestaurant(r);
});

// ---------- páginas ----------
const PAGES = [
  [/^\/indice\/?$/, 'indice.html'],
  [/^\/r\/[^/]+\/painel\/?$/, 'painel.html'],
  [/^\/m\/[^/]+\/?$/, 'menu.html'],
  [/^\/r\/[^/]+\/cozinha\/?$/, 'cozinha.html'],
  [/^\/r\/[^/]+\/caixa\/?$/, 'caixa.html'],
  [/^\/r\/[^/]+\/admin\/?$/, 'admin.html'],
  [/^\/r\/[^/]+\/qrcodes\/?$/, 'qrcodes.html'],
  [/^\/r\/[^/]+\/atendimento\/?$/, 'atendimento.html'],
  [/^\/agencia\/?$/, 'plataforma.html'],
];

const STREAM = Symbol('stream');

// Também é a função da Vercel (api/index.js). No PC, o mesmo handler sobe com createServer abaixo.
export async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (config.serverless) await ensureDemo();
    if (path.startsWith('/api/')) {
      const m = api.match(req.method, path);
      if (!m) throw new HttpError(404, 'Rota não encontrada');
      const out = await m.handler({ req, res, params: m.params, query: url.searchParams });
      if (out !== STREAM) sendJson(res, 200, out);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido');
    if (path === '/') {
      // abre direto no cardápio (mesa 1 do restaurante padrão); sem restaurante, vai para o painel
      const token = await S.defaultMenuToken(config.defaultSlug);
      res.writeHead(302, { Location: token ? `/m/${token}` : '/indice' });
      res.end();
      return;
    }
    if (/^\/(plataforma|painel)\/?$/.test(path)) { res.writeHead(302, { Location: '/indice' }); res.end(); return; }
    const page = PAGES.find(([re]) => re.test(path));
    if (page && serveStatic(res, PUBLIC, page[1], req)) return;
    if (path.startsWith('/uploads/') && serveStatic(res, UPLOADS, decodeURIComponent(path.slice(9)), req)) return;
    if (serveStatic(res, PUBLIC, decodeURIComponent(path.slice(1)), req)) return;
    throw new HttpError(404, 'Página não encontrada');
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (res.headersSent) { res.end(); return; }
    if (path.startsWith('/api/')) sendJson(res, status, { error: e.message || 'Erro interno' });
    else { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(e.message); }
  }
}

// Só sobe o servidor quando rodado direto (node src/server.js); na Vercel quem chama handle é api/index.js.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) createServer(handle).listen(config.port, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\nCardápio SaaS rodando:`);
  console.log(`  Neste PC:        http://localhost:${config.port}`);
  for (const ip of ips) console.log(`  Celular (Wi-Fi): http://${ip}:${config.port}`);
  console.log(`  Restaurantes (índice):  http://localhost:${config.port}/indice`);
  console.log(`  Agência:         http://localhost:${config.port}/agencia  (chave: PLATFORM_KEY)\n`);
});
