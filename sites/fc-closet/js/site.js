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
  const fechaMenu = () => { menu.classList.remove("aberto"); menuBtn.setAttribute("aria-expanded", "false"); };
  document.addEventListener("click", e => { if (menu.classList.contains("aberto") && (e.target.closest("#menu a") || !e.target.closest("#menu, #menuBtn"))) fechaMenu(); });
  const ajustaTopo = () => document.documentElement.style.setProperty("--altura-topo", $("#topo").offsetHeight - 1 + "px");
  ajustaTopo(); addEventListener("resize", ajustaTopo);

  /* favoritos: ficam guardados no aparelho da cliente */
  const CHF = "fc-fav-v1"; let favs = new Set();
  try { favs = new Set(JSON.parse(localStorage.getItem(CHF)) || []); } catch (e) {}
  favs = new Set([...favs].filter(id => porId[id]));
  const coracao = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/></svg>';
  let aoFavoritar = () => {};
  function favorita(id) {
    const tinha = favs.delete(id); if (!tinha) favs.add(id);
    try { localStorage.setItem(CHF, JSON.stringify([...favs])); } catch (e) {}
    $$("[data-fav]").forEach(b => { if (b.dataset.fav === id) b.setAttribute("aria-pressed", !tinha); });
    aoFavoritar();
  }

  const chaveModelo = p => (p.modelo || "").trim().toLocaleLowerCase("pt-BR");

  /* um vestido pode vir em várias cores: a principal (categoria) e as outras marcadas no painel, cada uma com sua foto */
  const coresDe = p => [{ cor: p.categoria, foto: (p.fotos || [])[0] }, ...(Array.isArray(p.outras_cores) ? p.outras_cores : [])
    .filter((x, i, l) => x && x.cor !== p.categoria && CATS.includes(x.cor) && l.findIndex(y => y && y.cor === x.cor) === i)
    .map(x => ({ cor: x.cor, foto: (p.fotos || []).includes(x.foto) ? x.foto : (p.fotos || [])[0] }))];
  const daCor = (p, c) => coresDe(p).find(x => x.cor === c);
  const fotoDa = (p, c) => (daCor(p, c) || coresDe(p)[0]).foto;
  /* esgotado: a peça inteira (disponivel) ou só algumas cores (cores_esgotadas). Sem cor, só conta se todas acabaram */
  const corFora = (p, c) => Array.isArray(p.cores_esgotadas) && p.cores_esgotadas.includes(c);
  const esgotada = (p, c) => p.disponivel === false || (daCor(p, c) ? corFora(p, c) : coresDe(p).every(x => corFora(p, x.cor)));
  /* fotos de vitrine: se a cor principal acabou, mostra primeiro uma cor que ainda tem */
  const vitrine = p => { const livre = corFora(p, p.categoria) && coresDe(p).find(x => !corFora(p, x.cor)); return livre && livre.foto ? [livre.foto] : p.fotos || []; };
  const selo = (p, c) => esgotada(p, c) ? '<span class="selo esg">Esgotado</span>' : p.novidade ? '<span class="selo">Novo</span>' : "";

  /* peças com o mesmo nome (um cadastro por cor): o pedido precisa dizer a cor */
  const nomeIgual = p => PRODUTOS.some(x => x.id !== p.id && x.nome.trim().toLocaleLowerCase("pt-BR") === p.nome.trim().toLocaleLowerCase("pt-BR"));
  const corDe = (p, c) => c || (coresDe(p).length === 1 && nomeIgual(p) ? p.categoria : null);

  const temMouse = matchMedia("(hover: hover)").matches;

  /* cartão de produto: no filtro de uma cor, mostra a foto daquela cor */
  function cartao(p, cor) {
    const varias = coresDe(p).length > 1, naCor = varias && daCor(p, cor);
    const f = naCor ? [naCor.foto].filter(Boolean) : vitrine(p);
    const midia = f.length ? `<img ${srcGrade(f[0])} alt="${esc(p.nome)}" loading="lazy" decoding="async">` + (f[1] && temMouse ? `<img class="foto-2" ${srcGrade(f[1])} alt="" loading="lazy" decoding="async">` : "") : vazia();
    const dc = naCor ? ` data-cor="${esc(cor)}"` : "";
    return `<article class="produto${esgotada(p, cor) ? " esgotado" : ""}">
      <div class="produto-midia">
        <button class="produto-foto" data-abrir="${esc(p.id)}"${dc} aria-label="Ver ${esc(p.nome)}">${selo(p, cor)}${midia}</button>
        <button type="button" class="produto-fav" data-fav="${esc(p.id)}" aria-pressed="${favs.has(p.id)}" aria-label="Favoritar ${esc(p.nome)}">${coracao}</button>
        <button class="produto-add" data-abrir="${esc(p.id)}"${dc} aria-label="Escolher tamanho de ${esc(p.nome)}">Escolher</button>
      </div>
      <button class="produto-link" data-abrir="${esc(p.id)}"${dc} tabindex="-1"><span class="produto-nome">${esc(p.nome)}</span><span class="produto-preco">${preco(p.preco)}</span></button>
    </article>`;
  }

  /* categorias da home */
  const catBox = $("[data-categorias]");
  if (catBox) {
    /* a capa de cada cor passa, bem de leve, pelas fotos dos vestidos daquela cor */
    const capas = c => { const l = PRODUTOS.filter(x => daCor(x, c) && fotoDa(x, c)), tem = l.filter(x => !esgotada(x, c)); return (tem.length ? tem : l).map(x => fotoDa(x, c)); };
    catBox.innerHTML = CATS.map(c => { const cp = capas(c)[0]; return `<a class="categoria" href="loja.html?cat=${encodeURIComponent(c)}"><div class="categoria-foto">${cp ? `<img ${srcGrade(cp)} alt="" loading="lazy" decoding="async">` : vazia()}</div><span class="categoria-nome">${esc(c)}</span></a>`; }).join("");
    const rodas = $$(".categoria-foto", catBox).map((el, n) => ({ el, nome: CATS[n], fotos: capas(CATS[n]), i: 0, ocupada: false })).filter(r => r.fotos.length > 1);
    function proximaCapa(r) {
      const caixa = r.el.getBoundingClientRect();
      if (r.ocupada || caixa.bottom <= 0 || caixa.top >= innerHeight) return;
      r.ocupada = true;
      const i = (r.i + 1) % r.fotos.length, nova = new Image();
      nova.className = "entrando-capa"; nova.alt = ""; nova.decoding = "async";
      nova.sizes = "(max-width: 600px) 50vw, (max-width: 1100px) 33vw, 25vw";
      nova.srcset = `${foto(r.fotos[i], "s")} 400w, ${foto(r.fotos[i], "m")} 720w`; nova.src = foto(r.fotos[i], "m");
      /* só troca depois que a próxima foto terminou de carregar, para não piscar */
      nova.decode().then(() => {
        r.el.append(nova); void nova.offsetWidth; nova.classList.add("visivel");
        setTimeout(() => { $$("img", r.el).forEach(x => { if (x !== nova) x.remove(); }); nova.className = ""; r.i = i; r.ocupada = false; }, 1700);
      }).catch(() => { r.i = i; r.ocupada = false; });
    }
    /* uma cor de cada vez; parado para quem pediu menos movimento no aparelho */
    if (rodas.length && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      let vez = 0;
      setInterval(() => { if (!document.hidden) proximaCapa(rodas[vez++ % rodas.length]); }, Math.max(900, Math.round(4800 / rodas.length)));
    }
    const n = CATS.length;
    catBox.style.setProperty("--n", n <= 6 ? Math.max(n, 2) : Math.min(Math.ceil(n / 2), 6));
  }
  $$('[data-grade="novidades"]').forEach(g => {
    const l = PRODUTOS.filter(p => p.novidade); const lim = +g.dataset.limite || 8;
    g.innerHTML = (l.length ? l : PRODUTOS).slice(0, lim).map(p => cartao(p)).join("");
  });

  /* loja */
  const gradeLoja = $('[data-grade="todas"]');
  if (gradeLoja) {
    let cat = new URLSearchParams(location.search).get("cat") || "todas";
    if (!["todas", "novidades", "favoritos"].includes(cat) && !CATS.includes(cat)) cat = "todas";
    let busca = "", tamF = "";
    const plano = s => String(s || "").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
    const selTam = $("[data-tamanho]"), TAMS = ["PP", "P", "M", "G", "GG"], posTam = t => (TAMS.indexOf(t) + 1) || 99;
    const tamanhos = [...new Set(PRODUTOS.flatMap(p => p.tamanhos || []))].sort((a, b) => posTam(a) - posTam(b) || a.localeCompare(b, "pt-BR", { numeric: true }));
    selTam.innerHTML = '<option value="">Tamanho</option>' + tamanhos.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    selTam.closest("label").hidden = !tamanhos.length;
    const textoVazio = $("p", $("[data-vazio]")), textoPadrao = textoVazio.textContent;
    let ordem = "padrao";
    const filtros = $("[data-filtros]"), qtd = $("[data-qtd]"), titulo = $("[data-loja-titulo]"), vazio = $("[data-vazio]");
    const rotulo = c => ({ todas: "Todas", novidades: "Novidades", favoritos: "♡ Favoritos" })[c] || c;
    filtros.innerHTML = ["todas", "novidades", ...CATS, "favoritos"].map(c => `<button class="filtro" data-cat="${esc(c)}" aria-pressed="false">${esc(rotulo(c))}</button>`).join("");
    const desenha = () => {
      let l = cat === "todas" ? PRODUTOS.slice() : cat === "novidades" ? PRODUTOS.filter(p => p.novidade) : cat === "favoritos" ? PRODUTOS.filter(p => favs.has(p.id)) : PRODUTOS.filter(p => daCor(p, cat));
      const termos = plano(busca).split(/\s+/).filter(Boolean);
      if (termos.length) l = l.filter(p => { const t = plano(`${p.nome} ${coresDe(p).map(x => x.cor).join(" ")} ${p.modelo || ""} ${p.descricao || ""}`); return termos.every(x => t.includes(x)); });
      if (tamF) l = l.filter(p => !esgotada(p, cat) && (p.tamanhos || []).includes(tamF));
      textoVazio.textContent = busca.trim() || tamF ? "Nada encontrado com esse filtro. Tente outra busca ou chame a Fernanda." : cat === "favoritos" ? "Toque no coração de uma peça para guardar aqui." : textoPadrao;
      if (ordem === "az") l.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      if (ordem === "novidades") l.sort((a, b) => (b.novidade ? 1 : 0) - (a.novidade ? 1 : 0));
      if (ordem === "menor") l.sort((a, b) => a.preco - b.preco);
      if (ordem === "maior") l.sort((a, b) => b.preco - a.preco);
      gradeLoja.classList.remove("entrando"); gradeLoja.innerHTML = l.map(p => cartao(p, cat)).join(""); void gradeLoja.offsetWidth; gradeLoja.classList.add("entrando");
      vazio.hidden = l.length > 0;
      qtd.textContent = l.length === 1 ? "1 peça" : l.length ? `${l.length} peças` : "";
      titulo.textContent = cat === "todas" ? "Todas as peças" : cat === "novidades" ? "Novidades" : cat === "favoritos" ? "Favoritos" : cat;
      document.title = `${titulo.textContent} · FC Closet`;
      $$(".filtro", filtros).forEach(b => b.setAttribute("aria-pressed", b.dataset.cat === cat));
      const at = $(`.filtro[aria-pressed="true"]`, filtros); if (at) filtros.scrollLeft = at.offsetLeft - (filtros.clientWidth - at.offsetWidth) / 2;
      $$("#menu a").forEach(a => { const m = a.getAttribute("href").match(/cat=([^&]+)/); if (m && decodeURIComponent(m[1]) === cat) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    };
    filtros.addEventListener("click", e => { const b = e.target.closest(".filtro"); if (!b) return; cat = b.dataset.cat; history.replaceState(null, "", "loja.html" + (cat === "todas" ? "" : "?cat=" + encodeURIComponent(cat))); desenha(); });
    $("[data-ordenar]").addEventListener("change", e => { ordem = e.target.value; desenha(); });
    $("[data-busca]").addEventListener("input", e => { busca = e.target.value; desenha(); });
    selTam.addEventListener("change", e => { tamF = e.target.value; desenha(); });
    aoFavoritar = () => { if (cat === "favoritos") desenha(); };
    $$("#menu a").forEach(a => { const m = a.getAttribute("href").match(/^loja\.html\?cat=([^&]+)/); if (!m) return; a.addEventListener("click", e => { e.preventDefault(); cat = decodeURIComponent(m[1]); history.replaceState(null, "", a.getAttribute("href")); desenha(); menu.classList.remove("aberto"); menuBtn.setAttribute("aria-expanded", "false"); scrollTo({ top: 0, behavior: "smooth" }); }); });
    desenha();
  }

  /* o botão "voltar" do celular fecha a peça ou a sacola, sem sair do site */
  const abreCamada = (nome, url) => history.pushState({ fc: nome }, "", url);
  const fechaCamada = () => { if (history.state && history.state.fc) history.back(); };
  const linkPeca = id => { const u = new URL("loja.html", location.href); u.searchParams.set("peca", id); return u.href; };

  /* sacola */
  const CH = "fc-sacola-v1"; let sacola = [];
  try { sacola = JSON.parse(localStorage.getItem(CH)) || []; } catch (e) {}
  sacola = sacola.filter(i => porId[i.id]);
  sacola.forEach(i => { if (i.cor && !daCor(porId[i.id], i.cor)) delete i.cor; });
  sacola = sacola.filter(i => !esgotada(porId[i.id], i.cor));
  const salva = () => { try { localStorage.setItem(CH, JSON.stringify(sacola)); } catch (e) {} };
  const sacolaEl = $("#sacola"), itensEl = $("[data-sacola-itens]"), vaziaEl = $("[data-sacola-vazia]"), fimEl = $("[data-sacola-fim]");
  function conta(pulo) {
    const n = sacola.reduce((s, i) => s + i.qtd, 0);
    $$("[data-sacola-qtd]").forEach(el => { el.textContent = n; el.hidden = !n; if (pulo) { el.classList.remove("pulo"); void el.offsetWidth; el.classList.add("pulo"); } });
  }
  function desenhaSacola() {
    vaziaEl.hidden = sacola.length > 0; fimEl.hidden = !sacola.length;
    itensEl.innerHTML = sacola.map((i, x) => { const p = porId[i.id], f = fotoDa(p, i.cor), c = corDe(p, i.cor); return `<li class="sacola-item">${f ? `<img src="${foto(f, "s")}" alt="">` : vazia()}<div><p class="si-nome">${esc(p.nome)}</p><p class="si-det">${c ? `Cor ${esc(c)} · ` : ""}${i.tam ? `Tamanho ${esc(i.tam)} · ` : ""}${preco(p.preco)}</p><div class="qtd"><button data-menos="${x}" aria-label="Diminuir">−</button><span>${i.qtd}</span><button data-mais="${x}" aria-label="Aumentar">+</button></div></div><button class="si-remover" data-remover="${x}">Remover</button></li>`; }).join("");
    const total = sacola.reduce((s, i) => s + i.qtd * (porId[i.id].preco || 0), 0);
    const semPreco = sacola.some(i => !(porId[i.id].preco > 0));
    const t = $("[data-sacola-total]"); if (t) t.textContent = total ? preco(total) + (semPreco ? " + itens sob consulta" : "") : sacola.length ? "Sob consulta" : "";
    conta();
  }
  let focoS = null;
  const abreSacola = () => { toastEl.classList.remove("visivel"); focoS = document.activeElement; desenhaSacola(); sacolaEl.hidden = false; document.body.style.overflow = "hidden"; $(".sacola-topo .fechar").focus(); abreCamada("sacola", location.href); };
  const fechaSacola = (peloVoltar) => { if (sacolaEl.hidden) return; if (peloVoltar !== true) fechaCamada(); sacolaEl.hidden = true; document.body.style.overflow = ""; if (focoS && document.contains(focoS)) focoS.focus(); };
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
    const linhas = sacola.map(i => { const p = porId[i.id]; const c = corDe(p, i.cor), det = [c && `cor ${c}`, i.tam && `tam. ${i.tam}`].filter(Boolean).join(", "); return `• ${i.qtd}x ${p.nome}${det ? ` (${det})` : ""}: ${preco(p.preco)}`; });
    abreWhats(`Olá, Fernanda! Montei minha sacola pelo site da FC Closet:\n\n${linhas.join("\n")}\n\nPode confirmar disponibilidade, valores e frete?`);
  });

  /* modal */
  const modal = $("#modalProduto"); let atual = null, tam = null, cor = null, ultimo = null;
  /* galeria: setas, pontinhos e arrastar com o dedo */
  const galeria = $("[data-mp-fotos]", modal), pontos = $("[data-mp-pontos]", modal);
  const posicao = () => Math.round(galeria.scrollLeft / (galeria.clientWidth || 1));
  function marca() {
    const i = posicao();
    Array.from(pontos.children).forEach((b, n) => b.setAttribute("aria-current", n === i));
    $(".mp-seta.ant", modal).disabled = i <= 0;
    $(".mp-seta.prox", modal).disabled = i >= pontos.children.length - 1;
  }
  const vaiPara = i => galeria.scrollTo({ left: i * galeria.clientWidth, behavior: "smooth" });
  galeria.addEventListener("scroll", marca, { passive: true });
  modal.addEventListener("click", e => {
    const s = e.target.closest("[data-mp-passo]"), d = e.target.closest("[data-mp-ir]");
    if (s) vaiPara(posicao() + Number(s.dataset.mpPasso));
    if (d) vaiPara(Number(d.dataset.mpIr));
  });
  /* cores: as do próprio vestido e, se houver, as peças com o mesmo "modelo" no painel */
  function cores(p) {
    const k = chaveModelo(p), irmas = k ? PRODUTOS.filter(x => chaveModelo(x) === k) : [], proprias = coresDe(p), varias = proprias.length > 1;
    const box = $("[data-mp-cores]", modal); box.hidden = !varias && irmas.length < 2;
    const mini = f => f ? `<img src="${foto(f, "s")}" alt="">` : vazia();
    const daPeca = x => `<button type="button" data-mp-outra="${esc(x.id)}" aria-pressed="${x.id === p.id && !varias}"${esgotada(x) ? ' class="esgotada"' : ""} aria-label="${esc(x.nome)}${esgotada(x) ? " (esgotado)" : ""}" title="${esc(x.categoria)}">${mini(vitrine(x)[0])}</button>`;
    const tom = x => { const fora = esgotada(p, x.cor); return `<button type="button" class="tom${fora ? " esgotada" : ""}" data-mp-tom="${esc(x.cor)}" aria-pressed="false">${mini(x.foto)}<span>${esc(x.cor)}</span>${fora ? "<small>Esgotado</small>" : ""}</button>`; };
    $("[data-mp-cores-lista]", modal).innerHTML = box.hidden ? "" : varias ? proprias.map(tom).join("") + irmas.filter(x => x.id !== p.id).map(daPeca).join("") : irmas.map(daPeca).join("");
    $("[data-mp-erro-cor]", modal).hidden = true;
    marcaCor();
  }
  function marcaCor() {
    const varias = coresDe(atual).length > 1, nomes = coresDe(atual).map(x => x.cor).join(" · ");
    $("[data-mp-cor]", modal).textContent = varias ? cor || "escolha" : atual.categoria;
    $("[data-mp-cat]", modal).textContent = varias ? cor || nomes : atual.categoria;
    $$("[data-mp-tom]", modal).forEach(b => b.setAttribute("aria-pressed", b.dataset.mpTom === cor));
    const add = $("[data-mp-add]", modal), fora = esgotada(atual, cor);
    add.disabled = fora; add.textContent = !fora ? "Adicionar à sacola" : varias && cor && atual.disponivel !== false ? "Esgotado nesta cor" : "Esgotado";
    const c = corDe(atual, cor), w = $("[data-mp-whats]", modal);
    w.dataset.whats = `Olá! Tenho interesse em "${atual.nome}"${c ? ` (cor ${c})` : ""}. Pode me passar mais detalhes?\n${linkPeca(atual.id)}`; w.href = linkWhats(w.dataset.whats); w.target = "_blank";
  }

  /* parcelas, detalhes, medidas e condições: só aparecem quando a dona preenche no painel */
  const condicoes = () => [["Pagamento", LOJA.pagamento], ["Entrega", LOJA.entrega], ["Trocas e devoluções", LOJA.trocas]].filter(c => c[1])
    .map(([t, x]) => `<h4>${t}</h4><p>${esc(x)}</p>`).join("");
  const dobra = (titulo, corpo) => corpo ? `<details class="dobra"><summary>${titulo}</summary><div>${corpo}</div></details>` : "";
  function informacoes(p) {
    const n = Number(LOJA.parcelas) || 0, par = $("[data-mp-parcelas]", modal);
    par.hidden = !(n > 1 && p.preco > 0);
    par.textContent = par.hidden ? "" : `ou ${n}x de ${preco(p.preco / n)} sem juros`;
    $("[data-mp-dobras]", modal).innerHTML = dobra("Detalhes da peça", p.detalhes ? `<p>${esc(p.detalhes)}</p>` : "") +
      dobra("Guia de medidas", LOJA.guia_medidas ? `<p>${esc(LOJA.guia_medidas)}</p>` : "") + dobra("Pagamento, entrega e trocas", condicoes());
  }
  function sugestoes(p) {
    const k = chaveModelo(p);
    const vistos = new Set(k ? [k] : []);
    const l = PRODUTOS.filter(x => x.id !== p.id && !esgotada(x))
      .sort((a, b) => (b.categoria === p.categoria) - (a.categoria === p.categoria))
      .filter(x => { const m = chaveModelo(x); if (!m) return true; if (vistos.has(m)) return false; vistos.add(m); return true; }) /* uma cor por modelo */
      .slice(0, 3);
    $("[data-mp-mais]", modal).hidden = !l.length;
    $("[data-mp-mais-lista]", modal).innerHTML = l.map(x => `<button type="button" data-mp-ver="${esc(x.id)}">${vitrine(x)[0] ? `<img src="${foto(vitrine(x)[0], "s")}" alt="" loading="lazy">` : vazia()}<span>${esc(x.nome)}</span><small>${preco(x.preco)}</small></button>`).join("");
  }
  const botaoFav = p => { const b = $("[data-mp-fav]", modal), on = favs.has(p.id); b.setAttribute("aria-pressed", on); b.textContent = on ? "♥ Nos favoritos" : "♡ Salvar nos favoritos"; };
  $("[data-mp-fav]", modal).addEventListener("click", () => { favorita(atual.id); botaoFav(atual); });
  const rodape = $(".rodape");
  if (rodape && condicoes()) rodape.insertAdjacentHTML("afterbegin", `<div class="rodape-info">${dobra("Pagamento, entrega e trocas", condicoes())}</div>`);

  /* zoom: toque na foto para ver de perto */
  document.body.insertAdjacentHTML("beforeend", '<div class="zoom" role="dialog" aria-modal="true" aria-label="Foto ampliada" hidden><button type="button" class="fechar" aria-label="Fechar foto">×</button><div class="zoom-rolo"><img alt=""></div></div>');
  const zoom = $(".zoom"), rolo = $(".zoom-rolo", zoom), zoomImg = $("img", rolo);
  function abreZoom(i) {
    zoomImg.src = foto(atual.fotos[i]); zoomImg.alt = atual.nome; zoom.classList.remove("perto"); zoom.hidden = false;
    $(".fechar", zoom).focus(); abreCamada("zoom", location.href);
  }
  const escondeZoom = () => { zoom.hidden = true; const f = $(".fechar", modal); if (f) f.focus({ preventScroll: true }); };
  galeria.addEventListener("click", e => { const img = e.target.closest("img"); if (img) abreZoom($$("img", galeria).indexOf(img)); });
  $(".fechar", zoom).addEventListener("click", () => history.back());
  zoomImg.addEventListener("click", e => {
    const r = zoomImg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (!zoom.classList.toggle("perto")) return;
    rolo.scrollTo(zoomImg.offsetWidth * x - rolo.clientWidth / 2, zoomImg.offsetHeight * y - rolo.clientHeight / 2);
  });

  function abreProduto(id, semHistorico, troca, corPedida) {
    const p = porId[id]; if (!p) return;
    const tamAntes = troca ? tam : null;
    atual = p; tam = null; cor = coresDe(p).length > 1 && daCor(p, corPedida) ? corPedida : null; if (!troca) ultimo = document.activeElement;
    $("[data-mp-fotos]", modal).innerHTML = p.fotos.length ? p.fotos.map((f, i) => `<img ${srcCheia(f)} alt="${esc(p.nome)}${i ? `, foto ${i + 1}` : ""}"${i ? ' loading="lazy"' : ""} decoding="async">`).join("") : vazia();
    pontos.innerHTML = p.fotos.length > 1 ? p.fotos.map((f, i) => `<button type="button" data-mp-ir="${i}" aria-label="Ver foto ${i + 1}"></button>`).join("") : "";
    $$(".mp-seta", modal).forEach(b => { b.hidden = p.fotos.length < 2; });
    $("[data-mp-nome]", modal).textContent = p.nome;
    $("[data-mp-preco]", modal).textContent = preco(p.preco);
    $("[data-mp-desc]", modal).textContent = p.descricao || "";
    const box = $("[data-mp-tamanhos]", modal); box.hidden = !(p.tamanhos || []).length;
    $("[data-mp-lista]", modal).innerHTML = (p.tamanhos || []).map(t => `<button class="tamanho" data-tam="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("");
    $("[data-mp-erro]", modal).hidden = true;
    if (tamAntes && (p.tamanhos || []).includes(tamAntes)) { tam = tamAntes; $$("[data-tam]", modal).forEach(b => b.setAttribute("aria-pressed", b.dataset.tam === tam)); }
    cores(p); informacoes(p); sugestoes(p); botaoFav(p);
    modal.hidden = false; document.body.style.overflow = "hidden"; $(".fechar", modal).focus();
    galeria.scrollLeft = cor ? Math.max(0, p.fotos.indexOf(fotoDa(p, cor))) * galeria.clientWidth : 0; marca();
    if (troca) {
      /* troca de cor: mesma janela, só muda o endereço (o "voltar" continua fechando) */
      const u = new URL(location.href); u.searchParams.set("peca", p.id); history.replaceState(history.state, "", u.href);
      [modal, $(".modal-caixa", modal), $(".mp-info", modal)].forEach(el => el.scrollTo({ top: 0, behavior: "smooth" }));
      const b = $('[data-mp-outra][aria-pressed="true"]', modal);
      (b && !b.closest("[hidden]") ? b : $(".fechar", modal)).focus({ preventScroll: true });
    } else if (!semHistorico) { const u = new URL(location.href); u.searchParams.set("peca", p.id); abreCamada("produto", u.href); }
  }
  const fechaProduto = (peloVoltar) => {
    if (modal.hidden) return;
    modal.hidden = true; document.body.style.overflow = ""; if (ultimo) ultimo.focus();
    if (peloVoltar === true) return;
    if (history.state && history.state.fc) history.back();
    else { const u = new URL(location.href); u.searchParams.delete("peca"); history.replaceState(null, "", u.href); }
  };
  addEventListener("popstate", () => {
    const camada = history.state && history.state.fc, peca = new URLSearchParams(location.search).get("peca");
    if (!zoom.hidden) { escondeZoom(); return; } /* voltar com a foto ampliada só fecha a foto */
    if (camada !== "produto" && camada !== "zoom") fechaProduto(true);
    if (camada !== "sacola") fechaSacola(true);
    if (camada === "produto" && modal.hidden && porId[peca]) abreProduto(peca, true);
  });
  $("[data-mp-share]", modal).addEventListener("click", async () => {
    const url = linkPeca(atual.id);
    try {
      if (navigator.share) await navigator.share({ title: `${atual.nome} · FC Closet`, url });
      else { await navigator.clipboard.writeText(url); toast("Link da peça copiado"); }
    } catch (e) { if (e.name !== "AbortError") toast("Não consegui compartilhar. Copie o endereço da página."); }
  });
  document.addEventListener("click", e => {
    const fav = e.target.closest("[data-fav]"); if (fav) { favorita(fav.dataset.fav); return; }
    const ver = e.target.closest("[data-mp-ver]"); if (ver) { tam = null; abreProduto(ver.dataset.mpVer, true, true); return; }
    const ab = e.target.closest("[data-abrir]"); if (ab) { abreProduto(ab.dataset.abrir, false, false, ab.dataset.cor); return; }
    if (e.target.closest("[data-fechar]")) fechaProduto();
    const outra = e.target.closest("[data-mp-outra]"); if (outra) { if (outra.dataset.mpOutra !== atual.id) abreProduto(outra.dataset.mpOutra, true, true); return; }
    const tom = e.target.closest("[data-mp-tom]");
    if (tom) { cor = tom.dataset.mpTom; marcaCor(); $("[data-mp-erro-cor]", modal).hidden = true; vaiPara(Math.max(0, atual.fotos.indexOf(fotoDa(atual, cor)))); return; }
    const t = e.target.closest("[data-tam]");
    if (t) { tam = t.dataset.tam; $$("[data-tam]", modal).forEach(b => b.setAttribute("aria-pressed", b === t)); $("[data-mp-erro]", modal).hidden = true; }
  });
  $("[data-mp-add]", modal).addEventListener("click", () => {
    if (esgotada(atual, cor)) return;
    if (coresDe(atual).length > 1 && !cor) { const er = $("[data-mp-erro-cor]", modal); er.hidden = false; er.scrollIntoView({ block: "nearest" }); return; }
    if ((atual.tamanhos || []).length && !tam) { $("[data-mp-erro]", modal).hidden = false; return; }
    const ex = sacola.find(i => i.id === atual.id && i.tam === tam && (i.cor || null) === cor);
    if (ex) ex.qtd++; else sacola.push({ id: atual.id, tam, ...(cor && { cor }), qtd: 1 });
    salva(); conta(true); const nome = atual.nome; fechaProduto(); toast(`${nome} foi para a sacola`);
  });
  document.addEventListener("keydown", e => {
    if (!zoom.hidden) { if (e.key === "Escape") history.back(); if (e.key === "Tab") { e.preventDefault(); $(".fechar", zoom).focus(); } return; }
    if (e.key === "Tab") {
      const alvo = !modal.hidden ? $(".modal-caixa", modal) : !sacolaEl.hidden ? $(".sacola-painel", sacolaEl) : null; if (!alvo) return;
      const f = $$("button, a[href], select, summary", alvo).filter(el => !el.closest("[hidden]") && !el.disabled); if (!f.length) return;
      if (!alvo.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); }
      else if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (!modal.hidden && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.target.closest("input, select")) vaiPara(posicao() + (e.key === "ArrowLeft" ? -1 : 1));
    if (e.key === "Escape") { if (!modal.hidden) fechaProduto(); else if (!sacolaEl.hidden) fechaSacola(); }
  });

  /* revelar ao rolar */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add("visto"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px" });
    $$(".categoria, .sobre-foto, .sobre-txt, .passo, .insta-grade a, [data-grade='novidades'] .produto").forEach((el, i) => { el.classList.add("revelar"); el.style.transitionDelay = (i % 4) * 80 + "ms"; io.observe(el); });
  }
  conta();

  /* link direto para uma peça (compartilhado) */
  const pedida = new URLSearchParams(location.search).get("peca");
  if (pedida) { if (porId[pedida]) abreProduto(pedida, true); else toast("Essa peça não está mais no site."); }
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
