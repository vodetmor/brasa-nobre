// Modernizai — comportamento do site.
// WHATSAPP: troque pelo número da agência (só dígitos, com 55 + DDD).
// Enquanto estiver vazio, os botões levam para a seção de contato.
const WHATSAPP = "";
const MENSAGEM = "Olá! Vim pelo site da Modernizai e quero modernizar o meu negócio.";

if (WHATSAPP) {
  const link = "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(MENSAGEM);
  document.querySelectorAll("[data-whats]").forEach((a) => {
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener";
  });
}

// Menu do celular
const botao = document.querySelector(".topo__abrir");
const menu = document.getElementById("menu");
function fechar() {
  menu.classList.remove("aberto");
  document.body.classList.remove("menu-aberto");
  botao.setAttribute("aria-expanded", "false");
  botao.setAttribute("aria-label", "Abrir menu");
}
botao.addEventListener("click", () => {
  const abrir = !menu.classList.contains("aberto");
  if (!abrir) return fechar();
  menu.classList.add("aberto");
  document.body.classList.add("menu-aberto");
  botao.setAttribute("aria-expanded", "true");
  botao.setAttribute("aria-label", "Fechar menu");
});
menu.addEventListener("click", (e) => { if (e.target.closest("a")) fechar(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });

document.getElementById("ano").textContent = new Date().getFullYear();
