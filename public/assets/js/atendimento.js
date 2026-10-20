// Atendimento pelo WhatsApp: /r/<slug>/atendimento
// O robô responde sozinho; a equipe acompanha, assume a conversa quando quiser e confirma os pedidos.
import { api, esc, $, $$, toast, money, hhmm, parseDate, unlockSound, beep, staffGate, staffNav, slugFromPath } from './common.js';

const slug = slugFromPath();
const REASON = {
  pediu_atendente: 'Pediu uma pessoa', reclamacao: 'Reclamação', alterar_cancelar: 'Alterar ou cancelar',
  fora_do_cardapio: 'Fora do cardápio', duvida: 'Dúvida', equipe_assumiu: 'Equipe respondendo', outro: 'Precisa da equipe',
};
const STATUS = { novo: 'Novo', confirmado: 'Em preparo', saiu: 'Saiu para entrega', pronto: 'Pronto para retirar', entregue: 'Entregue', cancelado: 'Cancelado' };
const PAY = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão' };
const INFO_HINT = `Exemplo:
Funcionamos de segunda a sábado, das 11h às 15h.
Entregamos em Sobradinho I e II. Taxa de entrega: R$ 5,00.
Tempo médio de entrega: 40 minutos.
Pix: (61) 99611-5754 (Central do Espeto).
Não aceitamos vale-refeição.`;

let restaurant, data = { contacts: [], orders: [], info: '' };
let tab = 'conversas', open = null, convo = null, seenOrders = null;

start();

async function start() {
  restaurant = await staffGate(slug);
  $('#app').innerHTML = `
    <header class="topbar"><span class="dot on" id="live-dot" title="Atualizando"></span>
      <span class="brand">${esc(restaurant.name)} · WhatsApp</span><span class="spacer"></span>${staffNav(slug, 'atendimento')}</header>
    <div class="at-tabs" role="tablist">
      <button type="button" role="tab" data-tab="conversas">Conversas<span class="count hidden" id="c-conv"></span></button>
      <button type="button" role="tab" data-tab="pedidos">Pedidos<span class="count hidden" id="c-ped"></span></button>
      <button type="button" role="tab" data-tab="info">Informações para o robô</button>
    </div>
    <div id="banner"></div>
    <main id="view"></main>`;
  $$('.at-tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  addEventListener('click', unlockSound, { once: true });
  await refresh();
  setInterval(refresh, 4000);
  setInterval(() => open && loadConvo(false), 3000);
}

async function refresh() {
  try {
    data = await api(`/api/r/${slug}/atendimento`);
    $('#live-dot').classList.add('on');
  } catch { $('#live-dot').classList.remove('on'); return; }
  const fresh = data.orders.filter(o => o.status === 'novo').map(o => o.id);
  if (seenOrders && fresh.some(id => !seenOrders.has(id))) { beep(); toast('Pedido novo pelo WhatsApp'); }
  seenOrders = new Set(data.orders.map(o => o.id));
  render(true);
}

function render(passive = false) {
  $$('.at-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  const need = data.contacts.filter(c => c.needs_human && c.human_reason !== 'equipe_assumiu').length;
  const novos = data.orders.filter(o => o.status === 'novo').length;
  setCount('#c-conv', need); setCount('#c-ped', novos);
  $('#banner').innerHTML = !data.robot ? '<p class="at-banner">O robô ainda não está ligado neste restaurante. As conversas aparecem aqui quando o WhatsApp for conectado.</p>'
    : !data.can_send ? '<p class="at-banner">Envio pelo painel desligado: a equipe vê as conversas, mas responde pelo celular.</p>' : '';
  // não redesenha o que a pessoa está digitando
  if (passive && tab === 'info') return;
  if (tab === 'conversas') renderChat(passive);
  else if (tab === 'pedidos') renderOrders();
  else renderInfo();
}

const setCount = (sel, n) => { const el = $(sel); el.textContent = n; el.classList.toggle('hidden', !n); };
const label = c => c.name || formatPhone(c.phone);
function formatPhone(p) {
  const m = String(p).match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${p}`;
}
function when(s) {
  const d = parseDate(s);
  return d.toDateString() === new Date().toDateString() ? hhmm(s) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ---------- conversas ----------
function renderChat(passive) {
  let wrap = $('.at-chat');
  if (!wrap) {
    $('#view').innerHTML = `<div class="at-chat"><aside class="at-list" aria-label="Conversas"></aside><section class="at-convo"></section></div>`;
    wrap = $('.at-chat');
    new ResizeObserver(() => document.documentElement.style.setProperty('--top', `${wrap.getBoundingClientRect().top + scrollY}px`)).observe(document.body);
    passive = false;
  }
  wrap.classList.toggle('open', !!open);
  const list = $('.at-list');
  // pede atenção primeiro, depois a mais recente
  const sorted = [...data.contacts].sort((a, b) => (urgent(b) - urgent(a)) || (b.updated_at > a.updated_at ? 1 : -1));
  // só redesenha a lista quando algo mudou (não rouba o clique nem o hover a cada atualização)
  const key = JSON.stringify([sorted, open]);
  if (passive && list.dataset.key === key) return;
  list.dataset.key = key;
  list.innerHTML = sorted.length ? sorted.map(c => `
    <button type="button" class="at-contact${c.phone === open ? ' active' : ''}" data-phone="${esc(c.phone)}">
      <b>${esc(label(c))}</b><time>${when(c.updated_at)}</time>
      <span class="last">${esc(c.last_message || '')}</span>
      <span class="badges">${c.needs_human ? `<span class="tag ${urgent(c) ? 'alert' : 'team'}">${esc(REASON[c.human_reason] || REASON.outro)}</span>` : ''}
        ${c.unread && c.phone !== open ? `<span class="unread">${c.unread}</span>` : ''}</span>
    </button>`).join('') : '<p class="at-empty">Nenhuma conversa ainda. Quando um cliente mandar mensagem para o WhatsApp da casa, ela aparece aqui.</p>';
  list.querySelectorAll('[data-phone]').forEach(b => b.addEventListener('click', () => openConvo(b.dataset.phone)));
  if (!passive || !open) renderConvo();
}
const urgent = c => (c.needs_human && c.human_reason !== 'equipe_assumiu' ? 1 : 0);

async function openConvo(phone) {
  open = phone; convo = null;
  render();
  await loadConvo(true);
}

async function loadConvo(scroll) {
  const phone = open;
  try {
    const d = await api(`/api/r/${slug}/atendimento/conversa?phone=${encodeURIComponent(phone)}`);
    if (phone !== open) return;
    const changed = !convo || JSON.stringify(d.messages.map(m => m.pending)) !== JSON.stringify(convo.messages.map(m => m.pending)) || d.contact.needs_human !== convo.contact.needs_human;
    convo = d;
    if (changed && tab === 'conversas') renderConvo(scroll || isAtBottom());
  } catch (e) { if (scroll) toast(e.message, 'error'); }
}

const isAtBottom = () => { const m = $('.at-msgs'); return !m || m.scrollHeight - m.scrollTop - m.clientHeight < 80; };

function renderConvo(scroll = true) {
  const box = $('.at-convo');
  if (!box) return;
  if (!open) { box.innerHTML = '<p class="at-empty">Escolha uma conversa para ver as mensagens.</p>'; return; }
  if (!convo) { box.innerHTML = '<p class="at-empty">Carregando…</p>'; return; }
  const c = convo.contact;
  const draft = $('#reply')?.value || '';
  box.innerHTML = `
    <div class="at-convo-head">
      <button type="button" class="btn ghost small at-back" id="back">Voltar</button>
      <div class="who"><b>${esc(label(c))}</b><span>${esc(formatPhone(c.phone))}</span></div>
      <span class="spacer"></span>
      ${c.needs_human
        ? `<span class="tag ${urgent(c) ? 'alert' : 'team'}">${esc(REASON[c.human_reason] || REASON.outro)}</span>
           <button type="button" class="btn soft small" id="robot-on">Devolver ao robô</button>`
        : `<span class="tag">Robô respondendo</span><button type="button" class="btn soft small" id="robot-off">Assumir conversa</button>`}
    </div>
    <div class="at-msgs">${convo.messages.map(m => `
      <div class="msg ${m.direction} ${m.origin}">${esc(m.text)}<small>${m.origin === 'cliente' ? '' : m.origin === 'robo' ? 'Robô · ' : 'Equipe · '}${hhmm(m.created_at)}${m.pending === 1 ? ' · enviando…' : m.pending === -1 ? ' · não enviada' : ''}</small></div>`).join('')
      || '<p class="at-empty">Sem mensagens.</p>'}</div>
    <form class="at-compose" id="compose">
      <textarea class="input" id="reply" rows="1" placeholder="${data.can_send ? 'Escreva para o cliente (o robô pausa nesta conversa)' : 'Envio pelo painel desligado'}" ${data.can_send ? '' : 'disabled'}></textarea>
      <button class="btn" ${data.can_send ? '' : 'disabled'}>Enviar</button>
    </form>`;
  const ta = $('#reply');
  ta.value = draft;
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#compose').requestSubmit(); } });
  if (scroll) { const m = $('.at-msgs'); m.scrollTop = m.scrollHeight; }
  $('#back').addEventListener('click', () => { open = null; convo = null; render(); });
  $('#robot-on')?.addEventListener('click', () => setRobot(true));
  $('#robot-off')?.addEventListener('click', () => setRobot(false));
  $('#compose').addEventListener('submit', async e => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      await api(`/api/r/${slug}/atendimento/enviar`, { method: 'POST', body: { phone: open, text } });
      ta.value = '';
      await loadConvo(true);
      refresh();
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Enviar'; }
  });
}

async function setRobot(on) {
  try {
    await api(`/api/r/${slug}/atendimento/robo`, { method: 'POST', body: { phone: open, on } });
    toast(on ? 'O robô volta a responder esta conversa' : 'Robô pausado: a conversa é sua');
    await loadConvo(false); refresh();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- pedidos ----------
const NEXT = {
  novo: o => [['confirmado', 'Confirmar pedido', 'ok'], ['cancelado', 'Cancelar', 'ghost']],
  confirmado: o => [o.mode === 'entrega' ? ['saiu', 'Saiu para entrega', ''] : ['pronto', 'Pronto para retirar', ''], ['cancelado', 'Cancelar', 'ghost']],
  saiu: () => [['entregue', 'Entregue', 'soft']],
  pronto: () => [['entregue', 'Retirado', 'soft']],
};

let ordersKey = '';
function renderOrders() {
  const list = data.orders;
  const key = JSON.stringify(list);
  if ($('.at-orders, #view > .at-empty') && key === ordersKey) return;
  ordersKey = key;
  $('#view').innerHTML = list.length ? `<div class="at-orders">${list.map(o => `
    <article class="order ${o.status}">
      <div class="top"><span class="num">nº ${o.number}</span><span class="pill">${STATUS[o.status]}</span><time>${hhmm(o.created_at)}</time></div>
      <div><b>${esc(o.customer_name)}</b> · <span class="muted">${esc(formatPhone(o.phone))}</span></div>
      <ul>${o.items.map(i => `<li>${i.qty}x ${esc(i.name)} · ${money(i.unit_price_cents * i.qty)}
        ${i.choices ? `<small>${esc(i.choices)}</small>` : ''}${i.note ? `<small>Obs.: ${esc(i.note)}</small>` : ''}</li>`).join('')}</ul>
      <div class="total">Total dos itens: ${money(o.total_cents)}</div>
      <div class="meta"><b>${o.mode === 'entrega' ? 'Entrega' : 'Retirada no local'}</b>${o.address ? `: ${esc(o.address)}` : ''}<br>
        Pagamento: <b>${PAY[o.payment] || '-'}</b>${o.note ? `<br>Obs.: ${esc(o.note)}` : ''}</div>
      <div class="actions">${(NEXT[o.status]?.(o) || []).map(([s, l, cls]) =>
        `<button type="button" class="btn small ${cls}" data-id="${o.id}" data-status="${s}">${l}</button>`).join('')}
        <button type="button" class="btn small ghost" data-open="${esc(o.phone)}">Ver conversa</button></div>
    </article>`).join('')}</div>`
    : '<p class="at-empty">Nenhum pedido pelo WhatsApp hoje. Quando o robô fechar um pedido com o cliente, ele aparece aqui para a equipe confirmar.</p>';
  $$('[data-status]').forEach(b => b.addEventListener('click', async () => {
    if (b.dataset.status === 'cancelado' && !confirm('Cancelar este pedido? O cliente não recebe aviso automático; avise pela conversa.')) return;
    b.disabled = true;
    try {
      const r = await api(`/api/r/${slug}/atendimento/pedidos/${b.dataset.id}`, { method: 'PATCH', body: { status: b.dataset.status } });
      toast(r.warning || (STATUS_MSG_HINT[b.dataset.status] ?? 'Pedido atualizado'), r.warning ? 'error' : '');
      refresh();
    } catch (e) { toast(e.message, 'error'); b.disabled = false; }
  }));
  $$('[data-open]').forEach(b => b.addEventListener('click', () => { tab = 'conversas'; openConvo(b.dataset.open); }));
}
const STATUS_MSG_HINT = { confirmado: 'Confirmado. O cliente recebeu o aviso no WhatsApp.', saiu: 'O cliente foi avisado que o pedido saiu.', pronto: 'O cliente foi avisado que pode retirar.' };

// ---------- informações para o robô ----------
function renderInfo() {
  $('#view').innerHTML = `
    <form class="at-info" id="info-form">
      <p class="muted">O robô só fala o que está no cardápio e aqui. O que não estiver escrito (horário, entrega, taxa, Pix), ele diz que a equipe confirma.</p>
      <textarea class="input" id="info" placeholder="${esc(INFO_HINT)}">${esc(data.info)}</textarea>
      <div class="row"><button class="btn">Salvar</button><span class="muted" id="info-state"></span></div>
    </form>`;
  $('#info-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api(`/api/r/${slug}/atendimento/info`, { method: 'PUT', body: { info: $('#info').value } });
      data.info = $('#info').value;
      toast('Salvo. O robô já usa na próxima mensagem.');
    } catch (err) { toast(err.message, 'error'); }
  });
}
