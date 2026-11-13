// Clientes mostrados no painel. Sem valores, senhas ou dados de pacientes/clientes finais.
// "whatsapp" liga o cliente ao id da sessão que a VPS manda no relatório.
module.exports = [
  {
    id: "central-do-espeto",
    nome: "Central do Espeto",
    servico: "Cardápio digital + robô de WhatsApp",
    situacao: "Em produção desde 20/10/2026",
    demandas: [],
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
    situacao: "Fechado em 27/10/2026 · no ar segue o robô antigo (demo); versão nova em teste",
    whatsapp: "medicmais",
    // Demandas em aberto (atualizar quando mudar). estado: feito | andamento | aguardando
    demandas: [
      { texto: "Treinamento da clínica virou base com busca (preços, convênios, objeções)", estado: "feito", data: "06/11" },
      { texto: "Robô novo com médicos do Sigma e marcação direta", estado: "andamento", data: "05/11", obs: "pronto no fluxo de teste" },
      { texto: "Ligar a base de treinamento e a memória do paciente no n8n", estado: "aguardando", obs: "sessão do servidor (VPS)" },
      { texto: "Confirmação de agenda na véspera", estado: "aguardando", obs: "doutor: Sigma já confirma? horário?" },
      { texto: "Follow-up e aviso de exames pendentes", estado: "aguardando", obs: "depois da confirmação" },
      { texto: "Campanhas (Saúde Day, repescagem)", estado: "aguardando", obs: "cada uma com OK do Ribeiro" },
      { texto: "Confirmar com a clínica: 36x odonto, vale-hemograma, retorno no 2º sábado", estado: "aguardando" },
      { texto: "Cancelar consulta de teste 423093 (16/11 8h30) no Sigma", estado: "aguardando" },
    ],
    robo: "medicmais",
    links: [
      { nome: "Site", url: "https://medicmais-sobradinho-site.vercel.app" },
      { nome: "Painel do robô", url: "https://painel.179-197-85-185.sslip.io/app/" },
    ],
  },
];
