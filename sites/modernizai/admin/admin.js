// Modernizai Admin — tela do painel (PWA). Nenhuma chave/senha fica aqui:
// tudo passa pelas funções em /api/admin, protegidas pelo cookie de login.
"use strict";

// O app vive em /admin/ (escopo do PWA). Sem a barra, o celular não oferece instalar.
if (location.pathname === "/admin") location.replace("/admin/" + location.search);

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const instalado = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const LIMITE_SINAL_MIN = 10;

let swReg = null;
let timer = null;

async function api(caminho, opcoes = {}) {
  const r = await fetch("/api/admin/" + caminho, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opcoes,
  });
  let corpo = {};
  try { corpo = await r.json(); } catch { /* vazio */ }
  if (r.status === 401 && caminho !== "login") mostrarLogin();
  return { ok: r.ok, status: r.status, corpo };
}

// ---------- telas ----------
function mostrarLogin() {
  clearInterval(timer);
  $("tela-painel").hidden = true;
  $("sair").hidden = true;
  $("tela-login").hidden = false;
  $("senha").focus();
}

function mostrarPainel() {
  $("tela-login").hidden = true;
  $("tela-painel").hidden = false;
  $("sair").hidden = false;
  carregar();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) carregar(); }, 30000);
  prepararPush();
  talvezMostrarInstalar();
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const botao = e.target.querySelector("button");
  botao.disabled = true;
  $("erro-login").textContent = "";
  const r = await api("login", { method: "POST", body: JSON.stringify({ senha: $("senha").value }) });
  botao.disabled = false;
  if (r.ok) { $("senha").value = ""; mostrarPainel(); }
  else $("erro-login").textContent = r.corpo.erro || "Não deu para entrar. Tente de novo.";
});

$("sair").addEventListener("click", async () => {
  await api("login", { method: "DELETE" });
  mostrarLogin();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("tela-painel").hidden) carregar();
});

// ---------- dados ----------
function haQuanto(iso, agora) {
  const min = Math.max(0, Math.round((Date.parse(agora) - Date.parse(iso)) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} dia(s)`;
}

function selo(ok, texto) {
  return `<span class="selo${ok === null ? " selo--cinza" : ok ? "" : " selo--erro"}">${esc(texto)}</span>`;
}

async function carregar() {
  const r = await api("status");
  if (!r.ok) return;
  const { status: s, clientes, agora, ia } = r.corpo;
  mostrarIa(ia, agora);
  const checks = (s && s.checks) || [];
  const porId = Object.fromEntries(checks.map((c) => [c.id, c]));

  // resumo
  const resumo = $("resumo");
  if (!s) {
    resumo.dataset.nivel = "atencao";
    $("resumo-titulo").textContent = "Aguardando o primeiro relatório da VPS";
    $("resumo-hora").textContent = "O script da VPS ainda não mandou dados.";
  } else {
    const idadeMin = (Date.parse(agora) - Date.parse(s.recebidoEm)) / 60000;
    const problemas = checks.filter((c) => !c.ok);
    if (idadeMin > LIMITE_SINAL_MIN) {
      resumo.dataset.nivel = "erro";
      $("resumo-titulo").textContent = "VPS sem sinal";
      $("resumo-hora").textContent = "Último relatório " + haQuanto(s.recebidoEm, agora);
    } else {
      resumo.dataset.nivel = problemas.length ? "erro" : "ok";
      $("resumo-titulo").textContent = problemas.length
        ? `${problemas.length} problema${problemas.length > 1 ? "s" : ""}: ${problemas.map((p) => p.nome).join(", ")}`
        : "Tudo funcionando";
      $("resumo-hora").textContent = "Atualizado " + haQuanto(s.recebidoEm, agora);
    }
  }

  // WhatsApps
  const was = (s && s.whatsapp) || [];
  $("lista-whatsapp").innerHTML = was.length
    ? was.map((w) => {
        const c = porId["wa:" + w.id] || {};
        return `<li><div class="nome">${esc(w.nome)}<small>${esc(w.numero ? "Número final " + w.numero : "")}</small></div>${selo(c.ok, c.detalhe || w.estado)}</li>`;
      }).join("")
    : `<li class="vazio">Sem dados ainda.</li>`;

  // Robôs
  const robos = (s && s.robos) || [];
  $("lista-robos").innerHTML = robos.length
    ? robos.map((rb) => {
        const c = porId["robo:" + rb.id] || {};
        const extra = rb.ultimo_erro ? "Último erro " + haQuanto(rb.ultimo_erro, agora) : "Erros dos últimos 15 min";
        return `<li><div class="nome">${esc(rb.nome)}<small>${esc(extra)}</small></div>${selo(c.ok, c.detalhe)}</li>`;
      }).join("")
    : `<li class="vazio">Sem dados ainda.</li>`;

  // VPS
  const v = (s && s.vps) || {};
  const medida = (nome, pct, id) => {
    if (pct == null) return "";
    const c = porId[id] || { ok: true };
    return `<div class="medida"${c.ok ? "" : " data-alto"}><div class="medida__topo"><span>${nome}</span><strong>${Math.round(pct)}%</strong></div>
      <div class="medida__barra"><span data-pct="${Math.min(100, Math.max(0, Number(pct) || 0))}"></span></div></div>`;
  };
  $("vps").innerHTML = s
    ? medida("Disco", v.disco_pct, "vps:disco") + medida("Memória", v.mem_pct, "vps:memoria") + medida("Swap", v.swap_pct, "vps:swap") +
      `<div class="vps__extra">${v.uptime_h != null ? `<span>Ligada há ${v.uptime_h >= 48 ? Math.round(v.uptime_h / 24) + " dias" : Math.round(v.uptime_h) + " h"}</span>` : ""}${v.carga1 != null ? `<span>Carga ${esc(v.carga1)}${v.cpus ? " / " + esc(v.cpus) + " CPUs" : ""}</span>` : ""}</div>`
    : `<p class="suave">Sem dados ainda.</p>`;
  $("vps").querySelectorAll("[data-pct]").forEach((el) => { el.style.width = el.dataset.pct + "%"; });

  // Serviços
  const svcs = (s && s.servicos) || [];
  $("lista-servicos").innerHTML = svcs.length
    ? svcs.map((sv) => {
        const c = porId["svc:" + sv.nome] || {};
        return `<li><div class="nome">${esc(c.nome || sv.nome)}</div>${selo(c.ok, c.detalhe || sv.estado)}</li>`;
      }).join("")
    : `<li class="vazio">Sem dados ainda.</li>`;

  // Clientes
  $("lista-clientes").innerHTML = (clientes || []).map((cl) => {
    const wa = porId["wa:" + cl.whatsapp];
    const rb = porId["robo:" + cl.robo];
    const tudoOk = wa ? wa.ok && (!rb || rb.ok) : null;
    const textoSelo = tudoOk === null ? "Sem dados" : tudoOk ? "Tudo certo" : "Atenção";
    return `<article class="cliente">
      <div class="cliente__topo"><div><h3>${esc(cl.nome)}</h3><p>${esc(cl.servico)}</p></div>${selo(tudoOk, textoSelo)}</div>
      <p>${esc(cl.situacao)}${wa ? " · WhatsApp: " + esc(wa.detalhe) : ""}</p>
      ${(cl.demandas || []).length ? `<ul class="demandas">${cl.demandas.map((d) => `<li class="demanda demanda--${esc(d.estado)}"><span class="demanda__estado">${{ feito: "Feito", andamento: "Andamento", aguardando: "Aguardando" }[d.estado] || esc(d.estado)}</span><span>${esc(d.texto)}${d.obs ? ` <em>· ${esc(d.obs)}</em>` : ""}${d.data ? ` <em>· ${esc(d.data)}</em>` : ""}</span></li>`).join("")}</ul>` : ""}
      <div class="cliente__links">${(cl.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.nome)}</a>`).join("")}</div>
    </article>`;
  }).join("");
}

// ---------- saldo da IA (z.ai) ----------
const dolar = (v) => "US$ " + Number(v || 0).toFixed(2).replace(".", ",");
const reais = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const milTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + " mi" : Math.round(n / 1000) + " mil");
const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function mostrarIa(ia, agora) {
  const el = $("ia");
  if (!ia) { el.innerHTML = `<p class="suave">Sem dados.</p>`; return; }
  const real = ia.fonte === "zai" && ia.real;
  const base = real
    ? `Saldo real da conta, consultado ${haQuanto(real.consultadoEm, agora)} · recarregado ${dolar(real.recarregado + real.bonus)} · gasto total ${dolar(real.gastoTotal)}`
    : `Estimativa: último saldo informado ${dolar(ia.saldoInformado)} em ${esc(dataHora(ia.informadoEm))}`;
  const acoes = `<div class="ia__acoes">${real ? "" : `<button class="botao" type="button" id="ia-informar">Informar saldo atual</button>`}
    <a class="botao${real ? "" : " botao--leve"}" href="https://z.ai/manage-apikey/billing" target="_blank" rel="noopener">Recarregar na z.ai</a></div>`;
  if (!ia.temDados || !ia.sincronizado) {
    el.dataset.nivel = "";
    el.innerHTML = `<p class="ia__rotulo">${ia.temDados ? "Atualizando a conta…" : "Aguardando a VPS mandar o uso da IA"}</p>
      <p class="ia__base">${base}</p>${acoes}`;
    return;
  }
  const nivel = ia.estimado < 0.5 ? "erro" : ia.estimado < 1.5 || (ia.diasRestantes != null && ia.diasRestantes < 2) ? "atencao" : "ok";
  el.dataset.nivel = nivel;
  const seloIa = `<span class="selo${nivel === "erro" ? " selo--erro" : nivel === "atencao" ? " selo--atencao" : ""}">${nivel === "erro" ? "Recarregar já" : nivel === "atencao" ? "Recarregar logo" : "OK"}</span>`;
  const dura = ia.diasRestantes == null ? "Sem gasto nas últimas 24h." :
    ia.diasRestantes < 1 ? `Acaba em menos de 1 dia no ritmo atual (${dolar(ia.porDia)}/dia).` :
    `Dura ~${Math.floor(ia.diasRestantes)} dia${Math.floor(ia.diasRestantes) === 1 ? "" : "s"} no ritmo atual (${dolar(ia.porDia)}/dia).`;
  const maxDia = Math.max(0.0001, ...(ia.dias || []).map((d) => d.custo));
  const dias = (ia.dias || []).length > 1
    ? `<div class="ia__dias" aria-label="Gasto por dia">${ia.dias.map((d) => `<span data-h="${Math.round((d.custo / maxDia) * 100)}" title="${esc(d.dia.slice(8, 10) + "/" + d.dia.slice(5, 7))}: ${esc(dolar(d.custo))}"></span>`).join("")}</div>
       <div class="ia__dias-legenda"><span>${esc(ia.dias[0].dia.slice(8, 10) + "/" + ia.dias[0].dia.slice(5, 7))}</span><span>gasto por dia</span><span>hoje</span></div>`
    : "";
  const brl = (ia.cotacao && ia.cotacao.brl) || 5.5;
  const comIof = (usd) => usd * brl * (1 + ((ia.cotacao && ia.cotacao.iof) || 0));
  const mes = ia.mes || { precisa: 0, recarregar: 0 };
  const recarga = `<div class="ia__recarga"><strong>${mes.recarregar > 0 ? `Recarregar ${dolar(mes.recarregar)} para durar 30 dias` : "O saldo cobre 30 dias no ritmo atual"}</strong>
    <span>${mes.recarregar > 0 ? `≈ ${reais(comIof(mes.recarregar))} no cartão (com IOF). ` : ""}Um mês neste ritmo custa ${dolar(mes.precisa)} ≈ ${reais(comIof(mes.precisa))}.</span></div>`;
  const tabela = (ia.porRoboModelo24h || []).length
    ? `<table class="ia__tabela"><thead><tr><th>Últimas 24h</th><th>Chamadas</th><th>Tokens</th><th>Custo</th></tr></thead><tbody>${ia.porRoboModelo24h.map((l) => `<tr><td>${esc(l.robo)}<small>${esc(l.modelo === "glm-auto" ? "modelo automático" : l.modelo)}</small></td><td>${l.chamadas}</td><td>${milTokens(l.entrada + l.saida)}</td><td>${dolar(l.custo)}</td></tr>`).join("")}</tbody></table>`
    : "";
  el.innerHTML = `<div class="ia__topo"><div><p class="ia__rotulo">${real ? "Saldo na z.ai" : "Saldo estimado agora"}</p><p class="ia__valor">${dolar(ia.estimado)}</p><p class="ia__rotulo">≈ ${reais(ia.estimado * brl)} · dólar a ${reais(brl)}</p></div>${seloIa}</div>
    <p class="ia__ritmo">${esc(dura)}</p>
    <p class="ia__base">${base}${real ? "" : " · gasto desde então " + dolar(ia.gastoDesde)}</p>
    <div class="ia__numeros">
      <div><strong>${dolar(ia.hoje.custo)}</strong><span>Hoje · ${ia.hoje.chamadas} chamadas · ${milTokens(ia.hoje.entrada + ia.hoje.saida)} tokens</span></div>
      <div><strong>${dolar(ia.h24.custo)}</strong><span>Últimas 24h · ${ia.h24.chamadas} chamadas · ${milTokens(ia.h24.entrada + ia.h24.saida)} tokens</span></div>
    </div>
    ${recarga}${tabela}
    ${dias}${acoes}
    <p class="ia__nota">${real ? `Saldo lido da z.ai a cada 5 min. Ritmo ${ia.ritmoFonte === "real" ? "medido pelo gasto real das últimas " + ia.ritmoHoras + " h" : "estimado pelos tokens"}. Divisão por robô pelos tokens de cada um, ajustada ao gasto real.` : "Estimativa pelos tokens que os robôs gastam (tabela de preço da z.ai). Confira o saldo real na z.ai de vez em quando e informe aqui."}</p>`;
  el.querySelectorAll("[data-h]").forEach((b) => { b.style.height = Math.max(3, Number(b.dataset.h)) + "%"; });
}

$("ia").addEventListener("click", (e) => {
  if (e.target.id !== "ia-informar") return;
  $("ia-form").hidden = false;
  $("ia-erro").textContent = "";
  $("ia-saldo").focus();
});
$("ia-cancelar").addEventListener("click", () => { $("ia-form").hidden = true; });
$("ia-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const botao = e.target.querySelector("button[type=submit]");
  botao.disabled = true;
  const r = await api("zai", { method: "POST", body: JSON.stringify({ saldo: $("ia-saldo").value }) });
  botao.disabled = false;
  if (!r.ok) { $("ia-erro").textContent = r.corpo.erro || "Não deu para salvar."; return; }
  $("ia-saldo").value = "";
  $("ia-form").hidden = true;
  carregar();
});

// ---------- notificações push ----------
function chaveBytes(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const bruto = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bruto, (c) => c.charCodeAt(0));
}

async function prepararPush() {
  const estado = $("push-estado");
  const suporta = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!suporta) {
    estado.textContent = ehIOS && !instalado
      ? "No iPhone, primeiro instale o app (Compartilhar → Adicionar à Tela de Início) e abra por ele. Aí dá para ativar as notificações."
      : "Este navegador não recebe notificações. Use o Chrome no Android ou instale o app no iPhone.";
    $("aviso-push").hidden = true;
    return;
  }
  swReg = swReg || (await navigator.serviceWorker.ready);
  const sub = await swReg.pushManager.getSubscription();
  const ligado = !!sub && Notification.permission === "granted";
  if (ligado) api("push", { method: "POST", body: JSON.stringify({ inscricao: sub.toJSON() }) }); // mantém a inscrição em dia
  $("aviso-push").hidden = ligado || Notification.permission === "denied";
  $("testar-push").hidden = !ligado;
  $("desligar-push").hidden = !ligado;
  estado.textContent = ligado
    ? "Ligadas neste celular. Você recebe aviso quando um WhatsApp cair, um robô der erro, a VPS tiver problema ou o saldo da IA estiver acabando."
    : Notification.permission === "denied"
      ? "As notificações foram bloqueadas. Libere nas configurações do navegador/app para este site."
      : "Desligadas neste celular.";
}

$("ativar-push").addEventListener("click", async (e) => {
  const botao = e.currentTarget;
  botao.disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return prepararPush();
    const { corpo } = await api("push");
    if (!corpo.chave) { $("push-estado").textContent = "Notificações ainda não configuradas no servidor."; return; }
    const sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(corpo.chave) });
    await api("push", { method: "POST", body: JSON.stringify({ inscricao: sub.toJSON() }) });
    await prepararPush();
  } catch (err) {
    $("push-estado").textContent = "Não deu para ativar: " + err.message;
  } finally {
    botao.disabled = false;
  }
});

$("testar-push").addEventListener("click", async () => {
  const r = await api("push", { method: "POST", body: JSON.stringify({ teste: true }) });
  $("push-estado").textContent = r.ok ? `Teste enviado para ${r.corpo.enviados} aparelho(s).` : "Falhou ao mandar o teste.";
});

$("desligar-push").addEventListener("click", async () => {
  const sub = swReg && (await swReg.pushManager.getSubscription());
  if (sub) {
    await api("push", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
  prepararPush();
});

// ---------- pop-up de instalação ----------
let pedidoInstalar = null;
const CHAVE_ADIAR = "mz-admin-instalar-adiado";

function adiado() {
  try { return Date.now() < Number(localStorage.getItem(CHAVE_ADIAR) || 0); } catch { return false; }
}

function talvezMostrarInstalar() {
  if (instalado || adiado() || $("tela-painel").hidden) return;
  if (pedidoInstalar) {
    $("instalar-sim").hidden = false;
    $("instalar-dica").textContent = "Fica na tela inicial e recebe os alertas.";
    $("instalar").hidden = false;
  } else if (ehIOS) {
    $("instalar-sim").hidden = true;
    $("instalar-nao").textContent = "Entendi";
    $("instalar-dica").textContent = "No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.";
    $("instalar").hidden = false;
  }
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  pedidoInstalar = e;
  talvezMostrarInstalar();
});

$("instalar-sim").addEventListener("click", async () => {
  $("instalar").hidden = true;
  if (!pedidoInstalar) return;
  pedidoInstalar.prompt();
  await pedidoInstalar.userChoice;
  pedidoInstalar = null;
});

$("instalar-nao").addEventListener("click", () => {
  $("instalar").hidden = true;
  try { localStorage.setItem(CHAVE_ADIAR, String(Date.now() + 3 * 864e5)); } catch { /* sem armazenamento */ }
});

window.addEventListener("appinstalled", () => { $("instalar").hidden = true; });

// ---------- início ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }).then((r) => { swReg = r; }).catch(() => {});
}

api("login").then((r) => (r.corpo.logado ? mostrarPainel() : mostrarLogin()));
