/* Painel da loja · FC Closet. Demonstração: salva no navegador (localStorage). */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const CFG = window.FC_CONFIG, DB = window.FC_DB;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const preco = v => (v > 0 ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Sob consulta");
  const slug = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fotoA = f => f.startsWith("data:") ? f : "../" + window.FC_FOTO(f, "s");
  let toastT;
  const toast = m => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2800); };

  /* ---- entrar ---- */
  const logado = () => { try { return sessionStorage.getItem("fc-admin") === "1"; } catch (e) { return false; } };
  function mostra() { $("#telaEntrar").hidden = true; $("#painel").hidden = false; desenha(); }
  $("#formEntrar").addEventListener("submit", e => {
    e.preventDefault();
    if ($("#senha").value.trim().toLowerCase() === CFG.senhaDemo) { try { sessionStorage.setItem("fc-admin", "1"); } catch (x) {} mostra(); }
    else { $("#erroSenha").hidden = false; $("#senha").select(); }
  });
  $("#sair").addEventListener("click", () => { try { sessionStorage.removeItem("fc-admin"); } catch (e) {} location.reload(); });

  /* ---- dados ---- */
  let produtos = DB.produtos(), cats = DB.categorias();
  const grava = () => {
    if (!DB.salvar(produtos)) { toast("Sem espaço para guardar tantas fotos. Remova algumas peças ou fotos."); return false; }
    DB.salvarCategorias(cats); return true;
  };

  /* ---- lista ---- */
  function desenha() {
    $("#nTotal").textContent = produtos.length;
    $("#nOn").textContent = produtos.filter(p => p.disponivel !== false).length;
    $("#nOff").textContent = produtos.filter(p => p.disponivel === false).length;
    $("#vazio").hidden = produtos.length > 0;
    $("#lista").innerHTML = produtos.map(p => `<li class="item${p.disponivel === false ? " off" : ""}" data-id="${esc(p.id)}">
      <img src="${p.fotos[0] ? fotoA(p.fotos[0]) : ""}" alt="">
      <div><h3>${esc(p.nome)}</h3>
        <p class="meta">${preco(p.preco)} · ${esc(p.categoria)}${(p.tamanhos || []).length ? " · " + esc(p.tamanhos.join(", ")) : ""}</p>
        <span class="etq ${p.disponivel === false ? "no" : "ok"}">${p.disponivel === false ? "Esgotado" : "À venda"}</span>${p.novidade ? '<span class="etq">Novidade</span>' : ""}</div>
      <div class="item-acoes">
        <button class="btn-p" data-a="editar">Editar</button>
        <button class="btn-p" data-a="disp">${p.disponivel === false ? "Voltar a vender" : "Marcar esgotado"}</button>
        <button class="btn-p perigo" data-a="remover">Remover</button>
      </div></li>`).join("");
  }
  $("#lista").addEventListener("click", e => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const id = b.closest(".item").dataset.id, p = produtos.find(x => x.id === id);
    if (b.dataset.a === "editar") abre(p);
    if (b.dataset.a === "disp") { p.disponivel = p.disponivel === false; if (grava()) { desenha(); toast(p.disponivel ? "Peça voltou para a venda" : "Peça marcada como esgotada"); } }
    if (b.dataset.a === "remover") {
      if (b.dataset.sure) { produtos = produtos.filter(x => x.id !== id); if (grava()) { desenha(); toast("Peça removida do site"); } }
      else { b.dataset.sure = "1"; b.textContent = "Toque de novo para confirmar"; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = "Remover"; } }, 3500); }
    }
  });
  $("#restaurar").addEventListener("click", e => {
    const b = e.currentTarget;
    if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Toque de novo para confirmar"; setTimeout(() => { delete b.dataset.sure; b.textContent = "Restaurar peças de exemplo"; }, 3500); return; }
    DB.restaurar(); produtos = DB.produtos(); cats = DB.categorias(); delete b.dataset.sure; b.textContent = "Restaurar peças de exemplo"; desenha(); toast("Peças de exemplo restauradas");
  });

  /* ---- formulário ---- */
  const folha = $("#folha");
  let editando = null, fotos = [], tams = new Set();
  const selCat = $("#fCat");
  function opcoesCat(sel) {
    selCat.innerHTML = cats.map(c => `<option${c === sel ? " selected" : ""}>${esc(c)}</option>`).join("") + '<option value="__nova">+ Nova categoria…</option>';
  }
  selCat.addEventListener("change", () => { $("#campoNovaCat").hidden = selCat.value !== "__nova"; if (selCat.value === "__nova") $("#fNovaCat").focus(); });
  function chipsTam() {
    $("#fTam").innerHTML = ["PP", "P", "M", "G", "GG", "Único"].map(t => `<button type="button" class="chip" data-t="${t}" aria-pressed="${tams.has(t)}">${t}</button>`).join("");
  }
  $("#fTam").addEventListener("click", e => { const b = e.target.closest("[data-t]"); if (!b) return; tams.has(b.dataset.t) ? tams.delete(b.dataset.t) : tams.add(b.dataset.t); chipsTam(); });
  function miniaturas() {
    $("#fotos").innerHTML = fotos.map((f, i) => `<button type="button" class="foto-t${i === 0 ? " capa" : ""}" data-i="${i}" aria-label="Remover foto ${i + 1}"><img src="${fotoA(f)}" alt=""></button>`).join("");
  }
  $("#fotos").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (!b) return; fotos.splice(+b.dataset.i, 1); miniaturas(); });
  $("#addFoto").addEventListener("click", () => $("#arquivo").click());
  /* reduz a foto para ~900px antes de guardar (cabe no navegador) */
  const reduz = file => new Promise((ok, falha) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", .78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); falha(); }; img.src = url;
  });
  $("#arquivo").addEventListener("change", async e => {
    for (const f of e.target.files) { try { fotos.push(await reduz(f)); } catch (x) { toast("Não consegui abrir uma das fotos."); } }
    e.target.value = ""; miniaturas();
  });

  function abre(p) {
    editando = p || null;
    $("#folhaT").textContent = p ? "Editar peça" : "Nova peça";
    fotos = p ? p.fotos.slice() : []; tams = new Set(p ? p.tamanhos : ["P", "M", "G"]);
    $("#fNome").value = p ? p.nome : ""; $("#fPreco").value = p && p.preco ? String(p.preco).replace(".", ",") : "";
    $("#fDesc").value = p ? p.descricao || "" : ""; $("#fNovo").checked = p ? !!p.novidade : true; $("#fDisp").checked = p ? p.disponivel !== false : true;
    opcoesCat(p ? p.categoria : cats[0]); $("#campoNovaCat").hidden = true; $("#fNovaCat").value = "";
    $("#erroForm").hidden = true; chipsTam(); miniaturas();
    folha.hidden = false; document.body.style.overflow = "hidden"; $("#fNome").focus();
  }
  const fecha = () => { folha.hidden = true; document.body.style.overflow = ""; };
  $("#novo").addEventListener("click", () => abre(null));
  folha.addEventListener("click", e => { if (e.target.closest("[data-fechar]")) fecha(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !folha.hidden) fecha(); });

  $("#form").addEventListener("submit", e => {
    e.preventDefault();
    const erro = m => { const el = $("#erroForm"); el.textContent = m; el.hidden = false; };
    const nome = $("#fNome").value.trim(); if (!nome) return erro("Escreva o nome da peça.");
    if (!fotos.length) return erro("Adicione pelo menos uma foto.");
    let cat = selCat.value;
    if (cat === "__nova") { cat = $("#fNovaCat").value.trim(); if (!cat) return erro("Escreva o nome da nova categoria."); if (!cats.includes(cat)) cats.push(cat); }
    const pr = parseFloat($("#fPreco").value.replace(/\./g, "").replace(",", ".")) || 0;
    const dados = { nome, categoria: cat, preco: pr, fotos: fotos.slice(), tamanhos: ["PP", "P", "M", "G", "GG", "Único"].filter(t => tams.has(t)), descricao: $("#fDesc").value.trim(), novidade: $("#fNovo").checked, disponivel: $("#fDisp").checked };
    const antes = JSON.stringify(produtos);
    if (editando) Object.assign(editando, dados);
    else { let id = slug(nome) || "peca", n = 1; while (produtos.some(p => p.id === id)) id = slug(nome) + "-" + (++n); produtos.unshift({ id, ...dados }); }
    if (!grava()) { produtos = JSON.parse(antes); return; }
    fecha(); desenha(); toast(editando ? "Peça atualizada no site" : "Peça adicionada ao site");
  });
  if (logado()) mostra();
})();
