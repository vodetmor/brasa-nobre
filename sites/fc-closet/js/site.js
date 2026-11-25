/* FC Closet · comportamento do site: vitrine, modal de produto, sacola e pedido no WhatsApp.
   Os dados vêm do banco (js/dados.js) e são editados no painel /admin. */
function iniciar(DADOS) {
  "use strict";
  const CFG = window.FC_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const LOJA = DADOS.loja || {}, PRODUTOS = DADOS.produtos, CATS = DADOS.categorias;
  const porId = Object.fromEntries(PRODUTOS.map(p => [p.id, p]));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const preco = v => (v > 0 ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Sob consulta");
  const foto = window.FC_FOTO;
  const srcGrade = f => `src="${foto(f, "m")}" srcset="${foto(f, "s")} 400w, ${foto(f, "m")} 720w" sizes="(max-width: 600px) 50vw, (max-width: 1100px) 33vw, 25vw"`;
  const srcCheia = f => `src="${foto(f, "l")}" srcset="${foto(f, "m")} 720w, ${foto(f, "l")} 1080w, ${foto(f)} 1600w" sizes="(max-width: 860px) 100vw, 55vw"`;
  const vazia = () => `<div class="joia-vazia"><span>Em breve</span></div>`;
  const slug = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");

  /* menu superior (categorias vêm do painel) */
  const menu = $("[data-menu]");
  if (menu) menu.innerHTML = [["novidades", "Novidades"], ...CATS.map(c => [c, c])]
    .map(([id, n]) => `<a href="loja.html?cat=${encodeURIComponent(id)}">${esc(n)}</a>`).join("") +
    `<a href="index.html#sobre">Nossa marca</a>`;

  /* textos e fotos da loja (editados no painel) */
  const poeFoto = (img, f, alt) => {
    if (!img) return; const fig = img.closest("figure");
    if (!f) { if (fig) fig.classList.add("sem-foto"); img.remove(); return; }
    img.sizes = "(max-width: 860px) 100vw, 50vw";
    img.srcset = `${foto(f, "m")} 720w, ${foto(f, "l")} 1080w`;
    img.src = foto(f, "l"); if (alt) img.alt = alt;
  };
  const poeTexto = (sel, t) => $$(sel).forEach(el => { if (t != null) { el.textContent = t; el.hidden = !t; } });
  poeTexto("[data-aviso]", LOJA.aviso);
  if (!LOJA.aviso) $$(".aviso-sep").forEach(el => { el.hidden = true; });
  poeTexto("[data-hero-sobre]", LOJA.hero_sobretitulo);
  poeTexto("[data-hero-titulo]", LOJA.hero_titulo);
  poeTexto("[data-sobre-texto]", LOJA.sobre_texto);
  poeFoto($("[data-hero-1]"), LOJA.hero_foto_1);
  poeFoto($("[data-hero-2]"), LOJA.hero_foto_2);
  poeFoto($("[data-sobre-foto]"), LOJA.sobre_foto);
  const instagram = LOJA.instagram != null ? LOJA.instagram : CFG.instagram;
  $$("a[data-insta]").forEach(a => { if (/^https:\/\//.test(instagram)) a.href = instagram; else a.hidden = true; });
  const arroba = (instagram.match(/instagram\.com\/([^/?#]+)/) || [])[1];
  poeTexto("[data-arroba]", arroba ? "@" + arroba : "Instagram");
  const instaGrade = $("[data-insta-grade]");
  if (instaGrade) {
    /* quatro fotos variadas das peças */
    const lista = [];
    for (let n = 1; n < 8 && lista.length < 4; n++) PRODUTOS.forEach(p => { const f = (p.fotos || [])[n % (p.fotos || [1]).length]; if (f && lista.length < 4 && !lista.some(x => x.f === f)) lista.push({ f, nome: p.nome }); });
    if (lista.length < 4 || !/^https:\/\//.test(instagram)) instaGrade.closest("section").hidden = true;
    else instaGrade.innerHTML = lista.map(x => `<a href="${esc(instagram)}" target="_blank" rel="noopener"><img ${srcGrade(x.f)} width="720" height="1040" alt="${esc(x.nome)}" loading="lazy" decoding="async"></a>`).join("");
  }

  /* WhatsApp */
  const numero = LOJA.whatsapp || CFG.whatsapp;
  const linkWhats = msg => `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
  $$("a[data-whats]").forEach(a => { a.href = linkWhats(a.dataset.whats); a.target = "_blank"; a.rel = "noopener"; });

  const toastEl = $("[data-toast]");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add("visivel");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("visivel"), 3200);
  }
  const abreWhats = msg => window.open(linkWhats(msg), "_blank", "noopener");

  /* menu mobile */
  const menuBtn = $("#menuBtn");
  menuBtn.addEventListener("click", () => {
    const a = menu.classList.toggle("aberto"); menuBtn.setAttribute("aria-expanded", a);
  });
  const ajustaTopo = () => document.documentElement.style.setProperty("--altura-topo", $("#topo").offsetHeight - 1 + "px");
  ajustaTopo(); addEventListener("resize", ajustaTopo);

  /* cartão de produto */
  function cartao(p) {
    const f = p.fotos || [];
    const midia = f.length ? `<img ${srcGrade(f[0])} alt="${esc(p.nome)}" loading="lazy" decoding="async">` + (f[1] ? `<img class="foto-2" ${srcGrade(f[1])} alt="" loading="lazy" decoding="async">` : "") : vazia();
    const selo = p.disponivel === false ? '<span class="selo esg">Esgotado</span>' : p.novidade ? '<span class="selo">Novo</span>' : "";
    return `<article class="produto${p.disponivel === false ? " esgotado" : ""}">
      <div class="produto-midia">
        <button class="produto-foto" data-abrir="${esc(p.id)}" aria-label="Ver ${esc(p.nome)}">${selo}${midia}</button>
        <button class="produto-add" data-abrir="${esc(p.id)}" aria-label="Escolher tamanho de ${esc(p.nome)}">Escolher</button>
      </div>
      <button class="produto-link" data-abrir="${esc(p.id)}" tabindex="-1"><span class="produto-nome">${esc(p.nome)}</span><span class="produto-preco">${preco(p.preco)}</span></button>
    </article>`;
  }

  /* categorias da home */
  const catBox = $("[data-categorias]");
  if (catBox) {
    const capa = c => { const p = PRODUTOS.find(x => x.categoria === c && x.fotos && x.fotos[0]); return p ? p.fotos[0] : null; };
    catBox.innerHTML = CATS.map(c => { const cp = capa(c); return `<a class="categoria" href="loja.html?cat=${encodeURIComponent(c)}"><div class="categoria-foto">${cp ? `<img ${srcGrade(cp)} alt="${esc(c)}" loading="lazy" decoding="async">` : vazia()}</div><span class="categoria-nome">${esc(c)}</span></a>`; }).join("");
    catBox.style.setProperty("--n", Math.min(Math.max(CATS.length, 2), 6));
  }
  $$('[data-grade="novidades"]').forEach(g => {
    const l = PRODUTOS.filter(p => p.novidade); const lim = +g.dataset.limite || 8;
    g.innerHTML = (l.length ? l : PRODUTOS).slice(0, lim).map(cartao).join("");
  });

  /* loja */
  const gradeLoja = $('[data-grade="todas"]');
  if (gradeLoja) {
    let cat = new URLSearchParams(location.search).get("cat") || "todas";
    if (cat !== "todas" && cat !== "novidades" && !CATS.includes(cat)) cat = "todas";
    let ordem = "padrao";
    const filtros = $("[data-filtros]"), qtd = $("[data-qtd]"), titulo = $("[data-loja-titulo]"), vazio = $("[data-vazio]");
    filtros.innerHTML = ["todas", "novidades", ...CATS].map(c => `<button class="filtro" data-cat="${esc(c)}" aria-pressed="false">${c === "todas" ? "Todas" : esc(c === "novidades" ? "Novidades" : c)}</button>`).join("");
    const desenha = () => {
      let l = cat === "todas" ? PRODUTOS.slice() : cat === "novidades" ? PRODUTOS.filter(p => p.novidade) : PRODUTOS.filter(p => p.categoria === cat);
      if (ordem === "az") l.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      if (ordem === "novidades") l.sort((a, b) => (b.novidade ? 1 : 0) - (a.novidade ? 1 : 0));
      if (ordem === "menor") l.sort((a, b) => a.preco - b.preco);
      if (ordem === "maior") l.sort((a, b) => b.preco - a.preco);
      gradeLoja.classList.remove("entrando"); gradeLoja.innerHTML = l.map(cartao).join(""); void gradeLoja.offsetWidth; gradeLoja.classList.add("entrando");
      vazio.hidden = l.length > 0;
      qtd.textContent = l.length === 1 ? "1 peça" : l.length ? `${l.length} peças` : "";
      titulo.textContent = cat === "todas" ? "Todas as peças" : cat === "novidades" ? "Novidades" : cat;
      document.title = `${titulo.textContent} · FC Closet`;
      $$(".filtro", filtros).forEach(b => b.setAttribute("aria-pressed", b.dataset.cat === cat));
      const at = $(`.filtro[aria-pressed="true"]`, filtros); if (at) filtros.scrollLeft = at.offsetLeft - (filtros.clientWidth - at.offsetWidth) / 2;
      $$("#menu a").forEach(a => { const m = a.getAttribute("href").match(/cat=([^&]+)/); if (m && decodeURIComponent(m[1]) === cat) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    };
    filtros.addEventListener("click", e => { const b = e.target.closest(".filtro"); if (!b) return; cat = b.dataset.cat; history.replaceState(null, "", "loja.html" + (cat === "todas" ? "" : "?cat=" + encodeURIComponent(cat))); desenha(); });
    $("[data-ordenar]").addEventListener("change", e => { ordem = e.target.value; desenha(); });
    $$("#menu a").forEach(a => { const m = a.getAttribute("href").match(/^loja\.html\?cat=([^&]+)/); if (!m) return; a.addEventListener("click", e => { e.preventDefault(); cat = decodeURIComponent(m[1]); history.replaceState(null, "", a.getAttribute("href")); desenha(); menu.classList.remove("aberto"); menuBtn.setAttribute("aria-expanded", "false"); scrollTo({ top: 0, behavior: "smooth" }); }); });
    desenha();
  }

  /* sacola */
  const CH = "fc-sacola-v1"; let sacola = [];
  try { sacola = JSON.parse(localStorage.getItem(CH)) || []; } catch (e) {}
  sacola = sacola.filter(i => porId[i.id] && porId[i.id].disponivel !== false);
  const salva = () => { try { localStorage.setItem(CH, JSON.stringify(sacola)); } catch (e) {} };
  const sacolaEl = $("#sacola"), itensEl = $("[data-sacola-itens]"), vaziaEl = $("[data-sacola-vazia]"), fimEl = $("[data-sacola-fim]");
  function conta(pulo) {
    const n = sacola.reduce((s, i) => s + i.qtd, 0);
    $$("[data-sacola-qtd]").forEach(el => { el.textContent = n; el.hidden = !n; if (pulo) { el.classList.remove("pulo"); void el.offsetWidth; el.classList.add("pulo"); } });
  }
  function desenhaSacola() {
    vaziaEl.hidden = sacola.length > 0; fimEl.hidden = !sacola.length;
    itensEl.innerHTML = sacola.map((i, x) => { const p = porId[i.id]; return `<li class="sacola-item">${p.fotos[0] ? `<img src="${foto(p.fotos[0], "s")}" alt="">` : vazia()}<div><p class="si-nome">${esc(p.nome)}</p><p class="si-det">${i.tam ? `Tamanho ${esc(i.tam)} · ` : ""}${preco(p.preco)}</p><div class="qtd"><button data-menos="${x}" aria-label="Diminuir">−</button><span>${i.qtd}</span><button data-mais="${x}" aria-label="Aumentar">+</button></div></div><button class="si-remover" data-remover="${x}">Remover</button></li>`; }).join("");
    const total = sacola.reduce((s, i) => s + i.qtd * (porId[i.id].preco || 0), 0);
    const t = $("[data-sacola-total]"); if (t) t.textContent = total ? preco(total) : "";
    conta();
  }
  let focoS = null;
  const abreSacola = () => { toastEl.classList.remove("visivel"); focoS = document.activeElement; desenhaSacola(); sacolaEl.hidden = false; document.body.style.overflow = "hidden"; $(".sacola-topo .fechar").focus(); };
  const fechaSacola = () => { sacolaEl.hidden = true; document.body.style.overflow = ""; if (focoS && document.contains(focoS)) focoS.focus(); };
  document.addEventListener("click", e => {
    if (e.target.closest("[data-abrir-sacola]")) abreSacola();
    if (e.target.closest("[data-fechar-sacola]")) fechaSacola();
    const mn = e.target.closest("[data-menos]"), ma = e.target.closest("[data-mais]"), rm = e.target.closest("[data-remover]");
    if (ma) sacola[+ma.dataset.mais].qtd++;
    if (mn) { const i = sacola[+mn.dataset.menos]; if (--i.qtd < 1) sacola.splice(+mn.dataset.menos, 1); }
    if (rm) sacola.splice(+rm.dataset.remover, 1);
    if (ma || mn || rm) { salva(); desenhaSacola(); }
  });
  $("[data-enviar-pedido]").addEventListener("click", () => {
    if (!sacola.length) return;
    const linhas = sacola.map(i => { const p = porId[i.id]; return `• ${i.qtd}x ${p.nome}${i.tam ? ` (tam. ${i.tam})` : ""}: ${preco(p.preco)}`; });
    abreWhats(`Olá, Fernanda! Montei minha sacola pelo site da FC Closet:\n\n${linhas.join("\n")}\n\nPode confirmar disponibilidade, valores e frete?`);
  });

  /* modal */
  const modal = $("#modalProduto"); let atual = null, tam = null, ultimo = null;
  function abreProduto(id) {
    const p = porId[id]; if (!p) return;
    atual = p; tam = null; ultimo = document.activeElement;
    $("[data-mp-fotos]", modal).innerHTML = p.fotos.length ? p.fotos.map((f, i) => `<img ${srcCheia(f)} alt="${esc(p.nome)}${i ? `, foto ${i + 1}` : ""}">`).join("") : vazia();
    $("[data-mp-cat]", modal).textContent = p.categoria;
    $("[data-mp-nome]", modal).textContent = p.nome;
    $("[data-mp-preco]", modal).textContent = preco(p.preco);
    $("[data-mp-desc]", modal).textContent = p.descricao || "";
    const box = $("[data-mp-tamanhos]", modal); box.hidden = !(p.tamanhos || []).length;
    $("[data-mp-lista]", modal).innerHTML = (p.tamanhos || []).map(t => `<button class="tamanho" data-tam="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("");
    $("[data-mp-erro]", modal).hidden = true;
    const add = $("[data-mp-add]", modal);
    add.disabled = p.disponivel === false; add.textContent = p.disponivel === false ? "Esgotado" : "Adicionar à sacola";
    const w = $("[data-mp-whats]", modal); w.dataset.whats = `Olá! Tenho interesse em "${p.nome}". Pode me passar mais detalhes?`; w.href = linkWhats(w.dataset.whats); w.target = "_blank";
    modal.hidden = false; document.body.style.overflow = "hidden"; $(".fechar", modal).focus();
  }
  const fechaProduto = () => { modal.hidden = true; document.body.style.overflow = ""; if (ultimo) ultimo.focus(); };
  document.addEventListener("click", e => {
    const ab = e.target.closest("[data-abrir]"); if (ab) { abreProduto(ab.dataset.abrir); return; }
    if (e.target.closest("[data-fechar]")) fechaProduto();
    const t = e.target.closest("[data-tam]");
    if (t) { tam = t.dataset.tam; $$("[data-tam]", modal).forEach(b => b.setAttribute("aria-pressed", b === t)); $("[data-mp-erro]", modal).hidden = true; }
  });
  $("[data-mp-add]", modal).addEventListener("click", () => {
    if (atual.disponivel === false) return;
    if ((atual.tamanhos || []).length && !tam) { $("[data-mp-erro]", modal).hidden = false; return; }
    const ex = sacola.find(i => i.id === atual.id && i.tam === tam);
    if (ex) ex.qtd++; else sacola.push({ id: atual.id, tam, qtd: 1 });
    salva(); conta(true); const nome = atual.nome; fechaProduto(); toast(`${nome} foi para a sacola`);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Tab") {
      const alvo = !modal.hidden ? $(".modal-caixa", modal) : !sacolaEl.hidden ? $(".sacola-painel", sacolaEl) : null; if (!alvo) return;
      const f = $$("button, a[href], select", alvo).filter(el => !el.closest("[hidden]") && !el.disabled); if (!f.length) return;
      if (!alvo.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); }
      else if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (e.key === "Escape") { if (!modal.hidden) fechaProduto(); else if (!sacolaEl.hidden) fechaSacola(); }
  });

  /* revelar ao rolar */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add("visto"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px" });
    $$(".categoria, .sobre-foto, .sobre-txt, .passo, .insta-grade a, [data-grade='novidades'] .produto").forEach((el, i) => { el.classList.add("revelar"); el.style.transitionDelay = (i % 4) * 80 + "ms"; io.observe(el); });
  }
  conta();
}

/* carrega a loja e monta a página */
window.FC_CARREGA().then(d => { iniciar(d); document.body.classList.add("pronto"); }).catch(() => {
  const C = window.FC_CONFIG;
  document.body.classList.add("pronto", "sem-loja");
  document.querySelectorAll("a[data-whats]").forEach(a => { a.href = `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(a.dataset.whats)}`; a.target = "_blank"; a.rel = "noopener"; });
  const aviso = document.createElement("div");
  aviso.className = "falha"; aviso.setAttribute("role", "alert");
  aviso.innerHTML = `<p>Não conseguimos carregar a loja agora.</p><button class="botao" type="button">Tentar de novo</button><a class="link-linha" target="_blank" rel="noopener" href="https://wa.me/${C.whatsapp}">Falar no WhatsApp</a>`;
  aviso.querySelector("button").addEventListener("click", () => location.reload());
  document.querySelector("main").prepend(aviso);
});
