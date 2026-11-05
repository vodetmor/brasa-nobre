// GET    /api/admin/push            → chave pública VAPID
// POST   /api/admin/push {inscricao} → liga as notificações neste celular
// POST   /api/admin/push {teste:true} → manda uma notificação de teste
// DELETE /api/admin/push {endpoint} → desliga neste celular
const { json, lerCorpo, logado, mesmaOrigem, lerJson, gravarJson, ARQ, enviarPush } = require("./_lib");

module.exports = async (req, res) => {
  if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem" });
  if (!logado(req)) return json(res, 401, { erro: "login" });
  if (req.method === "GET") return json(res, 200, { chave: process.env.VAPID_PUBLICA || null });

  let corpo;
  try {
    corpo = await lerCorpo(req, 8 * 1024);
  } catch {
    return json(res, 400, { erro: "pedido inválido" });
  }

  if (req.method === "POST" && corpo.teste) {
    const r = await enviarPush([
      { titulo: "Modernizai Admin", texto: "Notificações funcionando neste celular ✅", tag: "teste", nivel: "ok" },
    ]);
    return json(res, 200, { ok: true, enviados: r.enviados });
  }

  const lista = await lerJson(ARQ.inscricoes, []);
  if (req.method === "POST") {
    const s = corpo.inscricao;
    const valido =
      s && typeof s.endpoint === "string" && s.endpoint.startsWith("https://") && s.endpoint.length < 1000 &&
      s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
    if (!valido) return json(res, 400, { erro: "inscrição inválida" });
    const limpa = { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh.slice(0, 200), auth: s.keys.auth.slice(0, 100) } };
    const nova = lista.filter((x) => x.endpoint !== limpa.endpoint).concat(limpa).slice(-20);
    await gravarJson(ARQ.inscricoes, nova);
    return json(res, 200, { ok: true, aparelhos: nova.length });
  }
  if (req.method === "DELETE") {
    const nova = lista.filter((x) => x.endpoint !== corpo.endpoint);
    await gravarJson(ARQ.inscricoes, nova);
    return json(res, 200, { ok: true, aparelhos: nova.length });
  }
  return json(res, 405, { erro: "método" });
};
