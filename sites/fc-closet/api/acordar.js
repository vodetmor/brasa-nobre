/* Visita diária ao banco: o plano grátis do Supabase pausa projetos com pouca
   atividade em 7 dias. Agendado no vercel.json. Só faz leituras públicas.
   Reduz muito o risco de pausa, mas o Supabase só garante no plano Pro. */
const URL_BASE = "https://wormdqmiqagipoovcjxl.supabase.co/rest/v1/";
const CHAVE = "sb_publishable_4TJHSL8jg72dhEPFqW8p9Q_b32uzTu9";
const CONSULTAS = ["loja?select=id", "categorias?select=nome", "produtos?select=id&limit=1", "produtos?select=nome&order=ordem&limit=5"];

export default async function handler(req, res) {
  const resultados = await Promise.all(CONSULTAS.map(c =>
    fetch(URL_BASE + c, { headers: { apikey: CHAVE }, cache: "no-store" }).then(r => r.status).catch(() => 0)));
  const ok = resultados.every(s => s === 200);
  if (!ok) console.error("Banco não respondeu como esperado:", resultados.join(","));
  res.setHeader("Cache-Control", "no-store");
  res.status(ok ? 200 : 502).json({ ok });
}
