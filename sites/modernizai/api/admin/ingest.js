// POST /api/admin/ingest  (só a VPS chama, com o cabeçalho x-painel-chave)
// Guarda o relatório e manda push quando algo cai ou volta.
const { json, lerCorpo, iguais, lerJson, gravarJson, ARQ, enviarPush } = require("./_lib");
const { normalizar, verificacoes, decidir } = require("./_regras");
const zai = require("./_zai");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { erro: "método" });
  if (!process.env.PAINEL_CHAVE_VPS || !iguais(req.headers["x-painel-chave"], process.env.PAINEL_CHAVE_VPS))
    return json(res, 401, { erro: "chave" });
  let bruto;
  try {
    bruto = await lerCorpo(req, 64 * 1024);
  } catch {
    return json(res, 400, { erro: "pedido inválido" });
  }
  const s = normalizar(bruto);
  const checks = verificacoes(s);
  const estado = await lerJson(ARQ.alertas, {});
  const { checks: novos, avisos } = decidir(checks, estado);
  if (estado.semSinal)
    avisos.unshift({ titulo: "✅ VPS voltou a responder", texto: "Os relatórios voltaram a chegar.", tag: "vps:sinal", nivel: "ok" });

  // IA z.ai: saldo estimado e avisos de recarga (push + WhatsApp pela VPS)
  const ia = zai.normalizarIa(bruto && bruto.ia);
  const cfgIa = await zai.lerConfig();
  const whatsapp = [];
  if (ia) {
    const { avisos: avisosIa, avisados } = zai.decidirAvisos(zai.resumo(ia, cfgIa), cfgIa);
    const { _recarregado, ...avisadosLimpos } = avisados;
    const recarga = _recarregado != null && _recarregado !== cfgIa.recarregado;
    if (avisosIa.length || recarga) {
      await zai.gravarConfig({ ...cfgIa, avisados: avisadosLimpos, ...(recarga ? { recarregado: _recarregado } : {}) });
      avisos.push(...avisosIa);
      whatsapp.push(...avisosIa.map((a) => `${a.titulo}\n${a.texto}`));
    }
  }

  const agora = new Date().toISOString();
  await gravarJson(ARQ.status, { ...s, ia, checks, recebidoEm: agora });
  await gravarJson(ARQ.alertas, { checks: novos, semSinal: false, atualizadoEm: agora });
  const r = await enviarPush(avisos);
  return json(res, 200, { ok: true, avisos: avisos.length, enviados: r.enviados, ia_desde: cfgIa.em, whatsapp });
};
