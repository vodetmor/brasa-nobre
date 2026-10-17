// Painel da cozinha: /r/<slug>/cozinha
import { api, esc, h, $, $$, toast, live, unlockSound, beep, keepAwake, minutesAgo, hhmm, staffGate, staffNav, slugFromPath } from './common.js';
import { printOrder, bluetoothPair, bluetoothReconnect, bluetoothConnected, bluetoothName, bluetoothSupported } from './printer.js';

const slug = slugFromPath();
const COLS = [
  { status: 'received', title: 'Novos', next: 'preparing', label: 'Começar preparo' },
  { status: 'preparing', title: 'Preparando', next: 'ready', label: 'Pronto' },
  { status: 'ready', title: 'Prontos', next: 'delivered', label: 'Entregue na mesa' },
];
const prefs = {
  get mode() { return localStorage.getItem('print_mode') || 'off'; },
  set mode(v) { localStorage.setItem('print_mode', v); },
  get paper() { return Number(localStorage.getItem('print_paper') || 58); },
  set paper(v) { localStorage.setItem('print_paper', v); },
};

let restaurant;
let orders = new Map();
let calls = new Map();
const fresh = new Set(); // pedidos que acabaram de chegar (piscam)

start();

async function start() {
  restaurant = await staffGate(slug);
  $('#app').innerHTML = `
    <header class="topbar"><span class="dot" id="live-dot" title="Conexão em tempo real"></span>
      <span class="brand">${esc(restaurant.name)} · Cozinha</span><span class="spacer"></span>${staffNav(slug, 'cozinha')}</header>
    <div class="k-tools">
      <label class="row"><span class="muted">Impressão automática</span>
        <select class="input" id="p-mode">
          <option value="off">Desligada (só tela)</option>
          <option value="browser">Impressora do sistema (USB/rede)</option>
          <option value="bluetooth">Bluetooth BLE (Chrome)</option>
          <option value="rawbt">Bluetooth via app RawBT (Android)</option>
        </select></label>
      <select class="input" id="p-paper"><option value="58">58 mm</option><option value="80">80 mm</option></select>
      <button class="btn soft small hidden" id="p-pair">Conectar impressora</button>
      <button class="btn ghost small" id="p-test">Testar impressão</button>
      <span class="printer-state muted" id="p-state"></span>
    </div>
    <div class="calls" id="calls"></div>
    <main class="board">${COLS.map(c => `
      <section class="col" data-status="${c.status}"><h2>${c.title} <span class="count">0</span></h2><div class="list"></div></section>`).join('')}
    </main>`;

  setupPrinterControls();
  showSoundCta();
  keepAwake();

  await reload();
  live(`/api/r/${slug}/stream`, {
    order: o => {
      const isNew = !orders.has(o.id) && o.status === 'received';
      if (['delivered', 'canceled'].includes(o.status)) orders.delete(o.id); else orders.set(o.id, o);
      if (isNew) onNewOrder(o);
      render();
    },
    call: c => {
      if (c.status === 'done') calls.delete(c.id); else { calls.set(c.id, c); beep({ times: 2, freq: 660 }); }
      renderCalls();
    },
    session: () => {},
  }, ok => { $('#live-dot').classList.toggle('on', ok); if (ok) reload(); });
  setInterval(render, 30_000); // atualiza os "há X min"
}

async function reload() {
  const [list, callList] = await Promise.all([api(`/api/r/${slug}/orders`), api(`/api/r/${slug}/calls`)]);
  orders = new Map(list.map(o => [o.id, o]));
  calls = new Map(callList.map(c => [c.id, c]));
  render(); renderCalls();
}

async function onNewOrder(o) {
  fresh.add(o.id);
  setTimeout(() => { fresh.delete(o.id); }, 4000);
  beep();
  if (prefs.mode !== 'off') {
    try { await printOrder(prefs.mode, o, restaurant, prefs.paper); }
    catch (e) { toast(`Não imprimiu o pedido #${o.number}: ${e.message}`, 'error'); updatePrinterState(); }
  }
}

function render() {
  for (const c of COLS) {
    const list = [...orders.values()].filter(o => o.status === c.status).sort((a, b) => a.id - b.id);
    const col = $(`.col[data-status="${c.status}"]`);
    col.querySelector('.count').textContent = list.length;
    col.querySelector('.list').innerHTML = list.length ? list.map(o => ticket(o, c)).join('') : '<div class="empty">Nenhum pedido</div>';
  }
  $$('.ticket [data-act]').forEach(b => b.addEventListener('click', () => act(Number(b.closest('.ticket').dataset.id), b.dataset.act)));
}

function ticket(o, col) {
  const age = minutesAgo(o.created_at);
  return `<article class="ticket ${o.status} ${fresh.has(o.id) ? 'new' : ''}" data-id="${o.id}">
    <div class="top"><span class="mesa">Mesa ${o.table_number}</span><span class="num">#${o.number}</span>
      <span class="age ${age >= 25 ? 'late' : age >= 12 ? 'mid' : ''}" title="Chegou às ${hhmm(o.created_at)}">${age} min</span></div>
    <div class="who">${esc(o.customer_name)}${o.source === 'garcom' ? ' · lançado pela equipe' : ''}</div>
    <ul>${o.items.map(itemLine).join('')}</ul>
    ${o.note ? `<div class="onote">Obs.: ${esc(o.note)}</div>` : ''}
    <div class="actions">
      <button class="btn main ${col.next === 'ready' ? 'ok' : ''}" data-act="${col.next}">${col.label}</button>
      <button class="btn soft small" data-act="print" title="Imprimir">Imprimir</button>
      <button class="btn ghost small" data-act="canceled" title="Cancelar pedido">Cancelar</button>
    </div></article>`;
}

// Item: nome, ingredientes (os retirados aparecem riscados e em destaque "SEM ...") e observação.
function itemLine(i) {
  const removed = i.removed || [];
  const ingr = (i.ingredients || []).filter(x => !removed.includes(x));
  return `<li class="${i.image_url ? 'has-img' : ''}">${i.image_url ? `<img class="ithumb" src="${esc(i.image_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<b>${i.qty}×</b><span class="iname">${esc(i.name)}</span>
    ${removed.length ? `<span class="isem">SEM ${removed.map(esc).join(', ')}</span>` : ''}
    ${ingr.length ? `<span class="iingr">${ingr.map(esc).join(' · ')}</span>` : ''}
    ${i.note ? `<span class="inote">Obs.: ${esc(i.note)}</span>` : ''}</li>`;
}

async function act(id, action) {
  const o = orders.get(id);
  if (!o) return;
  if (action === 'print') {
    try { await printOrder(prefs.mode === 'off' ? 'browser' : prefs.mode, o, restaurant, prefs.paper); }
    catch (e) { toast(e.message, 'error'); }
    return;
  }
  if (action === 'canceled' && !confirm(`Cancelar o pedido #${o.number} da mesa ${o.table_number}?`)) return;
  try {
    const updated = await api(`/api/r/${slug}/orders/${id}`, { method: 'PATCH', body: { status: action } });
    if (['delivered', 'canceled'].includes(updated.status)) orders.delete(id); else orders.set(id, updated);
    render();
  } catch (e) { toast(e.message, 'error'); }
}

function renderCalls() {
  const el = $('#calls');
  el.innerHTML = [...calls.values()].map(c => `
    <div class="call ${c.kind}">Mesa ${c.table_number}: ${c.kind === 'conta' ? 'pediu a conta' : 'chamou o garçom'}${c.customer_name ? ` (${esc(c.customer_name)})` : ''}
      <button class="btn small soft" data-call="${c.id}">Ok</button></div>`).join('');
  $$('[data-call]', el).forEach(b => b.addEventListener('click', async () => {
    await api(`/api/r/${slug}/calls/${b.dataset.call}/done`, { method: 'POST' }).catch(e => toast(e.message, 'error'));
    calls.delete(Number(b.dataset.call)); renderCalls();
  }));
}

// ---------- impressora ----------
function setupPrinterControls() {
  const mode = $('#p-mode'), paper = $('#p-paper'), pair = $('#p-pair');
  mode.value = prefs.mode; paper.value = String(prefs.paper);
  mode.addEventListener('change', () => { prefs.mode = mode.value; updatePrinterState(); });
  paper.addEventListener('change', () => { prefs.paper = Number(paper.value); });
  pair.addEventListener('click', async () => {
    try { const name = await bluetoothPair(); toast(`Conectado: ${name}`); }
    catch (e) { if (e.name !== 'NotFoundError') toast(e.message, 'error'); }
    updatePrinterState();
  });
  $('#p-test').addEventListener('click', async () => {
    const sample = { id: 0, number: 0, table_number: 0, customer_name: 'Teste', created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      items: [{ qty: 2, name: 'Espetinho de carne', note: 'bem passado', removed: ['Farofa'], ingredients: ['Alcatra', 'Sal grosso', 'Farofa'] }, { qty: 1, name: 'Refrigerante' }], note: '', total_cents: 2400, source: 'qr' };
    try { await printOrder(prefs.mode === 'off' ? 'browser' : prefs.mode, sample, restaurant, prefs.paper); }
    catch (e) { toast(e.message, 'error'); }
  });
  if (prefs.mode === 'bluetooth') bluetoothReconnect().then(updatePrinterState);
  updatePrinterState();
}

function updatePrinterState() {
  const m = prefs.mode, st = $('#p-state');
  $('#p-pair').classList.toggle('hidden', m !== 'bluetooth');
  if (m === 'bluetooth') {
    st.textContent = !bluetoothSupported() ? 'Este navegador não tem Bluetooth: use o Chrome.'
      : bluetoothConnected() ? `Conectada: ${bluetoothName()}` : 'Impressora desconectada: toque em Conectar.';
  } else if (m === 'browser') st.textContent = 'Dica: abra o Chrome com --kiosk-printing para imprimir sem confirmação.';
  else if (m === 'rawbt') st.textContent = 'Precisa do app RawBT instalado e pareado com a impressora.';
  else st.textContent = '';
}

// Navegadores só tocam som depois de um toque na tela.
function showSoundCta() {
  const cta = h(`<div class="sound-cta"><div class="card grid">
    <h2>Painel da cozinha</h2><p class="muted">Toque para ativar o som de novos pedidos e manter a tela acesa.</p>
    <button class="btn block">Ativar som e começar</button></div></div>`);
  document.body.append(cta);
  cta.querySelector('button').addEventListener('click', () => { unlockSound(); beep({ times: 1 }); cta.remove(); keepAwake(); });
}
