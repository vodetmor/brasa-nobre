// Atendimento pelo WhatsApp. O robô (n8n + WAHA + IA) chama as rotas /api/r/<slug>/wa/bot/* com a chave
// WA_BOT_TOKEN; a equipe usa a tela /r/<slug>/atendimento (conversas, pedidos, assumir a conversa).
// O cardápio e os preços saem sempre do banco: a IA só repassa o que o cliente escolheu.
import { timingSafeEqual } from 'node:crypto';
import { all, get, run, tx, newToken } from './db.js';
import { config } from './config.js';
import { HttpError } from './lib/http.js';
import { menuFor, parseOptions, orderFull } from './services.js';
import { publish, staffChannel } from './lib/realtime.js';

const ORDER_STATUSES = ['novo', 'confirmado', 'saiu', 'pronto', 'entregue', 'cancelado'];
const OPEN_ORDER = "('novo', 'confirmado', 'saiu', 'pronto')";
const PAYMENTS = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão' };
const STATUS_LABEL = { novo: 'recebido, aguardando a equipe', confirmado: 'confirmado, em preparo', saiu: 'saiu para entrega',
  pronto: 'pronto para retirar', entregue: 'entregue', cancelado: 'cancelado' };
// Aviso automático para o cliente quando a equipe muda o status do pedido no painel
const STATUS_MSG = {
  confirmado: (o, r) => `Pedido nº ${o.number} confirmado! Já estamos preparando aqui na ${r.name}.`,
  saiu: o => `Seu pedido nº ${o.number} saiu para entrega. Já já chega aí!`,
  pronto: (o, r) => o.mode === 'local' ? `Seu pedido nº ${o.number} está pronto!` : `Seu pedido nº ${o.number} está pronto. Pode vir retirar na ${r.name}.`,
};

const brl = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const norm = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const cleanPhone = p => String(p || '').replace(/\D/g, '').slice(0, 20);
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

export function requireBot(req) {
  const want = Buffer.from(config.waBotToken);
  const got = Buffer.from(String(req.headers['x-bot-token'] || ''));
  if (!want.length || want.length !== got.length || !timingSafeEqual(want, got)) throw new HttpError(401, 'Chave do robô inválida');
}

// ---------- personalidade do robô (editável no painel) e prompt ----------
// O que a equipe muda: nome, quem ela é, jeito de falar, roteiro do pedido e regras extras.
// As REGRAS FIXAS (não inventar preço, passar para a equipe, usar as ferramentas) ficam no código.
export const BOT_DEFAULTS = {
  nome: '',
  persona: 'Você atende o WhatsApp da {restaurante}, restaurante de comida caseira. Fale como alguém da casa: simpático, direto e rápido. Seu objetivo é tirar dúvidas do cardápio e fechar o pedido para a equipe confirmar.',
  jeito: [
    'Fale como alguém da casa no WhatsApp: sempre cordial, simpático e direto, tratando por "você" e chamando o cliente pelo primeiro nome.',
    'UMA mensagem por vez, de 1 a 2 linhas. Só o resumo final pode ter uma linha por item.',
    'Não repita o que o cliente acabou de dizer ("Então é um prato feito com..."): só confirme tudo no resumo final.',
    'Não liste opções, a não ser que o cliente pergunte ou falte escolher algo; aí, numa linha só ("Arroz branco ou com brócolis?").',
    'Nada de frase pronta de atendimento ("Como posso ajudá-lo?", "Perfeitamente entendido", "Estou à disposição").',
  ].join('\n'),
  roteiro: [
    'Primeira resposta: saudação curta, use enviar_cardapio (fotos do cardápio) e "Qual vai ser o pedido?". Se ele já chegou pedindo, responda direto ao pedido.',
    'Quando pedirem cardápio, preços ou "o que tem hoje", use enviar_cardapio em vez de escrever a lista.',
    'Pergunte só o que falta, juntando tudo numa pergunta só. Ex.: "É entrega ou retirada? E paga no Pix, cartão ou dinheiro?"',
    'Entrega: peça o endereço (quadra e conjunto/casa) se ele não mandou. Dinheiro: pergunte o troco na mesma frase.',
    'Nome: use o do WhatsApp; só pergunte se não tiver.',
    'Resumo final UMA vez e curto: itens com preço, taxa, total e "Posso fechar?". Se ele mudar algo, responda só a mudança e o novo total ("Trocado! Total R$ 45,00. Posso fechar?"), sem repetir o resumo inteiro.',
  ].join('\n'),
  extras: '',
  modelo: 'glm-4.6',
  avisar: '',
  // prazos padrão que o robô pode informar (ajustáveis no painel); vazio = o robô diz que a equipe confirma
  prazo_almoco: '40 a 60 minutos',
  prazo_jantar: '40 a 60 minutos',
  prazo_retirada: '20 a 30 minutos',
};
// modelos da z.ai que dá para escolher no painel (preço aproximado por conversa de pedido)
export const MODELS = [
  { id: 'glm-4.6', nome: 'Mais esperto e confiável (recomendado)', custo: 'cerca de R$ 0,03 por resposta' },
  { id: 'glm-4.5-air', nome: 'Econômico, mas erra mais pedidos', custo: 'cerca de R$ 0,01 por resposta' },
];
const BOT_FIELDS = Object.keys(BOT_DEFAULTS);
const OLD_ROTEIRO = ['Na primeira resposta da conversa: saudação curta + o cardápio resumido (uma linha por prato ou grupo, com preço) + "Qual vai ser o seu pedido?". Se a pessoa já chegou pedindo algo, responda a isso em vez de mandar o cardápio inteiro.',
  '1. O que vai querer (com as escolhas dos pratos que pedem escolha).', '2. "É para entrega, retirada ou comer aí no local?"',
  '3. Se for entrega: endereço completo (quadra/rua, número e bairro).',
  '4. Forma de pagamento (dinheiro, Pix ou cartão). Se for dinheiro, pergunte se precisa de troco e para quanto.',
  '5. Nome para o pedido, se ainda não souber.', 'Pule o que o cliente já disse. Se ele mandou tudo de uma vez, vá direto ao resumo.'].join('\n');

export function botSettings(r) {
  let saved = {};
  try { saved = JSON.parse(r.wa_bot || '{}') || {}; } catch { saved = {}; }
  const out = { ...BOT_DEFAULTS };
  for (const k of BOT_FIELDS) if (typeof saved[k] === 'string') out[k] = saved[k];
  if (!MODELS.some(m => m.id === out.modelo)) out.modelo = BOT_DEFAULTS.modelo;
  // o roteiro antigo escrevia o cardápio; agora manda a imagem
  if (!saved.roteiro_v2 && out.roteiro === OLD_ROTEIRO) out.roteiro = BOT_DEFAULTS.roteiro;
  if (saved.modelo === 'glm-4.5-air' && !saved.modelo_escolhido) out.modelo = BOT_DEFAULTS.modelo;
  return out;
}

const NORMAS = `NORMAS

Art. 1. Cite só item, preço, horário, taxa e prazo que estejam nas fontes. Dado ausente: "Isso a equipe confirma." e siga o pedido.
Art. 2. Preço é o do CARDÁPIO. Opção (+R$ X) soma X. Total = itens + taxa.
Art. 3A. Prato feito tem 4 elementos: 1 arroz, 1 feijão, 1 acompanhamento e 1 proteína; confirme os 4 antes do resumo e peça só o que faltar. Jantinha completa tem 5 elementos: arroz branco, mandioca, feijão tropeiro, vinagrete e 1 espeto à escolha; só o espeto é escolha do cliente.
Art. 3. Prato com "escolher 1": uma opção de cada grupo, só entre as listadas. Padrão óbvio (arroz branco, feijão tropeiro) vai ao resumo.
Art. 4. Nunca presuma pagamento, endereço, bebida, quantidade nem tipo. "Espeto" ou "carne" sem tipo: pergunte qual (alcatra, contra-filé etc., só os do CARDÁPIO). Use só dados deste cliente.
Art. 5. Campos do pedido: itens, modo (entrega, retirada ou local), endereço (se entrega), pagamento (troco, se dinheiro) e nome.
Art. 6. A cada mensagem: extraia todos os campos; faltando algum, faça UMA pergunta curta que cubra todos (ex.: "Entrega ou retirada? Endereço, pagamento e nome?"). Nunca repita o item nem peça "Confirma?" antes de ter todos os campos. Peça o nome uma vez só; se já está na FICHA, não peça. Completo, envie o resumo na hora.
Art. 7. Resumo: uma linha por item, taxa, total e "Posso fechar?". Resposta positiva ("sim", "pode", "ok", "👍") ou correção: chame registrar_pedido na hora, sem perguntar de novo. Só o resumo final lista os itens.
Art. 7A. Fechar direto: não ofereça bebida, sobremesa, "mais alguma coisa?" nem repita o cardápio. Cliente que diz "é isso", "fecha" ou "só isso" com tudo preenchido: registrar_pedido sem novo resumo. Uma pergunta por mensagem, no máximo.
Art. 8. Endereço: só quadra e conjunto/casa. Nunca peça ponto de referência.
Art. 9. Primeira mensagem: saudação curta, enviar_cardapio e "Qual vai ser o pedido?". Depois, não cumprimente de novo.
Art. 10. As fotos mostram o CARDÁPIO. Dúvida sobre foto, item ou preço: responda pelo CARDÁPIO.
Art. 11. Até 2 linhas, sem markdown, sem repetir o que o cliente disse. Observação de preparo vai no item.
Art. 12. Use pedir_humano só para: pessoa ou atendente (pediu_atendente); reclamação (reclamacao); alterar ou cancelar pedido registrado (alterar_cancelar); encomenda, evento ou agendamento (fora_do_cardapio); mensagem que não é de cliente (outro; responda [SEM_RESPOSTA]). Responda: "A equipe vai te responder por aqui."
Art. 13. "Tá caro": sem desconto; diga o que vem no item e ofereça uma opção mais barata. "Demora?": só o PRAZO PADRÃO, como estimativa. "Vou pensar": agradeça e pergunte uma vez se anota.
Art. 14. Você é da equipe da casa. Não se declare robô; se perguntarem: "Sou do atendimento da casa pelo WhatsApp. Quer falar com alguém da equipe?"
Art. 15. Após registrar_pedido: OK, informe número e total; ERRO, pergunte só o que faltou.`;

// Normas próprias da Central do Espeto (valem só para ela). Ficam no código até irem para o painel.
const NORMAS_ESPETO = `NORMAS DA CASA

Art. 16. Horários (veja AGORA). Segunda a sábado, almoço das 11h às 15h; antes das 11h o cliente pode adiantar o pedido do almoço ("o almoço começa às 11h, mas já posso anotar o seu pedido para as 11h"). Segunda a sexta, janta das 18h às 23h. Entre 15h e 18h a cozinha está fechada: aceite pedido antecipado para as 18h (segunda a sexta). Sábado à noite e domingo: fechado; informe e diga quando abre. Prato feito, pratos da casa e feijoada: só no almoço. Sábado: só o CARDÁPIO DE HOJE.
Art. 17. Taxa de entrega. Sobradinho I, quadras 1 a 15: R$ 5; quadras 16 a 18: R$ 7. Sobradinho II (ARs): R$ 10. QMS e Setor de Mansões: R$ 13. Morada dos Nobres: R$ 13. DF-425, Império dos Nobres, RK, Buritizinho, Alto da Boa Vista (CABV) e Nova Colina: R$ 15. Faixa incerta ("Sobradinho 1" sem quadra): pergunte a quadra antes do total. Local fora da lista: "A equipe confirma a taxa."
Art. 18. Jantinha completa: preço fixo, inclui 1 espeto à escolha; tirar ingrediente não muda o preço (anote). Espetos avulsos = espetos pedidos menos jantinhas. Ex.: "1 jantinha e 5 de alcatra" = 1 jantinha (Alcatra) + 4 espetos. "Sem espeto" = Jantinha sem espeto.
Art. 19. Pagamento: Pix (chave landim.marccos@gmail.com; peça o comprovante) ou, na entrega, maquininha com o motoboy; retirada e local pagam na casa. Use só o que o cliente disse claramente (Pix, cartão, dinheiro). "Cartão de Todos" é lugar, não pagamento. Sem pagamento, não há resumo.
Art. 20. Registro: nome exato do produto no CARDÁPIO. Item sem preço: registre o resto e anote "+ item (valor a equipe confirma)".
Art. 21. Mídia: no áudio, "cardápio" pode vir trocado por palavra parecida. Foto ou vídeo com problema é reclamação. Comprovante: "Recebi! A equipe confere." Figurinha, foto do cardápio e agradecimento repetido: [SEM_RESPOSTA].
Art. 22. "O de sempre": use o PEDIDO DE SEMPRE da FICHA ou, sem ele, o ÚLTIMO PEDIDO; mostre o resumo com o total de hoje.
Art. 23. Pagar depois: registre com a observação "pagar depois (equipe confirma)".
Art. 24. "Marquinho" e "Marcos" são o dono, nunca item.
Art. 25. Só diga que o pedido está sendo feito depois de registrar_pedido OK; antes, nunca "tá saindo" nem "já estamos montando". Não use brincadeira, gíria nem chave Pix por conta própria; Pix só se o CARDÁPIO ou as INFORMAÇÕES DA CASA trouxerem a chave.
Art. 26. Conversa que não é pedido nem dúvida da casa (amigo, fornecedor, assunto pessoal, vistoria, gráfica): uma resposta curta e educada, sem puxar assunto, e pedir_humano (outro).`;

function nowText() {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: config.timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  return f.replace(/-feira/, '').replace(', ', ' ');
}

export function buildPrompt(r, ctx) {
  // ctx = [parte fixa (restaurante, cardápio, informações), parte variável (cliente, pedidos, histórico)].
  // A z.ai cobra bem menos pela parte repetida no começo do prompt: por isso a hora (que muda a cada minuto)
  // e tudo do cliente ficam no FIM.
  const [fixo, variavel] = Array.isArray(ctx) ? ctx : [ctx, ''];
  const b = botSettings(r);
  const nome = b.nome.trim();
  const extras = cardapioSabado(r) ? semHorarioNemPF(b.extras) : b.extras.trim();
  return [
    `IDENTIDADE\nVocê é ${nome ? nome : 'a atendente'}, da ${r.name} no WhatsApp. Função: informar o cardápio e registrar pedidos. Trate o cliente por "você" e pelo primeiro nome.`,
    '', 'FONTES, EM ORDEM DE PRIORIDADE\n1) NORMAS; 2) CARDÁPIO; 3) INFORMAÇÕES DA CASA; 4) REGRAS EXTRAS. O que não está nelas é desconhecido.',
    '', NORMAS,
    ...(r.slug === 'central-do-espeto' ? ['', NORMAS_ESPETO] : []),
    ...(extras ? ['', 'REGRAS EXTRAS (não valem contra as NORMAS)', extras] : []),
    '', fixo,
    '', `AGORA: ${nowText()}`,
    '', variavel,
  ].join('\n');
}

// Prazos padrão de entrega/retirada (editáveis no painel), com o turno de agora (almoço até 17h)
function prazoLinhas(r) {
  const b = botSettings(r);
  const h = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: config.timezone, hour: '2-digit', hour12: false }).format(new Date()));
  const turno = h < 17 ? ['almoço', b.prazo_almoco] : ['jantar', b.prazo_jantar];
  const l = [];
  if (clip(turno[1], 40)) l.push(`Entrega (${turno[0]}): costuma levar ${clip(turno[1], 40)}.`);
  if (clip(b.prazo_retirada, 40)) l.push(`Retirada: fica pronto em ${clip(b.prazo_retirada, 40)}.`);
  return l.length ? ['', 'PRAZOS PADRÃO (estimativas que você pode informar; em dia cheio a equipe avisa):', ...l] : [];
}

// Aos sábados a Central do Espeto só vende o cardápio de sábado (foto abaixo): nada de pratos do cardápio normal.
const CARDAPIO_SABADO = '/assets/img/cardapio-sabado.jpg';
const FEIJOADA_SABADO = '/assets/img/feijoada-sabado.jpg';
const CARDAPIO_SABADO_TEXTO = [
  'CARDÁPIO DE HOJE (sábado). Só existem estes itens; o cardápio normal e o prato feito NÃO existem hoje. Atendimento só das 11h às 15h; depois das 15h informe que hoje encerrou (sábado à noite fechado). Ignore qualquer outro horário.',
  'Espetos R$ 14: alcatra, contra filé, kafta, peito de frango, frango com bacon, meio da asa, coração, lombo suíno, camarão, queijo coalho, linguiça. Queijo provolone e pão de alho R$ 13.',
  'Jantinha completa R$ 22 (arroz branco, mandioca, feijão tropeiro, vinagrete e 1 espeto à escolha). Jantinha sem espeto R$ 13.',
  'Feijoada R$ 27 (couve, arroz branco, torresmo, farofa e vinagrete), em duas formas: "Individual" (marmitas separadas) ou "Tudo junto" (marmita redonda). Pergunte a forma e registre com escolhas {"Forma":"Individual"} ou {"Forma":"Tudo junto"}; sem a forma não registre. Jantinha completa: escolhas {"Espeto":"..."}.',
  'Bebidas: água s/ gás 3,50; água c/ gás 4,50; refrigerante lata 6,50; coca lata 310ml 6,50; coca zero lata 6,50; sprite lata 6,50; fanta uva lata 6,50; fanta laranja lata 6,50; guaraná 1L 9,50; guaraná 350ml zero 6,50; guaraná 350ml normal 6,50; coca 600ml 8,50; coca 600ml zero 8,50; coca 2L 14,50; coca 2L zero 14,50; guaraná 2L zero 14,00; guaraná 2L normal 14,00; monster 13,00; red bull 13,00; heineken long 330ml 10,00; stela pure gold 11,00; michelob 11,00; spaten lata 350ml 7,00; antarctica palito 269ml 5,00; corona long 11,00; suco natural 8,00; suco del valle lata 8,00; água tônica 6,50; pepsi black 6,50.',
  'Abertura e pedido de cardápio hoje: enviar_cardapio (fotos do cardápio de sábado e da feijoada), uma linha dizendo que há também feijoada R$ 27, e "Qual vai ser o pedido?".',
].join('\n');
function ehSabado() {
  return new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short' }).format(new Date()) === 'Sat';
}
// Itens que o registrar_pedido aceita aos sábados (o cardápio cadastrado no painel é o de dias úteis).
const ESPETOS_SAB = ['Alcatra', 'Contra filé', 'Kafta', 'Peito de frango', 'Frango com bacon', 'Meio da asa', 'Coração', 'Lombo suíno', 'Camarão', 'Queijo coalho', 'Linguiça'];
const BEBIDAS_SAB = [['Água s/ gás', 350], ['Água c/ gás', 450], ['Refrigerante lata', 650], ['Coca lata 310ml', 650], ['Coca zero lata', 650], ['Sprite lata', 650], ['Fanta uva lata', 650], ['Fanta laranja lata', 650],
  ['Guaraná 1L', 950], ['Guaraná 350ml zero', 650], ['Guaraná 350ml normal', 650], ['Coca 600ml', 850], ['Coca 600ml zero', 850], ['Coca 2L', 1450], ['Coca 2L zero', 1450], ['Guaraná 2L zero', 1400],
  ['Guaraná 2L normal', 1400], ['Monster', 1300], ['Red Bull', 1300], ['Heineken long 330ml', 1000], ['Stela Pure Gold', 1100], ['Michelob', 1100], ['Spaten lata 350ml', 700],
  ['Antarctica palito 269ml', 500], ['Corona long', 1100], ['Suco natural', 800], ['Suco Del Valle lata', 800], ['Água tônica', 650], ['Pepsi Black', 650]];
const PRODUTOS_SABADO = [
  ...ESPETOS_SAB.map(name => ({ name, price_cents: 1400, options: '' })),
  { name: 'Queijo provolone', price_cents: 1300, options: '' }, { name: 'Pão de alho', price_cents: 1300, options: '' },
  { name: 'Jantinha completa', price_cents: 2200, options: 'Espeto: ' + ESPETOS_SAB.join(', ') }, { name: 'Jantinha sem espeto', price_cents: 1300, options: '' },
  { name: 'Feijoada', price_cents: 2700, options: 'Forma: Individual, Tudo junto' },
  ...BEBIDAS_SAB.map(([name, price_cents]) => ({ name, price_cents, options: '' })),
];
const semHorarioNemPF = t => String(t || '').split(/\r?\n/).filter(l => !/almo[cç]o|jantar|janta|hor[aá]rio|\d\s*h\b|\bpf\b|prato feito/i.test(l)).join('\n').trim();
const cardapioSabado = r => r.slug === 'central-do-espeto' && ehSabado();

// O que vai junto com o prompt: restaurante, cardápio, informações da casa, cliente, pedidos e histórico.
async function contextFor(r, contact, history, orders, past = null) {
  const who = { cliente: 'CLIENTE', robo: 'VOCÊ', equipe: 'EQUIPE (pessoa da casa)' };
  // ficha do cliente (memória permanente): desde quando fala com a casa e o que costuma pedir
  const sempre = contact?.usual ? `PEDIDO DE SEMPRE (definido pela casa, vale mais que o último pedido): ${clip(contact.usual, 300)}. ` : '';
  // cliente frequente: quase sempre pede o mesmo, no mesmo endereço; já na primeira resposta oferece repetir
  const comeco = !history.some(m => m.direction === 'out');
  const ficha = past && past.total ? `Já fez ${past.total} pedido${past.total > 1 ? 's' : ''} pelo WhatsApp. ÚLTIMO PEDIDO: ${past.ultimo}. ` +
    (comeco ? `É CLIENTE DA CASA: nesta primeira resposta (se ele ainda não disse o que quer), cumprimente pelo primeiro nome e ofereça repetir em uma linha como PERGUNTA, com o total pelo cardápio de hoje, sem mandar o cardápio. Nunca trate o último pedido como pedido de hoje antes de ele dizer que quer: se ele só cumprimentou, ofereça e espere. Ex.: "Oi, Maria! Vai ser o de sempre? 1 prato feito de cupim com tropeiro e purê, entrega no mesmo endereço, no Pix: R$ 20,00". ` : '') +
    'Endereço: se for entrega e ele não disser outro, use o do último pedido sem perguntar de novo (só aparece no resumo). Pagamento: NUNCA suponha; se ele não disse, pergunte "Pix, cartão ou dinheiro?" (o do último pedido só vale se ele pedir "o de sempre").' : 'Nenhum pedido anterior pelo WhatsApp.';
  const fixo = [
    `RESTAURANTE: ${r.name}. Endereço: ${r.address || '(não informado)'}.` + (r.instagram ? ` Instagram: ${r.instagram}.` : ''),
    r.accepting_orders ? 'Pedidos: abertos.' : 'Pedidos: FECHADOS agora (o restaurante não está recebendo pedidos). Não registre pedido; diga isso com gentileza.',
    '',
    'CARDÁPIO (a única fonte de pratos e preços):',
    cardapioSabado(r) ? CARDAPIO_SABADO_TEXTO : await menuText(r.id),
    '',
    'INFORMAÇÕES DA CASA (escritas pela equipe; o que não estiver aqui você não sabe):',
    (cardapioSabado(r) ? clip(semHorarioNemPF(r.wa_info), 3000) : clip(r.wa_info, 3000)) || '(a equipe ainda não preencheu: horário, entrega, taxa e Pix você não sabe)',
    ...prazoLinhas(r),
  ].join('\n');
  const variavel = [
    `CLIENTE: ${past?.nome ? `nome "${past.nome}" (usado no último pedido: chame pelo primeiro nome e use esse nome no pedido, sem perguntar)` : contact?.name ? `nome "${contact.name}" (pode ser só o apelido do WhatsApp; confirme o nome para o pedido)` : '(nome ainda não informado)'}. ${history.length ? 'Já conversou antes.' : 'Primeira mensagem dele.'}`,
    `FICHA DO CLIENTE: ${sempre}${contact?.created_at ? `fala com a casa desde ${String(contact.created_at).slice(8, 10)}/${String(contact.created_at).slice(5, 7)}. ` : ''}${ficha}`,
    `PEDIDOS EM ANDAMENTO DESTE CLIENTE: ${orders.length ? orders.map(o => `nº ${o.number} (${STATUS_LABEL[o.status]}, ${brl(o.total_cents)})`).join('; ') : 'nenhum'}`,
    '',
    history.some(m => m.direction === 'out') ? 'ATENÇÃO: esta conversa já começou. NÃO cumprimente nem se apresente de novo; responda direto ao que o cliente mandou.' : '',
    'ÚLTIMAS MENSAGENS (fonte da verdade; inclui o que a equipe escreveu):',
    history.length ? [...history].reverse().map(m => `${who[m.origin] || m.origin}: ${m.text.slice(0, 240)}`).join('\n') : '(nenhuma)',
  ].join('\n');
  return [fixo, variavel];
}

// ---------- texto do cardápio para a IA ----------
export async function menuText(restaurantId) {
  const { categories, products } = await menuFor(restaurantId);
  const lines = [];
  const byCat = new Map(categories.map(c => [c.id, []]));
  for (const p of products) (byCat.get(p.category_id) || byCat.set(p.category_id, []).get(p.category_id)).push(p);
  for (const [catId, list] of byCat) {
    if (!list.length) continue;
    lines.push(`${categories.find(c => c.id === catId)?.name || 'Outros'}:${/guarni|avuls|prote/i.test(categories.find(c => c.id === catId)?.name || '') ? ' (vendidos avulsos: o cliente pode pedir só um deles, junto com um espeto, outra proteína ou sozinho)' : ''}`);
    for (const p of list) {
      // combo que tem os mesmos itens vendidos avulsos: deixa claro que o cliente pode pedir só parte dele
      const combo = p.option_groups.length || /jantinha|combo|completa/i.test(p.name);
      lines.push(`- ${p.name}: ${brl(p.price_cents)}${p.description ? `. ${p.description}` : ''}${combo && /jantinha/i.test(p.name) && !/sem espeto/i.test(p.name) ? ' (preço fixo: qualquer "jantinha", com ou sem algum acompanhamento, é esta; o que ele tirar vai na observação)' : ''}`);
      for (const g of p.option_groups) {
        lines.push(`  escolher 1 ${g.name.toLowerCase()}: ${g.choices.map(c => c.name + (c.add_cents ? ` (+${brl(c.add_cents)})` : '')).join(' | ')}`);
      }
    }
  }
  return lines.join('\n') || '(cardápio vazio)';
}

// ---------- robô: mensagem chegou ----------
// Travas contra rajada de mensagens (o cliente escreve picado, o WhatsApp às vezes entrega a mesma mensagem 2 vezes):
// 1) entrada grava e ignora id do WhatsApp repetido; 2) o n8n espera alguns segundos e pergunta a vez: só a
// mensagem mais nova do cliente responde, juntando as anteriores; 3) limite de respostas do robô por cliente.
const ROBOT_LIMIT = { max: 15, minutes: 3 }; // fotos do cardápio e respostas em partes contam cada uma (06/11: 8 travava conversa normal)
// Números de outros robôs (ex.: o atendente da MedicMais): o robô nunca responde, para não virar robô conversando
// com robô (aconteceu em 03/11). Dá para somar números na chave 'wa_ignorar' da tabela meta (separados por vírgula).
const OTHER_BOTS = ['556191852790'];
async function ignoredPhone(phone) {
  const m = await Promise.resolve().then(() => get("SELECT value FROM meta WHERE key = 'wa_ignorar'")).catch(() => null);
  const list = [...OTHER_BOTS, ...String(m?.value || '').split(',').map(cleanPhone)].filter(Boolean);
  return list.some(x => x === phone || (x.length >= 10 && phone.endsWith(x.slice(-10))));
}

export async function botInbound(r, body) {
  const phone = cleanPhone(body.telefone);
  if (!phone) throw new HttpError(400, 'telefone obrigatório');
  const text = clip(body.texto, 4000);
  const media = ['audio', 'imagem', 'video', 'outro'].includes(body.midia) ? body.midia : '';
  const pushName = clip(body.nome_whatsapp, 60);
  const waId = clip(body.msg_id, 120);
  // arquivo guardado pelo WAHA no PC; o painel abre por /atendimento/midia/:id
  const mediaFile = /^[A-Za-z0-9._-]{1,120}$/.test(String(body.midia_arquivo || '')) ? String(body.midia_arquivo) : '';
  const mediaName = clip(body.midia_nome, 120);
  if (waId && await get('SELECT id FROM wa_messages WHERE restaurant_id = ? AND wa_id = ?', r.id, waId)) return { duplicada: true, pausado: true };

  let released = null;
  const result = await tx(async () => {
    await run(`INSERT INTO wa_contacts (restaurant_id, phone, name) VALUES (?, ?, ?)
      ON CONFLICT (restaurant_id, phone) DO NOTHING`, r.id, phone, pushName);
    // conversa nova (6 h sem nenhuma mensagem): a passagem para a equipe era daquela conversa, o robô volta a atender.
    // Sem isso, quem foi atendido pela equipe uma vez ficava sem robô para sempre.
    const recent = await get(`SELECT id FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND created_at >= datetime('now', '-6 hours') LIMIT 1`, r.id, phone);
    if (!recent) await run(`UPDATE wa_contacts SET needs_human = 0, human_reason = '' WHERE restaurant_id = ? AND phone = ? AND needs_human = 1`, r.id, phone);
    await run(`UPDATE wa_contacts SET last_message = ?, unread = unread + 1, updated_at = datetime('now')
      WHERE restaurant_id = ? AND phone = ?`, text.slice(0, 200), r.id, phone);
    const { lastInsertRowid } = await run(`INSERT INTO wa_messages (restaurant_id, phone, direction, origin, text, media, wa_id, media_file, media_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, phone, 'in', 'cliente', text, media, waId, mediaFile, mediaName);
    let contact = await get('SELECT needs_human, human_reason, name FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, phone);
    // Passou para a equipe (reclamação, dúvida...) e ninguém respondeu em 5 min: o robô volta a atender
    if (contact.needs_human && !['equipe_assumiu', 'dono_respondeu'].includes(contact.human_reason)) {
      const before = await get(`SELECT MAX(created_at) AS t FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND id < ?`, r.id, phone, lastInsertRowid);
      const teamReplied = await get(`SELECT id FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND origin = 'equipe' AND direction = 'out'
        AND created_at >= datetime('now', '-30 minutes') LIMIT 1`, r.id, phone);
      const quiet = await get(`SELECT ? <= datetime('now', '-5 minutes') AS ok`, before?.t || '0');
      if (!teamReplied && before?.t && quiet?.ok) {
        await run(`UPDATE wa_contacts SET needs_human = 0, human_reason = '' WHERE restaurant_id = ? AND phone = ?`, r.id, phone);
        released = { nome: contact.name || phone };
        contact = { ...contact, needs_human: 0 };
      }
    }
    return { id: Number(lastInsertRowid), pausado: !r.wa_robot_on || !!contact.needs_human || await ignoredPhone(phone) };
  });
  if (released) await alertOwner(r, `⚠️ ${released.nome} pediu a equipe e ninguém respondeu em 5 minutos. O robô voltou a atender essa conversa; vale conferir no painel.`);
  return result;
}

// Antes de gastar IA com foto/vídeo: o robô vai responder este cliente? (robô ligado e equipe não assumiu)
export async function botState(r, body) {
  const c = await get('SELECT needs_human FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, cleanPhone(body.telefone));
  return { pausado: !r.wa_robot_on || !!c?.needs_human || await ignoredPhone(cleanPhone(body.telefone)) };
}

// A vez de responder: só a mensagem mais nova do cliente responde, com tudo o que ele mandou desde a última resposta.
export async function botTurn(r, body) {
  const phone = cleanPhone(body.telefone);
  const id = Number(body.id) || 0;
  const contact = await get('SELECT * FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, phone);
  if (!r.wa_robot_on) return { responder: false, motivo: 'robo_pausado' };
  if (await ignoredPhone(phone)) return { responder: false, motivo: 'outro_robo' };
  if (!contact || contact.needs_human) return { responder: false, motivo: 'equipe' };
  const last = await get(`SELECT MAX(id) AS id FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'in'`, r.id, phone);
  if (Number(last?.id) !== id) return { responder: false, motivo: 'mensagem_mais_nova' };
  const { n } = await get(`SELECT COUNT(*) AS n FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND origin = 'robo'
    AND created_at >= datetime('now', '-${ROBOT_LIMIT.minutes} minutes')`, r.id, phone);
  if (n >= ROBOT_LIMIT.max) {
    await run(`UPDATE wa_contacts SET needs_human = 1, human_reason = 'limite_mensagens', updated_at = datetime('now') WHERE id = ?`, contact.id);
    return { responder: false, motivo: 'limite' };
  }
  // ordem pelo horário (o histórico importado entra com id novo mas data antiga)
  const lastOut = await get(`SELECT created_at FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'out'
    ORDER BY created_at DESC, id DESC LIMIT 1`, r.id, phone);
  const since = lastOut?.created_at || '';
  const fresh = await all(`SELECT text FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'in' AND created_at >= ?
    AND created_at >= datetime('now', '-120 minutes') ORDER BY created_at, id`, r.id, phone, since);
  // Se uma resposta foi gravada DEPOIS desta mensagem (cliente respondeu rápido enquanto o robô ainda mandava as partes da resposta
  // anterior, ou voltou o eco do WhatsApp), a janela "desde a última resposta" fica vazia e a IA recebia texto vazio
  // (z.ai: 400 "The prompt parameter was not received normally" -> caía no modelo reserva, que chama a equipe). Usa a própria mensagem do turno.
  let texto = fresh.map(m => m.text).join('\n');
  if (!texto.trim()) {
    const mine = await get(`SELECT text FROM wa_messages WHERE id = ? AND restaurant_id = ? AND phone = ? AND direction = 'in'`, id, r.id, phone);
    texto = String(mine?.text || '');
  }
  if (!texto.trim()) return { responder: false, motivo: 'sem_texto' }; // nunca manda texto vazio para a IA
  // só a conversa atual (últimas 6 h): o que foi falado dias atrás não é continuado; o último pedido já vai na FICHA
  const history = (await all(`SELECT direction, origin, text FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND created_at <= ?
    AND created_at >= datetime('now', '-6 hours') ORDER BY created_at DESC, id DESC LIMIT 12`, r.id, phone, since || '0'));
  const pastRows = await all(`SELECT customer_name, items, mode, address, payment, note, created_at FROM wa_orders WHERE restaurant_id = ? AND phone = ? AND status <> 'cancelado' ORDER BY id DESC LIMIT 20`, r.id, phone);
  // "o de sempre": o último pedido completo (itens com escolhas, como recebe e como paga), para a IA repetir e confirmar
  const lastOrder = pastRows[0];
  const past = lastOrder ? { total: pastRows.length, nome: lastOrder.customer_name || '', ultimo: [
    JSON.parse(lastOrder.items || '[]').map(i => `${i.qty}x ${i.name}${i.choices ? ` (${i.choices})` : ''}${i.note ? ` [obs.: ${i.note}]` : ''}`).join(', '),
    lastOrder.mode === 'entrega' ? `entrega em ${String(lastOrder.address || '').replace(/[,;.\s]*\b(ref(er[eê]ncia)?|pr[oó]ximo|perto)\b.*$/i, '').trim()}` : lastOrder.mode === 'local' ? 'comer no local' : 'retirada',
    PAYMENTS[lastOrder.payment] ? `pagamento ${PAYMENTS[lastOrder.payment]}` : '',
    lastOrder.note ? `obs.: ${lastOrder.note}` : '',
    `em ${String(lastOrder.created_at).slice(8, 10)}/${String(lastOrder.created_at).slice(5, 7)}`,
  ].filter(Boolean).join('; ') } : null;
  // pedido em andamento só se for de hoje (12 h): pedido esquecido aberto não volta para a conversa dias depois
  const orders = await all(`SELECT * FROM wa_orders WHERE restaurant_id = ? AND phone = ? AND status IN ${OPEN_ORDER}
    AND created_at >= datetime('now', '-12 hours') ORDER BY id DESC LIMIT 3`, r.id, phone);

  const contexto = await contextFor(r, contact, history, orders, past);
  // ja_conversou: o n8n corta saudação ("Oi! Tudo bem?") se o robô já falou com este cliente nas últimas 12 h
  const recent = await get(`SELECT id FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'out' AND created_at >= datetime('now', '-12 hours') LIMIT 1`, r.id, phone);
  const recentes = (await all(`SELECT text FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND origin = 'robo' AND created_at >= datetime('now', '-30 minutes')
    ORDER BY id DESC LIMIT 6`, r.id, phone)).map(m => m.text);
  return { responder: true, texto, prompt: buildPrompt(r, contexto), modelo: botSettings(r).modelo, cardapio_imagem: cardapioSabado(r) ? (config.publicUrl || 'https://brasa-nobre.vercel.app') + CARDAPIO_SABADO : '',
    cardapio_imagens: cardapioSabado(r) ? [CARDAPIO_SABADO, FEIJOADA_SABADO].map(u => (config.publicUrl || 'https://brasa-nobre.vercel.app') + u) : [], restaurante: r.name, ja_conversou: !!recent, recentes };
}

// O n8n chama isto logo antes de enviar: ainda é a vez desta mensagem? (evita resposta dupla quando o cliente manda duas seguidas)
export async function botStillTurn(r, body) {
  const phone = cleanPhone(body.telefone);
  const id = Number(body.id) || 0;
  const last = await get(`SELECT MAX(id) AS id FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'in'`, r.id, phone);
  if (Number(last?.id) !== id) return { enviar: false, motivo: 'mensagem_mais_nova' };
  const out = await get(`SELECT id FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'out' AND origin = 'robo' AND id > ?`, r.id, phone, id);
  return out ? { enviar: false, motivo: 'ja_respondido' } : { enviar: true };
}

// Mensagem que saiu do celular do dono (WhatsApp dele, não o robô): registra e pausa o robô nesse cliente.
export async function botOwn(r, body) {
  const phone = cleanPhone(body.telefone);
  const text = clip(body.texto, 4000);
  if (!phone || !text) return { ok: false };
  const sent = await get(`SELECT id FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'out' AND text = ?
    AND created_at >= datetime('now', '-3 minutes')`, r.id, phone, text);
  if (sent) return { ok: true, robo: true }; // foi o próprio robô ou o painel
  const contact = await get('SELECT id FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, phone);
  if (!contact) await run('INSERT INTO wa_contacts (restaurant_id, phone) VALUES (?, ?) ON CONFLICT (restaurant_id, phone) DO NOTHING', r.id, phone);
  await logOut(r, phone, text, 'equipe', 0);
  await run(`UPDATE wa_contacts SET needs_human = 1, human_reason = 'dono_respondeu' WHERE restaurant_id = ? AND phone = ?`, r.id, phone);
  return { ok: true, robo: false };
}

export async function botOutbound(r, body) {
  const phone = cleanPhone(body.telefone);
  const text = clip(body.texto, 4000);
  if (!phone || !text) throw new HttpError(400, 'telefone e texto obrigatórios');
  await logOut(r, phone, text, body.origem === 'equipe' ? 'equipe' : 'robo', 0);
  return { ok: true };
}

// Importa o histórico antigo das conversas (lido do WAHA na VPS). Só acrescenta: não mexe no robô, em "não lidas"
// nem em quem precisa da equipe. Pula o que já existe: mesmo id do WhatsApp, ou mesmo texto na mesma direção
// num intervalo de 10 minutos (respostas do robô e do painel foram gravadas sem o id do WhatsApp).
// mensagens: [{ telefone, nome, de_mim, origem ('robo' | 'equipe'), texto, midia, msg_id, quando }]  quando = unix (s) ou ISO
const stamp = d => d.toISOString().slice(0, 19).replace('T', ' ');
export async function botImport(r, body) {
  const list = Array.isArray(body.mensagens) ? body.mensagens.slice(0, 500) : [];
  let novas = 0, repetidas = 0, invalidas = 0;
  for (const m of list) {
    const phone = cleanPhone(m.telefone);
    const raw = Number(m.quando);
    const when = new Date(raw ? (raw > 1e12 ? raw : raw * 1000) : String(m.quando || ''));
    const media = ['audio', 'imagem', 'video', 'outro'].includes(m.midia) ? m.midia : '';
    const text = clip(m.texto, 4000) || (media ? { audio: '[Áudio]', imagem: '[Foto]', video: '[Vídeo]', outro: '[Arquivo]' }[media] : '');
    if (!phone || !text || Number.isNaN(when.getTime())) { invalidas++; continue; }
    const at = stamp(when), dir = m.de_mim ? 'out' : 'in', waId = clip(m.msg_id, 120);
    const dup = (waId && await get('SELECT id FROM wa_messages WHERE restaurant_id = ? AND wa_id = ?', r.id, waId))
      || await get(`SELECT id FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = ? AND text = ? AND created_at BETWEEN ? AND ?`,
        r.id, phone, dir, text, stamp(new Date(when - 6e5)), stamp(new Date(+when + 6e5)));
    if (dup) { repetidas++; continue; }
    await run(`INSERT INTO wa_contacts (restaurant_id, phone, name, last_message, updated_at, unread) VALUES (?, ?, ?, ?, ?, 0)
      ON CONFLICT (restaurant_id, phone) DO NOTHING`, r.id, phone, clip(m.nome, 60), text.slice(0, 200), at);
    await run(`UPDATE wa_contacts SET name = CASE WHEN name = '' THEN ? ELSE name END WHERE restaurant_id = ? AND phone = ?`, clip(m.nome, 60), r.id, phone);
    // a conversa sobe na lista só se esta mensagem for mais nova que a última conhecida
    await run(`UPDATE wa_contacts SET last_message = ?, updated_at = ? WHERE restaurant_id = ? AND phone = ? AND updated_at < ?`,
      text.slice(0, 200), at, r.id, phone, at);
    await run(`INSERT INTO wa_messages (restaurant_id, phone, direction, origin, text, media, wa_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, r.id, phone, dir, dir === 'in' ? 'cliente' : m.origem === 'robo' ? 'robo' : 'equipe', text, media, waId, at);
    novas++;
  }
  return { novas, repetidas, invalidas };
}

async function logOut(r, phone, text, origin, pending) {
  await run('INSERT INTO wa_messages (restaurant_id, phone, direction, origin, text, pending) VALUES (?, ?, ?, ?, ?, ?)', r.id, phone, 'out', origin, text, pending);
  await run(`UPDATE wa_contacts SET last_message = ?, updated_at = datetime('now') WHERE restaurant_id = ? AND phone = ?`,
    text.slice(0, 200), r.id, phone);
}

export const COMPLAINT_TOPICS = ['Qualidade da comida', 'Comida fria', 'Atraso na entrega', 'Pedido errado ou faltando item',
  'Entregador', 'Atendimento', 'Preço', 'Embalagem', 'Outro'];
const topicOf = t => COMPLAINT_TOPICS.find(x => norm(x) === norm(t)) || COMPLAINT_TOPICS.find(x => norm(t) && norm(x).includes(norm(t))) || 'Outro';

async function addComplaint(r, phone, topic) {
  const last = await get(`SELECT text FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'in' ORDER BY id DESC LIMIT 1`, r.id, phone);
  const c = await get('SELECT name FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, phone);
  await run('INSERT INTO wa_complaints (restaurant_id, phone, name, topic, detail) VALUES (?, ?, ?, ?, ?)',
    r.id, phone, c?.name || '', topicOf(topic), clip(last?.text, 400));
}

export async function botHuman(r, body) {
  const phone = cleanPhone(body.telefone);
  const reason = clip(body.motivo, 60) || 'outro';
  if (reason === 'reclamacao') await addComplaint(r, phone, body.assunto);
  const c = await get('SELECT name FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, phone);
  await alertOwner(r, `🔔 ${c?.name || phone} precisa de alguém da equipe no WhatsApp (${reason.replace(/_/g, ' ')}${body.assunto ? `: ${clip(body.assunto, 60)}` : ''}).`);
  // dúvida simples só avisa o dono: o robô continua atendendo (pausar deixava o cliente sem resposta)
  if (reason === 'duvida') return { resultado: 'OK: a equipe foi avisada. Diga em uma frase "A equipe vai te responder por aqui" (sem prometer que volta) e continue atendendo o que você já sabe.' };
  const { changes } = await run(`UPDATE wa_contacts SET needs_human = 1, human_reason = ?, updated_at = datetime('now')
    WHERE restaurant_id = ? AND phone = ?`, reason, r.id, phone);
  return { resultado: changes ? 'OK: a equipe foi avisada e vai continuar a conversa por aqui. Diga "A equipe vai te responder por aqui" em uma frase, sem prometer que você volta.' : 'ERRO: contato não encontrado' };
}

// ---------- robô: registrar pedido ----------
// itens: [{ produto, quantidade, escolhas, observacao }] (ou o mesmo em texto JSON). escolhas: objeto { Arroz: "Arroz branco" }
// ou texto "Arroz branco, Feijão tropeiro, ...". Devolve sempre 200 com "resultado", para a IA explicar o problema ao cliente.
export async function botOrder(r, body) {
  const phone = cleanPhone(body.telefone);
  if (!r.accepting_orders) return { resultado: 'ERRO: o restaurante não está recebendo pedidos agora. Avise o cliente.' };
  let items = body.itens;
  if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = null; } }
  if (!Array.isArray(items) || !items.length) return { resultado: 'ERRO: nenhum item. Mande itens como lista JSON: [{"produto":"...","quantidade":1,"escolhas":{"Grupo":"opção"}}].' };
  const name = clip(body.nome, 60);
  if (!name) return { resultado: 'ERRO: falta o nome do cliente. Pergunte o nome antes de registrar.' };
  const tipo = norm(body.tipo);
  const mode = tipo.startsWith('entreg') ? 'entrega' : /local|comer|mesa|aqui/.test(tipo) ? 'local' : 'retirada';
  const address = clip(body.endereco, 300);
  if (mode === 'entrega' && address.length < 8) return { resultado: 'ERRO: pedido de entrega sem endereço completo (rua, número, bairro e referência). Pergunte ao cliente.' };
  const payment = Object.keys(PAYMENTS).find(k => norm(body.pagamento).includes(k === 'cartao' ? 'cart' : k)) || '';
  if (!payment) return { resultado: 'ERRO: falta a forma de pagamento (dinheiro, Pix ou cartão). Pergunte ao cliente.' };

  // Cliente que corrige DEPOIS de fechar não abre um 2º pedido (aconteceu em 06/11: nº 115 e 116): a equipe altera o certo.
  const aberto = await get(`SELECT number FROM wa_orders WHERE restaurant_id = ? AND phone = ? AND status IN ('novo', 'confirmado')
    AND created_at >= datetime('now', '-20 minutes') ORDER BY id DESC LIMIT 1`, r.id, phone);
  if (aberto) return { resultado: `ERRO: este cliente já tem o pedido nº ${aberto.number} registrado há poucos minutos. NÃO registre outro. Se ele quer mudar ou corrigir algo, use pedir_humano (motivo alterar_cancelar) e diga em uma frase que a equipe ajusta o pedido nº ${aberto.number}.` };

  const products = cardapioSabado(r) ? PRODUTOS_SABADO : (await menuFor(r.id)).products;
  const problems = [];
  const lines = [];
  for (const it of items.slice(0, 30)) {
    // compara sem espaços ("Coca-Cola 2L" = "Coca-Cola 2 L")
    const tight = x => norm(x).replace(/ /g, '');
    const want = tight(it.produto || it.nome);
    const exact = products.filter(p => tight(p.name) === want);
    const near = exact.length ? exact : products.filter(p => want.length >= 3 && (want.includes(tight(p.name)) || tight(p.name).includes(want)));
    if (near.length !== 1) {
      const words = norm(it.produto || it.nome).split(' ').filter(w => w.length >= 3);
      const like = products.filter(p => words.some(w => norm(p.name).includes(w))).slice(0, 4).map(p => p.name);
      problems.push(near.length ? `"${it.produto}" pode ser ${near.map(p => p.name).join(' ou ')}; confirme qual.`
        : `"${it.produto}" não está no cardápio${like.length ? `; os mais parecidos são: ${like.join(', ')} (use o nome exato)` : ''}.`);
      continue;
    }
    const p = near[0];
    const qty = Math.max(1, Math.min(30, Math.round(Number(it.quantidade ?? it.qtd) || 1)));
    const given = it.escolhas || '';
    const keyed = given && typeof given === 'object' ? Object.fromEntries(Object.entries(given).map(([k, v]) => [norm(k), String(v)])) : {};
    const loose = (typeof given === 'object' ? Object.values(given).map(String) : String(given).split(/[,;\n]/))
      .map(s => s.replace(/^[^:]*:/, '')).map(norm).filter(Boolean);
    let unit = p.price_cents;
    const picked = [];
    for (const g of parseOptions(p.options)) {
      const tokens = keyed[norm(g.name)] ? [norm(keyed[norm(g.name)])] : loose;
      const hits = g.choices.filter(c => tokens.some(t => t === norm(c.name) || t.includes(norm(c.name)) || (t.length >= 4 && norm(c.name).includes(t))));
      const best = hits.length > 1 ? hits.filter(c => tokens.includes(norm(c.name))) : hits;
      if (best.length !== 1) {
        problems.push(`${p.name}: ${hits.length ? `qual ${g.name.toLowerCase()}? (${hits.map(c => c.name).join(' ou ')})` : `falta escolher ${g.name.toLowerCase()} (${g.choices.map(c => c.name).join(', ')})`}`);
        continue;
      }
      unit += best[0].add_cents;
      picked.push(`${g.name}: ${best[0].name}`);
    }
    lines.push({ name: p.name, qty, unit_price_cents: unit, choices: picked.join('; '), note: clip(it.observacao, 140) });
  }
  if (problems.length) return { resultado: `ERRO: pedido NÃO registrado. Resolva com o cliente: ${problems.join(' ')}` };

  const total = lines.reduce((s, l) => s + l.unit_price_cents * l.qty, 0);
  const order = await tx(async () => {
    // numeração do dia por canal (pedido do Ribeiro, 06/11): mesa 1+, retirada 101+, entrega 201+.
    // "Comer no local" pelo WhatsApp entra na faixa da retirada (é pedido de balcão).
    const entrega = mode === 'entrega';
    const { n } = await get(`SELECT COUNT(*) AS n FROM wa_orders WHERE restaurant_id = ? AND ${entrega ? "mode = 'entrega'" : "mode != 'entrega'"}
      AND date(created_at, 'localtime') = date('now', 'localtime')`, r.id);
    const { lastInsertRowid } = await run(`INSERT INTO wa_orders (restaurant_id, number, phone, customer_name, items, total_cents, mode, address, payment, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, (entrega ? 200 : 100) + n + 1, phone, name, JSON.stringify(lines), total, mode,
      mode === 'entrega' ? address : '', payment, clip(body.observacao, 300));
    await run(`UPDATE wa_contacts SET name = ?, stage = 'pedido', updated_at = datetime('now') WHERE restaurant_id = ? AND phone = ?`, name, r.id, phone);
    return get('SELECT * FROM wa_orders WHERE id = ?', lastInsertRowid);
  });
  // aprovação automática: o pedido confirmado pelo cliente já vai para a cozinha (tela, som e impressora)
  let naCozinha = false;
  try {
    await run(`UPDATE wa_orders SET status = 'confirmado', updated_at = datetime('now') WHERE id = ?`, order.id);
    await toKitchen(r, order);
    naCozinha = true;
  } catch (e) { console.error('WhatsApp: pedido não foi para a cozinha', e.message); }
  await alertOwner(r, `🛵 Pedido novo pelo WhatsApp: nº ${order.number}, ${name}, ${brl(total)} (${mode}). ${naCozinha ? 'Já foi para a cozinha.' : 'Confira no painel: não entrou na cozinha.'}`);
  const resumo = lines.map(l => `${l.qty}x ${l.name}${l.choices ? ` (${l.choices.split('; ').map(c => c.slice(c.indexOf(': ') + 2)).join(', ')})` : ''} ${brl(l.unit_price_cents * l.qty)}`).join('; ');
  return { resultado: `OK: pedido nº ${order.number} registrado. Itens: ${resumo}. Total dos itens: ${brl(total)}` +
    `${mode === 'entrega' ? ' (sem a taxa de entrega: se ela estiver nas INFORMAÇÕES DA CASA para o bairro, some ao falar o total; senão, diga que a equipe confirma)' : ''}. Pagamento: ${PAYMENTS[payment]}. ` +
    (naCozinha ? 'O pedido JÁ ESTÁ CONFIRMADO e foi para a cozinha. Diga ao cliente o número do pedido, o resumo e o total, e que já está sendo preparado (avisamos por aqui quando sair para entrega ou ficar pronto).'
      : 'Diga ao cliente o número do pedido, o resumo e o total, e que a equipe confirma por aqui em instantes.') };
}

// ---------- equipe: tela de atendimento ----------
export async function inbox(r) {
  const contacts = await all(`SELECT phone, name, stage, needs_human, human_reason, last_message, unread, updated_at FROM wa_contacts
    WHERE restaurant_id = ? ORDER BY updated_at DESC LIMIT 500`, r.id);
  const orders = (await all(`SELECT * FROM wa_orders WHERE restaurant_id = ? AND (status IN ${OPEN_ORDER}
    OR date(created_at, 'localtime') = date('now', 'localtime')) ORDER BY id DESC LIMIT 60`, r.id))
    .map(o => ({ ...o, items: JSON.parse(o.items || '[]') }));
  return { contacts, orders, info: r.wa_info || '', robot: !!config.waBotToken, robot_on: !!r.wa_robot_on, can_send: !!config.waBotToken };
}

export async function conversation(r, phone) {
  phone = cleanPhone(phone);
  const contact = await get('SELECT * FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, phone);
  if (!contact) throw new HttpError(404, 'Conversa não encontrada');
  await run('UPDATE wa_contacts SET unread = 0 WHERE id = ?', contact.id);
  const messages = (await all(`SELECT id, direction, origin, text, media, media_name, (media_file <> '') AS has_file, pending, created_at FROM wa_messages
    WHERE restaurant_id = ? AND phone = ? ORDER BY created_at DESC, id DESC LIMIT 1000`, r.id, phone)).reverse();
  return { contact: { ...contact, unread: 0 }, messages };
}

// Mensagem da equipe para o cliente. Com WA_N8N_URL (app no mesmo PC do n8n) envia na hora; sem ela (Vercel,
// que não alcança o PC) entra na fila (pending = 1) e o n8n busca a cada poucos segundos em /wa/bot/fila.
// Endereço do n8n: hoje é o do VPS (espeto.179-197-85-185.sslip.io, fixo); o túnel trycloudflare do PC segue aceito. WA_N8N_URL é a reserva.
async function n8nUrl() {
  const m = await get("SELECT value FROM meta WHERE key = 'wa_n8n_url'");
  return (m?.value || config.waN8nUrl || '').replace(/\/$/, '');
}
export async function botSetN8nUrl(body) {
  const url = String(body?.url || '');
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$|^https:\/\/espeto\.179-197-85-185\.sslip\.io$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) throw new HttpError(400, 'Endereço inválido');
  await run("INSERT INTO meta (key, value) VALUES ('wa_n8n_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", url);
  return { ok: true };
}

async function deliver(r, phone, text) {
  const base = await n8nUrl();
  await logOut(r, phone, text, 'equipe', base ? 0 : 1);
  if (!base) return;
  let res;
  try {
    res = await fetch(`${base}/webhook/espeto/enviar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': config.waBotToken },
      body: JSON.stringify({ telefone: phone, texto: text }), signal: AbortSignal.timeout(12000),
    });
  } catch { res = null; }
  if (!res?.ok) {
    await run(`UPDATE wa_messages SET pending = -1 WHERE id = (SELECT MAX(id) FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'out')`, r.id, phone);
    throw new HttpError(502, res ? `O WhatsApp recusou o envio (erro ${res.status})` : 'O WhatsApp não respondeu. Confira se o PC do atendente está ligado.');
  }
}

// fila das mensagens da equipe (pending: 1 = esperando o n8n, 0 = enviada, -1 = o WhatsApp recusou)
export async function botQueue(r) {
  return all(`SELECT id, phone AS telefone, text AS texto FROM wa_messages WHERE restaurant_id = ? AND pending = 1 ORDER BY id LIMIT 20`, r.id);
}
export async function botQueueDone(r, body) {
  const ids = list => (Array.isArray(list) ? list : []).map(Number).filter(Boolean).slice(0, 50);
  for (const id of ids(body.ok)) await run('UPDATE wa_messages SET pending = 0 WHERE id = ? AND restaurant_id = ?', id, r.id);
  for (const id of ids(body.falhou)) await run('UPDATE wa_messages SET pending = -1 WHERE id = ? AND restaurant_id = ?', id, r.id);
  return { ok: true };
}

// Aviso no celular da equipe (número escolhido no painel): o robô manda uma mensagem do WhatsApp da casa para ele,
// e o celular toca. Não entra em nenhuma conversa de cliente.
async function alertOwner(r, text) {
  const to = cleanPhone(botSettings(r).avisar);
  const base = await n8nUrl();
  if (to.length < 12 || !base) return;
  try {
    await fetch(`${base}/webhook/espeto/enviar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': config.waBotToken },
      body: JSON.stringify({ telefone: to, texto: text }), signal: AbortSignal.timeout(8000) });
  } catch { /* aviso é extra: não trava o pedido */ }
}

// Resposta da equipe: envia e pausa o robô nesta conversa (a pessoa assumiu)
export async function staffSend(r, body) {
  const phone = cleanPhone(body.phone);
  const text = clip(body.text, 4000);
  if (!phone || !text) throw new HttpError(400, 'Escreva a mensagem');
  await deliver(r, phone, text);
  await run(`UPDATE wa_contacts SET needs_human = 1, human_reason = CASE WHEN needs_human = 1 THEN human_reason ELSE 'equipe_assumiu' END
    WHERE restaurant_id = ? AND phone = ?`, r.id, phone);
  return { ok: true };
}

export async function setUsual(r, body) {
  const { changes } = await run('UPDATE wa_contacts SET usual = ? WHERE restaurant_id = ? AND phone = ?', clip(body.usual, 300), r.id, cleanPhone(body.phone));
  if (!changes) throw new HttpError(404, 'Conversa não encontrada');
  return { ok: true };
}

export async function setRobot(r, body) {
  const on = !!body.on; // on = robô responde
  await run(`UPDATE wa_contacts SET needs_human = ?, human_reason = ? WHERE restaurant_id = ? AND phone = ?`,
    on ? 0 : 1, on ? '' : 'equipe_assumiu', r.id, cleanPhone(body.phone));
  return { ok: true };
}

export async function setOrderStatus(r, id, status) {
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Status inválido');
  const o = await get('SELECT * FROM wa_orders WHERE id = ? AND restaurant_id = ?', id, r.id);
  if (!o) throw new HttpError(404, 'Pedido não encontrado');
  await run(`UPDATE wa_orders SET status = ?, updated_at = datetime('now') WHERE id = ?`, status, id);
  let warning = '';
  if (status === 'confirmado' && !o.kitchen_order_id) {
    try { await toKitchen(r, o); } catch (e) { warning = `Confirmado, mas não foi para a cozinha: ${e.message}`; }
  }
  const msg = STATUS_MSG[status]?.(o, r);
  if (msg) {
    try { await deliver(r, o.phone, msg); }
    catch (e) { warning = `Status salvo, mas o aviso ao cliente não foi: ${e.message}`; }
  }
  return { ok: true, warning };
}

// Pedido confirmado do WhatsApp entra na cozinha (aparece na tela, toca e imprime) numa "mesa" virtual nº 0,
// escondida do caixa e dos QR Codes. A comanda já fecha com a forma de pagamento: a venda entra no relatório do dia.
const MODE_LABEL = { entrega: 'ENTREGA', retirada: 'RETIRADA', local: 'COMER NO LOCAL' };
async function toKitchen(r, o) {
  const items = JSON.parse(o.items || '[]');
  const kid = await tx(async () => {
    let t = await get('SELECT * FROM tables WHERE restaurant_id = ? AND number = 0', r.id);
    if (!t) {
      await run("INSERT INTO tables (restaurant_id, number, label, token, active) VALUES (?, 0, 'WhatsApp', ?, 0)", r.id, newToken());
      t = await get('SELECT * FROM tables WHERE restaurant_id = ? AND number = 0', r.id);
    }
    const { lastInsertRowid: sid } = await run('INSERT INTO table_sessions (restaurant_id, table_id) VALUES (?, ?)', r.id, t.id);
    // mesmo número que o cliente recebeu no WhatsApp (101+ retirada, 201+ entrega)
    const note = [`WhatsApp nº ${o.number} · ${MODE_LABEL[o.mode] || o.mode}`, o.address, PAYMENTS[o.payment], o.note].filter(Boolean).join(' · ');
    const { lastInsertRowid } = await run(`INSERT INTO orders (restaurant_id, table_id, session_id, number, customer_name, note, total_cents, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'whatsapp')`, r.id, t.id, sid, o.number, o.customer_name || 'WhatsApp', note.slice(0, 200), o.total_cents);
    for (const i of items) {
      const p = await get('SELECT id FROM products WHERE restaurant_id = ? AND name = ?', r.id, i.name);
      await run('INSERT INTO order_items (order_id, product_id, name, unit_price_cents, qty, note, removed, choices) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        lastInsertRowid, p?.id ?? null, i.name, i.unit_price_cents, i.qty, i.note || '', '', i.choices || '');
    }
    await run(`UPDATE table_sessions SET status = 'closed', closed_at = datetime('now'), payment_method = ?, subtotal_cents = ?, service_cents = 0, total_cents = ?
      WHERE id = ?`, o.payment || 'outro', o.total_cents, o.total_cents, sid);
    await run('UPDATE wa_orders SET kitchen_order_id = ? WHERE id = ?', lastInsertRowid, o.id);
    return Number(lastInsertRowid);
  });
  await publish(staffChannel(r.id), 'order', await orderFull(kid));
}

// ---------- equipe: robô ligado/pausado e personalidade ----------
export async function robotConfig(r) {
  const { products } = await menuFor(r.id);
  const exemplo = await contextFor(r, null, [], []);
  return { on: !!r.wa_robot_on, bot: botSettings(r), defaults: BOT_DEFAULTS, models: MODELS, info: r.wa_info || '', menu_count: products.length,
    prompt: buildPrompt(r, exemplo) };
}

export async function setRobotOn(r, body) {
  await run('UPDATE restaurants SET wa_robot_on = ? WHERE id = ?', body.on ? 1 : 0, r.id);
  return { on: !!body.on };
}

export async function saveBot(r, body) {
  const b = {};
  for (const k of BOT_FIELDS) if (typeof body?.[k] === 'string') b[k] = clip(body[k], k === 'nome' ? 40 : 3000);
  if (b.avisar !== undefined) b.avisar = cleanPhone(b.avisar);
  const extra = b.modelo ? { modelo_escolhido: '1' } : {}; // quem escolhe o modelo no painel não é mexido pela migração para o 4.6
  await run('UPDATE restaurants SET wa_bot = ? WHERE id = ?', JSON.stringify({ ...botSettings(r), ...b, ...extra, roteiro_v2: '1' }), r.id);
  return { ok: true };
}

// Foto, vídeo ou documento do cliente, buscado no PC pelo n8n (rota /webhook/espeto/midia).
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', pdf: 'application/pdf', oga: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg' };
export async function mediaFile(r, id) {
  const m = await get('SELECT media_file, media_name FROM wa_messages WHERE id = ? AND restaurant_id = ?', id, r.id);
  if (!m?.media_file) throw new HttpError(404, 'Arquivo não encontrado');
  const base = await n8nUrl();
  if (!base) throw new HttpError(503, 'O PC do atendente não está ligado ao painel');
  let res;
  try { res = await fetch(`${base}/webhook/espeto/midia?f=${encodeURIComponent(m.media_file)}`, { headers: { 'x-bot-token': config.waBotToken }, signal: AbortSignal.timeout(20000) }); }
  catch { throw new HttpError(502, 'O PC do atendente não respondeu'); }
  if (!res.ok) throw new HttpError(404, 'O arquivo não está mais no PC');
  const ext = m.media_file.split('.').pop().toLowerCase();
  return { body: Buffer.from(await res.arrayBuffer()), type: MIME[ext] || res.headers.get('content-type') || 'application/octet-stream', name: m.media_name || m.media_file };
}

// Reclamações agrupadas por assunto (últimos 30 dias), as mais frequentes primeiro
export async function complaints(r) {
  const rows = await all(`SELECT * FROM wa_complaints WHERE restaurant_id = ? AND created_at >= datetime('now', '-30 days') ORDER BY id DESC`, r.id);
  const groups = new Map();
  for (const c of rows) {
    const g = groups.get(c.topic) || { topic: c.topic, count: 0, last_at: c.created_at, examples: [] };
    g.count++;
    if (g.examples.length < 3) g.examples.push({ name: c.name, phone: c.phone, detail: c.detail, created_at: c.created_at });
    groups.set(c.topic, g);
  }
  return { total: rows.length, groups: [...groups.values()].sort((a, b) => b.count - a.count), topics: COMPLAINT_TOPICS };
}

export async function staffComplaint(r, body) {
  const phone = cleanPhone(body.phone);
  if (!phone) throw new HttpError(400, 'Escolha a conversa');
  await addComplaint(r, phone, body.topic);
  return { ok: true };
}

export async function saveInfo(r, body) {
  await run('UPDATE restaurants SET wa_info = ? WHERE id = ?', clip(body.info, 3000), r.id);
  return { ok: true };
}

// ---------- recriação dos demos (src/demo.js) ----------
// O seed apaga e recria o restaurante; sem isto, o ON DELETE CASCADE levaria as conversas, os pedidos e o robô.
export async function snapshotWhatsApp(slugs) {
  const snap = {};
  for (const slug of slugs) {
    const r = await get('SELECT id, wa_info, wa_bot, wa_robot_on FROM restaurants WHERE slug = ?', slug);
    if (!r) continue;
    snap[slug] = {
      settings: r,
      complaints: await all('SELECT * FROM wa_complaints WHERE restaurant_id = ? ORDER BY id', r.id),
      contacts: await all('SELECT * FROM wa_contacts WHERE restaurant_id = ? ORDER BY id', r.id),
      messages: await all('SELECT * FROM wa_messages WHERE restaurant_id = ? ORDER BY id', r.id),
      orders: await all('SELECT * FROM wa_orders WHERE restaurant_id = ? ORDER BY id', r.id),
    };
  }
  return snap;
}

export async function restoreWhatsApp(snap, slug, restaurantId) {
  const w = snap[slug];
  if (!w) return;
  await run('UPDATE restaurants SET wa_info = ?, wa_bot = ?, wa_robot_on = ? WHERE id = ?',
    w.settings.wa_info || '', w.settings.wa_bot || '', w.settings.wa_robot_on ? 1 : 0, restaurantId);
  const copy = async (table, rows, cols) => {
    for (const row of rows) {
      await run(`INSERT INTO ${table} (restaurant_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
        restaurantId, ...cols.map(c => row[c] ?? null));
    }
  };
  await copy('wa_contacts', w.contacts, ['phone', 'name', 'usual', 'stage', 'needs_human', 'human_reason', 'last_message', 'unread', 'created_at', 'updated_at']);
  await copy('wa_complaints', w.complaints || [], ['phone', 'name', 'topic', 'detail', 'created_at']);
  await copy('wa_messages', w.messages, ['phone', 'direction', 'origin', 'text', 'media', 'pending', 'wa_id', 'created_at']);
  // o pedido da cozinha some na recriação: kitchen_order_id não é copiado
  await copy('wa_orders', w.orders, ['number', 'phone', 'customer_name', 'items', 'total_cents', 'mode', 'address', 'payment', 'note', 'status', 'created_at', 'updated_at']);
}
