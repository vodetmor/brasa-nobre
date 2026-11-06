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
const PRECO_PADRAO = PRECOS["glm-4.6"]; // inclui "glm-auto" (modelo escolhido por expressão no n8n) // modelo desconhecido: conta pelo mais caro comum

// Avisos (push + WhatsApp), cada um uma vez por saldo informado.
const NIVEIS = [
  { id: "baixo", abaixoDe: 1.5, titulo: "🟡 Saldo da IA baixo" },
  { id: "critico", abaixoDe: 0.5, titulo: "🔴 Saldo da IA quase no fim" },
];
const DIAS_AVISO = 2; // também avisa se no ritmo atual acaba em menos de 2 dias

// Ponto de partida: print do Ribeiro em 06/11/2026 00:41 (Brasília) mostrando US$ 2,60.
const INICIAL = { saldo: 2.6, em: "2026-11-06T03:41:00.000Z", amostras: [{ t: "2026-11-06T03:49:21.000Z", g: 4.43604 }] };

// Amostras do gasto total real (1 por hora, 8 dias) para medir o ritmo de verdade.
// A tabela de preço não enxerga o desconto de cache da z.ai, então o ritmo real manda
// e o gasto por robô é ajustado proporcionalmente.
const AMOSTRA_MIN = 60;
const AMOSTRA_DIAS = 8;
const DIAS_MES = 30;
const IOF = 0.035; // cartão internacional, aproximado

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
    Object.entries(m && typeof m === "object" ? m : {}).slice(0, 120).forEach(([k, u]) => { out[txt(k, 60)] = limparUso(u); });
    return out;
  };
  const j = b.janelas || {};
  return {
    desde: b.desde ? txt(b.desde, 40) : null,
    janelas: { desde: limparMapa(j.desde), h24: limparMapa(j.h24), d7: limparMapa(j.d7), hoje: limparMapa(j.hoje) },
    dias: (Array.isArray(b.dias) ? b.dias : []).slice(-14).map((d) => ({ dia: txt(d && d.dia, 10), modelos: limparMapa(d && d.modelos) })),
    horas: (Array.isArray(b.horas) ? b.horas : []).slice(-24).map((d) => ({ hora: txt(d && d.hora, 13), modelos: limparMapa(d && d.modelos) })),
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

// Chamadas ao Groq chegam como modelo "groq:<tipo>": são grátis e têm seção própria.
const ehGroq = (modelo) => String(modelo || "").startsWith("groq:");

// Soma um mapa "robo|modelo[|parte]" → uso em custo/tokens (só z.ai).
function somar(mapa) {
  const t = { custo: 0, entrada: 0, saida: 0, chamadas: 0, porRobo: {}, porModelo: {} };
  for (const [chave, u] of Object.entries(mapa || {})) {
    const [robo, modelo] = chave.includes("|") ? chave.split("|") : ["", chave];
    if (ehGroq(modelo)) continue;
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
  const c = cfg && Number.isFinite(cfg.saldo) && cfg.em ? cfg : { ...INICIAL, avisados: {} };
  if (!Array.isArray(c.amostras) || !c.amostras.length) c.amostras = INICIAL.amostras.slice();
  return c;
}

// Devolve as amostras novas se for hora de guardar outra (ou null).
function novaAmostra(ia, cfg) {
  const real = ia && ia.saldoReal;
  if (!real || !Number.isFinite(real.gastoTotal) || !real.consultadoEm) return null;
  const lista = (cfg.amostras || []).slice();
  const ult = lista[lista.length - 1];
  if (ult && Date.parse(real.consultadoEm) - Date.parse(ult.t) < AMOSTRA_MIN * 60000) return null;
  lista.push({ t: real.consultadoEm, g: real.gastoTotal });
  const limite = Date.now() - AMOSTRA_DIAS * 864e5;
  return lista.filter((a) => Date.parse(a.t) >= limite);
}

// Ritmo real em US$/dia: queda do gasto total na janela mais longa disponível (até 3 dias,
// mínimo 3 h). Janela curta tende a superestimar (pega só o horário de movimento).
function ritmoReal(real, amostras) {
  if (!real || !Array.isArray(amostras)) return null;
  const agora = Date.parse(real.consultadoEm);
  const validas = amostras.filter((a) => {
    const idade = agora - Date.parse(a.t);
    return idade >= 3 * 3600e3 && idade <= 3 * 864e5;
  });
  if (!validas.length) return null;
  const mais = validas.reduce((m, a) => (Date.parse(a.t) < Date.parse(m.t) ? a : m));
  const horas = (agora - Date.parse(mais.t)) / 3600e3;
  const gasto = real.gastoTotal - mais.g;
  if (horas <= 0 || gasto < 0) return null;
  return { porDia: (gasto / horas) * 24, horas: Math.round(horas) };
}

// Junta saldo informado + uso da VPS num resumo para a tela e para os alertas.
// Groq: chamadas por robô e tipo, quantas deram certo e por que falharam.
const GROQ_FALHA_AVISO = 0.2; // acima de 20% de falha no dia, o painel destaca
function resumoGroq(ia) {
  const agrupar = (mapa) => {
    const g = {};
    for (const [chave, u] of Object.entries(mapa || {})) {
      const [robo, modelo, resultado] = chave.split("|");
      if (!ehGroq(modelo)) continue;
      const k = robo + "|" + modelo.slice(5);
      const l = g[k] || (g[k] = { robo: NOMES_ROBO[robo] || robo, tipo: modelo.slice(5), chamadas: 0, ok: 0, semAudio: 0, erros: {}, tokens: 0 });
      l.chamadas += u.chamadas;
      l.tokens += u.entrada + u.saida;
      if (!resultado || resultado === "ok") l.ok += u.chamadas;
      else if (resultado === "sem_audio") l.semAudio += u.chamadas;
      else l.erros[resultado] = (l.erros[resultado] || 0) + u.chamadas;
    }
    const linhas = Object.values(g).sort((a, b) => b.chamadas - a.chamadas);
    const tot = linhas.reduce((t, l) => {
      t.chamadas += l.chamadas; t.ok += l.ok; t.tokens += l.tokens;
      for (const [m, n] of Object.entries(l.erros)) { t.falhas += n; t.erros[m] = (t.erros[m] || 0) + n; }
      return t;
    }, { chamadas: 0, ok: 0, falhas: 0, tokens: 0, erros: {} });
    tot.taxaFalha = tot.chamadas ? tot.falhas / tot.chamadas : 0;
    return { linhas, ...tot };
  };
  const hoje = agrupar(ia.janelas.hoje);
  const h24 = agrupar(ia.janelas.h24);
  const d7 = agrupar(ia.janelas.d7);
  return { hoje, h24, d7: { chamadas: d7.chamadas, falhas: d7.falhas, taxaFalha: d7.taxaFalha, erros: d7.erros }, alerta: hoje.chamadas >= 5 && hoje.taxaFalha > GROQ_FALHA_AVISO };
}

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
  const porDiaTokens = Math.max(h24.custo, d7.custo / diasComDado);
  const real = ia.saldoReal && Date.now() - Date.parse(ia.saldoReal.consultadoEm) < REAL_VALE_MIN * 60000 ? ia.saldoReal : null;
  const rr = ritmoReal(real, cfg.amostras);
  const porDia = rr ? rr.porDia : porDiaTokens;
  // fator que leva o custo pela tabela ao gasto real (desconto de cache etc.)
  const fator = rr && porDiaTokens > 0 ? rr.porDia / porDiaTokens : 1;
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
    hoje: { custo: hoje.custo * fator, entrada: hoje.entrada, saida: hoje.saida, chamadas: hoje.chamadas },
    h24: { custo: rr && rr.horas >= 20 ? rr.porDia : h24.custo * fator, entrada: h24.entrada, saida: h24.saida, chamadas: h24.chamadas },
    ritmoFonte: rr ? "real" : "tokens",
    ritmoHoras: rr ? rr.horas : null,
    mes: (() => {
      const precisa = porDia * DIAS_MES;
      const saldo = estimado || 0;
      return { precisa, recarregar: Math.max(0, Math.ceil(precisa - saldo)) };
    })(),
    porRobo24h: Object.entries(h24.porRobo).map(([id, c]) => ({ id, nome: NOMES_ROBO[id] || id, custo: c * fator })).sort((a, b) => b.custo - a.custo),
    porModelo24h: Object.entries(h24.porModelo).map(([modelo, c]) => ({ modelo, custo: c * fator })).sort((a, b) => b.custo - a.custo),
    porRoboModelo24h: Object.entries(ia.janelas.h24).filter(([chave]) => !ehGroq(chave.split("|")[1])).map(([chave, u]) => {
      const [robo, modelo, parte] = chave.split("|");
      return { robo: NOMES_ROBO[robo] || robo, modelo, parte: parte || null, chamadas: u.chamadas, entrada: u.entrada, saida: u.saida, custo: custo(modelo, u) * fator };
    }).sort((a, b) => b.custo - a.custo),
    dias: ia.dias.map((d) => ({ dia: d.dia, custo: somar(d.modelos).custo * fator })),
    horas: (ia.horas || []).map((h) => ({ hora: h.hora, custo: somar(h.modelos).custo * fator })),
    groq: resumoGroq(ia),
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

// Cotação do dólar (cache de 6 h por instância). Falha = última conhecida ou 5,50.
let cotacaoCache = null;
async function cotacao() {
  if (cotacaoCache && Date.now() - cotacaoCache.em < 6 * 3600e3) return cotacaoCache;
  const fontes = [
    async () => { const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(4000) }); const d = await r.json(); return Number(d && d.rates && d.rates.BRL); },
    async () => { const r = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", { signal: AbortSignal.timeout(4000) }); const d = await r.json(); return Number(d && d.USDBRL && d.USDBRL.bid); },
  ];
  for (const f of fontes) {
    try {
      const v = await f();
      if (Number.isFinite(v) && v > 1 && v < 20) { cotacaoCache = { brl: v, em: Date.now(), fonte: "ao vivo" }; return cotacaoCache; }
    } catch { /* tenta a próxima */ }
  }
  return cotacaoCache || { brl: 5.5, em: Date.now(), fonte: "fixa" };
}

module.exports = { normalizarIa, resumo, decidirAvisos, lerConfig, gravarConfig, novaAmostra, cotacao, dolar, PRECOS, IOF };
