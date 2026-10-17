// Utilidades compartilhadas por todas as telas (módulo ES).

export async function api(path, { method = 'GET', body, raw } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (raw) { opts.body = raw; opts.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Erro ${res.status}`); e.status = res.status; throw e; }
  return data;
}

export const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// O banco grava em UTC ("2026-10-16 07:08:31"): converte para Date local.
export const parseDate = s => new Date(String(s).replace(' ', 'T') + 'Z');
export const hhmm = s => parseDate(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const minutesAgo = s => Math.max(0, Math.round((Date.now() - parseDate(s)) / 60000));

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, type = '') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = h(`<div class="toast ${type}" role="status">${esc(msg)}</div>`);
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

export function applyTheme(r) {
  const s = document.documentElement.style;
  if (r.primary_color) s.setProperty('--primary', r.primary_color);
  if (r.accent_color) s.setProperty('--accent', r.accent_color);
  if (r.bg_color) s.setProperty('--bg', r.bg_color);
  if (r.text_color) s.setProperty('--text', r.text_color);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = r.bg_color || '#111';
}

// Abre uma folha (modal). Retorna { el, close }.
export function sheet(innerHtml, { onClose } = {}) {
  const back = h(`<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true">${innerHtml}</div></div>`);
  const close = () => { back.remove(); onClose?.(); };
  back.addEventListener('click', e => { if (e.target === back) close(); });
  back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  document.body.append(back);
  return { el: back.querySelector('.sheet'), close };
}

// Conexão em tempo real (SSE) com reconexão automática. handlers: { order: fn, call: fn, ... }
// Tempo real: SSE no servidor comum; na Vercel (sem conexão longa) busca eventos novos a cada 2 s.
let cfg;
export function live(url, handlers, onStatus = () => {}) {
  let es, timer, stopped = false;
  const sse = () => {
    es = new EventSource(url);
    es.onopen = () => onStatus(true);
    es.onerror = () => onStatus(false);
    for (const [ev, fn] of Object.entries(handlers)) es.addEventListener(ev, e => fn(JSON.parse(e.data)));
  };
  const poll = async () => {
    const evUrl = url.replace(/\/stream$/, '/events');
    let after = '';
    const tick = async () => {
      if (stopped) return;
      try {
        const r = await fetch(`${evUrl}?after=${after}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        const d = await r.json();
        onStatus(true);
        if (after !== '') for (const e of d.events) handlers[e.type]?.(e.data);
        after = d.last;
      } catch { onStatus(false); }
      timer = setTimeout(tick, document.hidden ? 6000 : 2000);
    };
    tick();
  };
  (cfg ||= fetch('/api/config').then(r => r.json()).catch(() => ({})))
    .then(c => (c.realtime === 'poll' ? poll() : sse()));
  return () => { stopped = true; es?.close(); clearTimeout(timer); };
}

// Som de alerta sem arquivo de áudio (Web Audio). Navegadores exigem um clique antes do primeiro som.
let audioCtx;
export function unlockSound() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx.state === 'running';
}
export function beep({ times = 3, freq = 880 } = {}) {
  if (!audioCtx) return;
  for (let i = 0; i < times; i++) {
    const t = audioCtx.currentTime + i * 0.28;
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = i % 2 ? freq * 1.25 : freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.24);
  }
  navigator.vibrate?.([200, 100, 200]);
}

// Mantém a tela do tablet acesa (cozinha/caixa).
export async function keepAwake() {
  try {
    let lock = await navigator.wakeLock?.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') lock = await navigator.wakeLock?.request('screen');
    });
  } catch { /* sem suporte: tudo bem */ }
}

export const slugFromPath = () => location.pathname.split('/')[2];

// Portão de login das telas da equipe. Resolve com o restaurante quando logado.
export async function staffGate(slug) {
  const { restaurant, logged } = await api(`/api/r/${slug}/public`);
  applyTheme(restaurant);
  document.title = `${document.title} · ${restaurant.name}`;
  if (logged) return restaurant;
  return new Promise(resolve => {
    const wrap = h(`<div class="login-wrap"><form class="login-box card grid">
      <h2>${esc(restaurant.name)}</h2><p class="muted">Digite o PIN da equipe</p>
      <input class="input" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" required autofocus>
      <button class="btn block">Entrar</button></form></div>`);
    document.body.prepend(wrap);
    const form = wrap.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await api(`/api/r/${slug}/login`, { method: 'POST', body: { pin: form.querySelector('input').value } });
        wrap.remove();
        resolve(restaurant);
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

const NAV_ICON = {
  painel: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  cozinha: '<svg viewBox="0 0 24 24"><path d="M6 13.5a6 6 0 1 1 12 0V18H6z"/><path d="M4 21h16M12 4V2.5"/></svg>',
  caixa: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/></svg>',
  admin: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  qrcodes: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-7"/></svg>',
};
export function staffNav(slug, active) {
  const links = [['painel', 'Painel'], ['cozinha', 'Cozinha'], ['caixa', 'Caixa'], ['admin', 'Cardápio e mesas'], ['qrcodes', 'QR Codes']];
  return `<nav aria-label="Telas do restaurante">${links.map(([p, l]) =>
    `<a href="/r/${slug}/${p}" class="${p === active ? 'active' : ''}"${p === active ? ' aria-current="page"' : ''}>${NAV_ICON[p]}${l}</a>`).join('')}</nav>`;
}

// URL pública da mesa (usada no QR Code e na tag NFC).
export async function tableUrl(token, source = 'qr') {
  const { public_url } = await api('/api/config').catch(() => ({}));
  const base = public_url || location.origin;
  return `${base}/m/${token}${source === 'nfc' ? '?src=nfc' : ''}`;
}
