// Clientes mostrados no painel. Sem valores, senhas ou dados de pacientes/clientes finais.
// "whatsapp" liga o cliente ao id da sessão que a VPS manda no relatório.
module.exports = [
  {
    id: "central-do-espeto",
    nome: "Central do Espeto",
    servico: "Cardápio digital + robô de WhatsApp",
    situacao: "Em produção desde 20/10/2026",
    whatsapp: "espeto",
    robo: "espeto",
    links: [
      { nome: "Cardápio", url: "https://brasa-nobre.vercel.app" },
      { nome: "Painel do restaurante", url: "https://brasa-nobre.vercel.app/r/central-do-espeto/painel" },
    ],
  },
  {
    id: "medicmais",
    nome: "MedicMais Sobradinho",
    servico: "Robô de WhatsApp (atendimento)",
    situacao: "Fechado em 27/10/2026",
    whatsapp: "medicmais",
    robo: "medicmais",
    links: [
      { nome: "Site", url: "https://medicmais-sobradinho-site.vercel.app" },
      { nome: "Painel do robô", url: "https://medic-mais.vercel.app" },
    ],
  },
];
