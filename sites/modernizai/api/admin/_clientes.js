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
    situacao: "Fechado em 27/10/2026 · Fátima no ar desde 13/11 (médicos e agenda do Sigma) · pausada em 18/11 a pedido do Ribeiro",
    whatsapp: "medicmais",
    // Demandas em aberto (atualizar quando mudar). estado: feito | andamento | aguardando
    demandas: [
      { texto: "Treinamento da clínica virou base com busca (preços, convênios, objeções)", estado: "feito", data: "06/11" },
      { texto: "Fátima com médicos do Sigma, marcar e cancelar direto no Sigma", estado: "feito", data: "13/11" },
      { texto: "Preços, regras e profissionais por consulta (ferramentas), memória do paciente", estado: "feito", data: "13/11" },
      { texto: "Ajustes 1 a 6: menos chamada de humano, juntar mensagens, recepção pelo celular, trava, erro da IA, áudio", estado: "andamento", data: "18/11", obs: "testando no fluxo de teste; robô pausado" },
      { texto: "Ajuste 7: marcar mais de uma consulta (\"uma por vez\")", estado: "aguardando", obs: "mostrar ao Ribeiro antes de mudar" },
      { texto: "Confirmação de agenda na véspera e follow-up", estado: "aguardando", obs: "clínica: o Sigma já confirma por WhatsApp?" },
      { texto: "Campanhas de repescagem", estado: "aguardando", obs: "cada uma com OK do Ribeiro; Saúde Day não divulgar" },
      { texto: "Confirmar com a clínica: 36x odonto, vale-hemograma, retorno no 2º sábado", estado: "aguardando" },
      { texto: "Limpar consultas de teste no Sigma (423093 e 424724)", estado: "aguardando", obs: "datas já passaram; precisa login do Sigma" },
      { texto: "Trocar senha do banco e tokens que apareceram no chat", estado: "aguardando" },
    ],
    robo: "medicmais",
    links: [
      { nome: "Site", url: "https://medicmais-sobradinho-site.vercel.app" },
      { nome: "Painel do robô", url: "https://painel.179-197-85-185.sslip.io/app/" },
    ],
  },
];
