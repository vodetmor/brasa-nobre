// Regras do painel: transforma o relatório da VPS em "verificações" (ok / com problema)
// e decide quando mandar notificação. Um problema só vira alerta se aparecer em
// 2 relatórios seguidos (evita alarme falso quando o WhatsApp está só reiniciando).

const LIMITES = { disco: 85, memoria: 92, swap: 90 };
const CONFIRMAR = 2; // relatórios seguidos com problema antes de avisar

const NOMES = {
  "waha-espeto": "WAHA Espeto",
  "waha-atendente": "WAHA MedicMais",
  "n8n-espeto": "n8n Espeto",
  "n8n-atendente": "n8n MedicMais",
  "qr-espeto": "Página do QR Espeto",
  "qr-medicmais": "Página do QR MedicMais",
  "db-atendente": "Banco MedicMais",
  "frames-atendente": "Frames MedicMais",
  caddy: "Caddy (HTTPS)",
};

const texto = (v, max = 60) => String(v == null ? "" : v).slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Limpa e limita o que chega da VPS (nunca confiar no formato).
function normalizar(bruto) {
  const b = bruto && typeof bruto === "object" ? bruto : {};
  const vps = b.vps || {};
  return {
    geradoEm: texto(b.geradoEm, 40),
    vps: {
      disco_pct: num(vps.disco_pct),
      mem_pct: num(vps.mem_pct),
      swap_pct: num(vps.swap_pct),
      carga1: num(vps.carga1),
      cpus: num(vps.cpus),
      uptime_h: num(vps.uptime_h),
    },
    whatsapp: (Array.isArray(b.whatsapp) ? b.whatsapp : []).slice(0, 10).map((w) => ({
      id: texto(w.id, 30),
      nome: texto(w.nome, 40),
      estado: texto(w.estado, 30),
      numero: texto(w.numero, 12), // só o final, ex.: "…5754"
    })),
    servicos: (Array.isArray(b.servicos) ? b.servicos : []).slice(0, 30).map((s) => ({
      nome: texto(s.nome, 40),
      estado: texto(s.estado, 20),
      saude: texto(s.saude, 20),
    })),
    robos: (Array.isArray(b.robos) ? b.robos : []).slice(0, 10).map((r) => ({
      id: texto(r.id, 30),
      nome: texto(r.nome, 40),
      erros_15min: num(r.erros_15min) || 0,
      ultimo_erro: texto(r.ultimo_erro, 40) || null,
    })),
  };
}

function verificacoes(s) {
  const lista = [];
  for (const w of s.whatsapp) {
    lista.push({
      id: "wa:" + w.id,
      grupo: "whatsapp",
      nome: "WhatsApp " + w.nome,
      ok: w.estado === "WORKING",
      detalhe: w.estado === "WORKING" ? "Conectado" : traduzEstado(w.estado),
    });
  }
  for (const r of s.robos) {
    lista.push({
      id: "robo:" + r.id,
      grupo: "robos",
      nome: r.nome,
      ok: r.erros_15min === 0,
      detalhe: r.erros_15min === 0 ? "Sem erros" : `${r.erros_15min} erro(s) nos últimos 15 min`,
    });
  }
  for (const sv of s.servicos) {
    const ok = sv.estado === "running" && sv.saude !== "unhealthy";
    lista.push({
      id: "svc:" + sv.nome,
      grupo: "servicos",
      nome: NOMES[sv.nome] || sv.nome,
      ok,
      detalhe: ok ? "Rodando" : sv.estado === "running" ? "Com problema" : "Parado",
    });
  }
  const v = s.vps;
  if (v.disco_pct != null)
    lista.push({ id: "vps:disco", grupo: "vps", nome: "Disco da VPS", ok: v.disco_pct < LIMITES.disco, detalhe: `${Math.round(v.disco_pct)}% usado` });
  if (v.mem_pct != null)
    lista.push({ id: "vps:memoria", grupo: "vps", nome: "Memória da VPS", ok: v.mem_pct < LIMITES.memoria, detalhe: `${Math.round(v.mem_pct)}% usada` });
  if (v.swap_pct != null)
    lista.push({ id: "vps:swap", grupo: "vps", nome: "Swap da VPS", ok: v.swap_pct < LIMITES.swap, detalhe: `${Math.round(v.swap_pct)}% usada` });
  return lista;
}

function traduzEstado(e) {
  return (
    {
      SCAN_QR_CODE: "Desconectado (precisa ler o QR)",
      STARTING: "Reiniciando",
      FAILED: "Caiu",
      STOPPED: "Parado",
      SEM_RESPOSTA: "WAHA não respondeu",
    }[e] || e || "Sem informação"
  );
}

// Compara com o estado anterior e devolve as notificações a mandar.
function decidir(lista, estado) {
  const anterior = (estado && estado.checks) || {};
  const novo = {};
  const avisos = [];
  for (const c of lista) {
    const a = anterior[c.id] || { seguidas: 0, alertado: false };
    if (c.ok) {
      if (a.alertado) avisos.push({ titulo: "✅ " + c.nome + " voltou", texto: c.detalhe, tag: c.id, nivel: "ok" });
      novo[c.id] = { seguidas: 0, alertado: false };
    } else {
      const seguidas = (a.seguidas || 0) + 1;
      let alertado = a.alertado;
      if (!alertado && seguidas >= CONFIRMAR) {
        avisos.push({ titulo: "⚠️ " + c.nome, texto: c.detalhe, tag: c.id, nivel: "erro" });
        alertado = true;
      }
      novo[c.id] = { seguidas, alertado };
    }
  }
  return { checks: novo, avisos };
}

module.exports = { normalizar, verificacoes, decidir, LIMITES };
