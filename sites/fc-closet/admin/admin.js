/* Painel da loja · FC Closet. Tudo é gravado no Supabase; quem decide o que
   pode ser alterado são as regras do banco, não esta tela. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const CFG = window.FC_CONFIG;
  const TAMANHOS = ["PP", "P", "M", "G", "GG", "Único"];
  const SESSAO = "fc-sessao-v1";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const preco = v => (v > 0 ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Sob consulta");
  const fotoA = f => window.FC_FOTO(f, "s", "../");
  let toastT;
  const toast = m => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3200); };
  const erroEm = (sel, m) => { const el = $(sel); el.textContent = m || ""; el.hidden = !m; };

  /* ---------- conexão ---------- */
  class Falha extends Error { constructor(msg, status, codigo) { super(msg); this.status = status; this.codigo = codigo; } }
  let sessao = null;
  try { sessao = JSON.parse(localStorage.getItem(SESSAO)); } catch (e) {}
  const guarda = s => {
    sessao = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expira: Date.now() + (s.expires_in || 3600) * 1000, email: s.user && s.user.email } : null;
    try { sessao ? localStorage.setItem(SESSAO, JSON.stringify(sessao)) : localStorage.removeItem(SESSAO); } catch (e) {}
  };
  async function pede(caminho, { metodo = "GET", corpo, headers = {}, auth = true } = {}) {
    if (auth) await renova();
    const h = { apikey: CFG.chave, ...headers };
    if (auth && sessao) h.Authorization = "Bearer " + sessao.access_token;
    const binario = corpo instanceof Blob;
    if (corpo !== undefined && !binario) h["Content-Type"] = "application/json";
    let r;
    try { r = await fetch(CFG.url + caminho, { method: metodo, headers: h, body: corpo === undefined ? undefined : binario ? corpo : JSON.stringify(corpo), cache: "no-store" }); }
    catch (e) { throw new Falha("Sem conexão. Confira a internet e tente de novo.", 0); }
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
    if (!r.ok) {
      if (auth && r.status === 401) { sai("Sua sessão acabou. Entre de novo."); }
      throw new Falha((j && (j.msg || j.message || j.error_description || j.error)) || "Erro " + r.status, r.status, j && (j.error_code || j.code));
    }
    return j;
  }
  let renovando = null;
  async function renova() {
    if (!sessao) throw new Falha("Entre de novo.", 401);
    if (sessao.expira - Date.now() > 60000) return;
    renovando = renovando || pede("/auth/v1/token?grant_type=refresh_token", { metodo: "POST", corpo: { refresh_token: sessao.refresh_token }, auth: false })
      .then(guarda)
      .catch(e => { if (e.status === 400 || e.status === 401 || e.status === 403) { sai("Sua sessão acabou. Entre de novo."); } throw e; })
      .finally(() => { renovando = null; });
    await renovando;
  }
  const db = (tabela, metodo, corpo) => pede("/rest/v1/" + tabela, { metodo, corpo, headers: { Prefer: "return=representation" } });
  /* grava e confere que o banco realmente aceitou */
  async function grava(tabela, metodo, corpo) {
    const r = await db(tabela, metodo, corpo);
    if (!r || !r.length) throw new Falha("A alteração não foi aceita. Atualize a página e tente de novo.", 403);
    return r;
  }
  const explica = e => e.codigo === "23505" ? "Já existe uma categoria com esse nome." : e.codigo === "23503" ? "Essa categoria ainda tem peças." : e.message;

  /* ---------- entrar e sair ---------- */
  function telaEntrar(msg) { $("#painel").hidden = true; $("#folha").hidden = true; $("#escolha").hidden = true; document.body.style.overflow = ""; $("#telaEntrar").hidden = false; erroEm("#erroEntrar", msg); }
  function sai(msg) { guarda(null); telaEntrar(msg); }
  async function abrePainel() {
    if (await pede("/rest/v1/rpc/e_admin", { metodo: "POST", corpo: {} }) !== true) return sai("Esta conta não tem permissão para editar a loja.");
    await carrega();
    $("#telaEntrar").hidden = true; $("#painel").hidden = false;
    $("#contaEmail").textContent = sessao.email ? "Conta: " + sessao.email : "";
  }
  $("#formEntrar").addEventListener("submit", async e => {
    e.preventDefault(); const b = $("button[type=submit]", e.target); b.disabled = true; erroEm("#erroEntrar");
    try {
      guarda(await pede("/auth/v1/token?grant_type=password", { metodo: "POST", auth: false, corpo: { email: $("#email").value.trim(), password: $("#senha").value } }));
      $("#senha").value = "";
      await abrePainel();
    } catch (x) { erroEm("#erroEntrar", x.status === 400 ? "E-mail ou senha incorretos." : x.status === 429 ? "Muitas tentativas. Espere um pouco e tente de novo." : x.message); }
    b.disabled = false;
  });
  $("#sair").addEventListener("click", async () => { try { await pede("/auth/v1/logout?scope=local", { metodo: "POST" }); } catch (e) {} sai(); });
  $("#formSenha").addEventListener("submit", async e => {
    e.preventDefault(); erroEm("#erroSenha");
    const a = $("#senha1").value;
    if (a.length < 8) return erroEm("#erroSenha", "Use pelo menos 8 caracteres.");
    if (a !== $("#senha2").value) return erroEm("#erroSenha", "As duas senhas estão diferentes.");
    try { await pede("/auth/v1/user", { metodo: "PUT", corpo: { password: a } }); e.target.reset(); toast("Senha trocada"); }
    catch (x) { erroEm("#erroSenha", x.codigo === "same_password" ? "A nova senha precisa ser diferente da atual." : x.codigo === "weak_password" ? "Senha fraca. Misture letras e números." : x.message); }
  });

  /* ---------- dados ---------- */
  let produtos = [], cats = [], loja = {};
  async function carrega() {
    const [p, c, l] = await Promise.all([
      pede("/rest/v1/produtos?select=*&order=ordem,criado_em.desc"),
      pede("/rest/v1/categorias?select=*&order=ordem,nome"),
      pede("/rest/v1/loja?select=*&id=eq.1")
    ]);
    produtos = p; cats = c; loja = l[0] || {};
    desenha(); desenhaCats(); preencheLoja();
  }
  /* executa uma ação, avisa o resultado e recarrega o que está no banco */
  let ocupado = false;
  async function faz(acao, ok) {
    if (ocupado) return false; ocupado = true; document.body.classList.add("ocupado");
    let certo = false;
    try { await acao(); certo = true; if (ok) toast(ok); } catch (e) { toast(explica(e)); }
    try { if (sessao) { const [p, c] = await Promise.all([pede("/rest/v1/produtos?select=*&order=ordem,criado_em.desc"), pede("/rest/v1/categorias?select=*&order=ordem,nome")]); produtos = p; cats = c; desenha(); desenhaCats(); } } catch (e) {}
    ocupado = false; document.body.classList.remove("ocupado"); return certo;
  }
  /* troca de posição e renumera */
  async function move(lista, i, passo, caminho) {
    const j = i + passo; if (j < 0 || j >= lista.length) return;
    const nova = lista.slice(); [nova[i], nova[j]] = [nova[j], nova[i]];
    const mudar = nova.map((x, n) => [x, n + 1]).filter(([x, o]) => x.ordem !== o);
    /* grava em pequenos grupos: bem mais rápido quando há muitas peças */
    for (let n = 0; n < mudar.length; n += 6) await Promise.all(mudar.slice(n, n + 6).map(([x, o]) => grava(caminho(x), "PATCH", { ordem: o })));
  }
  function confirma(b) {
    if (b.dataset.sure) return true;
    const antes = b.textContent; b.dataset.sure = "1"; b.textContent = "Toque de novo para confirmar";
    setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = antes; } }, 3500);
    return false;
  }

  /* ---------- abas ---------- */
  $(".abas").addEventListener("click", e => {
    const b = e.target.closest("[data-aba]"); if (!b) return;
    $$("[data-aba]").forEach(x => x.setAttribute("aria-pressed", x === b));
    $$("[data-tela]").forEach(t => { t.hidden = t.dataset.tela !== b.dataset.aba; });
    scrollTo(0, 0);
  });

  /* ---------- lista de peças ---------- */
  function desenha() {
    $("#nTotal").textContent = produtos.length;
    $("#nOn").textContent = produtos.filter(p => p.disponivel && p.visivel).length;
    $("#nOff").textContent = produtos.filter(p => !p.disponivel).length;
    $("#vazio").hidden = produtos.length > 0;
    $("#lista").innerHTML = produtos.map((p, i) => `<li class="item${!p.disponivel || !p.visivel ? " off" : ""}" data-id="${esc(p.id)}">
      ${p.fotos[0] ? `<img src="${esc(fotoA(p.fotos[0]))}" alt="" loading="lazy">` : '<span class="sem">Sem foto</span>'}
      <div><h3>${esc(p.nome)}</h3>
        <p class="meta">${preco(p.preco)} · ${esc([p.categoria, ...(p.outras_cores || []).map(x => x.cor)].join(", "))}${p.tamanhos.length ? " · " + esc(p.tamanhos.join(", ")) : ""}${p.modelo ? " · modelo " + esc(p.modelo) : ""}</p>
        <span class="etq ${p.disponivel ? "ok" : "no"}">${p.disponivel ? "À venda" : "Esgotado"}</span>${p.novidade ? '<span class="etq">Novidade</span>' : ""}${p.visivel ? "" : '<span class="etq no">Escondida</span>'}</div>
      <div class="item-acoes">
        <button class="btn-p" data-a="editar">Editar</button>
        <button class="btn-p" data-a="cor">+ Outra cor</button>
        <button class="btn-p" data-a="disp">${p.disponivel ? "Marcar esgotado" : "Voltar a vender"}</button>
        <button class="btn-p" data-a="ver">${p.visivel ? "Esconder" : "Mostrar no site"}</button>
        <button class="btn-p" data-a="sobe" aria-label="Subir ${esc(p.nome)}"${i === 0 ? " disabled" : ""}>↑</button>
        <button class="btn-p" data-a="desce" aria-label="Descer ${esc(p.nome)}"${i === produtos.length - 1 ? " disabled" : ""}>↓</button>
        <button class="btn-p perigo" data-a="remover">Remover</button>
      </div></li>`).join("");
  }
  $("#lista").addEventListener("click", e => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const id = b.closest(".item").dataset.id, i = produtos.findIndex(x => x.id === id), p = produtos[i];
    if (!p) return;
    const url = x => "produtos?id=eq." + x.id, a = b.dataset.a;
    if (a === "editar") abre(p);
    if (a === "cor") abre(null, p);
    if (a === "disp") faz(() => grava(url(p), "PATCH", { disponivel: !p.disponivel }), p.disponivel ? "Peça marcada como esgotada" : "Peça voltou para a venda");
    if (a === "ver") faz(() => grava(url(p), "PATCH", { visivel: !p.visivel }), p.visivel ? "Peça escondida do site" : "Peça aparecendo no site");
    if (a === "sobe" || a === "desce") faz(() => move(produtos, i, a === "sobe" ? -1 : 1, url));
    if (a === "remover" && confirma(b)) faz(async () => { await grava(url(p), "DELETE"); await limpaFotos(p.fotos); }, "Peça removida do site");
  });

  /* ---------- fotos ---------- */
  const abreImagem = file => new Promise((ok, falha) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Falha("Não consegui abrir uma das fotos. Tente em JPG.")); };
    img.src = url;
  });
  const tela = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; return [c, x]; };
  /* reduz em etapas (metade por vez) para não perder nitidez */
  function reduz(img, largMax, altMax) {
    const k = Math.min(1, largMax / img.width, altMax / img.height), w = Math.round(img.width * k), h = Math.round(img.height * k);
    let fonte = img, fw = img.width, fh = img.height;
    while (fw / 2 >= w && fh / 2 >= h) { const [c, x] = tela(Math.round(fw / 2), Math.round(fh / 2)); x.drawImage(fonte, 0, 0, c.width, c.height); fonte = c; fw = c.width; fh = c.height; }
    const [c, x] = tela(w, h); x.drawImage(fonte, 0, 0, w, h); return c;
  }
  const exporta = (c, tipo, q) => new Promise((ok, falha) => c.toBlob(b => b ? ok(b) : falha(new Falha("Não consegui preparar a foto.")), tipo, q));
  const VERSOES = [["", 1600, 2400, .92], ["-l", 1080, 1800, .9], ["-m", 720, 1200, .86], ["-s", 400, 700, .84]];
  const arquivos = (ref) => { const [id, ext] = ref.slice(3).split("."); return VERSOES.map(v => `${id}${v[0]}.${ext}`); };
  const apaga = nomes => pede("/storage/v1/object/fotos", { metodo: "DELETE", corpo: { prefixes: nomes } });
  async function envia(file) {
    const img = await abreImagem(file);
    const id = crypto.randomUUID(); let tipo = "image/webp", ext = "webp"; const feitos = [];
    try {
      for (const [suf, w, h, q] of VERSOES) {
        const c = reduz(img, w, h);
        let blob = await exporta(c, tipo, q);
        if (blob.type !== tipo) { tipo = "image/jpeg"; ext = "jpg"; blob = await exporta(c, tipo, q); } /* iPhone sem WebP */
        const nome = `${id}${suf}.${ext}`;
        await pede("/storage/v1/object/fotos/" + nome, { metodo: "POST", corpo: blob, headers: { "Content-Type": tipo, "cache-control": "max-age=31536000" } });
        feitos.push(nome);
      }
    } catch (e) { if (feitos.length) await apaga(feitos).catch(() => {}); throw e; }
    return `sb:${id}.${ext}`;
  }
  /* apaga do armazenamento só as fotos que ninguém mais usa */
  async function limpaFotos(refs) {
    try {
      const [p, l] = await Promise.all([pede("/rest/v1/produtos?select=fotos"), pede("/rest/v1/loja?select=hero_foto_1,hero_foto_2,sobre_foto&id=eq.1")]);
      const usadas = new Set([...p.flatMap(x => x.fotos), ...Object.values(l[0] || {})]);
      const nomes = refs.filter(r => r && r.startsWith("sb:") && !usadas.has(r)).flatMap(arquivos);
      if (nomes.length) await apaga(nomes);
    } catch (e) { /* sobra um arquivo sem uso; não atrapalha a loja */ }
  }

  /* ---------- formulário da peça ---------- */
  const folha = $("#folha"), selCat = $("#fCat");
  let editando = null, fotos = [], tams = new Set(), salvando = false;
  /* "+ Outra cor": peça de origem e se o nome ainda é o sugerido */
  let origem = null, nomeLivre = false;
  const semCor = p => { const cor = p.categoria.toLowerCase(), limpo = p.nome.split(/\s+/).filter(x => x.toLowerCase() !== cor).join(" "); return limpo || p.nome; };
  function sugereNome() {
    if (!origem || !nomeLivre) return;
    const cor = selCat.value === "__nova" ? $("#fNovaCat").value.trim() : selCat.value;
    $("#fNome").value = `${semCor(origem)} ${cor}`.trim().slice(0, 60);
  }
  $("#fNome").addEventListener("input", () => { nomeLivre = false; });
  $("#fNovaCat").addEventListener("input", sugereNome);
  function opcoesCat(sel) {
    selCat.innerHTML = cats.map(c => `<option value="${esc(c.nome)}"${c.nome === sel ? " selected" : ""}>${esc(c.nome)}</option>`).join("") + '<option value="__nova">+ Nova categoria…</option>';
    $("#campoNovaCat").hidden = selCat.value !== "__nova";
  }
  selCat.addEventListener("change", () => { $("#campoNovaCat").hidden = selCat.value !== "__nova"; if (selCat.value === "__nova") $("#fNovaCat").focus(); sugereNome(); desenhaCores(); });
  function chipsTam() {
    const todos = [...TAMANHOS, ...[...tams].filter(t => !TAMANHOS.includes(t))];
    $("#fTam").innerHTML = todos.map(t => `<button type="button" class="chip" data-t="${esc(t)}" aria-pressed="${tams.has(t)}">${esc(t)}</button>`).join("");
  }
  $("#fTam").addEventListener("click", e => { const b = e.target.closest("[data-t]"); if (!b) return; tams.has(b.dataset.t) ? tams.delete(b.dataset.t) : tams.add(b.dataset.t); chipsTam(); });
  const incluiTam = () => { const t = $("#fOutroTam").value.trim(); if (t) { tams.add(TAMANHOS.find(x => x.toLowerCase() === t.toLowerCase()) || t); $("#fOutroTam").value = ""; chipsTam(); } };
  $("#addTam").addEventListener("click", incluiTam);
  $("#fOutroTam").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); incluiTam(); } });
  /* outras cores do mesmo vestido: cor marcada -> foto (o próprio item de "fotos") */
  let extras = new Map();
  function desenhaCores() {
    const principal = selCat.value, opcoes = cats.map(c => c.nome).filter(n => n !== principal);
    $("#fCores").innerHTML = opcoes.map(n => `<button type="button" class="chip" data-cor="${esc(n)}" aria-pressed="${extras.has(n)}">${esc(n)}</button>`).join("");
    $("#fCoresFotos").innerHTML = opcoes.filter(n => extras.has(n)).map(n => `<div class="cor-foto"><p>Toque na foto da cor <b>${esc(n)}</b></p>${fotos.length ? `<div>${fotos.map((f, i) => `<button type="button" data-cor="${esc(n)}" data-i="${i}" aria-pressed="${extras.get(n) === f}" aria-label="Foto ${i + 1} para ${esc(n)}"><img src="${esc(f.ref ? fotoA(f.ref) : f.url)}" alt=""></button>`).join("")}</div>` : '<p class="ajuda">Adicione as fotos primeiro.</p>'}</div>`).join("");
  }
  $("#fCores").addEventListener("click", e => { const b = e.target.closest("[data-cor]"); if (!b) return; const n = b.dataset.cor; extras.has(n) ? extras.delete(n) : extras.set(n, null); desenhaCores(); });
  $("#fCoresFotos").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (!b) return; extras.set(b.dataset.cor, fotos[+b.dataset.i]); desenhaCores(); });
  function miniaturas() {
    $("#fotos").innerHTML = fotos.map((f, i) => `<figure class="foto-t"><div><img src="${esc(f.ref ? fotoA(f.ref) : f.url)}" alt="Foto ${i + 1}">${i === 0 ? '<span class="capa">Capa</span>' : ""}<button type="button" class="tira" data-f="tira" data-i="${i}" aria-label="Remover foto ${i + 1}">×</button></div>
      <figcaption><button type="button" data-f="antes" data-i="${i}" aria-label="Mover foto ${i + 1} para antes"${i === 0 ? " disabled" : ""}>‹</button><button type="button" data-f="capa" data-i="${i}"${i === 0 ? " disabled" : ""}>Capa</button><button type="button" data-f="depois" data-i="${i}" aria-label="Mover foto ${i + 1} para depois"${i === fotos.length - 1 ? " disabled" : ""}>›</button></figcaption></figure>`).join("");
    desenhaCores();
  }
  $("#fotos").addEventListener("click", e => {
    const b = e.target.closest("[data-f]"); if (!b || salvando) return; const i = +b.dataset.i, a = b.dataset.f;
    if (a === "tira") { const [f] = fotos.splice(i, 1); if (f.url) URL.revokeObjectURL(f.url); }
    if (a === "capa") fotos.unshift(...fotos.splice(i, 1));
    if (a === "antes" || a === "depois") { const j = i + (a === "antes" ? -1 : 1); [fotos[i], fotos[j]] = [fotos[j], fotos[i]]; }
    miniaturas();
  });
  $("#addFoto").addEventListener("click", () => $("#arquivo").click());
  $("#arquivo").addEventListener("change", e => {
    for (const file of e.target.files) fotos.push({ file, url: URL.createObjectURL(file) });
    e.target.value = ""; miniaturas();
  });

  function abre(p, base) {
    editando = p || null; origem = base || null; nomeLivre = !!base;
    $("#folhaT").textContent = p ? "Editar peça" : base ? "Outra cor" : "Nova peça";
    $("#ajudaCor").hidden = !base;
    fotos = p ? p.fotos.map(ref => ({ ref })) : []; tams = new Set(p ? p.tamanhos : []);
    $("#fNome").value = p ? p.nome : ""; $("#fPreco").value = p && p.preco > 0 ? Number(p.preco).toFixed(2).replace(".", ",") : "";
    $("#fDesc").value = p ? p.descricao : ""; $("#fDetalhes").value = p ? p.detalhes || "" : ""; $("#fOutroTam").value = "";
    $("#fNovo").checked = p ? p.novidade : true; $("#fDisp").checked = p ? p.disponivel : true; $("#fVisivel").checked = p ? p.visivel : true;
    opcoesCat(p ? p.categoria : cats[0] && cats[0].nome); $("#fNovaCat").value = "";
    $("#fModelo").value = p ? p.modelo || "" : "";
    $("#listaModelos").innerHTML = [...new Set(produtos.map(x => x.modelo).filter(Boolean))].map(m => `<option value="${esc(m)}"></option>`).join("");
    if (base) {
      tams = new Set(base.tamanhos);
      $("#fPreco").value = base.preco > 0 ? Number(base.preco).toFixed(2).replace(".", ",") : "";
      $("#fDesc").value = base.descricao; $("#fDetalhes").value = base.detalhes || "";
      $("#fModelo").value = base.modelo || semCor(base).slice(0, 40);
      selCat.insertAdjacentHTML("afterbegin", '<option value="" disabled>Escolha a cor…</option>'); selCat.value = ""; $("#campoNovaCat").hidden = true;
      sugereNome();
    }
    extras = new Map((p && p.outras_cores || []).map(x => [x.cor, fotos.find(f => f.ref === x.foto) || null]));
    erroEm("#erroForm"); chipsTam(); miniaturas();
    folha.hidden = false; document.body.style.overflow = "hidden"; $(".folha-caixa", folha).scrollTop = 0;
  }
  const fecha = () => { if (salvando) return; fotos.forEach(f => f.url && URL.revokeObjectURL(f.url)); folha.hidden = true; document.body.style.overflow = ""; };
  $("#novo").addEventListener("click", () => abre(null));
  folha.addEventListener("click", e => { if (e.target.closest("[data-fechar]")) fecha(); });

  /* "289,90", "1.289,90" e "289.90" */
  function lePreco(t) {
    t = t.replace(/[R$\s]/g, ""); if (!t) return 0;
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
  }
  $("#form").addEventListener("submit", async e => {
    e.preventDefault(); if (salvando) return;
    const erro = m => erroEm("#erroForm", m); erro();
    const nome = $("#fNome").value.trim(); if (!nome) return erro("Escreva o nome da peça.");
    if (!fotos.length) return erro("Adicione pelo menos uma foto.");
    const valor = lePreco($("#fPreco").value); if (Number.isNaN(valor)) return erro("Confira o preço. Exemplo: 289,90");
    let cat = selCat.value, criaCat = false;
    if (!cat) return erro("Escolha a categoria da cor nova.");
    const modelo = $("#fModelo").value.trim();
    if (origem && !modelo) return erro("Escreva o nome do modelo para juntar as cores.");
    if (cat === "__nova") {
      cat = $("#fNovaCat").value.trim(); if (!cat) return erro("Escreva o nome da nova categoria.");
      const ja = cats.find(c => c.nome.toLowerCase() === cat.toLowerCase()); if (ja) cat = ja.nome; else criaCat = true;
    }
    const outras = [...extras].filter(([n]) => n !== cat && cats.some(c => c.nome === n));
    const semFoto = outras.find(([, f]) => !fotos.includes(f));
    if (semFoto) return erro(`Toque na foto da cor ${semFoto[0]}.`);
    incluiTam();
    const botao = $("#salvar"), era = editando, antigas = era ? era.fotos : [], enviadas = [];
    salvando = true; botao.disabled = true;
    try {
      const novas = fotos.filter(f => !f.ref).length; let n = 0;
      for (const f of fotos) if (!f.ref) { botao.textContent = `Enviando foto ${++n} de ${novas}…`; f.ref = await envia(f.file); enviadas.push(f); }
      botao.textContent = "Salvando…";
      if (criaCat) { await grava("categorias", "POST", { nome: cat, ordem: cats.length + 1 }); cats.push({ nome: cat, ordem: cats.length + 1 }); opcoesCat(cat); }
      const dados = { nome, modelo, categoria: cat, outras_cores: outras.map(([cor, f]) => ({ cor, foto: f.ref })), preco: valor, fotos: fotos.map(f => f.ref), tamanhos: [...TAMANHOS.filter(t => tams.has(t)), ...[...tams].filter(t => !TAMANHOS.includes(t))], descricao: $("#fDesc").value.trim(), detalhes: $("#fDetalhes").value.trim(), novidade: $("#fNovo").checked, disponivel: $("#fDisp").checked, visivel: $("#fVisivel").checked };
      await grava(era ? "produtos?id=eq." + era.id : "produtos", era ? "PATCH" : "POST", dados);
      const de = origem; salvando = false; fecha();
      if (de && (de.modelo || "") !== modelo) {
        try { await grava("produtos?id=eq." + de.id, "PATCH", { modelo }); }
        catch (x) { toast(`Cor salva. Falta escrever o modelo "${modelo}" na peça ${de.nome}.`); }
      }
      await limpaFotos(antigas);
      await faz(async () => {}, era ? "Peça atualizada no site" : "Peça adicionada ao site");
    } catch (x) {
      /* nada foi salvo: desfaz os envios para tentar de novo do zero */
      const refs = enviadas.map(f => f.ref); enviadas.forEach(f => delete f.ref);
      if (sessao) await limpaFotos(refs);
      erro(explica(x));
    }
    salvando = false; botao.disabled = false; botao.textContent = "Salvar peça";
  });

  /* ---------- categorias ---------- */
  function desenhaCats() {
    $("#listaCat").innerHTML = cats.map((c, i) => { const n = produtos.filter(p => p.categoria === c.nome).length, tambem = produtos.filter(p => (p.outras_cores || []).some(x => x.cor === c.nome)).length; return `<li class="cat" data-i="${i}">
      <div class="linha"><input value="${esc(c.nome)}" maxlength="24" aria-label="Nome da categoria"><button class="btn-p" data-c="renomear">Salvar nome</button></div>
      <p class="meta">${n + tambem === 1 ? "1 peça" : n + tambem + " peças"}</p>
      <div class="item-acoes"><button class="btn-p" data-c="sobe" aria-label="Subir"${i === 0 ? " disabled" : ""}>↑</button><button class="btn-p" data-c="desce" aria-label="Descer"${i === cats.length - 1 ? " disabled" : ""}>↓</button><button class="btn-p perigo" data-c="apagar"${n ? " disabled" : ""}>${n ? "Mova as peças para apagar" : "Apagar"}</button></div></li>`; }).join("");
  }
  const urlCat = c => "categorias?nome=eq." + encodeURIComponent(c.nome);
  $("#listaCat").addEventListener("click", e => {
    const b = e.target.closest("[data-c]"); if (!b) return; const li = b.closest(".cat"), i = +li.dataset.i, c = cats[i], a = b.dataset.c;
    if (a === "renomear") { const nome = $("input", li).value.trim(); if (!nome) return toast("Escreva um nome."); if (nome !== c.nome) faz(() => grava(urlCat(c), "PATCH", { nome }), "Categoria renomeada"); }
    if (a === "sobe" || a === "desce") faz(() => move(cats, i, a === "sobe" ? -1 : 1, urlCat));
    if (a === "apagar" && confirma(b)) faz(() => grava(urlCat(c), "DELETE"), "Categoria apagada");
  });
  $("#formCat").addEventListener("submit", async e => {
    e.preventDefault(); const nome = $("#catNova").value.trim(); if (!nome) return;
    if (cats.some(c => c.nome.toLowerCase() === nome.toLowerCase())) return toast("Já existe uma categoria com esse nome.");
    if (await faz(() => grava("categorias", "POST", { nome, ordem: Math.max(0, ...cats.map(c => c.ordem)) + 1 }), "Categoria criada")) e.target.reset();
  });

  /* ---------- dados da loja ---------- */
  const CAMPOS = { lWhats: "whatsapp", lInsta: "instagram", lAviso: "aviso", lSobretitulo: "hero_sobretitulo", lTitulo: "hero_titulo", lSobre: "sobre_texto", lParcelas: "parcelas", lPagamento: "pagamento", lEntrega: "entrega", lTrocas: "trocas", lMedidas: "guia_medidas" };
  let alvoFoto = null;
  function preencheLoja() {
    for (const [id, c] of Object.entries(CAMPOS)) $("#" + id).value = loja[c] || "";
    if (loja.whatsapp) $("#lWhats").value = "+" + loja.whatsapp;
    $$("[data-foto]").forEach(desenhaFotoLoja);
  }
  function desenhaFotoLoja(el) {
    const f = loja[el.dataset.foto];
    el.innerHTML = `${f ? `<img src="${esc(fotoA(f))}" alt="">` : '<span class="sem">Sem foto</span>'}<div><button type="button" class="btn-p" data-l="enviar">Enviar do celular</button><button type="button" class="btn-p" data-l="escolher">Usar foto de uma peça</button></div>`;
  }
  /* cada troca de foto é salva na hora, sem mexer nos textos que estão sendo digitados */
  async function trocaFoto(campo, obtem) {
    if (ocupado) return; const antiga = loja[campo], el = $(`[data-foto="${campo}"]`);
    el.classList.add("enviando"); let nova = null;
    await faz(async () => {
      nova = await obtem();
      try { loja[campo] = (await grava("loja?id=eq.1", "PATCH", { [campo]: nova }))[0][campo]; }
      catch (e) { await limpaFotos([nova]); throw e; }
      await limpaFotos([antiga]);
    }, "Foto atualizada no site");
    el.classList.remove("enviando"); desenhaFotoLoja(el);
  }
  $("#formLoja").addEventListener("click", e => {
    const b = e.target.closest("[data-l]"); if (!b) return; alvoFoto = b.closest("[data-foto]").dataset.foto;
    if (b.dataset.l === "enviar") $("#arquivoLoja").click();
    else {
      const todas = [...new Set(produtos.flatMap(p => p.fotos))];
      if (!todas.length) return toast("Ainda não há fotos de peças.");
      $("#gradeEscolha").innerHTML = todas.map(f => `<button type="button" data-ref="${esc(f)}"><img src="${esc(fotoA(f))}" alt="" loading="lazy"></button>`).join("");
      $("#escolha").hidden = false; document.body.style.overflow = "hidden";
    }
  });
  const fechaEscolha = () => { $("#escolha").hidden = true; document.body.style.overflow = ""; };
  $("#escolha").addEventListener("click", e => {
    const r = e.target.closest("[data-ref]");
    if (r) { fechaEscolha(); trocaFoto(alvoFoto, async () => r.dataset.ref); }
    else if (e.target.closest("[data-fechar-escolha]")) fechaEscolha();
  });
  $("#arquivoLoja").addEventListener("change", e => {
    const f = e.target.files[0]; e.target.value = "";
    if (f) { toast("Enviando foto…"); trocaFoto(alvoFoto, () => envia(f)); }
  });
  $("#formLoja").addEventListener("submit", async e => {
    e.preventDefault(); erroEm("#erroLoja");
    const d = {}; for (const [id, c] of Object.entries(CAMPOS)) d[c] = $("#" + id).value.trim();
    d.whatsapp = d.whatsapp.replace(/\D/g, "");
    d.parcelas = Number(d.parcelas) || 0;
    if (d.whatsapp.length === 10 || d.whatsapp.length === 11) d.whatsapp = "55" + d.whatsapp;
    if (d.whatsapp.length < 12 || d.whatsapp.length > 13) return erroEm("#erroLoja", "Confira o WhatsApp: DDD e número. Ex.: 61 99999-9999");
    if (d.instagram && !/^https:\/\//.test(d.instagram)) return erroEm("#erroLoja", "O link do Instagram precisa começar com https://");
    if (!d.hero_titulo) return erroEm("#erroLoja", "Escreva o título do destaque.");
    const b = $("button[type=submit]", e.target); b.disabled = true;
    await faz(async () => { loja = (await grava("loja?id=eq.1", "PATCH", d))[0]; preencheLoja(); }, "Loja atualizada");
    b.disabled = false;
  });

  document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if (!$("#escolha").hidden) fechaEscolha(); else if (!folha.hidden) fecha(); });

  /* ---------- início ---------- */
  if (!sessao) telaEntrar();
  else abrePainel().catch(e => telaEntrar(e.status === 401 ? "Sua sessão acabou. Entre de novo." : e.message));
})();
