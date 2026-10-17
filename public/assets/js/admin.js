// Painel do dono do restaurante: configurações, cardápio, mesas (QR/NFC) e relatório do dia.
import { api, money, esc, h, toast, sheet, applyTheme, staffGate, staffNav, tableUrl, slugFromPath, $, $$ } from './common.js';

const slug = slugFromPath();
let R = null;               // restaurante (linha completa, inclui staff_pin)
let tables = [];
let categories = [];
let products = [];
let publicBase = location.origin;

const PAY_LABEL = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', outro: 'Outro' };
const MAX_UPLOAD = 40 * 1024 * 1024;

// ---------- utilidades locais ----------
async function call(path, opts) {
  try { return await api(path, opts); }
  catch (e) {
    if (e.status === 401) { toast('Sessão expirada. Entre novamente.', 'error'); setTimeout(() => location.reload(), 1200); }
    throw e;
  }
}

async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

const urlFor = (token, src = 'qr') => `${publicBase}/m/${token}${src === 'nfc' ? '?src=nfc' : ''}`;
const isLocalBase = () => /\/\/(localhost|127\.|\[::1\])/.test(publicBase);

// "12,90" / "12.90" / "1.234,56" -> centavos
function parsePrice(v) {
  let s = String(v || '').trim().replace(/[^\d.,]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return s && Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
const priceInput = cents => (cents / 100).toFixed(2).replace('.', ',');

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copiado'); }
  catch {
    const ta = h(`<textarea style="position:fixed;opacity:0"></textarea>`); ta.value = text;
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Link copiado'); } catch { toast('Não foi possível copiar. Selecione o texto e copie manualmente.', 'error'); }
    ta.remove();
  }
}

async function upload(file) {
  if (file.size > MAX_UPLOAD) throw new Error('Arquivo muito grande (máximo 40 MB)');
  const { url } = await call(`/api/r/${slug}/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', raw: file });
  return url;
}

const sorted = list => [...list].sort((a, b) => (a.position - b.position) || (a.id - b.id));

// ---------- início ----------
init();

async function init() {
  try {
    await staffGate(slug);
  } catch (e) {
    document.body.innerHTML = `<div class="login-wrap"><div class="card"><h2>Restaurante não encontrado</h2><p class="muted">${esc(e.message)}</p></div></div>`;
    return;
  }
  const cfg = await api('/api/config').catch(() => ({}));
  if (cfg.public_url) publicBase = cfg.public_url;
  await load();
  renderTopbar();
  $('#app').hidden = false;
  $$('#tabs [data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  showTab(location.hash.slice(1) || 'config');
}

async function load() {
  const d = await call(`/api/r/${slug}/admin`);
  R = d.restaurant; tables = d.tables; categories = d.categories; products = d.products;
  applyTheme(R);
}

function renderTopbar() {
  const tb = $('#topbar');
  tb.innerHTML = `<span class="brand">${esc(R.name)}</span>${staffNav(slug, 'admin')}<span class="spacer"></span>
    <button class="btn ghost small" id="logout">Sair</button>`;
  $('#logout', tb).addEventListener('click', async () => {
    await api(`/api/r/${slug}/logout`, { method: 'POST' }).catch(() => {});
    location.reload();
  });
  const fit = () => document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`);
  fit();
  if (!renderTopbar.bound) { renderTopbar.bound = true; window.addEventListener('resize', fit); }
}

function showTab(tab) {
  if (!['config', 'menu', 'tables', 'report'].includes(tab)) tab = 'config';
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', `#${tab}`);
  $$('#tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $(`#tabs [data-tab="${tab}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
  ({ config: renderConfig, menu: renderMenu, tables: renderTables, report: renderReport })[tab]();
}

// =====================================================================
// Configurações
// =====================================================================
const COLOR_FIELDS = [['primary_color', 'Cor principal (botões)'], ['accent_color', 'Destaque'], ['bg_color', 'Fundo'], ['text_color', 'Texto']];

function renderConfig() {
  const p = $('#p-config');
  const color = v => /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000';
  p.innerHTML = `
  <form class="grid" id="cfg" autocomplete="off">
    <div class="card grid">
      <h3>Identidade</h3>
      <label class="field"><span>Nome do restaurante</span><input class="input" name="name" required maxlength="80" value="${esc(R.name)}"></label>
      <label class="field"><span>Frase de apresentação</span><input class="input" name="tagline" maxlength="140" value="${esc(R.tagline)}" placeholder="Ex.: Espetinhos na brasa desde 1998"></label>
      ${imageField('logo_url', 'Logo', R.logo_url)}
      ${imageField('cover_url', 'Foto de capa', R.cover_url)}
      <label class="field"><span>Visual do cardápio</span><select class="input" name="theme">
        <option value="premium" ${R.theme !== 'claro' ? 'selected' : ''}>Premium (escuro, cards pretos)</option>
        <option value="claro" ${R.theme === 'claro' ? 'selected' : ''}>Claro (editorial)</option>
      </select></label>
    </div>

    <div class="card grid">
      <h3>Cores</h3>
      <p class="muted small-text">A tela muda na hora para você ver como fica. Só vale depois de salvar.</p>
      <div class="colors">
        ${COLOR_FIELDS.map(([f, l]) => `<label class="color-field"><input type="color" name="${f}" value="${color(R[f])}"><span>${l}</span><code>${esc(color(R[f]))}</code></label>`).join('')}
      </div>
      <div class="preview" id="preview"></div>
    </div>

    <div class="card grid">
      <h3>Contato</h3>
      <label class="field"><span>WhatsApp (com DDD)</span><input class="input" name="whatsapp" inputmode="tel" value="${esc(R.whatsapp)}" placeholder="11999998888"></label>
      <label class="field"><span>Endereço</span><input class="input" name="address" value="${esc(R.address)}"></label>
      <p class="muted small-text">Aparecem no botão "Contato" do cardápio. Pode colar o @ ou o link; deixe em branco o que não usa.</p>
      ${[['instagram', 'Instagram', '@seurestaurante'], ['tiktok', 'TikTok', '@seurestaurante'], ['facebook', 'Facebook', 'facebook.com/seurestaurante'],
        ['ifood', 'iFood (link da loja)', 'https://www.ifood.com.br/delivery/...'], ['website', 'Site', 'seurestaurante.com.br']]
        .map(([f, l, ph]) => `<label class="field"><span>${l}</span><input class="input" name="${f}" value="${esc(R[f] || '')}" placeholder="${ph}"></label>`).join('')}
    </div>

    <div class="card grid">
      <h3>Pedidos e equipe</h3>
      <label class="switch-row"><input type="checkbox" name="accepting_orders" ${R.accepting_orders ? 'checked' : ''}><span class="switch"></span>
        <span><b>Recebendo pedidos</b><br><span class="muted">Desligue para deixar o cardápio só para consulta (restaurante fechado).</span></span></label>
      <label class="switch-row"><input type="checkbox" name="require_open_table" ${R.require_open_table ? 'checked' : ''}><span class="switch"></span>
        <span><b>Só aceitar pedidos de mesas abertas pelo caixa (anti-trote)</b><br><span class="muted">O cliente só consegue pedir depois que o caixa abrir a mesa.</span></span></label>
      <div class="two">
        <label class="field"><span>Taxa de serviço (%)</span><input class="input" name="service_fee_pct" type="number" min="0" max="30" step="0.5" value="${esc(R.service_fee_pct)}"></label>
        <label class="field"><span>PIN da equipe (4 a 8 números)</span><input class="input" name="staff_pin" inputmode="numeric" pattern="\\d{4,8}" maxlength="8" required value="${esc(R.staff_pin)}"></label>
      </div>
    </div>

    <div class="save-bar">
      <button type="button" class="btn ghost" id="cfg-reset">Desfazer</button>
      <button class="btn" id="cfg-save">Salvar configurações</button>
    </div>
  </form>`;

  const form = $('#cfg', p);
  bindImageFields(form);
  const values = () => {
    const fd = new FormData(form);
    const o = Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith('_')));
    o.accepting_orders = form.accepting_orders.checked;
    o.require_open_table = form.require_open_table.checked;
    o.service_fee_pct = Number(o.service_fee_pct) || 0;
    return o;
  };
  const preview = () => {
    const v = values();
    applyTheme(v);
    $$('.color-field', form).forEach(l => { $('code', l).textContent = $('input', l).value; });
    $('#preview', form).innerHTML = `
      <div class="pv-cover"></div>
      <div class="pv-body">
        <div class="row">${v.logo_url ? `<img class="pv-logo" src="${esc(v.logo_url)}" alt="">` : ''}
          <div><b>${esc(v.name || 'Seu restaurante')}</b><div class="muted">${esc(v.tagline || '')}</div></div></div>
        <div class="pv-item"><div><b>Produto exemplo</b> <span class="pill">mais pedido</span><div class="muted">Descrição curta do prato</div></div>
          <b class="pv-price">${money(2990)}</b></div>
        <button type="button" class="btn block" tabindex="-1">Adicionar ao pedido</button>
      </div>`;
    if (v.cover_url) $('.pv-cover', form).style.backgroundImage = `url(${JSON.stringify(v.cover_url)})`;
  };
  form.addEventListener('input', preview);
  preview();
  $('#cfg-reset', p).addEventListener('click', () => { applyTheme(R); renderConfig(); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    run($('#cfg-save', p), async () => {
      R = await call(`/api/r/${slug}/settings`, { method: 'PUT', body: values() });
      applyTheme(R); renderTopbar(); renderConfig();
      toast('Configurações salvas');
    });
  });
}

// Campo de imagem/arquivo com URL + botão de enviar arquivo.
function imageField(name, label, value, accept = 'image/jpeg,image/png,image/webp', isImage = true) {
  return `<div class="field upload-field" data-upload="${name}">
    <span class="muted">${label}</span>
    <div class="row">
      ${isImage ? `<img class="thumb ${value ? '' : 'hidden'}" src="${esc(value)}" alt="">` : ''}
      <input class="input" name="${name}" value="${esc(value)}" placeholder="https://… ou envie um arquivo">
      <label class="btn soft small file-btn">Enviar<input type="file" name="_file_${name}" accept="${accept}" hidden></label>
    </div>
  </div>`;
}

function bindImageFields(root, onChange = () => {}) {
  $$('[data-upload]', root).forEach(box => {
    const input = $(`input[name="${box.dataset.upload}"]`, box);
    const file = $('input[type=file]', box);
    const img = $('img.thumb', box);
    const sync = () => {
      if (img) { img.src = input.value; img.classList.toggle('hidden', !input.value); }
      onChange(box.dataset.upload, input.value);
    };
    input.addEventListener('change', sync);
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      const btn = file.closest('label');
      btn.classList.add('busy'); btn.firstChild.textContent = 'Enviando…';
      try {
        input.value = await upload(f);
        sync();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        toast('Arquivo enviado');
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.classList.remove('busy'); btn.firstChild.textContent = 'Enviar'; file.value = ''; }
    });
  });
}

// =====================================================================
// Cardápio
// =====================================================================
function renderMenu() {
  const p = $('#p-menu');
  const cats = sorted(categories);
  const catIds = new Set(cats.map(c => c.id));
  const groups = cats.map(c => ({ cat: c, items: sorted(products.filter(x => x.category_id === c.id)) }));
  const orphans = sorted(products.filter(x => !catIds.has(x.category_id)));
  if (orphans.length) groups.push({ cat: null, items: orphans });
  const out = products.filter(x => !x.available).length;

  p.innerHTML = `
  <div class="card grid">
    <div class="row wrap"><h3 class="grow">Categorias</h3></div>
    <ul class="cat-list">
      ${cats.map((c, i) => `<li data-cat="${c.id}">
        <input class="input" value="${esc(c.name)}" aria-label="Nome da categoria" maxlength="60">
        <button class="icon-btn" data-move="-1" ${i === 0 ? 'disabled' : ''} title="Subir" aria-label="Subir">▲</button>
        <button class="icon-btn" data-move="1" ${i === cats.length - 1 ? 'disabled' : ''} title="Descer" aria-label="Descer">▼</button>
        <button class="icon-btn danger" data-del title="Excluir" aria-label="Excluir categoria">✕</button>
      </li>`).join('') || '<li class="muted">Nenhuma categoria ainda.</li>'}
    </ul>
    <form class="row" id="new-cat"><input class="input" name="name" placeholder="Nova categoria (ex.: Bebidas)" required maxlength="60"><button class="btn">Adicionar</button></form>
  </div>

  <div class="row wrap section-head">
    <h3 class="grow">Produtos <span class="muted">(${products.length}${out ? ` · ${out} esgotado${out > 1 ? 's' : ''}` : ''})</span></h3>
    <button class="btn" data-new-product="">+ Novo produto</button>
  </div>
  ${groups.map(g => `
    <div class="card prod-group">
      <div class="row group-head"><h4 class="grow">${g.cat ? esc(g.cat.name) : 'Sem categoria'}</h4>
        <button class="btn soft small" data-new-product="${g.cat ? g.cat.id : ''}">+ Produto</button></div>
      ${g.items.map(productRow).join('') || '<p class="muted">Nenhum produto nesta categoria.</p>'}
    </div>`).join('') || '<p class="muted">Crie uma categoria e adicione produtos.</p>'}
  `;

  // categorias
  $$('[data-cat]', p).forEach(li => {
    const id = Number(li.dataset.cat);
    const c = categories.find(x => x.id === id);
    const input = $('input', li);
    input.addEventListener('change', () => run(input, async () => {
      const name = input.value.trim();
      if (!name) { input.value = c.name; throw new Error('Informe o nome da categoria'); }
      Object.assign(c, await call(`/api/r/${slug}/categories/${id}`, { method: 'PUT', body: { name, position: c.position } }));
      toast('Categoria renomeada'); renderMenu();
    }));
    $$('[data-move]', li).forEach(b => b.addEventListener('click', () => run(b, () => moveCategory(id, Number(b.dataset.move)))));
    $('[data-del]', li).addEventListener('click', e => run(e.currentTarget, async () => {
      const n = products.filter(x => x.category_id === id).length;
      if (!confirm(`Excluir a categoria "${c.name}"?${n ? `\n\nOs ${n} produto(s) dela continuam, mas ficam "Sem categoria".` : ''}`)) return;
      await call(`/api/r/${slug}/categories/${id}`, { method: 'DELETE' });
      categories = categories.filter(x => x.id !== id);
      products.forEach(x => { if (x.category_id === id) x.category_id = null; });
      toast('Categoria excluída'); renderMenu();
    }));
  });
  $('#new-cat', p).addEventListener('submit', e => {
    e.preventDefault();
    const f = e.currentTarget;
    run($('button', f), async () => {
      const position = categories.reduce((m, c) => Math.max(m, c.position), -1) + 1;
      categories.push(await call(`/api/r/${slug}/categories`, { method: 'POST', body: { name: f.name.value.trim(), position } }));
      toast('Categoria criada'); renderMenu();
    });
  });

  // produtos
  $$('[data-new-product]', p).forEach(b => b.addEventListener('click', () => productSheet(null, b.dataset.newProduct)));
  $$('[data-prod]', p).forEach(row => {
    const prod = products.find(x => x.id === Number(row.dataset.prod));
    $('[data-edit]', row).addEventListener('click', () => productSheet(prod));
    $('[data-toggle]', row).addEventListener('click', e => run(e.currentTarget, async () => {
      Object.assign(prod, await call(`/api/r/${slug}/products/${prod.id}`, { method: 'PUT', body: { available: !prod.available } }));
      toast(prod.available ? `${prod.name}: disponível` : `${prod.name}: esgotado`);
      renderMenu();
    }));
  });
}

function productRow(x) {
  return `<div class="prod-row ${x.available ? '' : 'off'}" data-prod="${x.id}">
    <button class="prod-main" data-edit>
      ${x.image_url ? `<img class="prod-thumb" src="${esc(x.image_url)}" alt="" loading="lazy">` : '<span class="prod-thumb empty">🍽</span>'}
      <span class="prod-text"><b>${esc(x.name)}</b>
        <span class="muted">${money(x.price_cents)}${x.badge ? ` · <span class="pill">${esc(x.badge)}</span>` : ''}${x.model_glb_url ? ' · <span class="pill">3D</span>' : ''}</span></span>
    </button>
    <button class="avail ${x.available ? 'on' : ''}" data-toggle aria-pressed="${!!x.available}" title="Tocar para alternar">
      ${x.available ? 'Disponível' : 'Esgotado'}</button>
  </div>`;
}

async function moveCategory(id, dir) {
  const list = sorted(categories);
  const i = list.findIndex(c => c.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (const [pos, c] of list.entries()) {
    if (c.position === pos) continue;
    Object.assign(c, await call(`/api/r/${slug}/categories/${c.id}`, { method: 'PUT', body: { name: c.name, position: pos } }));
  }
  renderMenu();
}

function productSheet(prod, presetCat = '') {
  const x = prod || { name: '', description: '', price_cents: 0, category_id: presetCat ? Number(presetCat) : null, badge: '', available: 1, image_url: '', model_glb_url: '', model_usdz_url: '' };
  const { el, close } = sheet(`
    <form class="grid" id="pform" autocomplete="off">
      <div class="row"><h2 class="grow">${prod ? 'Editar produto' : 'Novo produto'}</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button></div>
      <label class="field"><span>Nome</span><input class="input" name="name" required maxlength="80" value="${esc(x.name)}"></label>
      <label class="field"><span>Descrição</span><textarea class="input" name="description" rows="3" maxlength="400">${esc(x.description)}</textarea></label>
      <div class="two">
        <label class="field"><span>Preço (R$)</span><input class="input" name="price" inputmode="decimal" required value="${prod ? priceInput(x.price_cents) : ''}" placeholder="0,00"></label>
        <label class="field"><span>Categoria</span><select class="input" name="category_id">
          <option value="">Sem categoria</option>
          ${sorted(categories).map(c => `<option value="${c.id}" ${c.id === x.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>
      </div>
      <label class="field"><span>Ingredientes (separados por vírgula; o cliente pode tirar)</span><input class="input" name="ingredients" maxlength="300" value="${esc(x.ingredients || '')}" placeholder="Ex.: Alcatra, Cebola, Pimentão, Farofa"></label>
      <label class="field"><span>Selo (opcional)</span><input class="input" name="badge" maxlength="30" list="badges" value="${esc(x.badge)}" placeholder="Ex.: mais pedido, picante, vegetariano">
        <datalist id="badges"><option value="mais pedido"><option value="novo"><option value="picante"><option value="vegetariano"><option value="vegano"><option value="sem glúten"></datalist></label>
      <label class="switch-row"><input type="checkbox" name="available" ${x.available ? 'checked' : ''}><span class="switch"></span><span><b>Disponível</b><br><span class="muted">Desligado = aparece como esgotado e some do cardápio do cliente.</span></span></label>
      ${imageField('image_url', 'Foto', x.image_url)}
      <details class="three-d" ${x.model_glb_url || x.model_usdz_url ? 'open' : ''}>
        <summary>Modelo 3D / realidade aumentada (opcional)</summary>
        <p class="muted small-text">GLB funciona no Android e no navegador; USDZ é usado pela realidade aumentada do iPhone.</p>
        ${imageField('model_glb_url', 'Arquivo GLB', x.model_glb_url, '.glb,model/gltf-binary', false)}
        ${imageField('model_usdz_url', 'Arquivo USDZ (iPhone)', x.model_usdz_url, '.usdz,model/vnd.usdz+zip', false)}
        <div class="mv-wrap" id="mv"></div>
      </details>
      <div class="row wrap">
        ${prod ? '<button type="button" class="btn danger" id="pdel">Excluir</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button class="btn" id="psave">Salvar</button>
      </div>
    </form>`);
  const form = $('#pform', el);
  const F = n => form.elements.namedItem(n);
  const mv = $('#mv', el);
  const renderModel = () => {
    const glb = F('model_glb_url').value.trim();
    const usdz = F('model_usdz_url').value.trim();
    mv.innerHTML = glb ? `<model-viewer src="${esc(glb)}" ${usdz ? `ios-src="${esc(usdz)}"` : ''} camera-controls auto-rotate
      shadow-intensity="1" alt="Prévia 3D de ${esc(F('name').value)}"></model-viewer>` : '';
  };
  bindImageFields(form, name => { if (name.startsWith('model_')) renderModel(); });
  renderModel();
  if (!prod) F('name').focus();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const price_cents = parsePrice(F('price').value);
    if (!Number.isFinite(price_cents) || price_cents < 0) { toast('Preço inválido. Use por exemplo 12,90', 'error'); F('price').focus(); return; }
    const body = {
      name: F('name').value.trim(), description: F('description').value.trim(), price_cents,
      category_id: F('category_id').value ? Number(F('category_id').value) : '',
      badge: F('badge').value.trim(), available: F('available').checked, ingredients: F('ingredients').value.trim(),
      image_url: F('image_url').value.trim(), model_glb_url: F('model_glb_url').value.trim(), model_usdz_url: F('model_usdz_url').value.trim(),
    };
    run($('#psave', el), async () => {
      if (prod) Object.assign(prod, await call(`/api/r/${slug}/products/${prod.id}`, { method: 'PUT', body }));
      else {
        const same = products.filter(p => p.category_id === (body.category_id || null));
        body.position = same.reduce((m, p) => Math.max(m, p.position), -1) + 1;
        products.push(await call(`/api/r/${slug}/products`, { method: 'POST', body }));
      }
      toast('Produto salvo'); close(); renderMenu();
    });
  });
  $('#pdel', el)?.addEventListener('click', e => run(e.currentTarget, async () => {
    if (!confirm(`Excluir "${prod.name}" do cardápio?\n\nSe só acabou hoje, prefira marcar como esgotado.`)) return;
    await call(`/api/r/${slug}/products/${prod.id}`, { method: 'DELETE' });
    products = products.filter(p => p.id !== prod.id);
    toast('Produto excluído'); close(); renderMenu();
  }));
}

// =====================================================================
// Mesas
// =====================================================================
function renderTables() {
  const p = $('#p-tables');
  p.innerHTML = `
  ${isLocalBase() ? `<div class="notice">Você abriu o painel por <b>localhost</b>: os links e QR Codes vão apontar para este computador e não abrem no celular do cliente.
    Abra o painel pelo IP do computador na rede (ex.: http://192.168.0.10:3000) ou configure <code>PUBLIC_URL</code> no servidor.</div>` : ''}
  <div class="card grid">
    <form class="row wrap" id="add-tables">
      <label class="field grow"><span>Adicionar mesas</span><input class="input" type="number" name="count" min="1" max="200" value="1" required></label>
      <button class="btn">Adicionar</button>
      <a class="btn soft" href="/r/${esc(slug)}/painel#qrcodes" target="_top">Imprimir QR Codes</a>
    </form>
    <p class="muted small-text">Cada mesa tem um link secreto usado no QR Code e na tag NFC. Novas mesas recebem o próximo número.</p>
  </div>
  <div class="table-list">
    ${tables.map(t => `
      <div class="card tbl ${t.active ? '' : 'off'}" data-table="${t.id}">
        <div class="row">
          <div class="tbl-num">${t.number}</div>
          <div class="grow min0">
            <input class="input" data-label value="${esc(t.label)}" placeholder="Apelido (ex.: Varanda)" maxlength="40" aria-label="Apelido da mesa ${t.number}">
            <div class="muted tiny mono" title="Código da mesa">código ${esc(t.token)}</div>
          </div>
        </div>
        <label class="switch-row compact"><input type="checkbox" data-active ${t.active ? 'checked' : ''}><span class="switch"></span><span>${t.active ? 'Ativa' : 'Desativada (QR e NFC não abrem o cardápio)'}</span></label>
        <div class="row wrap tbl-actions">
          <a class="btn soft small" href="${esc(urlFor(t.token))}" target="_blank" rel="noopener">Abrir cardápio</a>
          <button class="btn soft small" data-nfc>Gravar tag NFC</button>
          <button class="btn soft small" data-copy>Copiar link</button>
          <button class="btn ghost small" data-regen>Gerar novo QR</button>
          <button class="btn ghost small danger-text" data-del>Excluir</button>
        </div>
      </div>`).join('') || '<p class="muted">Nenhuma mesa cadastrada.</p>'}
  </div>`;

  $('#add-tables', p).addEventListener('submit', e => {
    e.preventDefault();
    const f = e.currentTarget;
    run($('button', f), async () => {
      const count = Math.max(1, Math.min(200, Number(f.count.value) || 1));
      tables = await call(`/api/r/${slug}/tables`, { method: 'POST', body: { count } });
      toast(count > 1 ? `${count} mesas adicionadas` : 'Mesa adicionada'); renderTables();
    });
  });

  $$('[data-table]', p).forEach(card => {
    const t = tables.find(x => x.id === Number(card.dataset.table));
    const put = async body => { Object.assign(t, await call(`/api/r/${slug}/tables/${t.id}`, { method: 'PUT', body })); };
    const label = $('[data-label]', card);
    label.addEventListener('change', () => run(label, async () => { await put({ label: label.value }); toast(`Mesa ${t.number} atualizada`); }));
    const active = $('[data-active]', card);
    active.addEventListener('change', () => run(active, async () => {
      await put({ active: active.checked });
      toast(t.active ? `Mesa ${t.number} ativada` : `Mesa ${t.number} desativada`); renderTables();
    }));
    $('[data-copy]', card).addEventListener('click', () => copy(urlFor(t.token)));
    $('[data-nfc]', card).addEventListener('click', () => nfcSheet(t));
    $('[data-regen]', card).addEventListener('click', e => run(e.currentTarget, async () => {
      if (!confirm(`Gerar um novo código para a mesa ${t.number}?\n\nO QR Code impresso e a tag NFC atuais desta mesa VÃO PARAR DE FUNCIONAR. Você precisará imprimir o novo QR e regravar a tag.\n\nUse isto se alguém fotografou o QR e está fazendo pedidos falsos.`)) return;
      await put({ regenerate: true });
      toast(`Novo código gerado para a mesa ${t.number}. Reimprima o QR.`); renderTables();
    }));
    $('[data-del]', card).addEventListener('click', e => run(e.currentTarget, async () => {
      if (!confirm(`Excluir a mesa ${t.number}?\n\nO histórico de pedidos e comandas desta mesa também será apagado. Para só parar de usar, prefira desativar.`)) return;
      await call(`/api/r/${slug}/tables/${t.id}`, { method: 'DELETE' });
      tables = tables.filter(x => x.id !== t.id);
      toast(`Mesa ${t.number} excluída`); renderTables();
    }));
  });
}

function nfcSheet(t) {
  const url = urlFor(t.token, 'nfc');
  const supported = 'NDEFReader' in window;
  let ctrl = null;
  const { el } = sheet(`
    <div class="grid">
      <div class="row"><h2 class="grow">Tag NFC · Mesa ${t.number}</h2><button class="icon-btn" data-close aria-label="Fechar">✕</button></div>
      <p class="muted">Endereço que será gravado na tag:</p>
      <div class="row copy-row"><code class="url-box">${esc(url)}</code><button class="btn soft small" id="nfc-copy">Copiar</button></div>
      ${supported ? `
        <ol class="steps"><li>Toque em <b>Gravar</b>.</li><li>Encoste a tag NFC atrás do celular, perto da câmera, e segure até confirmar.</li></ol>
        <div class="nfc-status" id="nfc-status" role="status"></div>
        <button class="btn block" id="nfc-write">Gravar</button>` : `
        <div class="notice">A gravação de NFC pelo navegador só funciona no <b>Chrome no Android</b>, com o painel aberto em <b>HTTPS</b>${window.isSecureContext ? '' : ' (esta página não está em HTTPS)'}.</div>
        <p>Alternativa: instale o app gratuito <b>NFC Tools</b> (Android ou iPhone), escolha <i>Gravar → Adicionar registro → URL</i>, cole o endereço acima e encoste a tag.</p>`}
      ${isLocalBase() ? '<p class="notice">Atenção: este endereço aponta para <b>localhost</b> e não vai abrir no celular do cliente.</p>' : ''}
      <p class="muted small-text">Dica: use tags NTAG213/215 e cole a tag embaixo do tampo ou no display da mesa.</p>
    </div>`, { onClose: () => ctrl?.abort() });
  $('#nfc-copy', el).addEventListener('click', () => copy(url));
  if (!supported) return;
  const status = $('#nfc-status', el);
  const btn = $('#nfc-write', el);
  const say = (msg, cls = '') => { status.className = `nfc-status ${cls}`; status.textContent = msg; };
  btn.addEventListener('click', async () => {
    ctrl?.abort();
    ctrl = new AbortController();
    btn.disabled = true;
    say('Aproxime a tag NFC do celular agora…', 'wait');
    try {
      const data = await tableUrl(t.token, 'nfc');
      await new NDEFReader().write({ records: [{ recordType: 'url', data }] }, { signal: ctrl.signal });
      say(`Tag gravada! Teste encostando um celular na tag da mesa ${t.number}.`, 'ok');
      navigator.vibrate?.(150);
      btn.textContent = 'Gravar outra tag';
    } catch (e) {
      if (e.name === 'AbortError') return;
      const msg = e.name === 'NotAllowedError' ? 'Permissão de NFC negada. Libere o NFC para este site nas configurações do Chrome.'
        : e.name === 'NotSupportedError' ? 'NFC desligado ou indisponível. Ative o NFC nas configurações do celular.'
        : e.name === 'NetworkError' ? 'A tag se afastou antes de terminar ou está protegida contra gravação. Tente de novo.'
        : `Não foi possível gravar: ${e.message}`;
      say(msg, 'err');
    } finally { btn.disabled = false; }
  });
}

// =====================================================================
// Relatório do dia
// =====================================================================
let reportDate = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD local

async function renderReport() {
  const p = $('#p-report');
  p.innerHTML = `
    <div class="row wrap section-head">
      <h3 class="grow">Relatório do dia</h3>
      <input class="input date-input" type="date" id="rdate" value="${esc(reportDate)}" max="${new Date().toLocaleDateString('sv-SE')}">
      <button class="btn soft small" id="rrefresh">Atualizar</button>
    </div>
    <div id="rbody"><p class="muted">Carregando…</p></div>`;
  $('#rdate', p).addEventListener('change', e => { reportDate = e.target.value || reportDate; renderReport(); });
  $('#rrefresh', p).addEventListener('click', () => renderReport());
  let rep;
  try { rep = await call(`/api/r/${slug}/report?date=${encodeURIComponent(reportDate)}`); }
  catch (e) { $('#rbody', p).innerHTML = `<p class="notice">${esc(e.message)}</p>`; return; }
  const closed = rep.by_payment.reduce((s, x) => s + (x.total || 0), 0);
  const nClosed = rep.by_payment.reduce((s, x) => s + x.n, 0);
  const avg = rep.orders.n ? Math.round(rep.orders.total / rep.orders.n) : 0;
  const maxQty = Math.max(1, ...rep.top_items.map(i => i.qty));
  $('#rbody', p).innerHTML = `
    <div class="stats">
      <div class="card stat"><span class="muted">Pedidos</span><b>${rep.orders.n}</b></div>
      <div class="card stat"><span class="muted">Total dos pedidos</span><b>${money(rep.orders.total)}</b></div>
      <div class="card stat"><span class="muted">Ticket médio por pedido</span><b>${money(avg)}</b></div>
      <div class="card stat"><span class="muted">Contas fechadas</span><b>${nClosed}</b><span class="muted tiny">${money(closed)} com taxa</span></div>
    </div>
    <div class="card">
      <h4>Recebido por forma de pagamento</h4>
      ${rep.by_payment.length ? `<table class="rtable"><tbody>
        ${rep.by_payment.map(x => `<tr><td>${esc(PAY_LABEL[x.payment_method] || x.payment_method || 'Não informado')}</td><td class="num">${x.n} conta${x.n > 1 ? 's' : ''}</td><td class="num"><b>${money(x.total || 0)}</b></td></tr>`).join('')}
        </tbody><tfoot><tr><td>Total</td><td class="num">${nClosed}</td><td class="num"><b>${money(closed)}</b></td></tr></tfoot></table>`
        : '<p class="muted">Nenhuma conta fechada neste dia.</p>'}
    </div>
    <div class="card">
      <h4>Mais vendidos</h4>
      ${rep.top_items.length ? `<ol class="top-list">${rep.top_items.map(i => `
        <li><div class="row"><span class="grow min0 ellipsis">${esc(i.name)}</span><b>${i.qty}×</b><span class="muted num">${money(i.total)}</span></div>
          <div class="bar"><span style="width:${Math.round(i.qty / maxQty * 100)}%"></span></div></li>`).join('')}</ol>`
        : '<p class="muted">Nenhum item vendido neste dia.</p>'}
    </div>`;
}
