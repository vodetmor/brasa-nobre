/* =========================================================
   FC CLOSET · acesso aos dados da loja (Supabase)
   A chave abaixo é a chave pública do site: só permite o que as
   regras do banco liberam (visitante lê, apenas a dona edita).
   ========================================================= */
window.FC_CONFIG = {
  url: "https://wormdqmiqagipoovcjxl.supabase.co",
  chave: "sb_publishable_4TJHSL8jg72dhEPFqW8p9Q_b32uzTu9",
  /* usados só se a loja não carregar */
  whatsapp: "5561996381700",
  instagram: "https://www.instagram.com/fc.closeet/"
};

(function () {
  const C = window.FC_CONFIG;
  const CACHE = "fc-loja-v2";

  /* foto: "sb:<id>.<ext>" (enviada pelo painel) ou nome de arquivo em img/fotos/ */
  window.FC_FOTO = (f, tam, base = "") => {
    const suf = tam ? "-" + tam : "";
    if (f.startsWith("sb:")) {
      const [id, ext] = f.slice(3).split(".");
      return `${C.url}/storage/v1/object/public/fotos/${encodeURIComponent(id)}${suf}.${ext === "jpg" ? "jpg" : "webp"}`;
    }
    return `${base}img/fotos/${encodeURIComponent(f)}${suf}.webp`;
  };

  async function le(caminho) {
    const corta = new AbortController(), t = setTimeout(() => corta.abort(), 10000);
    try {
      const r = await fetch(`${C.url}/rest/v1/${caminho}`, { headers: { apikey: C.chave }, cache: "no-store", signal: corta.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  /* sempre busca o mais novo; sem conexão, mostra a última versão vista neste aparelho */
  window.FC_CARREGA = async () => {
    try {
      const [loja, categorias, produtos] = await Promise.all([
        le("loja?select=*&id=eq.1"),
        le("categorias?select=nome&order=ordem,nome"),
        le("produtos?select=*&visivel=is.true&order=ordem,criado_em.desc")
      ]);
      if (!loja[0]) throw new Error("loja vazia");
      const d = { loja: loja[0], categorias: categorias.map(c => c.nome), produtos };
      try { localStorage.setItem(CACHE, JSON.stringify(d)); } catch (e) {}
      return d;
    } catch (erro) {
      try { const s = localStorage.getItem(CACHE); if (s) return JSON.parse(s); } catch (e) {}
      throw erro;
    }
  };
})();
