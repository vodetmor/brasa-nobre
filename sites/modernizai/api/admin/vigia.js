// GET /api/admin/vigia  (chamado de 10 em 10 min pelo GitHub Actions)
// Se a VPS parou de mandar relatório há mais de 10 min, avisa uma vez.
// Não recebe nem devolve dado nenhum: é seguro ficar aberto.
const { json, lerJson, gravarJson, ARQ, enviarPush } = require("./_lib");
const LIMITE_MIN = 10;

module.exports = async (req, res) => {
  const status = await lerJson(ARQ.status, null);
  if (!status || !status.recebidoEm) return json(res, 200, { ok: true, situacao: "sem-relatorio" });
  const minutos = (Date.now() - Date.parse(status.recebidoEm)) / 60000;
  if (minutos <= LIMITE_MIN) return json(res, 200, { ok: true, situacao: "ok" });
  const estado = await lerJson(ARQ.alertas, {});
  if (estado.semSinal) return json(res, 200, { ok: true, situacao: "ja-avisado" });
  await gravarJson(ARQ.alertas, { ...estado, semSinal: true, atualizadoEm: new Date().toISOString() });
  await enviarPush([
    {
      titulo: "🔴 VPS sem sinal",
      texto: `Nenhum relatório há ${Math.round(minutos)} min. A VPS pode ter caído.`,
      tag: "vps:sinal",
      nivel: "erro",
    },
  ]);
  return json(res, 200, { ok: true, situacao: "avisado" });
};
