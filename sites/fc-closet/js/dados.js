/* =========================================================
   FC CLOSET · dados da loja (catálogo)
   Padrão = peças de exemplo (1ª coleção). O painel da dona (/admin)
   salva alterações no navegador (demonstração). No site final,
   o painel grava no banco de dados.
   ========================================================= */
window.FC_CONFIG = {
  /* WhatsApp com DDI+DDD (ex.: "5561999999999"). Vazio = usa o link do QR da bio. */
  whatsapp: "",
  whatsQr: "https://wa.me/qr/5NHOXKOQ7VK7L1",
  instagram: "https://www.instagram.com/fc.closeet/",
  senhaDemo: "closet2026"
};

window.FC_TAM = ["P", "M", "G", "GG"];

window.FC_CATEGORIAS_PADRAO = ["Branco", "Preto", "Vinho", "Manteiga"];

window.FC_PADRAO = [
  { id: "vestido-assimetrico-branco", nome: "Vestido Assimétrico Branco", categoria: "Branco", preco: 289.9, novidade: true, disponivel: true,
    fotos: ["branco-assimetrico", "branco-assimetrico-2", "branco-sentada", "branco-costas"], tamanhos: ["P", "M", "G"],
    descricao: "Longo em malha, com recorte na cintura e echarpe de amarrar no ombro. Caimento justo e elegante." },
  { id: "vestido-assimetrico-preto", nome: "Vestido Assimétrico Preto", categoria: "Preto", preco: 289.9, novidade: true, disponivel: true,
    fotos: ["preto-assimetrico", "preto-assimetrico-2", "preto-assimetrico-3"], tamanhos: ["P", "M", "G"],
    descricao: "O clássico preto com recorte vazado e laço lateral. Para sair de dia ou de noite." },
  { id: "vestido-costas-abertas-vinho", nome: "Vestido Costas Abertas Vinho", categoria: "Vinho", preco: 269.9, novidade: true, disponivel: true,
    fotos: ["vinho-costas-abertas", "vinho-costas-detalhe"], tamanhos: ["P", "M", "G"],
    descricao: "Longo vinho com costas abertas e modelagem que valoriza a silhueta. A cor da marca." },
  { id: "vestido-longo-manteiga", nome: "Vestido Longo Manteiga", categoria: "Manteiga", preco: 259.9, novidade: true, disponivel: true,
    fotos: ["manteiga-fenda", "manteiga-frente"], tamanhos: ["P", "M", "G"],
    descricao: "Amarelo manteiga com fenda lateral e decote reto. Leve, delicado e cheio de presença." },
  { id: "vestido-amarracao-manteiga", nome: "Vestido Costas com Amarração", categoria: "Manteiga", preco: 279.9, novidade: false, disponivel: true,
    fotos: ["duo-branco-manteiga"], tamanhos: ["P", "M", "G"],
    descricao: "Amarelo manteiga com amarração nas costas e barra com babado. Romântico e marcante." },
  { id: "vestido-sereia-branco", nome: "Vestido Longo Branco Tomara que Caia", categoria: "Branco", preco: 249.9, novidade: false, disponivel: true,
    fotos: ["branco-sentada-2", "branco-assimetrico-2"], tamanhos: ["P", "M", "G"],
    descricao: "Branco puro, tomara que caia, modelagem ajustada até o tornozelo." }
];

/* capas das categorias (home) */
window.FC_CAPAS = { Branco: "branco-assimetrico", Preto: "preto-assimetrico", Vinho: "vinho-costas-abertas", Manteiga: "manteiga-fenda" };

(function () {
  const CHAVE = "fc-catalogo-v1";
  const CHAVE_CAT = "fc-categorias-v1";
  const copia = o => JSON.parse(JSON.stringify(o));
  window.FC_DB = {
    produtos() {
      try { const s = localStorage.getItem(CHAVE); if (s) return JSON.parse(s); } catch (e) {}
      return copia(window.FC_PADRAO);
    },
    salvar(lista) {
      try { localStorage.setItem(CHAVE, JSON.stringify(lista)); return true; }
      catch (e) { return false; }
    },
    categorias() {
      try { const s = localStorage.getItem(CHAVE_CAT); if (s) return JSON.parse(s); } catch (e) {}
      return window.FC_CATEGORIAS_PADRAO.slice();
    },
    salvarCategorias(l) { try { localStorage.setItem(CHAVE_CAT, JSON.stringify(l)); } catch (e) {} },
    restaurar() { try { localStorage.removeItem(CHAVE); localStorage.removeItem(CHAVE_CAT); } catch (e) {} },
    personalizado() { try { return !!localStorage.getItem(CHAVE); } catch (e) { return false; } }
  };
  /* foto: nome do arquivo em img/fotos/ ou imagem enviada pela dona (data:) */
  window.FC_FOTO = (f, tam) => f.startsWith("data:") ? f
    : `img/fotos/${f}${tam === "s" ? "-s" : tam === "m" ? "-m" : tam === "l" ? "-l" : ""}.webp`;
})();
