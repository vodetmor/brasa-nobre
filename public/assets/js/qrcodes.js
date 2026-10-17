// Folha A4 imprimível com um cartão por mesa: QR Code + aviso de NFC.
import { api, esc, toast, staffGate, staffNav, tableUrl, slugFromPath, $, $$ } from './common.js';

const slug = slugFromPath();
const PER_PAGE = { g: 4, m: 6, p: 12 };
const NFC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <rect x="2.5" y="2.5" width="19" height="19" rx="5"/>
  <path d="M8 8.5a5 5 0 0 1 0 7"/><path d="M11 6.5a8.5 8.5 0 0 1 0 11"/><path d="M14 4.8a11.5 11.5 0 0 1 0 14.4" opacity=".55"/>
</svg>`;

let R, tables = [], base = '';
const urls = new Map();       // token -> URL (calculada uma vez)
const selected = new Set();   // ids das mesas a imprimir

init();

async function init() {
  try { R = await staffGate(slug); }
  catch (e) { document.body.innerHTML = `<div class="login-wrap"><div class="card"><h2>Restaurante não encontrado</h2><p class="muted">${esc(e.message)}</p></div></div>`; return; }

  $('#topbar').innerHTML = `<span class="brand">${esc(R.name)}</span>${staffNav(slug, 'qrcodes')}`;
  try {
    const d = await api(`/api/r/${slug}/admin`);
    R = d.restaurant;
    tables = d.tables;
  } catch (e) { toast(e.message, 'error'); return; }

  // tableUrl() é a fonte oficial do link; a base (PUBLIC_URL ou este endereço) vale para todas as mesas.
  for (const t of tables) urls.set(t.token, await urlFor(t.token));
  base = tables.length ? new URL(urls.get(tables[0].token)).origin : location.origin;

  renderNotices();
  for (const t of tables) if (t.active) selected.add(t.id);
  renderPicker();

  $('#size').addEventListener('change', renderSheets);
  $('#show-url').addEventListener('change', renderSheets);
  $('#show-label').addEventListener('change', renderSheets);
  $('#all').addEventListener('click', () => { tables.filter(t => t.active).forEach(t => selected.add(t.id)); renderPicker(); });
  $('#none').addEventListener('click', () => { selected.clear(); renderPicker(); });
  $('#print').addEventListener('click', () => {
    if (!selected.size) { toast('Escolha pelo menos uma mesa', 'error'); return; }
    window.print();
  });
  $('#app').hidden = false;
}

let cachedBase = null;
async function urlFor(token) {
  // Uma chamada a /api/config para a primeira mesa; as demais reaproveitam a mesma base.
  if (cachedBase === null) {
    const u = await tableUrl(token, 'qr');
    cachedBase = u.slice(0, u.indexOf(`/m/${token}`));
    return u;
  }
  return `${cachedBase}/m/${token}`;
}

function renderNotices() {
  const box = $('#notices');
  const local = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(base);
  const inactive = tables.filter(t => !t.active).length;
  box.innerHTML = `
    ${local ? `<div class="notice"><b>Atenção:</b> os QR Codes estão apontando para <code>${esc(base)}</code>, que só existe neste computador e
      <b>não abre no celular dos clientes</b>. Abra esta página pelo IP do computador na rede (ex.: <code>http://192.168.0.10:${esc(location.port || '80')}/r/${esc(slug)}/qrcodes</code>)
      ou configure <code>PUBLIC_URL</code> com o endereço público do servidor antes de imprimir.</div>` : ''}
    ${!tables.length ? `<div class="notice">Nenhuma mesa cadastrada. <a href="/r/${esc(slug)}/admin#tables">Adicione mesas no painel</a>.</div>` : ''}
    ${inactive ? `<p class="muted" style="margin:.5rem 0 0">${inactive} mesa(s) desativada(s) não aparecem para impressão: o QR delas não abre o cardápio.</p>` : ''}`;
}

function renderPicker() {
  const pick = $('#pick');
  const active = tables.filter(t => t.active);
  pick.innerHTML = active.map(t => `<label><input type="checkbox" value="${t.id}" ${selected.has(t.id) ? 'checked' : ''}>
    Mesa ${t.number}${t.label ? ` · ${esc(t.label)}` : ''}</label>`).join('') || '<span class="muted">Nenhuma mesa ativa.</span>';
  $$('input', pick).forEach(i => i.addEventListener('change', () => {
    const id = Number(i.value);
    if (i.checked) selected.add(id); else selected.delete(id);
    renderSheets();
  }));
  renderSheets();
}

function qrSvg(text) {
  const qr = qrcode(0, 'M'); // eslint-disable-line no-undef -- global do /assets/vendor/qrcode.js
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 16, // zona de silêncio de 4 módulos: leitura confiável
     scalable: true, alt: 'QR Code da mesa' });
}

function card(t) {
  const url = urls.get(t.token);
  const showLabel = $('#show-label').checked && t.label;
  return `<div class="card-qr">
    <div class="cq-head">${R.logo_url ? `<img src="${esc(R.logo_url)}" alt="">` : ''}<span class="cq-name">${esc(R.name)}</span></div>
    <div><div class="cq-mesa">Mesa ${t.number}</div>${showLabel ? `<div class="cq-label">${esc(t.label)}</div>` : ''}</div>
    <div class="cq-qr">${qrSvg(url)}</div>
    ${$('#show-url').checked ? `<div class="cq-url">${esc(url)}</div>` : ''}
    <div class="cq-foot">${NFC_ICON}<span>Aponte a câmera ou aproxime o celular (NFC)</span></div>
  </div>`;
}

function renderSheets() {
  const size = $('#size').value;
  const per = PER_PAGE[size];
  const list = tables.filter(t => t.active && selected.has(t.id));
  const pages = [];
  for (let i = 0; i < list.length; i += per) pages.push(list.slice(i, i + per));
  const sheets = $('#sheets');
  sheets.className = `sheets size-${size}`;
  sheets.innerHTML = pages.map(p => `<div class="page"><div class="page-inner">${p.map(card).join('')}</div></div>`).join('')
    || '<p class="muted no-print">Nenhuma mesa selecionada.</p>';
  // cor do restaurante no cartão (fundo branco para imprimir bem)
  sheets.style.setProperty('--primary', R.primary_color || '#d32f2f');
}
