// Cardápio do cliente: /m/<token-da-mesa>  (QR Code; NFC usa ?src=nfc)
// Fluxo: vê o prato → "Adicionar" → "Ver pedido" → nome → "Enviar para a cozinha". Pronto.
import { api, money, hhmm, esc, $, $$, live } from './common.js';

const token = location.pathname.split('/')[2];
const source = new URLSearchParams(location.search).get('src') === 'nfc' ? 'nfc' : 'qr';
const K = { cart: `cart:${token}`, name: 'customer_name', mine: `my_orders:${token}` };
const STATUS = { received: 'Recebido', preparing: 'Preparando', ready: 'Pronto', delivered: 'Entregue', canceled: 'Cancelado' };
const STEPS = ['received', 'preparing', 'ready'];

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado */ } },
};

let data;
let cart = store.get(K.cart, []);      // [{ product_id, qty, note, removed: [] }]
let mine = store.get(K.mine, {});      // { [orderId]: order }
let overlay = null;                    // tela sobreposta aberta
const byId = id => data.products.find(p => p.id === id);
const qtyOf = id => cart.filter(l => l.product_id === id).reduce((s, l) => s + l.qty, 0);
const cartCount = () => cart.reduce((s, l) => s + l.qty, 0);
const premium = () => (data.restaurant.theme || 'premium') === 'premium';
const sameLine = (l, note, removed) => l.note === note && [...(l.removed || [])].sort().join() === [...removed].sort().join();
const ingredientsOf = p => String(p.ingredients || '').split(',').map(x => x.trim()).filter(Boolean);
const extras = l => [l.removed?.length ? `Sem ${l.removed.join(', ')}` : '', l.note].filter(Boolean).join(' · ');
const cartTotal = () => cart.reduce((s, l) => s + byId(l.product_id).price_cents * l.qty, 0);

init();

async function init() {
  try { data = await api(`/api/m/${token}`); }
  catch (e) { $('#app').innerHTML = `<div class="m-loading">${esc(e.message)}</div>`; return; }
  const r = data.restaurant;
  const app = $('#app');
  app.dataset.theme = r.theme || 'premium';
  if (r.accent_color) app.style.setProperty('--accent', r.accent_color);
  app.style.setProperty('--primary', r.primary_color || '#a8231b');
  document.body.style.background = premium() ? '#121110' : getComputedStyle(app).getPropertyValue('--paper');
  document.title = `${r.name} · Mesa ${data.table.number}`;
  cart = cart.filter(l => byId(l.product_id));
  render();
  setupBackButton();
  live(`/api/m/${token}/stream`, {
    order: o => {
      if (!mine[o.id]) return;
      const was = mine[o.id].status;
      mine[o.id] = o; store.set(K.mine, mine);
      if (was !== o.status && o.status === 'ready') toast(`Seu pedido nº ${o.number} está pronto`);
      if (overlay?.kind === 'sent' && overlay.id === o.id) showSent(o);
    },
    session: s => { if (s.status === 'closed') { mine = {}; store.set(K.mine, mine); } },
  });
}

// ---------- página principal ----------
function menuGroups() {
  const groups = data.categories
    .map(c => ({ c, items: data.products.filter(p => p.category_id === c.id) }))
    .filter(g => g.items.length);
  const loose = data.products.filter(p => !data.categories.some(c => c.id === p.category_id));
  if (loose.length) groups.push({ c: { id: 0, name: 'Outros' }, items: loose });
  return groups;
}

function render() {
  if (premium()) return renderPremium();
  const r = data.restaurant;
  const groups = menuGroups();

  $('#app').innerHTML = `
    <header class="m-top">
      <span class="m-table">Mesa ${data.table.number}${data.table.label ? ` · ${esc(data.table.label)}` : ''}</span>
      <span class="m-links">${hasContact(r) ? '<button data-go="contato">Contato</button>' : ''}<button data-go="conta">Minha conta</button><button data-go="garcom">Chamar garçom</button></span>
    </header>
    <section class="m-mast">
      ${r.logo_url ? `<img class="m-logo" src="${esc(r.logo_url)}" alt="">` : ''}
      <div class="m-kicker">Cardápio</div>
      <h1>${esc(r.name)}</h1>
      ${r.tagline ? `<p>${esc(r.tagline)}</p>` : ''}
    </section>
    ${r.cover_url ? `<div class="m-cover"><img src="${esc(r.cover_url)}" alt=""></div>` : ''}
    ${r.accepting_orders ? '' : '<div class="m-closed">No momento os pedidos pelo cardápio estão pausados. Chame o atendente.</div>'}
    <nav class="m-nav"><div class="m-nav-inner">${groups.map((g, i) =>
      `<button data-cat="${g.c.id}" class="${i ? '' : 'on'}">${esc(g.c.name)}</button>`).join('')}</div></nav>
    ${groups.map((g, gi) => `
      <section class="m-section" id="cat-${g.c.id}">
        <div class="m-section-head"><span class="n">${String(gi + 1).padStart(2, '0')}</span><h2>${esc(g.c.name)}</h2></div>
        ${g.items.map((p, i) => item(p, i % 2 === 1)).join('')}
      </section>`).join('')}
    <footer class="m-foot">
      <div class="m-sig">Bom apetite.</div>
      ${r.address ? `${esc(r.address)}<br>` : ''}O pagamento é feito no caixa, ao final.
    </footer>
    <div class="m-bar"><button id="open-cart"></button></div>`;

  $$('.m-nav button').forEach(b => b.addEventListener('click', () => $(`#cat-${b.dataset.cat}`).scrollIntoView({ behavior: 'smooth' })));
  $('[data-go="conta"]').addEventListener('click', showAccount);
  $('[data-go="contato"]')?.addEventListener('click', showContact);
  $('[data-go="garcom"]').addEventListener('click', () => callStaff('garcom'));
  $('#open-cart').addEventListener('click', showCart);
  $('#app').addEventListener('click', onListClick);
  spyNav();
  renderBar();
}


// ---------- contato (botão da barra de baixo) ----------
// Página tipo "linktree" do restaurante: WhatsApp, redes, iFood, site, como chegar e salvar na agenda.
// Link sem https ganha o https; "@usuario" (sem barra) vira o link da rede.
const urlOf = v => {
  v = String(v || '').trim();
  if (/^https?:\/\//i.test(v)) return v;
  return /^[\w-]+(\.[\w-]+)+(\/|$)/.test(v) ? `https://${v}` : '';
};
const social = (v, base) => (v = String(v || '').trim()).includes('/') ? urlOf(v) : `${base}${v.replace(/^@/, '')}`;
function contactLinks(r) {
  const digits = String(r.whatsapp || '').replace(/\D/g, '');
  const phone = digits ? (digits.length <= 11 ? `55${digits}` : digits) : '';
  const local = digits.slice(-11);
  const fone = local.length >= 10 ? `(${local.slice(0, 2)}) ${local.slice(2, -4)}-${local.slice(-4)}` : digits;
  const at = v => String(v || '').includes('/') ? '' : `@${String(v).trim().replace(/^@/, '')}`;
  const host = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
  // [rede, rótulo, link, linha de baixo]
  return {
    phone,
    links: [
      phone && ['whatsapp', 'WhatsApp', `https://wa.me/${phone}`, fone],
      r.instagram && ['instagram', 'Instagram', social(r.instagram, 'https://instagram.com/'), at(r.instagram)],
      r.tiktok && ['tiktok', 'TikTok', social(r.tiktok, 'https://www.tiktok.com/@'), at(r.tiktok)],
      r.facebook && ['facebook', 'Facebook', social(r.facebook, 'https://facebook.com/'), at(r.facebook)],
      r.ifood && ['ifood', 'Peça no iFood', urlOf(r.ifood), 'Delivery em casa'],
      r.website && ['site', 'Site', urlOf(r.website), host(urlOf(r.website))],
      r.address && ['maps', 'Como chegar', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name}, ${r.address}`)}`, r.address],
    ].filter(l => l && l[2]),
  };
}
const hasContact = r => contactLinks(r).links.length > 0;
const NET = {
  whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8z"/><path d="M9 9.5c.3 2 2.3 4.2 4.6 4.7l1.1-1.1 2 .9-.4 1.4c-3.6.6-8-3.6-7.6-7.5l1.5-.4.9 2z" stroke-width="1.4"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".6" fill="currentColor"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.4 2.6 2.2 4.4 5 4.6"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14.5 21v-8h3l.5-3.5h-3.5V7.6c0-1 .4-1.6 1.7-1.6H18V3.1A20 20 0 0 0 15.6 3C13 3 11 4.5 11 7.3v2.2H8V13h3v8"/></svg>',
  ifood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  site: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/></svg>',
  maps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.7-3.6 3.3-5.5 6.5-5.5s5.8 1.9 6.5 5.5M19 8v6M16 11h6"/></svg>',
};
function showContact() {
  const r = data.restaurant;
  const { phone, links } = contactLinks(r);
  const vcard = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${r.name}`, `ORG:${r.name}`,
    phone ? `TEL;TYPE=CELL:+${phone}` : '', r.address ? `ADR;TYPE=WORK:;;${r.address};;;;` : '',
    ...links.filter(([k]) => ['instagram', 'site'].includes(k)).map(l => `URL:${l[2]}`),
    'END:VCARD'].filter(Boolean).join('\r\n');
  const all = [...links.map(([k, l, u, sub]) => ({ k, l, sub, attrs: `href="${esc(u)}" target="_blank" rel="noopener"` })),
    { k: 'save', l: 'Salvar contato', sub: 'Guarda o restaurante na sua agenda',
      attrs: `href="data:text/vcard;charset=utf-8,${encodeURIComponent(vcard)}" download="${esc(r.name)}.vcf"` }];
  const row = ({ k, l, sub, attrs }, i) => `<a class="lk${i ? '' : ' main'}" ${attrs}>
      <span class="lk-ic">${NET[k]}</span><span class="lk-t"><b>${l}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="lk-go" aria-hidden="true">→</span></a>`;
  if (premium()) {
    // mesma capa do cardápio: foto escurecida, nome em dourado, folha clara com cards escuros
    const [first, ...rest] = r.name.split(' ');
    openOverlay('contact', `
      <div class="lk-page is-premium">
        <header class="p-hero lk-hero">
          ${r.cover_url ? `<img src="${esc(r.cover_url)}" alt="" onerror="this.remove()">` : ''}<div class="p-shade"></div>
          <div class="p-hero-top"><button class="p-chip lk-back" data-back>← Voltar</button></div>
          <div class="p-hero-text">
            <div class="p-kicker">Contato</div>
            <h1>${esc(first)}${rest.length ? `<em>${esc(rest.join(' '))}</em>` : ''}</h1>
            ${r.tagline ? `<p>${esc(r.tagline)}</p>` : ''}
          </div>
        </header>
        <main class="p-sheet lk-sheet"><div class="lk-list">${all.map(row).join('')}</div>
          <footer class="m-foot">Toque para abrir. Até a próxima!</footer></main>
      </div>`);
  } else {
    openOverlay('contact', `
      ${topbar('Contato')}
      <div class="lk-page is-claro">
        <section class="m-mast"><div class="m-kicker">Fale com a gente</div><h1>${esc(r.name)}</h1>${r.tagline ? `<p>${esc(r.tagline)}</p>` : ''}</section>
        ${r.cover_url ? `<div class="m-cover"><img src="${esc(r.cover_url)}" alt=""></div>` : ''}
        <div class="lk-list">${all.map(row).join('')}</div>
        <footer class="m-foot"><div class="m-sig">Até a próxima.</div></footer>
      </div>`);
  }
}

const ICON = {
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  contact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4.5 4.5 0 0 1 0-6.4l2.6-2.6a4.5 4.5 0 0 1 6.4 6.4L17.5 13"/><path d="M14 10a4.5 4.5 0 0 1 0 6.4l-2.6 2.6a4.5 4.5 0 0 1-6.4-6.4L6.5 11"/></svg>',
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5V4.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L3.6 14.6a1.6 1.6 0 0 1 2.4-2.1L8 14.5"/></svg>',
};

// Tema "premium": foto do restaurante no topo, folha clara, cards escuros que rolam de lado.
function renderPremium() {
  const r = data.restaurant;
  const groups = menuGroups();
  const [first, ...rest] = r.name.split(' ');
  $('#app').innerHTML = `
    <header class="p-hero">
      ${r.cover_url ? `<img src="${esc(r.cover_url)}" alt="" onerror="this.remove()">` : ''}<div class="p-shade"></div>
      <div class="p-hero-top">
        <span class="p-chip">Mesa ${data.table.number}${data.table.label ? ` · ${esc(data.table.label)}` : ''}</span>
        <button class="p-round" data-go="garcom" aria-label="Chamar garçom">${ICON.bell}</button>
      </div>
      <div class="p-hero-text">
        <div class="p-kicker">Cardápio da casa</div>
        <h1>${esc(first)}${rest.length ? `<em>${esc(rest.join(' '))}</em>` : ''}</h1>
        ${r.tagline ? `<p>${esc(r.tagline)}</p>` : ''}
      </div>
    </header>
    <main class="p-sheet">
      <div class="p-search"><label><input id="q" type="search" placeholder="Buscar no cardápio" autocomplete="off">${ICON.search}</label></div>
      ${r.accepting_orders ? '' : '<div class="m-closed">No momento os pedidos pelo cardápio estão pausados. Chame o atendente.</div>'}
      <div class="p-menuhead"><h2>Cardápio</h2></div>
      <div class="p-chips">${[['all', 'Todos'], ['popular', 'Mais pedidos'], ['cheap', 'Econômicos'], ...(data.products.some(p => p.model_glb_url) ? [['3d', 'Em 3D']] : [])]
        .map(([k, l], i) => `<button data-chip="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div>
      <nav class="p-tabs">${groups.map((g, i) => `<button data-cat="${g.c.id}" class="${i ? '' : 'on'}">${esc(g.c.name)}</button>`).join('')}</nav>
      <div id="sections">${groups.map(g => `
        <section class="p-section" id="cat-${g.c.id}">
          <h3>${esc(g.c.name)}</h3>
          <div class="p-row">${g.items.map(card).join('')}</div>
        </section>`).join('')}</div>
      <div class="p-none" id="none" hidden>Nada encontrado.</div>
      <div class="p-info">
        <div class="t"><small>Precisa de algo?</small><strong>O garçom vem até a sua mesa</strong></div>
        <button data-go="garcom">Chamar</button>
      </div>
      <footer class="m-foot">O pagamento é feito no caixa, ao final.</footer>
    </main>
    <nav class="p-nav"><div class="p-nav-inner">
      <button class="p-tab" data-go="buscar">${ICON.search}Buscar</button>
      <button class="p-tab" data-go="contato">${ICON.contact}Contato</button>
      <button class="p-cartbtn" id="open-cart" aria-label="Ver pedido">${ICON.bag}<span class="b" hidden></span></button>
      <button class="p-tab" data-go="conta">${ICON.receipt}Conta</button>
      <button class="p-tab" data-go="garcom">${ICON.hand}Garçom</button>
    </div></nav>`;

  $$('.p-tabs button').forEach(b => b.addEventListener('click', () => {
    const sec = $(`#cat-${b.dataset.cat}`);
    window.scrollTo({ top: sec.getBoundingClientRect().top + scrollY - 56, behavior: 'smooth' });
  }));
  $$('[data-go="garcom"]').forEach(b => b.addEventListener('click', () => callStaff('garcom')));
  $('[data-go="conta"]').addEventListener('click', showAccount);
  $('[data-go="contato"]').addEventListener('click', showContact);
  $('[data-go="buscar"]').addEventListener('click', () => { $('#q').focus(); $('#q').scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  $('#open-cart').addEventListener('click', () => cartCount() ? showCart() : toast('Toque no + de um prato para pedir'));
  $('#q').addEventListener('input', () => filter());
  $$('[data-chip]').forEach(b => b.addEventListener('click', () => {
    chip = b.dataset.chip;
    $$('[data-chip]').forEach(x => x.classList.toggle('on', x === b));
    filter();
  }));
  $('#app').addEventListener('click', onListClick);
  spyTabs();
  renderBar();
}

function card(p) {
  return `<article class="p-card ${qtyOf(p.id) ? 'in-cart' : ''}" data-id="${p.id}" data-name="${esc(norm(p.name + ' ' + (p.description || '')))}">
    <div class="p-img" data-open="${p.id}">
      ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'m-ph',textContent:'${esc(p.name[0])}'}))">`
        : p.model_glb_url ? `<model-viewer src="${esc(p.model_glb_url)}" alt="" auto-rotate rotation-per-second="20deg" disable-zoom interaction-prompt="none" style="width:100%;height:100%;background:#1d1b19;pointer-events:none"></model-viewer>`
        : `<div class="m-ph">${esc(p.name[0])}</div>`}
      ${badgeOf(p) ? `<span class="p-tag">${esc(badgeOf(p))}</span>` : ''}
      ${p.model_glb_url ? '<span class="p-3d">Ver em 3D</span>' : ''}
    </div>
    <div class="p-body">
      <h4 data-open="${p.id}">${esc(p.name)}</h4>
      ${p.description ? `<p>${esc(p.description)}</p>` : ''}
      <div class="p-buy"><span class="p-price">${money(p.price_cents)}</span>${buyControl(p)}</div>
    </div>
  </article>`;
}

const badgeOf = p => p.badge || (data.highlights?.popular.includes(p.id) ? 'Mais pedido' : '');
const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

let chip = 'all';
const CHIP = {
  all: () => true,
  popular: p => data.highlights?.popular.includes(p.id),
  cheap: p => data.highlights?.cheap.includes(p.id),
  '3d': p => !!p.model_glb_url,
};

function filter() {
  const q = norm($('#q').value.trim());
  let any = false;
  $$('.p-section').forEach(sec => {
    let n = 0;
    sec.querySelectorAll('.p-card').forEach(c => {
      const hit = (!q || c.dataset.name.includes(q)) && CHIP[chip](byId(Number(c.dataset.id)));
      c.hidden = !hit; if (hit) n++;
    });
    sec.hidden = !n; any ||= n > 0;
  });
  $('#none').hidden = any;
}

function spyTabs() {
  const obs = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const id = e.target.id.slice(4);
    $$('.p-tabs button').forEach(b => b.classList.toggle('on', b.dataset.cat === id));
    $(`.p-tabs button[data-cat="${id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }), { rootMargin: '-30% 0px -60% 0px' });
  $$('.p-section').forEach(s => obs.observe(s));
}

function item(p, flip) {
  return `<article class="m-item ${flip ? 'flip' : ''}" data-id="${p.id}">
    <div class="m-photo" data-open="${p.id}">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">` : `<div class="m-ph">${esc(p.name[0])}</div>`}</div>
    <div class="m-text">
      ${p.badge ? `<div class="m-tag">${esc(p.badge)}</div>` : ''}
      <h3 data-open="${p.id}">${esc(p.name)}${p.model_glb_url ? '<span class="m-3d">3D</span>' : ''}</h3>
      ${p.description ? `<p>${esc(p.description)}</p>` : ''}
      <div class="m-buy"><span class="m-price">${money(p.price_cents)}</span>${buyControl(p)}</div>
    </div>
  </article>`;
}

function buyControl(p) {
  if (!data.restaurant.accepting_orders) return '';
  const q = qtyOf(p.id);
  if (premium()) return q
    ? `<span class="p-qty"><button data-dec="${p.id}" aria-label="Tirar um">−</button><span>${q}</span><button data-inc="${p.id}" aria-label="Mais um">+</button></span>`
    : `<button class="p-plus" data-inc="${p.id}" aria-label="Adicionar ${esc(p.name)}">${ICON.plus}</button>`;
  return q
    ? `<span class="m-qty"><button data-dec="${p.id}" aria-label="Tirar um">−</button><span>${q}</span><button data-inc="${p.id}" aria-label="Mais um">+</button></span>`
    : `<button class="m-add" data-inc="${p.id}">Adicionar</button>`;
}

function onListClick(e) {
  const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]'), open = e.target.closest('[data-open]');
  if (inc) { change(Number(inc.dataset.inc), +1); return; }
  if (dec) { change(Number(dec.dataset.dec), -1); return; }
  if (open && !overlay) showDish(Number(open.dataset.open));
}

// Adiciona/remove 1 unidade. Itens com observação ou ingrediente retirado viram linhas separadas.
function change(id, d, note = '', removed = []) {
  let line = cart.find(l => l.product_id === id && sameLine(l, note, removed)) || (d < 0 && [...cart].reverse().find(l => l.product_id === id));
  if (!line && d > 0) cart.push(line = { product_id: id, qty: 0, note, removed });
  if (!line) return;
  line.qty += d;
  if (line.qty <= 0) cart.splice(cart.indexOf(line), 1);
  store.set(K.cart, cart);
  refreshItem(id);
  renderBar();
}

function refreshItem(id) {
  if (premium()) {
    const c = $(`.p-card[data-id="${id}"]`);
    if (!c) return;
    c.classList.toggle('in-cart', qtyOf(id) > 0);
    c.querySelector('.p-buy').innerHTML = `<span class="p-price">${money(byId(id).price_cents)}</span>${buyControl(byId(id))}`;
    return;
  }
  const el = $(`.m-item[data-id="${id}"] .m-buy`);
  if (el) el.innerHTML = `<span class="m-price">${money(byId(id).price_cents)}</span>${buyControl(byId(id))}`;
}

function renderBar() {
  const btn = $('.p-cartbtn');
  if (btn) {
    const n = cartCount(), b = btn.querySelector('.b');
    if (n && b.textContent !== String(n)) { btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump'); }
    b.hidden = !n; b.textContent = n || '';
    $('.p-nav').hidden = !!overlay;
    return;
  }
  const bar = $('.m-bar');
  if (!bar) return;
  const n = cartCount();
  bar.classList.toggle('show', n > 0 && !overlay);
  if (n) bar.querySelector('button').innerHTML = `<span class="c">${n}</span>Ver pedido<span class="t">${money(cartTotal())}</span><span class="arrow">→</span>`;
}

function spyNav() {
  const obs = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const id = e.target.id.slice(4);
    $$('.m-nav button').forEach(b => b.classList.toggle('on', b.dataset.cat === id));
    $(`.m-nav button[data-cat="${id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }), { rootMargin: '-40% 0px -55% 0px' });
  $$('.m-section').forEach(s => obs.observe(s));
}

// ---------- botão voltar do celular ----------
// Cada tela sobreposta (prato, sacola, conta) ganha uma entrada no histórico: o voltar do Android fecha só ela.
// Sem nada aberto, o primeiro voltar sobe para o topo do cardápio e limpa a busca; só o seguinte sai do site.
let skipPop = false;
function setupBackButton() {
  // o Chrome ignora no voltar as entradas criadas sem toque do usuário: a "trava" entra no primeiro toque
  const arm = () => { if (!history.state?.guard && !history.state?.ov) history.pushState({ guard: true }, ''); };
  addEventListener('pointerdown', arm, { once: true, capture: true });
  addEventListener('popstate', () => {
    if (skipPop) { skipPop = false; return; }
    if (overlay) { closeOverlay(true, true); return; }
    const q = $('#q');
    if (scrollY > 150 || q?.value) {
      if (q && q.value) { q.value = ''; q.dispatchEvent(new Event('input')); }
      const all = $('[data-chip="all"]');
      if (all && !all.classList.contains('on')) all.click();
      scrollTo({ top: 0, behavior: 'smooth' });
      history.pushState({ guard: true }, '');
    }
  });
}

// ---------- telas sobrepostas ----------
function openOverlay(kind, html, extra = {}) {
  closeOverlay(false, true);
  if (!history.state?.ov) history.pushState({ ov: true }, '');
  const el = document.createElement('div');
  el.className = 'm-over';
  el.dataset.theme = data.restaurant.theme || 'premium';
  el.innerHTML = `<div class="m-over-inner">${html}</div>`;
  $('#app').append(el);
  document.documentElement.style.overflow = 'hidden';
  overlay = { kind, el, ...extra };
  el.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => closeOverlay()));
  renderBar();
  return el;
}

function closeOverlay(update = true, fromHistory = false) {
  // fechado pelo botão da tela: tira a entrada do histórico também, sem fechar de novo no popstate
  if (!fromHistory && overlay && history.state?.ov) { skipPop = true; history.back(); }
  overlay?.el.remove();
  overlay = null;
  document.documentElement.style.overflow = '';
  if (update) renderBar();
}

const topbar = title => `<div class="m-over-top"><button class="m-back" data-back>← Voltar</button><strong>${title}</strong><span style="width:60px"></span></div>`;

// Detalhe do prato. Se tiver modelo 3D, abre direto no 3D (um toque na foto = 3D).
function showDish(id) {
  const p = byId(id);
  const has3d = !!p.model_glb_url;
  let qty = 1;
  const el = openOverlay('dish', `
    ${topbar(esc(data.restaurant.name))}
    <div class="m-dish"><div class="m-dmedia">
    <div class="m-dphoto" id="d-media"></div>
    ${has3d ? `<div class="m-switch"><button data-mode="3d" class="on">Ver em 3D</button>${p.image_url ? '<button data-mode="foto">Foto</button>' : ''}</div>` : ''}
    </div><div class="m-dside">
    <div class="m-dtext">
      ${p.badge ? `<div class="m-tag" style="font-size:.66rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--brand)">${esc(p.badge)}</div>` : ''}
      <h2>${esc(p.name)}</h2>
      ${p.description ? `<p>${esc(p.description)}</p>` : ''}
      <div class="m-price">${money(p.price_cents)}</div>
      ${ingredientsOf(p).length ? `<div class="m-label">Ingredientes <span>toque para tirar</span></div>
        <div class="m-ingr">${ingredientsOf(p).map(x => `<button type="button" data-ingr="${esc(x)}" aria-pressed="false">${esc(x)}</button>`).join('')}</div>` : ''}
      <label class="m-label" for="d-note">Alguma observação?</label>
      <input class="m-input" id="d-note" maxlength="140" placeholder="Ex.: bem passado, molho à parte">
    </div>
    ${data.restaurant.accepting_orders ? `<div class="m-dock"><div class="m-dock-inner">
      <span class="m-qty"><button data-q="-1">−</button><span id="d-q">1</span><button data-q="1">+</button></span>
      <button class="m-primary" id="d-add"><span>Adicionar</span><span id="d-total">${money(p.price_cents)}</span></button>
    </div></div>` : ''}
    </div></div>`);
  el.classList.add('is-dish');

  const media = el.querySelector('#d-media');
  const show = mode => {
    el.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    media.innerHTML = mode === '3d'
      ? `<model-viewer src="${esc(p.model_glb_url)}" ${p.model_usdz_url ? `ios-src="${esc(p.model_usdz_url)}"` : ''} alt="${esc(p.name)} em 3D"
           ar ar-modes="webxr scene-viewer quick-look" ar-placement="floor" ar-scale="fixed"
           camera-controls auto-rotate touch-action="pan-y" shadow-intensity="1" exposure="1.05">
           <button slot="ar-button" class="m-ar-btn" style="position:absolute;left:0;right:0;bottom:12px;margin:0 auto;width:auto;padding:0 16px;background:var(--paper)">Ver na minha mesa (realidade aumentada)</button>
         </model-viewer>`
      : p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}">` : '';
    media.style.position = 'relative';
  };
  show(has3d ? '3d' : 'foto');
  el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => show(b.dataset.mode)));
  el.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
    qty = Math.max(1, Math.min(50, qty + Number(b.dataset.q)));
    el.querySelector('#d-q').textContent = qty;
    el.querySelector('#d-total').textContent = money(p.price_cents * qty);
  }));
  el.querySelectorAll('[data-ingr]').forEach(b => b.addEventListener('click', () => {
    const off = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', off);
  }));
  el.querySelector('#d-add')?.addEventListener('click', () => {
    const note = el.querySelector('#d-note').value.trim();
    const removed = [...el.querySelectorAll('[data-ingr][aria-pressed="true"]')].map(b => b.dataset.ingr);
    for (let i = 0; i < qty; i++) change(p.id, +1, note, removed);
    closeOverlay();
    toast(`${qty}× ${p.name} adicionado`);
  });
}

function showCart() {
  const draw = () => `
    ${topbar('Seu pedido')}
    <div class="m-lines">${cart.map((l, i) => { const p = byId(l.product_id); return `
      <div class="m-line">
        ${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : '<div class="m-thumb"></div>'}
        <div><strong>${esc(p.name)}</strong><small>${money(p.price_cents)}${extras(l) ? ` · ${esc(extras(l))}` : ''}</small></div>
        <span class="m-qty"><button data-l="${i}" data-d="-1">−</button><span>${l.qty}</span><button data-l="${i}" data-d="1">+</button></span>
      </div>`; }).join('')}</div>
    <div class="m-total"><span>Total</span><b>${money(cartTotal())}</b></div>
    <div class="m-form">
      <label class="m-label" for="c-name">Seu nome <span>opcional</span></label>
      <input class="m-input" id="c-name" maxlength="40" autocomplete="given-name" placeholder="Se a mesa tiver mais de um pedido, ajuda a separar">
      <p class="m-note-small">Mesa ${data.table.number}. O pagamento é feito no caixa, ao final.</p>
    </div>
    <div class="m-dock"><div class="m-dock-inner">
      <button class="m-primary" id="c-send"><span>Enviar para a cozinha</span><span>${money(cartTotal())}</span></button>
    </div></div>`;
  const el = openOverlay('cart', draw());
  const bind = () => {
    const nameInput = el.querySelector('#c-name');
    nameInput.value = overlay.name ?? store.get(K.name, '');
    nameInput.addEventListener('input', () => { overlay.name = nameInput.value; });
    el.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => {
      const l = cart[b.dataset.l];
      l.qty += Number(b.dataset.d);
      if (l.qty <= 0) cart.splice(b.dataset.l, 1);
      store.set(K.cart, cart);
      refreshItem(l.product_id);
      if (!cart.length) { closeOverlay(); return; }
      el.querySelector('.m-over-inner').innerHTML = draw();
      el.querySelector('[data-back]').addEventListener('click', () => closeOverlay());
      bind();
    }));
    el.querySelector('#c-send').addEventListener('click', send);
  };
  bind();
}

async function send() {
  const el = overlay.el;
  const name = el.querySelector('#c-name').value.trim();
  const btn = el.querySelector('#c-send');
  btn.disabled = true; btn.firstElementChild.textContent = 'Enviando…';
  try {
    const items = cart.map(l => ({ product_id: l.product_id, qty: l.qty, note: l.note || '', removed: l.removed || [] }));
    const order = await api(`/api/m/${token}/orders`, { method: 'POST', body: { customer_name: name, source, items } });
    if (name) store.set(K.name, name);
    mine[order.id] = order; store.set(K.mine, mine);
    const ids = new Set(cart.map(l => l.product_id));
    cart = []; store.set(K.cart, cart);
    ids.forEach(refreshItem);
    showSent(order);
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false; btn.firstElementChild.textContent = 'Enviar para a cozinha';
  }
}

// Confirmação com acompanhamento ao vivo (Recebido → Preparando → Pronto).
function showSent(o) {
  const step = STEPS.indexOf(o.status);
  const el = openOverlay('sent', `
    ${topbar('Pedido enviado')}
    <div class="m-sent">
      <div class="m-kicker">Mesa ${o.table_number}</div>
      <div class="m-senha"><small>Sua senha</small><b>${o.number}</b></div>
      <h2>${o.status === 'ready' ? 'Está pronto!' : o.status === 'canceled' ? 'Pedido cancelado' : o.status === 'preparing' ? 'Está sendo preparado.' : 'Chegou na cozinha.'}</h2>
      <p>${o.status === 'canceled' ? 'Fale com o atendente.'
        : o.status === 'received' ? (o.ahead ? `${o.ahead} ${o.ahead === 1 ? 'pedido' : 'pedidos'} na frente do seu. ` : 'Você é o próximo. ') + 'Esta tela atualiza sozinha.'
        : o.status === 'ready' ? 'Já vamos levar até a sua mesa.' : 'Esta tela atualiza sozinha. Pode continuar pedindo quando quiser.'}</p>
      <div class="m-track">${STEPS.map((s, i) => `<div class="${i <= step ? 'on' : ''}">${STATUS[s]}</div>`).join('')}</div>
    </div>
    <div class="m-lines">${o.items.map(i => `<div class="m-order"><div class="h"><span>${i.qty}× ${esc(i.name)}</span><span>${money(i.unit_price_cents * i.qty)}</span></div>${extras(i) ? `<ul><li>${esc(extras(i))}</li></ul>` : ''}</div>`).join('')}</div>
    <div class="m-actions2"><button class="m-secondary" data-back>Voltar ao cardápio</button><button class="m-secondary" id="s-acc">Minha conta</button></div>`,
  { id: o.id });
  el.querySelector('#s-acc').addEventListener('click', showAccount);
}

async function showAccount() {
  let c;
  try { c = await api(`/api/m/${token}/comanda`); } catch (e) { toast(e.message, true); return; }
  const el = openOverlay('account', `
    ${topbar(`Conta da mesa ${data.table.number}`)}
    <div class="m-lines">${c.orders.length ? c.orders.map(o => `
      <div class="m-order">
        <div class="h"><span>Nº ${o.number} · ${esc(o.customer_name)}${mine[o.id] ? ' (você)' : ''}</span><span class="m-st ${o.status}">${STATUS[o.status]}</span></div>
        <ul>${o.items.map(i => `<li>${i.qty}× ${esc(i.name)}${extras(i) ? ` · ${esc(extras(i))}` : ''}</li>`).join('')}</ul>
        <div style="font-size:.82rem;color:var(--ink-2);margin-top:4px">${hhmm(o.created_at)} · ${money(o.total_cents)}</div>
      </div>`).join('') : '<p style="color:var(--ink-2);padding:24px 0">Nenhum pedido nesta mesa ainda.</p>'}</div>
    ${c.orders.length ? `<div class="m-total"><span>Total da mesa</span><b>${money(c.total_cents)}</b></div>
      ${c.service_cents ? `<p class="m-note-small" style="padding:0 20px">Inclui serviço de ${c.service_fee_pct}% (${money(c.service_cents)}).</p>` : ''}` : ''}
    <div class="m-actions2"><button class="m-secondary" id="a-waiter">Chamar garçom</button><button class="m-primary center" id="a-bill" ${c.orders.length ? '' : 'disabled'}>Pedir a conta</button></div>
    <p class="m-note-small" style="text-align:center">O pagamento é feito no caixa.</p>`);
  el.querySelector('#a-waiter').addEventListener('click', () => callStaff('garcom'));
  el.querySelector('#a-bill').addEventListener('click', () => callStaff('conta'));
}

async function callStaff(kind) {
  try {
    await api(`/api/m/${token}/call`, { method: 'POST', body: { kind, customer_name: store.get(K.name, '') } });
    toast(kind === 'conta' ? 'Conta pedida. Já vamos até a mesa.' : 'Garçom chamado. Já vamos até a mesa.');
  } catch (e) { toast(e.message, true); }
}

function toast(msg, error = false) {
  $$('.m-toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = `m-toast${error ? ' error' : ''}`;
  t.textContent = msg;
  $('#app').append(t);
  setTimeout(() => t.remove(), 2600);
}
