// GET /api/admin/status → último relatório da VPS + clientes (precisa estar logado)
const { json, logado, lerJson, ARQ } = require("./_lib");
const clientes = require("./_clientes");
const zai = require("./_zai");

module.exports = async (req, res) => {
  if (req.method !== "GET") return json(res, 405, { erro: "método" });
  if (!logado(req)) return json(res, 401, { erro: "login" });
  const [status, cfgIa] = await Promise.all([lerJson(ARQ.status, null), zai.lerConfig()]);
  const ia = zai.resumo(status && status.ia, cfgIa);
  if (status) delete status.ia;
  return json(res, 200, {
    agora: new Date().toISOString(),
    status,
    ia,
    clientes: clientes.map(({ id, nome, servico, situacao, whatsapp, robo, links, demandas }) => ({
      id, nome, servico, situacao, whatsapp, robo, links, demandas: demandas || [],
    })),
  });
};
