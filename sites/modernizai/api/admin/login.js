// POST /api/admin/login  {senha}  → cria a sessão (cookie HttpOnly)
// DELETE /api/admin/login         → sai
const { json, lerCorpo, iguais, criarSessao, encerrarSessao, logado, mesmaOrigem } = require("./_lib");

module.exports = async (req, res) => {
  if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem" });
  if (req.method === "GET") return json(res, 200, { logado: logado(req) });
  if (req.method === "DELETE") {
    encerrarSessao(res);
    return json(res, 200, { ok: true });
  }
  if (req.method !== "POST") return json(res, 405, { erro: "método" });
  if (!process.env.ADMIN_SENHA || !process.env.ADMIN_SEGREDO) return json(res, 503, { erro: "Painel ainda não configurado." });
  let corpo;
  try {
    corpo = await lerCorpo(req, 2048);
  } catch {
    return json(res, 400, { erro: "pedido inválido" });
  }
  if (!iguais(corpo && corpo.senha, process.env.ADMIN_SENHA)) {
    await new Promise((r) => setTimeout(r, 800)); // freia tentativa e erro
    return json(res, 401, { erro: "Senha incorreta." });
  }
  criarSessao(res);
  return json(res, 200, { ok: true });
};
