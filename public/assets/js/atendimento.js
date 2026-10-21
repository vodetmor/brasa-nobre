// Atendimento pelo WhatsApp: /r/<slug>/atendimento
// O robô responde sozinho; a equipe acompanha, assume a conversa quando quiser e confirma os pedidos.
import { api, esc, $, $$, toast, money, hhmm, parseDate, staffGate, staffNav, slugFromPath, embedded } from './common.js';

const slug = slugFromPath();
const REASON = {
  pediu_atendente: 'Pediu uma pessoa', reclamacao: 'Reclamação', alterar_cancelar: 'Alterar ou cancelar',
  fora_do_cardapio: 'Fora do cardápio', duvida: 'Dúvida', equipe_assumiu: 'Equipe respondendo', dono_respondeu: 'Dono respondeu pelo celular',
  limite_mensagens: 'Robô pausado (muitas mensagens)', outro: 'Precisa da equipe',
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
// ?so=robo: só os controles do robô (embutido na área "Robô do WhatsApp" do painel), sem conversas nem avisos
const onlyRobot = new URLSearchParams(location.search).get('so') === 'robo';
let tab = onlyRobot ? 'robo' : 'conversas', open = null, convo = null, seenOrders = null, filter = 'todas';

// ---------- avisos de atendimento humano (como no painel da MedicMais) ----------
// barra vermelha no topo + som "ding-dong" + notificação do navegador + título piscando; "plim" para mensagem nova.
const AL = { base: null, pend: [], unread: null, orig: '', blink: null };
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
const soundOn = () => store('wa_som') === '1';
let actx;
function audio() {
  try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch { actx = null; }
  return actx;
}
function note(freq, t0, dur, vol = 0.22) {
  const c = audio(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}
function dingDong() { const c = audio(); if (!c) return; const t = c.currentTime + 0.03; note(880, t, 1.2); note(659.25, t + 0.52, 1.6); }
function plim() { const c = audio(); if (!c) return; note(1318.5, c.currentTime + 0.02, 0.16, 0.14); }

function soundButton() {
  const b = $('#som');
  if (!b) return;
  b.textContent = soundOn() ? 'Som e avisos: ligados' : 'Ligar som e avisos';
  b.setAttribute('aria-pressed', soundOn());
}
async function toggleSound() {
  const on = !soundOn();
  store('wa_som', on ? '1' : '0');
  soundButton();
  if (on) {
    dingDong();
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
    toast('Avisos ligados: você ouve quando alguém pedir atendimento ou mandar mensagem.');
  } else toast('Som dos avisos desligado.');
}

function checkAlerts() {
  const urgentNow = data.contacts.filter(urgent);
  if (AL.base) {
    const novos = urgentNow.filter(c => !AL.base.has(c.phone));
    if (novos.length) {
      for (const c of novos) if (!AL.pend.some(p => p.phone === c.phone)) AL.pend.push(c);
      if (soundOn()) dingDong();
      notify(novos);
    }
  }
  AL.base = new Set(urgentNow.map(c => c.phone));
  AL.pend = AL.pend.filter(p => AL.base.has(p.phone) && p.phone !== open);
  // mensagem nova de cliente sem pedido de atendimento: só o plim
  const unread = data.contacts.reduce((s, c) => s + (c.phone === open ? 0 : c.unread), 0);
  if (AL.unread !== null && unread > AL.unread && soundOn()) plim();
  AL.unread = unread;
  renderAlertBar();
  if (embedded) parent.postMessage({ type: 'wa-humano', n: urgentNow.length, nomes: urgentNow.map(label) }, location.origin);
}

function notify(list) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || (!document.hidden && document.hasFocus())) return;
  for (const c of list) {
    try {
      const n = new Notification('Pediu atendimento humano', { body: `${label(c)}: ${REASON[c.human_reason] || REASON.outro}`, tag: `wa-${c.phone}` });
      n.onclick = () => { window.focus(); tab = 'conversas'; openConvo(c.phone); n.close(); };
    } catch { /* navegador sem suporte */ }
  }
}

function renderAlertBar() {
  let bar = $('#al-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'al-bar'; bar.className = 'al-bar'; bar.setAttribute('role', 'alert'); document.body.append(bar); }
  bar.hidden = !AL.pend.length;
  bar.innerHTML = AL.pend.slice(-3).map(c => `<div class="al-item"><span class="al-ic" aria-hidden="true">🔔</span>
      <span class="al-t"><b>${esc(label(c))}</b> ${c.human_reason === 'pediu_atendente' ? 'pediu atendimento humano' : `precisa da equipe: ${esc((REASON[c.human_reason] || REASON.outro).toLowerCase())}`}</span>
      <button type="button" class="btn small al-open" data-al-open="${esc(c.phone)}">Abrir conversa</button>
      <button type="button" class="al-x" data-al-x="${esc(c.phone)}" aria-label="Dispensar aviso">✕</button></div>`).join('')
    + (AL.pend.length > 3 ? `<div class="al-more">+ ${AL.pend.length - 3} aguardando</div>` : '');
  bar.querySelectorAll('[data-al-open]').forEach(b => b.addEventListener('click', () => { tab = 'conversas'; openConvo(b.dataset.alOpen); }));
  bar.querySelectorAll('[data-al-x]').forEach(b => b.addEventListener('click', () => { AL.pend = AL.pend.filter(p => p.phone !== b.dataset.alX); renderAlertBar(); }));
  blinkTitle();
}

function blinkTitle() {
  clearInterval(AL.blink); AL.blink = null;
  AL.orig ||= document.title;
  if (!AL.pend.length) { document.title = AL.orig; return; }
  const msg = `(${AL.pend.length}) Pediu atendimento · ${restaurant.name}`;
  let on = true; document.title = msg;
  AL.blink = setInterval(() => { on = !on; document.title = on ? msg : AL.orig; }, 1000);
}

start();

async function start() {
  restaurant = await staffGate(slug);
  $('#app').innerHTML = `
    <header class="topbar"><span class="dot on" id="live-dot" title="Atualizando"></span>
      <span class="brand">${esc(restaurant.name)} · WhatsApp</span><span class="spacer"></span>${staffNav(slug, 'atendimento')}</header>
    <div class="at-tabs" role="tablist">
      <button type="button" role="tab" data-tab="conversas">Conversas<span class="count hidden" id="c-conv"></span></button>
      <button type="button" role="tab" data-tab="pedidos">Pedidos<span class="count hidden" id="c-ped"></span></button>
      <button type="button" role="tab" data-tab="reclamacoes">Reclamações</button>
      <button type="button" role="tab" data-tab="robo">Robô</button>
      <span class="spacer"></span><button type="button" class="btn soft small" id="som" aria-pressed="false">Ligar som e avisos</button>
    </div>
    <div id="banner"></div>
    <section class="robot-bar" id="robot-bar" aria-live="polite"></section>
    <main id="view"></main>`;
  $$('.at-tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  if (onlyRobot) { document.body.classList.add('only-robot'); render(); }
  $('#som').addEventListener('click', toggleSound);
  soundButton();
  // o navegador só toca som depois de um clique na página
  addEventListener('pointerdown', () => soundOn() && audio(), { once: true });
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
  if (seenOrders && fresh.some(id => !seenOrders.has(id))) { if (soundOn()) dingDong(); toast('Pedido novo pelo WhatsApp'); }
  seenOrders = new Set(data.orders.map(o => o.id));
  if (!onlyRobot) checkAlerts();
  render(true);
}

function render(passive = false) {
  $$('.at-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  const need = data.contacts.filter(urgent).length;
  const novos = data.orders.filter(o => o.status === 'novo').length;
  setCount('#c-conv', need); setCount('#c-ped', novos);
  $('#banner').innerHTML = !data.robot ? '<p class="at-banner">O WhatsApp ainda não foi conectado neste restaurante. As conversas aparecem aqui quando conectar.</p>' : '';
  renderRobotBar();
  // não redesenha o que a pessoa está digitando
  if (passive && tab === 'robo') return;
  if (tab === 'conversas') renderChat(passive);
  else if (tab === 'pedidos') renderOrders();
  else if (tab === 'reclamacoes') { if (!passive) renderComplaints(); }
  else renderRobot();
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
    $('#view').innerHTML = `<div class="at-chat"><aside class="at-side"><div class="at-filters">
      <button type="button" data-filter="todas">Todas</button><button type="button" data-filter="humano">Pedem atendimento<span id="f-n"></span></button></div>
      <div class="at-list" aria-label="Conversas"></div></aside><section class="at-convo"></section></div>`;
    $$('.at-filters button').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; renderChat(false); }));
    wrap = $('.at-chat');
    new ResizeObserver(() => document.documentElement.style.setProperty('--top', `${wrap.getBoundingClientRect().top + scrollY}px`)).observe(document.body);
    passive = false;
  }
  wrap.classList.toggle('open', !!open);
  const list = $('.at-list');
  // pede atenção primeiro, depois a mais recente
  $$('.at-filters button').forEach(b => b.setAttribute('aria-pressed', b.dataset.filter === filter));
  const nh = data.contacts.filter(urgent).length;
  $('#f-n').textContent = nh ? ` ${nh}` : '';
  const sorted = data.contacts.filter(c => filter !== 'humano' || c.needs_human).sort((a, b) => (urgent(b) - urgent(a)) || (b.updated_at > a.updated_at ? 1 : -1));
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
    </button>`).join('') : filter === 'humano' ? '<p class="at-empty">Ninguém esperando a equipe agora.</p>'
    : '<p class="at-empty">Nenhuma conversa ainda. Quando um cliente mandar mensagem para o WhatsApp da casa, ela aparece aqui.</p>';
  list.querySelectorAll('[data-phone]').forEach(b => b.addEventListener('click', () => openConvo(b.dataset.phone)));
  if (!passive || !open) renderConvo();
}
const urgent = c => (c.needs_human && !['equipe_assumiu', 'dono_respondeu'].includes(c.human_reason) ? 1 : 0);

async function openConvo(phone) {
  open = phone; convo = null;
  AL.pend = AL.pend.filter(p => p.phone !== phone); renderAlertBar();
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
           <button type="button" class="btn ${urgent(c) ? 'ok' : 'soft'} small" id="robot-on" title="O robô volta a responder este cliente">${urgent(c) ? 'Resolvido' : 'Devolver ao robô'}</button>`
        : `<span class="tag">Robô respondendo</span><button type="button" class="btn soft small" id="robot-off">Assumir conversa</button>`}
      <button type="button" class="btn ghost small" id="mark-complaint" title="Conta nos avisos de reclamação">Marcar reclamação</button>
    </div>
    <div class="at-msgs">${convo.messages.map(m => `
      <div class="msg ${m.direction} ${m.origin}">${mediaView(m)}${esc(m.text)}<small>${m.origin === 'cliente' ? '' : m.origin === 'robo' ? 'Robô · ' : 'Equipe · '}${hhmm(m.created_at)}${m.pending === 1 ? ' · enviando…' : m.pending === -1 ? ' · não enviada' : ''}</small></div>`).join('')
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
  $('#mark-complaint').addEventListener('click', markComplaint);
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

// foto, figurinha e vídeo aparecem na conversa; documento e áudio viram um link
function mediaView(m) {
  if (!m.has_file) return '';
  const url = `/api/r/${slug}/atendimento/midia/${m.id}`;
  if (m.media === 'imagem') return `<a href="${url}" target="_blank" rel="noopener"><img class="msg-img" src="${url}" alt="Foto enviada pelo cliente" loading="lazy"></a>`;
  if (m.media === 'video') return `<video class="msg-img" src="${url}" controls preload="metadata"></video>`;
  if (m.media === 'audio') return `<audio src="${url}" controls preload="none"></audio>`;
  return `<a class="msg-file" href="${url}" target="_blank" rel="noopener">📎 ${esc(m.media_name || 'Abrir arquivo')}</a>`;
}

// ---------- reclamações: só aviso para o dono saber o que melhorar ----------
let complaintTopics = [];
async function renderComplaints() {
  $('#view').innerHTML = '<p class="at-empty">Carregando…</p>';
  let d;
  try { d = await api(`/api/r/${slug}/atendimento/reclamacoes`); } catch (e) { $('#view').innerHTML = `<p class="at-empty">${esc(e.message)}</p>`; return; }
  complaintTopics = d.topics;
  const max = Math.max(1, ...d.groups.map(g => g.count));
  $('#view').innerHTML = `<div class="at-complaints">
    <p class="muted">Últimos 30 dias. O robô conta uma reclamação quando passa a conversa para a equipe por esse motivo; você também pode marcar pela conversa.</p>
    ${d.groups.length ? d.groups.map((g, i) => `
      <article class="cp ${i === 0 ? 'top' : ''}">
        <div class="cp-head"><b>${esc(g.topic)}</b><span class="cp-n">${g.count} ${g.count === 1 ? 'reclamação' : 'reclamações'}</span></div>
        <div class="cp-bar"><i style="width:${Math.round(g.count / max * 100)}%"></i></div>
        ${g.examples.map(x => `<button type="button" class="cp-ex" data-open="${esc(x.phone)}"><span>“${esc(x.detail || '(sem texto)')}”</span>
          <small>${esc(x.name || formatPhone(x.phone))} · ${when(x.created_at)}</small></button>`).join('')}
      </article>`).join('') : '<p class="at-empty">Nenhuma reclamação nos últimos 30 dias. 👍</p>'}
  </div>`;
  $$('.cp-ex').forEach(b => b.addEventListener('click', () => { tab = 'conversas'; openConvo(b.dataset.open); }));
}

async function markComplaint() {
  if (!complaintTopics.length) complaintTopics = (await api(`/api/r/${slug}/atendimento/reclamacoes`).catch(() => ({ topics: [] }))).topics;
  const list = complaintTopics.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const n = Number(prompt(`Qual o assunto da reclamação?\n${list}`, ''));
  if (!n || !complaintTopics[n - 1]) return;
  try { await api(`/api/r/${slug}/atendimento/reclamacoes`, { method: 'POST', body: { phone: open, topic: complaintTopics[n - 1] } }); toast('Reclamação registrada nos avisos.'); }
  catch (e) { toast(e.message, 'error'); }
}

async function setRobot(on) {
  try {
    await api(`/api/r/${slug}/atendimento/robo`, { method: 'POST', body: { phone: open, on } });
    toast(on ? 'Resolvido. O robô volta a responder este cliente.' : 'Robô pausado: a conversa é sua.');
    await loadConvo(false); refresh();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- pedidos ----------
const NEXT = {
  novo: o => [['confirmado', 'Confirmar pedido', 'ok'], ['cancelado', 'Cancelar', 'ghost']],
  confirmado: o => [o.mode === 'entrega' ? ['saiu', 'Saiu para entrega', ''] : ['pronto', o.mode === 'local' ? 'Pronto' : 'Pronto para retirar', ''], ['cancelado', 'Cancelar', 'ghost']],
  saiu: () => [['entregue', 'Entregue', 'soft']],
  pronto: o => [['entregue', o.mode === 'local' ? 'Servido' : 'Retirado', 'soft']],
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
      <div class="meta"><b>${{ entrega: 'Entrega', retirada: 'Retirada no balcão', local: 'Comer no local' }[o.mode] || o.mode}</b>${o.address ? `: ${esc(o.address)}` : ''}<br>
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
// ---------- robô: ligar/pausar ----------
function renderRobotBar() {
  const bar = $('#robot-bar');
  if (!bar || !data.robot) { if (bar) bar.innerHTML = ''; return; }
  const on = data.robot_on;
  const key = String(on);
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;
  bar.className = `robot-bar ${on ? 'on' : 'off'}`;
  bar.innerHTML = `
    <span class="rb-dot" aria-hidden="true"></span>
    <div class="rb-text"><b>${on ? 'Robô ligado' : 'Robô pausado'}</b>
      <span>${on ? 'Responde sozinho os clientes no WhatsApp. Quando alguém pede uma pessoa, ele avisa aqui.' : 'Ninguém recebe resposta automática. A equipe responde por aqui ou pelo celular.'}</span></div>
    <button type="button" class="btn ${on ? 'soft' : 'ok'}" id="rb-toggle" role="switch" aria-checked="${on}">${on ? 'Pausar robô' : 'Ligar robô'}</button>`;
  $('#rb-toggle').addEventListener('click', toggleRobot);
}

async function toggleRobot() {
  const on = !data.robot_on;
  if (!on && !confirm('Pausar o robô? Os clientes deixam de receber resposta automática até você ligar de novo.')) return;
  const b = $('#rb-toggle'); b.disabled = true;
  try {
    await api(`/api/r/${slug}/atendimento/robo-ligar`, { method: 'POST', body: { on } });
    data.robot_on = on;
    renderRobotBar();
    toast(on ? 'Robô ligado: ele volta a responder os clientes.' : 'Robô pausado.');
  } catch (e) { toast(e.message, 'error'); b.disabled = false; }
}

// ---------- aba Robô: como funciona + personalidade + informações da casa ----------
const FUNNEL = [
  ['Cliente manda mensagem', 'Texto, áudio (vira texto) ou foto (vira descrição). Grupos e status ficam de fora.'],
  ['Espera o cliente terminar', '9 segundos para juntar mensagens seguidas numa resposta só. Mensagem repetida é ignorada.'],
  ['Pode responder?', 'Só se o robô estiver ligado, a equipe não tiver assumido a conversa e ele não tiver passado de 8 respostas em 3 minutos.'],
  ['IA monta a resposta', 'Usa a personalidade e o roteiro abaixo, as regras fixas, o cardápio, as informações da casa e as últimas 14 mensagens.'],
  ['Conduz o pedido', 'Pedido, entrega/retirada/local, endereço, pagamento e nome. Mostra o resumo e espera o "sim".'],
  ['Registra o pedido', 'O sistema calcula o preço pelo cardápio (a IA não inventa valor). Aparece na aba Pedidos.'],
  ['Equipe confirma', 'O cliente recebe o aviso no WhatsApp e o pedido vai para a Cozinha, que toca e imprime.'],
];
const BOT_FORM = [
  ['nome', 'Nome da atendente', 'input', 'Vazio = "atendimento da casa". Ex.: Maria'],
  ['persona', 'Quem ela é', 'textarea', 'Use {restaurante} para o nome da casa.'],
  ['jeito', 'Jeito de falar', 'textarea', 'Uma regra por linha.'],
  ['roteiro', 'Roteiro do pedido', 'textarea', 'A ordem das perguntas. Uma etapa por linha.'],
  ['extras', 'Regras extras da casa', 'textarea', 'Ex.: Não fazemos troca de acompanhamento no prato da casa.'],
];
let robot = null;

async function renderRobot() {
  $('#view').innerHTML = '<p class="at-empty">Carregando…</p>';
  try { robot = await api(`/api/r/${slug}/atendimento/robo-config`); }
  catch (e) { $('#view').innerHTML = `<p class="at-empty">${esc(e.message)}</p>`; return; }
  const b = robot.bot;
  $('#view').innerHTML = `
    <div class="at-robot">
      <section class="card-sec">
        <h2>Como o robô funciona</h2>
        <ol class="funnel">${FUNNEL.map(([t, d], i) => `<li><span class="fn-n">${i + 1}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></li>`).join('')}</ol>
        <p class="fn-side"><b>Passa para a equipe</b> quando o cliente pede uma pessoa, reclama, quer alterar ou cancelar, pede algo fora do cardápio ou o robô não sabe responder. A conversa fica vermelha na aba Conversas e o painel toca.</p>
        <details class="fn-prompt"><summary>Ver exatamente o que a IA recebe</summary><pre>${esc(robot.prompt)}</pre></details>
      </section>
      <form class="card-sec" id="bot-form">
        <h2>Personalidade e roteiro</h2>
        <p class="muted">O que você mudar aqui vale a partir da próxima mensagem. As regras fixas (não inventar preço, passar para a equipe) continuam valendo.</p>
        ${BOT_FORM.map(([k, l, type, hint]) => `<label class="field"><span>${l}</span>
          ${type === 'input' ? `<input class="input" name="${k}" maxlength="40" value="${esc(b[k])}">` : `<textarea class="input" name="${k}" rows="${k === 'roteiro' ? 8 : 4}">${esc(b[k])}</textarea>`}
          <small class="muted">${esc(hint)}</small></label>`).join('')}
        <div class="row wrap"><button class="btn">Salvar</button><button type="button" class="btn ghost" id="bot-reset">Voltar ao padrão</button></div>
      </form>
      <form class="card-sec" id="info-form">
        <h2>Informações da casa</h2>
        <p class="muted">O robô só fala o que está no cardápio e aqui. O que não estiver escrito (horário, entrega, taxa, Pix), ele diz que a equipe confirma.</p>
        <textarea class="input" id="info" rows="7" placeholder="${esc(INFO_HINT)}">${esc(robot.info)}</textarea>
        <div class="row"><button class="btn">Salvar</button></div>
      </form>
    </div>`;
  $('#bot-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try { await api(`/api/r/${slug}/atendimento/robo-config`, { method: 'PUT', body }); toast('Salvo. O robô já usa na próxima mensagem.'); renderRobot(); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#bot-reset').addEventListener('click', () => {
    if (!confirm('Voltar a personalidade e o roteiro ao padrão?')) return;
    for (const [k] of BOT_FORM) e2(k).value = robot.defaults[k];
    toast('Padrão carregado. Clique em Salvar para aplicar.');
  });
  const e2 = k => $(`#bot-form [name=${k}]`);
  $('#info-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api(`/api/r/${slug}/atendimento/info`, { method: 'PUT', body: { info: $('#info').value } });
      data.info = $('#info').value;
      toast('Salvo. O robô já usa na próxima mensagem.');
    } catch (err) { toast(err.message, 'error'); }
  });
}
