// Caixa: mapa de mesas, comanda em tempo real, fechamento, impressão e lançamento de pedidos.
import {
  api, money, hhmm, minutesAgo, esc, $, $$, h, toast, sheet, live, unlockSound, beep, keepAwake,
  staffGate, staffNav, slugFromPath,
} from './common.js';

const slug = slugFromPath();
const STATUS = { received: 'Recebido', preparing: 'Em preparo', ready: 'Pronto', delivered: 'Entregue', canceled: 'Cancelado' };
const PAY = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', outro: 'Outro' };
const CALL = { garcom: 'Chamou o garçom', conta: 'Pediu a conta' };

const S = {
  restaurant: null,
  tables: [],
  products: [],
  categories: [],
  sessions: new Map(), // table_id -> sessão aberta
  calls: [],
  report: null,
  filter: 'all',
  soundOn: false,
  open: null, // folha aberta: { tableId, view, el, close, detail, pay, received, cart, customer, search }
};

// ---------- utilidades ----------
const tableById = id => S.tables.find(t => t.id === id);
const tableName = t => (t ? `Mesa ${t.number}` : 'Mesa');
const callsFor = tableId => S.calls.filter(c => c.table_id === tableId);

function ago(s) {
  const m = minutesAgo(s);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

function parseCents(v) {
  const s = String(v || '').trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const handleAuth = e => { if (e.status === 401 || e.status === 403) location.reload(); };

// ---------- carga de dados ----------
async function loadBase() {
  const d = await api(`/api/r/${slug}/admin`);
  S.tables = d.tables;
  S.products = d.products.filter(p => p.available);
  S.categories = d.categories;
  S.restaurant = { ...S.restaurant, ...d.restaurant };
}

async function loadLive() {
  const [sessions, calls, report] = await Promise.all([
    api(`/api/r/${slug}/sessions`),
    api(`/api/r/${slug}/calls`),
    api(`/api/r/${slug}/report`).catch(() => S.report),
  ]);
  S.sessions = new Map(sessions.map(s => [s.table_id, s]));
  S.calls = calls;
  S.report = report;
}

let refreshTimer = null;
let refreshing = null;
function scheduleRefresh(delay = 250) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, delay);
}
async function refresh() {
  if (refreshing) { scheduleRefresh(400); return; }
  refreshing = (async () => {
    try {
      await loadLive();
      renderAll();
      if (S.open) await refreshSheet();
    } catch (e) { handleAuth(e); console.warn(e); }
  })();
  await refreshing;
  refreshing = null;
}

// ---------- topo, resumo, chamados, mapa ----------
function renderTopbar() {
  $('#topbar').innerHTML = `
    <span class="brand">${esc(S.restaurant.name)} · Caixa</span>
    <span class="dot" id="live-dot" title="Tempo real desconectado"></span>
    ${staffNav(slug, 'caixa')}
    <button class="btn warn small sound-btn" id="sound-btn" type="button">Ativar som</button>`;
  $('#sound-btn').addEventListener('click', enableSound);
}

function enableSound() {
  S.soundOn = unlockSound();
  if (S.soundOn) { $('#sound-btn')?.remove(); beep({ times: 1 }); toast('Som ativado: você ouvirá os chamados das mesas.'); }
}

function setLive(on) {
  const dot = $('#live-dot');
  if (!dot) return;
  const was = dot.classList.contains('on');
  dot.classList.toggle('on', on);
  dot.title = on ? 'Tempo real conectado' : 'Tempo real desconectado — tentando reconectar';
  if (on && !was) scheduleRefresh(0); // recupera eventos perdidos na queda
}

function renderSummary() {
  const r = S.report;
  const openTotal = [...S.sessions.values()].reduce((s, x) => s + x.subtotal_cents, 0);
  const closed = r?.by_payment || [];
  const closedTotal = closed.reduce((s, p) => s + (p.total || 0), 0);
  const closedN = closed.reduce((s, p) => s + p.n, 0);
  const stats = [
    ['main', 'Recebido hoje', money(closedTotal)],
    ['', 'Contas fechadas', closedN],
    ['', 'Pedidos hoje', `${r?.orders?.n ?? 0} · ${money(r?.orders?.total ?? 0)}`],
    ['', `Em aberto (${S.sessions.size} mesas)`, money(openTotal)],
    ...closed.map(p => ['', PAY[p.payment_method] || p.payment_method || '—', `${money(p.total || 0)} · ${p.n}`]),
  ];
  $('#summary').innerHTML = stats.map(([cls, k, v]) =>
    `<div class="cx-stat ${cls}"><small>${esc(k)}</small><strong>${esc(v)}</strong></div>`).join('');
}

function renderCalls() {
  const box = $('#calls');
  box.hidden = !S.calls.length;
  box.innerHTML = S.calls.map(c => `
    <div class="cx-call ${c.kind === 'conta' ? 'conta' : ''}">
      <button class="open-t" type="button" data-table="${c.table_id}">
        Mesa ${esc(c.table_number)} · ${esc(CALL[c.kind] || c.kind)}${c.customer_name ? ` (${esc(c.customer_name)})` : ''} · ${esc(ago(c.created_at))}
      </button>
      <button class="btn ok small" type="button" data-done="${c.id}">Atendido</button>
    </div>`).join('');
}

function visibleTables() {
  return S.tables.filter(t => t.active || S.sessions.has(t.id) || callsFor(t.id).length);
}

function renderFilters() {
  const list = visibleTables();
  const counts = {
    all: list.length,
    open: list.filter(t => S.sessions.has(t.id)).length,
    free: list.filter(t => !S.sessions.has(t.id)).length,
    calling: list.filter(t => callsFor(t.id).length).length,
  };
  for (const b of $$('#filters button')) {
    const f = b.dataset.filter;
    b.classList.toggle('active', f === S.filter);
    b.dataset.label ||= b.textContent.trim();
    b.innerHTML = `${esc(b.dataset.label)}<span class="n">${counts[f]}</span>`;
  }
}

function tileHtml(t) {
  const s = S.sessions.get(t.id);
  const calls = callsFor(t.id);
  const cls = ['tile', s ? 'open' : 'free', calls.length ? 'calling' : '', t.active ? '' : 'inactive'].join(' ');
  const badges = calls.map(c => `<span class="badge ${c.kind === 'conta' ? 'conta' : ''}">${esc(CALL[c.kind] || c.kind)}</span>`).join('');
  let body;
  if (s) {
    const meta = s.orders_count
      ? `${s.orders_count} pedido${s.orders_count > 1 ? 's' : ''} · último ${esc(ago(s.last_order_at))}`
      : `Aberta ${esc(ago(s.opened_at))} · sem pedidos`;
    body = `<span class="t-state">Aberta</span><span class="t-total">${money(s.subtotal_cents)}</span><span class="t-meta">${meta}</span>`;
  } else {
    body = `<span class="t-state">Livre</span>`;
  }
  return `<button type="button" class="${cls}" data-table="${t.id}" aria-label="${esc(tableName(t))}${s ? ', aberta' : ', livre'}">
    <span class="t-num">${esc(t.number)}</span>
    ${t.label ? `<span class="t-label">${esc(t.label)}</span>` : ''}
    ${badges ? `<span class="t-badges">${badges}</span>` : ''}
    ${body}
  </button>`;
}

function renderTables() {
  let list = visibleTables();
  if (S.filter === 'open') list = list.filter(t => S.sessions.has(t.id));
  if (S.filter === 'free') list = list.filter(t => !S.sessions.has(t.id));
  if (S.filter === 'calling') list = list.filter(t => callsFor(t.id).length);
  $('#tables').innerHTML = list.length
    ? list.map(tileHtml).join('')
    : `<p class="muted cx-empty">${S.tables.length ? 'Nenhuma mesa neste filtro.' : 'Nenhuma mesa cadastrada. Cadastre em “Cardápio e mesas”.'}</p>`;
}

function renderAll() {
  renderSummary();
  renderCalls();
  renderFilters();
  renderTables();
}

// ---------- folha da mesa ----------
function openTable(tableId) {
  const t = tableById(tableId);
  if (!t) return;
  S.open?.close();
  const { el, close } = sheet('<div class="muted">Carregando…</div>', { onClose: () => { if (S.open?.el === el) S.open = null; } });
  el.classList.add('cx-sheet');
  S.open = { tableId, view: 'detail', el, close, detail: null, pay: null, received: '', cart: new Map(), customer: '', search: '' };
  el.addEventListener('click', onSheetClick);
  el.addEventListener('input', onSheetInput);
  refreshSheet();
}

let sheetSeq = 0;
async function refreshSheet() {
  const o = S.open;
  if (!o) return;
  const seq = ++sheetSeq;
  const s = S.sessions.get(o.tableId);
  let detail = null;
  try {
    if (s) detail = await api(`/api/r/${slug}/sessions/${s.id}`);
  } catch (e) { handleAuth(e); if (e.status !== 404) toast(e.message, 'error'); }
  if (seq !== sheetSeq || S.open !== o) return;
  o.detail = detail && detail.session.status === 'open' ? detail : null;
  if (o.view === 'close' && !o.detail) { toast('Esta comanda já foi fechada.'); o.view = 'detail'; }
  if (o.view === 'launch') return; // não apaga o que o garçom está montando
  renderSheet();
}

function sheetHead(title, sub = '') {
  return `<div class="cx-head"><div class="spacer"><h2>${title}</h2>${sub ? `<div class="muted">${sub}</div>` : ''}</div>
    <button class="btn ghost x" type="button" data-act="dismiss" aria-label="Fechar">✕</button></div>`;
}

function renderSheet() {
  const o = S.open;
  if (!o) return;
  const t = tableById(o.tableId);
  if (o.view === 'close') o.el.innerHTML = closeView(t, o);
  else if (o.view === 'launch') o.el.innerHTML = launchView(t, o);
  else o.el.innerHTML = detailView(t, o);
}

function callsBlock(tableId) {
  const calls = callsFor(tableId);
  if (!calls.length) return '';
  return `<div class="sheet-calls">${calls.map(c => `
    <div class="sheet-call ${c.kind === 'conta' ? 'conta' : ''}">
      <div><strong>${esc(CALL[c.kind] || c.kind)}</strong>
        <div class="muted">${c.customer_name ? `${esc(c.customer_name)} · ` : ''}${esc(hhmm(c.created_at))} (${esc(ago(c.created_at))})</div></div>
      <button class="btn ok small" type="button" data-done="${c.id}">Atendido</button>
    </div>`).join('')}</div>`;
}

function orderHtml(o) {
  const canceled = o.status === 'canceled';
  return `<article class="order ${canceled ? 'canceled' : ''}">
    <div class="order-head">
      <strong>#${esc(o.number)}</strong>
      <span class="who">${esc(o.customer_name)}</span>
      <span class="muted">${esc(hhmm(o.created_at))}</span>
      <span class="spacer"></span>
      <span class="st ${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span>
    </div>
    <ul>${o.items.map(i => `<li>
      <span class="q">${esc(i.qty)}×</span>
      <span class="n">${esc(i.name)} <span class="u">${money(i.unit_price_cents)}</span></span>
      <span>${money(i.unit_price_cents * i.qty)}</span>
      ${i.choices?.length ? `<span class="note">${i.choices.map(c => esc(c.split(': ').pop())).join(' · ')}</span>` : ''}
      ${i.note ? `<span class="note">Obs.: ${esc(i.note)}</span>` : ''}
    </li>`).join('')}</ul>
    ${o.note ? `<div class="o-note">Obs. do pedido: ${esc(o.note)}</div>` : ''}
    <div class="o-foot">
      <span class="muted">${o.source === 'garcom' ? 'Lançado pela equipe' : o.source === 'nfc' ? 'Via NFC' : o.source === 'whatsapp' ? 'Via WhatsApp' : 'Via QR Code'}</span>
      <span class="spacer"></span>
      <strong class="o-total">${money(o.total_cents)}</strong>
      ${canceled ? '' : `<button class="btn ghost small" type="button" data-cancel="${o.id}">Cancelar</button>`}
    </div>
  </article>`;
}

// Divide a conta por pessoa (nome digitado no pedido). Taxa de serviço proporcional.
function byPerson(d) {
  const m = new Map();
  for (const o of d.orders) {
    if (o.status === 'canceled') continue;
    const name = String(o.customer_name || '').trim() || 'Sem nome';
    const key = name.toLocaleLowerCase('pt-BR');
    const cur = m.get(key) || { name, sub: 0, n: 0 };
    cur.sub += o.total_cents; cur.n += 1;
    m.set(key, cur);
  }
  const pct = d.service_fee_pct || 0;
  return [...m.values()].map(p => ({ ...p, service: Math.round(p.sub * pct / 100), total: p.sub + Math.round(p.sub * pct / 100) }))
    .sort((a, b) => b.total - a.total);
}

function totalsHtml(d) {
  return `<div class="totals">
    <div><span>Subtotal</span><span>${money(d.subtotal_cents)}</span></div>
    ${d.service_fee_pct ? `<div><span>Taxa de serviço (${esc(d.service_fee_pct)}%)</span><span>${money(d.service_cents)}</span></div>` : ''}
    <div class="grand"><span>Total</span><span>${money(d.total_cents)}</span></div>
  </div>`;
}

function detailView(t, o) {
  const d = o.detail;
  const title = `${esc(tableName(t))}${t?.label ? ` <span class="muted">· ${esc(t.label)}</span>` : ''}`;
  if (!d) {
    return `${sheetHead(title, 'Mesa livre')}
      ${callsBlock(o.tableId)}
      <p class="muted">Nenhuma comanda aberta nesta mesa.${S.restaurant.require_open_table
        ? ' Este restaurante exige que a mesa seja aberta pela equipe antes de o cliente pedir pelo celular.' : ''}</p>
      <div class="cx-actions">
        <button class="btn soft" type="button" data-act="launch">+ Lançar pedido</button>
        <button class="btn" type="button" data-act="open-table">Abrir mesa</button>
      </div>`;
  }
  const active = d.orders.filter(x => x.status !== 'canceled');
  const people = byPerson(d);
  return `${sheetHead(title, `Comanda aberta às ${esc(hhmm(d.session.opened_at))} · ${active.length} pedido${active.length === 1 ? '' : 's'}`)}
    ${callsBlock(o.tableId)}
    <section class="cx-section"><h3>Pedidos</h3>
      ${d.orders.length ? d.orders.map(orderHtml).join('') : '<p class="muted">Mesa aberta, ainda sem pedidos.</p>'}
    </section>
    ${people.length > 1 ? `<section class="cx-section"><h3>Quanto cada um consumiu</h3>
      <div class="people">${people.map(p => `<div class="person"><span class="nm">${esc(p.name)} <small>${p.n} pedido${p.n > 1 ? 's' : ''}</small></span>
        ${p.service ? `<small>${money(p.sub)} + ${money(p.service)}</small>` : ''}<strong>${money(p.total)}</strong></div>`).join('')}</div>
      ${d.service_fee_pct ? '<small class="muted">Taxa de serviço dividida proporcionalmente ao consumo (pode haver diferença de centavos).</small>' : ''}
    </section>` : ''}
    <section class="cx-section">${totalsHtml(d)}</section>
    <div class="cx-actions">
      <button class="btn soft" type="button" data-act="launch">+ Lançar pedido</button>
      <button class="btn soft" type="button" data-act="print">Imprimir conta</button>
      <button class="btn ok full" type="button" data-act="close-view">Fechar conta · ${money(d.total_cents)}</button>
    </div>`;
}

function closeView(t, o) {
  const d = o.detail;
  const rec = parseCents(o.received);
  const change = rec === null ? null : rec - d.total_cents;
  const quick = [...new Set([d.total_cents, Math.ceil(d.total_cents / 1000) * 1000, Math.ceil(d.total_cents / 5000) * 5000,
    Math.ceil(d.total_cents / 10000) * 10000])].filter(v => v > 0).slice(0, 4);
  return `${sheetHead(`Fechar conta · ${esc(tableName(t))}`, 'Escolha a forma de pagamento')}
    <div class="big-total">${money(d.total_cents)}</div>
    ${totalsHtml(d)}
    ${(d.by_customer || []).length > 1 ? `<section class="cx-section"><h3>Por pessoa</h3>
      <div class="per-person">${d.by_customer.map(c => `<div><span>${esc(c.name)}</span><b>${money(c.subtotal_cents)}</b></div>`).join('')}</div>
      ${d.service_cents ? '<p class="muted" style="font-size:.82rem;margin:.3em 0 0">Sem a taxa de serviço.</p>' : ''}</section>` : ''}
    <section class="cx-section"><h3>Forma de pagamento</h3>
      <div class="pay-grid">${Object.entries(PAY).map(([k, l]) =>
        `<button type="button" data-pay="${k}" class="${o.pay === k ? 'active' : ''}" aria-pressed="${o.pay === k}">${l}</button>`).join('')}</div>
    </section>
    ${o.pay === 'dinheiro' ? `<section class="cx-section"><h3>Troco</h3>
      <label class="field"><span>Valor recebido (opcional)</span>
        <input class="input" id="received" inputmode="decimal" placeholder="Ex.: 100,00" value="${esc(o.received)}" autocomplete="off"></label>
      <div class="cash-quick">${quick.map(v => `<button class="btn soft small" type="button" data-cash="${v}">${money(v)}</button>`).join('')}</div>
      <div id="change-out">${changeHtml(change)}</div>
    </section>` : ''}
    ${o.charging ? `<div class="terminal ${o.charging}" role="status">${TERMINAL[o.charging]}</div>` : ''}
    <div class="cx-actions">
      <button class="btn ghost" type="button" data-act="back" ${o.charging ? 'disabled' : ''}>Voltar</button>
      ${TERMINAL_PAY.includes(o.pay)
        ? `<button class="btn ghost" type="button" data-act="confirm-close" ${o.charging ? 'disabled' : ''}>Recebi por fora</button>
           <button class="btn ok" type="button" data-act="charge" ${o.charging ? 'disabled' : ''}>Cobrar ${money(d.total_cents)} na maquininha</button>`
        : `<button class="btn ok" type="button" data-act="confirm-close" ${o.pay ? '' : 'disabled'}>Confirmar pagamento</button>`}
    </div>`;
}

// Maquininha: hoje simulada (PAYMENT_PROVIDER no servidor escolhe a operadora quando for integrada).
const TERMINAL_PAY = ['cartao', 'pix'];
const TERMINAL = {
  sending: 'Enviando o valor para a maquininha…',
  waiting: 'Aguardando o cliente passar o cartão ou pagar o Pix…',
  approved: 'Pagamento aprovado. Fechando a conta…',
};

function changeHtml(change) {
  if (change === null) return '';
  return change >= 0
    ? `<div class="change">Troco: ${money(change)}</div>`
    : `<div class="change neg">Faltam ${money(-change)}</div>`;
}

function launchView(t, o) {
  const q = o.search.trim().toLocaleLowerCase('pt-BR');
  const prods = S.products.filter(p => !q || p.name.toLocaleLowerCase('pt-BR').includes(q));
  const cats = [...S.categories, { id: null, name: 'Outros' }];
  const groups = cats.map(c => ({ c, items: prods.filter(p => (p.category_id ?? null) === c.id || (c.id === null && !S.categories.some(k => k.id === p.category_id))) }))
    .filter(g => g.items.length);
  const cartLines = [...o.cart.entries()];
  const total = cartLines.reduce((s, [id, l]) => s + lineUnit(id, l) * l.qty, 0);
  return `${sheetHead(`Lançar pedido · ${esc(tableName(t))}`, 'Pedido feito pela equipe (vai direto para a cozinha)')}
    <label class="field"><span>Nome do cliente (opcional)</span>
      <input class="input" id="l-customer" maxlength="40" value="${esc(o.customer)}" placeholder="Garçom" autocomplete="off"></label>
    <section class="cx-section">
      <input class="input" id="l-search" type="search" placeholder="Buscar produto…" value="${esc(o.search)}" autocomplete="off">
      <div class="launch-list" id="l-list">${groups.length ? groups.map(g => `<div class="launch-cat">${esc(g.c.name)}</div>${g.items.map(p => prodHtml(p, o)).join('')}`).join('')
        : '<p class="muted">Nenhum produto disponível encontrado.</p>'}</div>
    </section>
    <section class="cx-section" id="l-cart">${cartHtml(o)}</section>
    <div class="cx-actions">
      <button class="btn ghost" type="button" data-act="back">Voltar</button>
      <button class="btn ok" type="button" data-act="send-order" ${cartLines.length ? '' : 'disabled'}>Enviar · ${money(total)}</button>
    </div>`;
}

function prodHtml(p, o) {
  const qty = o.cart.get(p.id)?.qty || 0;
  return `<div class="prod ${qty ? 'sel' : ''}" data-prod="${p.id}">
    <span class="pn">${esc(p.name)}<small>${money(p.price_cents)}</small></span>
    <span class="stepper">
      ${qty ? `<button type="button" data-dec="${p.id}" aria-label="Diminuir">−</button><span class="qv">${qty}</span>` : ''}
      <button type="button" class="plus" data-inc="${p.id}" aria-label="Adicionar ${esc(p.name)}">+</button>
    </span>
  </div>`;
}

// preço do item lançado: prato + acréscimo das escolhas (ex.: parmegiana +R$ 5)
function lineUnit(id, l) {
  const p = S.products.find(x => x.id === id);
  return (p?.price_cents || 0) + (p?.option_groups || []).reduce((s, g) => s + (g.choices.find(c => c.name === l.choices?.[g.name])?.add_cents || 0), 0);
}

function cartHtml(o) {
  const lines = [...o.cart.entries()];
  if (!lines.length) return '<p class="muted">Toque em + para adicionar itens.</p>';
  return `<h3>Itens do pedido</h3>${lines.map(([id, l]) => {
    const p = S.products.find(x => x.id === id);
    return `<div class="cart-line"><div class="row"><strong>${l.qty}× ${esc(p?.name)}</strong><span>${money(lineUnit(id, l) * l.qty)}</span></div>
      ${(p?.option_groups || []).map(g => `<label class="field"><span>${esc(g.name)}</span><select class="input" data-choice="${id}" data-group="${esc(g.name)}">
        ${g.choices.map(c => `<option ${l.choices?.[g.name] === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`).join('')}
      <input class="input" data-note="${id}" maxlength="140" placeholder="Observação (ex.: sem cebola)" value="${esc(l.note)}" autocomplete="off"></div>`;
  }).join('')}`;
}

// atualiza só lista/carrinho/botão (sem perder o foco da busca)
function rerenderLaunchParts() {
  const o = S.open;
  const t = tableById(o.tableId);
  const tmp = h(`<div>${launchView(t, o)}</div>`);
  $('#l-list', o.el).replaceWith($('#l-list', tmp));
  $('#l-cart', o.el).replaceWith($('#l-cart', tmp));
  $('.cx-actions', o.el).replaceWith($('.cx-actions', tmp));
}

// ---------- ações da folha ----------
async function onSheetClick(e) {
  const o = S.open;
  if (!o) return;
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  try {
    if (act === 'dismiss') { o.close(); return; }
    if (act === 'back') { o.view = 'detail'; renderSheet(); refreshSheet(); return; }
    if (act === 'close-view') { o.view = 'close'; o.pay = null; o.received = ''; o.charging = null; renderSheet(); return; }
    if (act === 'launch') { o.view = 'launch'; o.cart = new Map(); o.customer = ''; o.search = ''; renderSheet(); return; }
    if (act === 'print') { printReceipt(o); return; }
    if (b.dataset.pay) { o.pay = b.dataset.pay; renderSheet(); if (o.pay === 'dinheiro') $('#received', o.el)?.focus(); return; }
    if (b.dataset.cash) { o.received = (Number(b.dataset.cash) / 100).toFixed(2).replace('.', ','); renderSheet(); return; }
    if (b.dataset.inc || b.dataset.dec) {
      const id = Number(b.dataset.inc || b.dataset.dec);
      // prato com escolhas começa na primeira opção de cada grupo; a equipe troca no seletor
      const p = S.products.find(x => x.id === id);
      const cur = o.cart.get(id) || { qty: 0, note: '', choices: Object.fromEntries((p?.option_groups || []).map(g => [g.name, g.choices[0].name])) };
      cur.qty = Math.max(0, Math.min(50, cur.qty + (b.dataset.inc ? 1 : -1)));
      if (cur.qty) o.cart.set(id, cur); else o.cart.delete(id);
      rerenderLaunchParts();
      return;
    }
    if (b.dataset.done) { await doneCall(Number(b.dataset.done), b); return; }
    if (b.dataset.cancel) {
      const ord = o.detail?.orders.find(x => x.id === Number(b.dataset.cancel));
      if (!ord || !confirm(`Cancelar o pedido #${ord.number} de ${ord.customer_name} (${money(ord.total_cents)})? Ele sai da conta.`)) return;
      b.disabled = true;
      await api(`/api/r/${slug}/orders/${ord.id}`, { method: 'PATCH', body: { status: 'canceled' } });
      toast(`Pedido #${ord.number} cancelado.`);
      scheduleRefresh(0);
      return;
    }
    if (act === 'open-table') {
      b.disabled = true;
      await api(`/api/r/${slug}/tables/${o.tableId}/open`, { method: 'POST' });
      toast(`${tableName(tableById(o.tableId))} aberta.`);
      await refresh();
      return;
    }
    if (act === 'charge') {
      const d = o.detail;
      if (!d || !TERMINAL_PAY.includes(o.pay)) return;
      const step = (st, ms) => { o.charging = st; renderSheet(); return new Promise(r => setTimeout(r, ms)); };
      try {
        await step('sending', 700);
        await step('waiting', 1600);
        const res = await api(`/api/r/${slug}/sessions/${d.session.id}/close`, { method: 'POST', body: { payment_method: o.pay, terminal: true } });
        await step('approved', 700);
        toast(`Pago na maquininha: ${money(d.total_cents)} (${PAY[o.pay]}) · ${res.session.payment_ref}`);
        o.close();
        scheduleRefresh(0);
      } catch (err) { o.charging = null; renderSheet(); throw err; }
      return;
    }
    if (act === 'confirm-close') {
      const d = o.detail;
      if (!d || !o.pay) return;
      b.disabled = true;
      await api(`/api/r/${slug}/sessions/${d.session.id}/close`, { method: 'POST', body: { payment_method: o.pay } });
      const rec = o.pay === 'dinheiro' ? parseCents(o.received) : null;
      toast(`Conta fechada: ${money(d.total_cents)} (${PAY[o.pay]})${rec !== null && rec >= d.total_cents ? ` · troco ${money(rec - d.total_cents)}` : ''}`);
      o.close();
      scheduleRefresh(0);
      return;
    }
    if (act === 'send-order') {
      const items = [...o.cart.entries()].map(([product_id, l]) => ({ product_id, qty: l.qty, note: l.note.trim(), choices: l.choices }));
      if (!items.length) return;
      b.disabled = true;
      const name = o.customer.trim();
      const order = await api(`/api/r/${slug}/orders`, {
        method: 'POST', body: { table_id: o.tableId, customer_name: name.length >= 2 ? name : undefined, items },
      });
      toast(`Pedido #${order.number} enviado para a cozinha.`);
      o.view = 'detail';
      renderSheet();
      await refresh();
      return;
    }
  } catch (err) {
    handleAuth(err);
    toast(err.message, 'error');
    b.disabled = false;
  }
}

function onSheetInput(e) {
  const o = S.open;
  if (!o) return;
  const el = e.target;
  if (el.id === 'received') {
    o.received = el.value;
    const rec = parseCents(o.received);
    $('#change-out', o.el).innerHTML = changeHtml(rec === null ? null : rec - o.detail.total_cents);
  } else if (el.id === 'l-customer') o.customer = el.value;
  else if (el.id === 'l-search') { o.search = el.value; rerenderLaunchParts(); }
  else if (el.dataset.note) { const l = o.cart.get(Number(el.dataset.note)); if (l) l.note = el.value; }
  else if (el.dataset.choice) {
    const l = o.cart.get(Number(el.dataset.choice));
    if (l) { l.choices[el.dataset.group] = el.value; rerenderLaunchParts(); }
  }
}

async function doneCall(id, btn) {
  if (btn) btn.disabled = true;
  try {
    await api(`/api/r/${slug}/calls/${id}/done`, { method: 'POST' });
    S.calls = S.calls.filter(c => c.id !== id);
    renderAll();
    if (S.open && S.open.view === 'detail') renderSheet();
  } catch (e) { handleAuth(e); toast(e.message, 'error'); if (btn) btn.disabled = false; }
}

// ---------- impressão da conta (cupom 80 mm) ----------
function printReceipt(o) {
  const d = o.detail;
  if (!d) return;
  const t = tableById(o.tableId);
  const r = S.restaurant;
  const lines = new Map();
  for (const ord of d.orders) {
    if (ord.status === 'canceled') continue;
    for (const i of ord.items) {
      const k = `${i.name}|${i.unit_price_cents}`;
      const cur = lines.get(k) || { name: i.name, unit: i.unit_price_cents, qty: 0 };
      cur.qty += i.qty;
      lines.set(k, cur);
    }
  }
  const people = byPerson(d);
  const now = new Date();
  $('#print-area').innerHTML = `<div class="receipt">
    <h1>${esc(r.name)}</h1>
    ${r.address ? `<div class="c">${esc(r.address)}</div>` : ''}
    <hr>
    <div>${esc(tableName(t))}${t?.label ? ` · ${esc(t.label)}` : ''}</div>
    <div>Aberta: ${esc(hhmm(d.session.opened_at))} · Impressa: ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
    <hr>
    <table>${[...lines.values()].map(l => `<tr><td>${l.qty}x ${esc(l.name)}<br><small>${money(l.unit)} un.</small></td><td class="r">${money(l.unit * l.qty)}</td></tr>`).join('')}</table>
    <hr>
    <table>
      <tr><td>Subtotal</td><td class="r">${money(d.subtotal_cents)}</td></tr>
      ${d.service_fee_pct ? `<tr><td>Serviço (${esc(d.service_fee_pct)}%)</td><td class="r">${money(d.service_cents)}</td></tr>` : ''}
      <tr class="tot"><td>TOTAL</td><td class="r">${money(d.total_cents)}</td></tr>
    </table>
    ${people.length > 1 ? `<hr><div>Por pessoa:</div><table>${people.map(p => `<tr><td>${esc(p.name)}</td><td class="r">${money(p.total)}</td></tr>`).join('')}</table>` : ''}
    <hr>
    <div class="c">Obrigado pela preferência!</div>
    <div class="c"><small>Não é documento fiscal</small></div>
  </div>`;
  window.print();
}

// ---------- tempo real ----------
function onCall(c) {
  const isNew = c.status !== 'done' && !S.calls.some(x => x.id === c.id);
  if (isNew) {
    if (S.soundOn) beep();
    toast(`Mesa ${c.table_number}: ${CALL[c.kind] || 'chamado'}`);
  }
  scheduleRefresh();
}

// ---------- início ----------
async function init() {
  S.restaurant = await staffGate(slug);
  renderTopbar();
  try {
    await loadBase();
    await loadLive();
  } catch (e) { handleAuth(e); toast(e.message, 'error'); }
  $('#app').hidden = false;
  renderAll();

  $('#tables').addEventListener('click', e => {
    const b = e.target.closest('[data-table]');
    if (b) openTable(Number(b.dataset.table));
  });
  $('#calls').addEventListener('click', e => {
    const done = e.target.closest('[data-done]');
    if (done) { doneCall(Number(done.dataset.done), done); return; }
    const b = e.target.closest('[data-table]');
    if (b) openTable(Number(b.dataset.table));
  });
  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    S.filter = b.dataset.filter;
    try { localStorage.setItem('caixa-filter', S.filter); } catch { /* sem armazenamento */ }
    renderFilters(); renderTables();
  });
  try { const f = localStorage.getItem('caixa-filter'); if (f) { S.filter = f; renderFilters(); renderTables(); } } catch { /* idem */ }

  live(`/api/r/${slug}/stream`, {
    order: () => scheduleRefresh(),
    session: () => scheduleRefresh(),
    call: onCall,
  }, setLive);

  // relógio: atualiza "há X min" e recarrega mesas/produtos de vez em quando
  setInterval(() => { renderTables(); renderCalls(); }, 30_000);
  setInterval(() => loadBase().then(() => { renderAll(); }).catch(handleAuth), 5 * 60_000);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.open) S.open.close(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleRefresh(0); });
  keepAwake();
}

init();
