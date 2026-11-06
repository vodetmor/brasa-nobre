// Saldo da IA z.ai (GLM) usada por todos os robôs.
// Saldo REAL: a VPS consulta a z.ai a cada 5 min com a chave dos robôs (campo ia.saldo_real).
// Reserva, se a consulta falhar: saldo estimado = último saldo informado − custo dos tokens
// gastos desde então. Os tokens vêm da VPS (lidos das execuções do n8n) e dão o ritmo de gasto. Preço em US$ por 1 milhão de tokens,
// tabela pública da z.ai (conferir em https://docs.z.ai/guides/overview/pricing se mudar).
const { lerJson, gravarJson } = require("./_lib");

const ARQ_ZAI = "admin/zai.json";

const PRECOS = {
  "glm-4.6": { entrada: 0.6, cache: 0.11, saida: 2.2 },
  "glm-4.7": { entrada: 0.6, cache: 0.11, saida: 2.2 },
  "glm-4.5": { entrada: 0.6, cache: 0.11, saida: 2.2 },
  "glm-4.5-air": { entrada: 0.2, cache: 0.03, saida: 1.1 },
  "glm-4.6v": { entrada: 0.3, cache: 0.05, saida: 0.9 },
  "glm-4.5v": { entrada: 0.6, cache: 0.11, saida: 1.8 },
  "glm-4.5-flash": { entrada: 0, cache: 0, saida: 0 },
  "glm-4.6v-flash": { entrada: 0, cache: 0, saida: 0 },
  "glm-4.7-flash": { entrada: 0, cache: 0, saida: 0 },
};
const PRECO_PADRAO = PRECOS["glm-4.6"]; // modelo desconhecido: conta pelo mais caro comum

// Avisos (push + WhatsApp), cada um uma vez por saldo informado.
const NIVEIS = [
  { id: "baixo", abaixoDe: 1.5, titulo: "🟡 Saldo da IA baixo" },
  { id: "critico", abaixoDe: 0.5, titulo: "🔴 Saldo da IA quase no fim" },
];
const DIAS_AVISO = 2; // também avisa se no ritmo atual acaba em menos de 2 dias

// Ponto de partida: print do Ribeiro em 06/11/2026 00:41 (Brasília) mostrando US$ 2,60.
const INICIAL = { saldo: 2.6, em: "2026-11-06T03:41:00.000Z" };

const NOMES_ROBO = { espeto: "Central do Espeto", medicmais: "MedicMais" };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const txt = (v, max = 40) => String(v == null ? "" : v).slice(0, max);

function preco(modelo) {
  return PRECOS[String(modelo || "").toLowerCase()] || PRECO_PADRAO;
}

function custo(modelo, u) {
  const p = preco(modelo);
  const cache = Math.min(num(u.cache), num(u.entrada));
  return ((num(u.entrada) - cache) * p.entrada + cache * p.cache + num(u.saida) * p.saida) / 1e6;
}

// Limpa o bloco "ia" que vem da VPS.
function normalizarIa(b) {
  if (!b || typeof b !== "object") return null;
  const limparUso = (u) => ({ entrada: num(u && u.entrada), saida: num(u && u.saida), cache: num(u && u.cache), chamadas: num(u && u.chamadas) });
  const limparMapa = (m) => {
    const out = {};
    Object.entries(m && typeof m === "object" ? m : {}).slice(0, 40).forEach(([k, u]) => { out[txt(k, 60)] = limparUso(u); });
    return out;
  };
  const j = b.janelas || {};
  return {
    desde: b.desde ? txt(b.desde, 40) : null,
    janelas: { desde: limparMapa(j.desde), h24: limparMapa(j.h24), d7: limparMapa(j.d7), hoje: limparMapa(j.hoje) },
    dias: (Array.isArray(b.dias) ? b.dias : []).slice(-14).map((d) => ({ dia: txt(d && d.dia, 10), modelos: limparMapa(d && d.modelos) })),
    primeiro: b.primeiro ? num(b.primeiro) : null,
    saldoReal: b.saldo_real && typeof b.saldo_real === "object" && Number.isFinite(Number(b.saldo_real.disponivel))
      ? {
          disponivel: num(b.saldo_real.disponivel),
          recarregado: num(b.saldo_real.recarregado),
          bonus: num(b.saldo_real.bonus),
          gastoTotal: num(b.saldo_real.gastoTotal),
          consultadoEm: txt(b.saldo_real.consultadoEm, 40),
        }
      : null,
  };
}

const REAL_VALE_MIN = 30; // saldo real consultado há mais que isso volta para a estimativa

// Soma um mapa "robo|modelo" → uso em custo/tokens.
function somar(mapa) {
  const t = { custo: 0, entrada: 0, saida: 0, chamadas: 0, porRobo: {}, porModelo: {} };
  for (const [chave, u] of Object.entries(mapa || {})) {
    const [robo, modelo] = chave.includes("|") ? chave.split("|") : ["", chave];
    const c = custo(modelo, u);
    t.custo += c;
    t.entrada += u.entrada;
    t.saida += u.saida;
    t.chamadas += u.chamadas;
    if (robo) t.porRobo[robo] = (t.porRobo[robo] || 0) + c;
    t.porModelo[modelo] = (t.porModelo[modelo] || 0) + c;
  }
  return t;
}

async function lerConfig() {
  const cfg = await lerJson(ARQ_ZAI, null);
  return cfg && Number.isFinite(cfg.saldo) && cfg.em ? cfg : { ...INICIAL, avisados: {} };
}

// Junta saldo informado + uso da VPS num resumo para a tela e para os alertas.
function resumo(ia, cfg) {
  const base = { saldoInformado: cfg.saldo, informadoEm: cfg.em, temDados: !!ia };
  if (!ia) return base;
  const sincronizado = ia.desde === cfg.em;
  const desde = somar(ia.janelas.desde);
  const h24 = somar(ia.janelas.h24);
  const d7 = somar(ia.janelas.d7);
  const hoje = somar(ia.janelas.hoje);
  // ritmo: média dos dias com dado (até 7), para não subestimar quando a contagem começou há pouco
  const diasComDado = ia.primeiro ? Math.min(7, Math.max(1, (Date.now() / 1000 - ia.primeiro) / 86400)) : 1;
  const porDia = Math.max(h24.custo, d7.custo / diasComDado);
  const real = ia.saldoReal && Date.now() - Date.parse(ia.saldoReal.consultadoEm) < REAL_VALE_MIN * 60000 ? ia.saldoReal : null;
  const estimado = real ? real.disponivel : sincronizado ? Math.max(0, cfg.saldo - desde.custo) : null;
  return {
    ...base,
    fonte: real ? "zai" : "estimativa",
    real,
    sincronizado: real ? true : sincronizado,
    gastoDesde: sincronizado ? desde.custo : null,
    estimado,
    porDia,
    diasRestantes: estimado != null && porDia > 0 ? estimado / porDia : null,
    hoje: { custo: hoje.custo, entrada: hoje.entrada, saida: hoje.saida, chamadas: hoje.chamadas },
    h24: { custo: h24.custo, entrada: h24.entrada, saida: h24.saida, chamadas: h24.chamadas },
    porRobo24h: Object.entries(h24.porRobo).map(([id, c]) => ({ id, nome: NOMES_ROBO[id] || id, custo: c })).sort((a, b) => b.custo - a.custo),
    porModelo24h: Object.entries(h24.porModelo).map(([modelo, c]) => ({ modelo, custo: c })).sort((a, b) => b.custo - a.custo),
    dias: ia.dias.map((d) => ({ dia: d.dia, custo: somar(d.modelos).custo })),
  };
}

const dolar = (v) => "US$ " + Number(v || 0).toFixed(2).replace(".", ",");

// Decide os avisos novos. Devolve {avisos, avisados} (avisados é gravado de volta no zai.json).
function decidirAvisos(r, cfg) {
  let avisados = { ...(cfg.avisados || {}) };
  // Recarga detectada pelo total recarregado na z.ai: libera os avisos de novo.
  if (r.real && r.real.recarregado > (cfg.recarregado || 0) + 0.001) {
    if (cfg.recarregado != null) avisados = {};
    avisados._recarregado = r.real.recarregado;
  }
  const avisos = [];
  if (r.estimado == null) return { avisos, avisados };
  const ritmo = r.diasRestantes != null ? ` No ritmo atual (${dolar(r.porDia)}/dia) dura ~${r.diasRestantes < 1 ? "menos de 1 dia" : Math.floor(r.diasRestantes) + " dia(s)"}.` : "";
  for (const n of NIVEIS) {
    if (r.estimado < n.abaixoDe && !avisados[n.id]) {
      avisados[n.id] = new Date().toISOString();
      avisos.push({ titulo: n.titulo, texto: `Saldo ${r.real ? "" : "estimado "}${dolar(r.estimado)} na z.ai.${ritmo} Recarregue em z.ai → Billing.`, tag: "zai:" + n.id, nivel: "erro" });
    }
  }
  if (!avisos.length && r.diasRestantes != null && r.diasRestantes < DIAS_AVISO && !avisados.ritmo) {
    avisados.ritmo = new Date().toISOString();
    avisos.push({ titulo: "🟡 Saldo da IA acaba em breve", texto: `Saldo ${r.real ? "" : "estimado "}${dolar(r.estimado)} na z.ai.${ritmo} Vale recarregar.`, tag: "zai:ritmo", nivel: "erro" });
  }
  return { avisos, avisados };
}

async function gravarConfig(cfg) {
  await gravarJson(ARQ_ZAI, cfg);
}

module.exports = { normalizarIa, resumo, decidirAvisos, lerConfig, gravarConfig, dolar, PRECOS };
