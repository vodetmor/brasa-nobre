// POST /api/admin/zai  {saldo}  → informa o saldo atual da z.ai (ex.: depois de recarregar).
// O painel passa a descontar o gasto a partir deste momento e libera os avisos de novo.
const { json, lerCorpo, logado, mesmaOrigem } = require("./_lib");
const zai = require("./_zai");

module.exports = async (req, res) => {
  if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem" });
  if (!logado(req)) return json(res, 401, { erro: "login" });
  if (req.method !== "POST") return json(res, 405, { erro: "método" });
  let corpo;
  try {
    corpo = await lerCorpo(req, 1024);
  } catch {
    return json(res, 400, { erro: "pedido inválido" });
  }
  const saldo = Number(String(corpo && corpo.saldo).replace(",", "."));
  if (!Number.isFinite(saldo) || saldo < 0 || saldo > 10000) return json(res, 400, { erro: "Saldo inválido. Use o valor em dólar, ex.: 10,00" });
  const anterior = await zai.lerConfig();
  const novo = {
    saldo: Math.round(saldo * 100) / 100,
    em: new Date().toISOString(),
    avisados: {},
    anterior: { saldo: anterior.saldo, em: anterior.em },
  };
  await zai.gravarConfig(novo);
  return json(res, 200, { ok: true, saldo: novo.saldo, em: novo.em });
};
