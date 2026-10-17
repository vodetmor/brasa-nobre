// Área da agência: lista os restaurantes e cria novos clientes.
// A chave fica só nesta aba (sessionStorage) e vai no cabeçalho x-platform-key.
import { esc, toast, $ } from './common.js';

const KEY = 'cs_platform_key';
const getKey = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
const setKey = v => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* sem storage */ } };
let memKey = getKey();

async function papi(path, { method = 'GET', body } = {}) {
  const headers = { 'x-platform-key': memKey };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Erro ${res.status}`); e.status = res.status; throw e; }
  return data;
}

export const slugify = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 41).replace(/-+$/, '');

const LINKS = [['admin', 'Admin'], ['cozinha', 'Cozinha'], ['caixa', 'Caixa'], ['qrcodes', 'QR Codes']];

// ---------- login ----------
$('#key-form').addEventListener('submit', async e => {
  e.preventDefault();
  memKey = e.currentTarget.key.value.trim();
  const btn = $('button', e.currentTarget);
  btn.disabled = true;
  try { await enter(); }
  catch (err) { toast(err.status === 401 ? 'Chave inválida' : err.message, 'error'); memKey = ''; }
  finally { btn.disabled = false; }
});

$('#exit').addEventListener('click', () => { setKey(''); memKey = ''; location.reload(); });

async function enter() {
  const list = await papi('/api/platform/restaurants');
  setKey(memKey);
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#exit').classList.remove('hidden');
  renderList(list);
}

if (memKey) enter().catch(() => { setKey(''); memKey = ''; });

// ---------- lista ----------
async function reload() {
  try { renderList(await papi('/api/platform/restaurants')); }
  catch (e) { toast(e.message, 'error'); }
}

function renderList(list) {
  $('#list').innerHTML = list.map(r => {
    const color = /^#[0-9a-f]{3,8}$/i.test(r.primary_color || '') ? r.primary_color : '';
    return `<article class="card rest" ${color ? `style="--c:${color}"` : ''}>
      <div class="rest-head">
        ${r.logo_url ? `<img class="rest-logo" src="${esc(r.logo_url)}" alt="">` : `<span class="rest-logo">${esc((r.name || '?').trim().charAt(0).toUpperCase())}</span>`}
        <div class="t"><b>${esc(r.name)}</b><span class="muted">/${esc(r.slug)}${r.tagline ? ` · ${esc(r.tagline)}` : ''}</span></div>
      </div>
      <div class="muted stat">${r.tables} mesa${r.tables === 1 ? '' : 's'} · ${r.products} produto${r.products === 1 ? '' : 's'}</div>
      <div class="links">${LINKS.map(([p, l]) => `<a class="btn soft small" href="/r/${encodeURIComponent(r.slug)}/${p}" target="_blank" rel="noopener">${l}</a>`).join('')}</div>
    </article>`;
  }).join('') || '<p class="muted">Nenhum restaurante cadastrado ainda. Crie o primeiro abaixo.</p>';
}

// ---------- novo restaurante ----------
const form = $('#create');
const F = n => form.elements.namedItem(n);
let slugTouched = false;

const updateSlugPreview = () => {
  const s = F('slug').value;
  $('#slug-preview').textContent = s ? `Painel: ${location.origin}/r/${s}/admin` : '';
};
F('name').addEventListener('input', () => {
  if (!slugTouched) F('slug').value = slugify(F('name').value);
  updateSlugPreview();
});
F('slug').addEventListener('input', () => {
  slugTouched = F('slug').value !== '';
  const clean = F('slug').value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (clean !== F('slug').value) F('slug').value = clean;
  updateSlugPreview();
});
$('#go-new').addEventListener('click', () => { $('#new').scrollIntoView({ behavior: 'smooth' }); F('name').focus({ preventScroll: true }); });

form.addEventListener('submit', async e => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form).entries());
  body.slug = body.slug.replace(/^-+|-+$/g, '');
  body.tables = Math.max(0, Math.min(200, Number(body.tables) || 0));
  for (const k of ['tagline', 'whatsapp']) if (!body[k]) delete body[k];
  const btn = $('#create-btn');
  btn.disabled = true;
  try {
    const r = await papi('/api/platform/restaurants', { method: 'POST', body });
    const slug = encodeURIComponent(r.slug);
    $('#created').innerHTML = `<div class="card done grid" style="gap:.6rem">
      <b>${esc(r.name)} criado com ${body.tables} mesa${body.tables === 1 ? '' : 's'}.</b>
      <span class="muted">Entre no painel com o PIN da equipe para cadastrar o cardápio e imprimir os QR Codes.</span>
      <div class="links">${LINKS.map(([p, l]) => `<a class="btn small ${p === 'admin' ? '' : 'soft'}" href="/r/${slug}/${p}" target="_blank" rel="noopener">${l}</a>`).join('')}</div>
    </div>`;
    toast('Restaurante criado');
    form.reset(); slugTouched = false; updateSlugPreview();
    reload();
  } catch (err) {
    if (err.status === 401) { toast('Chave da plataforma inválida. Entre de novo.', 'error'); setKey(''); setTimeout(() => location.reload(), 1200); }
    else toast(err.message, 'error');
  } finally { btn.disabled = false; }
});
