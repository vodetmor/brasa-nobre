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
const STATUS_LABEL = { novo: 'recebido, aguardando a equipe confirmar', confirmado: 'confirmado, em preparo', saiu: 'saiu para entrega',
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
    'Fale como alguém da casa no WhatsApp: português do Brasil, informal e educado, tratando por "você" e pelo primeiro nome quando souber.',
    'Mensagens curtas: 1 a 3 linhas. Uma pergunta por vez. No máximo 1 emoji, quando natural.',
    'Reaja ao que a pessoa disse antes de perguntar ("Boa!", "Ah, entendi", "Poxa, que chato"). Varie as palavras: não repita a mesma abertura nem a mesma frase de uma mensagem para outra.',
    'Nada de frase pronta de atendimento ("Como posso ajudá-lo?", "Estou à disposição", "Perfeitamente entendido"). Nada de formulário: converse.',
  ].join('\n'),
  roteiro: [
    'Na primeira resposta da conversa: saudação curta, use enviar_cardapio (manda as fotos do cardápio) e pergunte "Qual vai ser o seu pedido?". Se a pessoa já chegou pedindo algo, responda a isso em vez de mandar o cardápio.',
    'Sempre que pedirem o cardápio, os preços ou "o que tem hoje", use enviar_cardapio em vez de escrever a lista inteira.',
    '1. O que vai querer (com as escolhas dos pratos que pedem escolha).',
    '2. "É para entrega, retirada ou comer aí no local?"',
    '3. Se for entrega: endereço completo (quadra/rua, número, bairro e ponto de referência).',
    '4. Forma de pagamento (dinheiro, Pix ou cartão). Se for dinheiro, pergunte se precisa de troco e para quanto.',
    '5. Nome para o pedido, se ainda não souber.',
    'Pule o que o cliente já disse. Se ele mandou tudo de uma vez, vá direto ao resumo.',
  ].join('\n'),
  extras: '',
  modelo: 'glm-4.5-air',
  avisar: '',
};
// modelos da z.ai que dá para escolher no painel (preço aproximado por conversa de pedido)
export const MODELS = [
  { id: 'glm-4.5-air', nome: 'Econômico e rápido (recomendado)', custo: 'cerca de R$ 0,01 por resposta' },
  { id: 'glm-4.6', nome: 'Mais esperto, 3x mais caro', custo: 'cerca de R$ 0,03 por resposta' },
];
const BOT_FIELDS = Object.keys(BOT_DEFAULTS);
const OLD_ROTEIRO = ['Na primeira resposta da conversa: saudação curta + o cardápio resumido (uma linha por prato ou grupo, com preço) + "Qual vai ser o seu pedido?". Se a pessoa já chegou pedindo algo, responda a isso em vez de mandar o cardápio inteiro.',
  '1. O que vai querer (com as escolhas dos pratos que pedem escolha).', '2. "É para entrega, retirada ou comer aí no local?"',
  '3. Se for entrega: endereço completo (quadra/rua, número, bairro e ponto de referência).',
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
  return out;
}

const FIXED_RULES = `REGRAS FIXAS (valem acima de tudo)
1. Só existe o que está no CARDÁPIO e nas INFORMAÇÕES DA CASA lá embaixo. NUNCA invente prato, preço, promoção, desconto, combo, bebida, horário, taxa ou tempo de entrega, bairro atendido ou chave Pix. Se perguntarem algo que não está lá, diga com naturalidade que vai confirmar com a equipe; se a pessoa precisar dessa resposta para decidir, use pedir_humano (motivo duvida).
2. Preço é exatamente o do cardápio. Opção com (+R$ X) soma esse valor ao prato. Não calcule taxa de entrega.
3. Pratos com "escolher 1 ..." no cardápio: o cliente escolhe uma opção de cada grupo, só entre as listadas. Pergunte o que faltar de um jeito leve, podendo juntar duas escolhas numa pergunta.
4. Sem markdown: nada de asterisco, título ou lista com traço. Para listar (cardápio, resumo), use uma linha por item, sem linha em branco no meio.
5. ANTES de registrar, mande o resumo numa mensagem (itens com escolhas, total dos itens, entrega/retirada/local, endereço, pagamento) e pergunte se está tudo certo. Só depois do "sim" use registrar_pedido. Se for entrega, diga que a taxa (se houver) a equipe confirma, a não ser que as INFORMAÇÕES DA CASA tragam o valor.
6. registrar_pedido responde OK ou ERRO. Se ERRO, explique de forma simples o que falta e pergunte. Se OK, informe o número do pedido e diga que a equipe confirma por aqui em instantes. Nunca diga que o pedido foi feito sem o OK da ferramenta.
7. Use pedir_humano NA HORA, sem tentar convencer, quando o cliente: pedir uma pessoa, atendente, gerente ou dono; reclamar; quiser alterar ou cancelar um pedido já registrado; pedir encomenda grande, evento ou algo fora do cardápio; ou quando você não souber resolver. Motivos: pediu_atendente, reclamacao, alterar_cancelar, fora_do_cardapio, duvida ou outro. Nesse caso responda só uma frase curta avisando que a equipe vai continuar a conversa por aqui.
8. Se perguntarem do pedido, use PEDIDOS EM ANDAMENTO. Não prometa tempo de entrega que não esteja nas informações.
9. Áudio, foto, figurinha, vídeo e documento: "[Áudio do cliente, transcrito]" -> responda como quem ouviu, sem falar em transcrição. "[Foto ...]" ou "[Vídeo ...]" -> responda ao que aparece (se mostrar problema com a comida ou a entrega, é reclamação: pedir_humano). "[Figurinha ...]" -> reaja curto e siga a conversa. "[Documento enviado pelo cliente: ...]" -> se parecer comprovante de pagamento, agradeça e diga que a equipe confere; senão, peça para ele dizer do que se trata. Se não abriu, peça para escrever.
10. Você faz parte da equipe da casa. Nunca se apresente nem se descreva como robô, IA, chatbot, assistente virtual ou atendimento automático, e não comente como funciona por dentro. Se o cliente perguntar com sinceridade se está falando com uma pessoa, não afirme que é humano: diga com leveza que é o atendimento da casa pelo WhatsApp e ofereça chamar alguém da equipe (se ele quiser, use pedir_humano).
11. Encerramento: se o assunto já foi resolvido e o cliente manda só "ok", "obrigado", "👍", responda UMA vez, bem curto. Se mandar outro agradecimento depois, responda exatamente [SEM_RESPOSTA] e nada mais.
12. Assunto que não tem a ver com o restaurante: volte com leveza para o atendimento.
13. Dia e horário: quando o nome de uma categoria do CARDÁPIO diz dias ou horário (ex.: "seg a sex, almoço"), só ofereça e registre aqueles pratos nesses dias e horários, olhando o AGORA. Fora disso, diga com naturalidade quando tem e ofereça o que está valendo agora.
14. Se registrar_pedido der ERRO, corrija com o cliente só o que faltou e tente de novo; nunca recomece o pedido do zero nem esqueça o que ele já escolheu.

COMO A CASA COSTUMA RESPONDER (exemplos de tom, não copie palavra por palavra)
- "tem marmita?" -> "Tem sim! O prato feito sai R$ 20, você monta: arroz, feijão, carne e acompanhamento. Quer montar o seu?"
- "quanto é?" sem dizer o quê -> pergunte o que ele quer saber ou mande o cardápio, sem despejar todos os preços.
- "o de sempre" -> use a FICHA DO CLIENTE e confirme: "O mesmo da última vez, [pedido]?"
- "tá caro" -> não dê desconto; mostre o que vem no prato com leveza.
- cliente manda tudo de uma vez ("2 pf de cupim com tropeiro e purê, entrega na qd 5, pix") -> confira só o que faltou e vá ao resumo.
- cliente some e volta horas depois -> retome de onde parou, sem cumprimentar de novo.`;

function nowText() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: config.timezone, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit' }).format(new Date());
}

export function buildPrompt(r, contexto) {
  const b = botSettings(r);
  const persona = b.persona.replaceAll('{restaurante}', r.name);
  return [
    persona + (b.nome.trim() ? ` Seu nome é ${b.nome.trim()}; apresente-se por esse nome só na primeira resposta.` : ''),
    '', 'COMO FALAR', b.jeito,
    '', FIXED_RULES,
    '', 'ROTEIRO DO PEDIDO (uma pergunta por vez, nesta ordem)', b.roteiro,
    ...(b.extras.trim() ? ['', 'REGRAS EXTRAS DA CASA', b.extras] : []),
    '', `AGORA: ${nowText()} (horário de Brasília).`,
    '', contexto,
  ].join('\n');
}

// O que vai junto com o prompt: restaurante, cardápio, informações da casa, cliente, pedidos e histórico.
async function contextFor(r, contact, history, orders, past = null) {
  const who = { cliente: 'CLIENTE', robo: 'VOCÊ', equipe: 'EQUIPE (pessoa da casa)' };
  // ficha do cliente (memória permanente): desde quando fala com a casa e o que costuma pedir
  const ficha = past && past.total ? `Já fez ${past.total} pedido${past.total > 1 ? 's' : ''} pelo WhatsApp; o último foi ${past.ultimo}. Se fizer sentido, ofereça repetir ("Vai querer o mesmo de sempre?").` : 'Nenhum pedido anterior pelo WhatsApp.';
  return [
    `RESTAURANTE: ${r.name}. Endereço: ${r.address || '(não informado)'}.` + (r.instagram ? ` Instagram: ${r.instagram}.` : ''),
    r.accepting_orders ? 'Pedidos: abertos.' : 'Pedidos: FECHADOS agora (o restaurante não está recebendo pedidos). Não registre pedido; diga isso com gentileza.',
    '',
    'CARDÁPIO (a única fonte de pratos e preços):',
    await menuText(r.id),
    '',
    'INFORMAÇÕES DA CASA (escritas pela equipe; o que não estiver aqui você não sabe):',
    clip(r.wa_info, 3000) || '(a equipe ainda não preencheu: horário, entrega, taxa e Pix você não sabe)',
    '',
    `CLIENTE: ${contact?.name ? `nome "${contact.name}" (pode ser só o apelido do WhatsApp; confirme o nome para o pedido)` : '(nome ainda não informado)'}. ${history.length ? 'Já conversou antes.' : 'Primeira mensagem dele.'}`,
    `FICHA DO CLIENTE: ${contact?.created_at ? `fala com a casa desde ${String(contact.created_at).slice(8, 10)}/${String(contact.created_at).slice(5, 7)}. ` : ''}${ficha}`,
    `PEDIDOS EM ANDAMENTO DESTE CLIENTE: ${orders.length ? orders.map(o => `nº ${o.number} (${STATUS_LABEL[o.status]}, ${brl(o.total_cents)})`).join('; ') : 'nenhum'}`,
    '',
    history.some(m => m.direction === 'out') ? 'ATENÇÃO: esta conversa já começou. NÃO cumprimente nem se apresente de novo; responda direto ao que o cliente mandou.' : '',
    'ÚLTIMAS MENSAGENS (fonte da verdade; inclui o que a equipe escreveu):',
    history.length ? [...history].reverse().map(m => `${who[m.origin] || m.origin}: ${m.text.slice(0, 240)}`).join('\n') : '(nenhuma)',
  ].join('\n');
}

// ---------- texto do cardápio para a IA ----------
export async function menuText(restaurantId) {
  const { categories, products } = await menuFor(restaurantId);
  const lines = [];
  const byCat = new Map(categories.map(c => [c.id, []]));
  for (const p of products) (byCat.get(p.category_id) || byCat.set(p.category_id, []).get(p.category_id)).push(p);
  for (const [catId, list] of byCat) {
    if (!list.length) continue;
    lines.push(`${categories.find(c => c.id === catId)?.name || 'Outros'}:`);
    for (const p of list) {
      lines.push(`- ${p.name}: ${brl(p.price_cents)}${p.description ? `. ${p.description}` : ''}`);
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
const ROBOT_LIMIT = { max: 8, minutes: 3 };

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

  return tx(async () => {
    await run(`INSERT INTO wa_contacts (restaurant_id, phone, name) VALUES (?, ?, ?)
      ON CONFLICT (restaurant_id, phone) DO NOTHING`, r.id, phone, pushName);
    await run(`UPDATE wa_contacts SET last_message = ?, unread = unread + 1, updated_at = datetime('now')
      WHERE restaurant_id = ? AND phone = ?`, text.slice(0, 200), r.id, phone);
    const { lastInsertRowid } = await run(`INSERT INTO wa_messages (restaurant_id, phone, direction, origin, text, media, wa_id, media_file, media_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, phone, 'in', 'cliente', text, media, waId, mediaFile, mediaName);
    const contact = await get('SELECT needs_human FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, phone);
    return { id: Number(lastInsertRowid), pausado: !r.wa_robot_on || !!contact.needs_human };
  });
}

// Antes de gastar IA com foto/vídeo: o robô vai responder este cliente? (robô ligado e equipe não assumiu)
export async function botState(r, body) {
  const c = await get('SELECT needs_human FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, cleanPhone(body.telefone));
  return { pausado: !r.wa_robot_on || !!c?.needs_human };
}

// A vez de responder: só a mensagem mais nova do cliente responde, com tudo o que ele mandou desde a última resposta.
export async function botTurn(r, body) {
  const phone = cleanPhone(body.telefone);
  const id = Number(body.id) || 0;
  const contact = await get('SELECT * FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, phone);
  if (!r.wa_robot_on) return { responder: false, motivo: 'robo_pausado' };
  if (!contact || contact.needs_human) return { responder: false, motivo: 'equipe' };
  const last = await get(`SELECT MAX(id) AS id FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'in'`, r.id, phone);
  if (Number(last?.id) !== id) return { responder: false, motivo: 'mensagem_mais_nova' };
  const { n } = await get(`SELECT COUNT(*) AS n FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND origin = 'robo'
    AND created_at >= datetime('now', '-${ROBOT_LIMIT.minutes} minutes')`, r.id, phone);
  if (n >= ROBOT_LIMIT.max) {
    await run(`UPDATE wa_contacts SET needs_human = 1, human_reason = 'limite_mensagens', updated_at = datetime('now') WHERE id = ?`, contact.id);
    return { responder: false, motivo: 'limite' };
  }
  const lastOut = await get(`SELECT MAX(id) AS id FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'out'`, r.id, phone);
  const fresh = await all(`SELECT text FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND direction = 'in' AND id > ?
    ORDER BY id`, r.id, phone, Number(lastOut?.id) || 0);
  const history = await all(`SELECT direction, origin, text FROM wa_messages WHERE restaurant_id = ? AND phone = ? AND id <= ?
    ORDER BY id DESC LIMIT 12`, r.id, phone, Number(lastOut?.id) || 0);
  const pastRows = await all(`SELECT items, created_at FROM wa_orders WHERE restaurant_id = ? AND phone = ? AND status <> 'cancelado' ORDER BY id DESC LIMIT 20`, r.id, phone);
  const past = pastRows.length ? { total: pastRows.length, ultimo: JSON.parse(pastRows[0].items || '[]').map(i => `${i.qty}x ${i.name}${i.choices ? ` (${i.choices.split('; ').map(c => c.slice(c.indexOf(': ') + 2)).join(', ')})` : ''}`).join(', ') } : null;
  const orders = await all(`SELECT * FROM wa_orders WHERE restaurant_id = ? AND phone = ? AND status IN ${OPEN_ORDER}
    ORDER BY id DESC LIMIT 3`, r.id, phone);

  const contexto = await contextFor(r, contact, history, orders, past);
  return { responder: true, texto: fresh.map(m => m.text).join('\n'), prompt: buildPrompt(r, contexto), modelo: botSettings(r).modelo, restaurante: r.name };
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
  const { changes } = await run(`UPDATE wa_contacts SET needs_human = 1, human_reason = ?, updated_at = datetime('now')
    WHERE restaurant_id = ? AND phone = ?`, reason, r.id, phone);
  return { resultado: changes ? 'OK: a equipe foi avisada e vai continuar a conversa por aqui. Diga isso ao cliente em uma frase.' : 'ERRO: contato não encontrado' };
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

  const { products } = await menuFor(r.id);
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
    const { n } = await get(`SELECT COUNT(*) AS n FROM wa_orders WHERE restaurant_id = ?
      AND date(created_at, 'localtime') = date('now', 'localtime')`, r.id);
    const { lastInsertRowid } = await run(`INSERT INTO wa_orders (restaurant_id, number, phone, customer_name, items, total_cents, mode, address, payment, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, n + 1, phone, name, JSON.stringify(lines), total, mode,
      mode === 'entrega' ? address : '', payment, clip(body.observacao, 300));
    await run(`UPDATE wa_contacts SET name = ?, stage = 'pedido', updated_at = datetime('now') WHERE restaurant_id = ? AND phone = ?`, name, r.id, phone);
    return get('SELECT * FROM wa_orders WHERE id = ?', lastInsertRowid);
  });
  await alertOwner(r, `🛵 Pedido novo pelo WhatsApp: nº ${order.number}, ${name}, ${brl(total)} (${mode}). Confirme no painel.`);
  const resumo = lines.map(l => `${l.qty}x ${l.name}${l.choices ? ` (${l.choices.split('; ').map(c => c.slice(c.indexOf(': ') + 2)).join(', ')})` : ''} ${brl(l.unit_price_cents * l.qty)}`).join('; ');
  return { resultado: `OK: pedido nº ${order.number} registrado. Itens: ${resumo}. Total dos itens: ${brl(total)}` +
    `${mode === 'entrega' ? ' (taxa de entrega, se houver, a equipe informa)' : ''}. Pagamento: ${PAYMENTS[payment]}. ` +
    'Agora diga ao cliente o número do pedido, o resumo e o total, e que a equipe confirma por aqui em instantes.' };
}

// ---------- equipe: tela de atendimento ----------
export async function inbox(r) {
  const contacts = await all(`SELECT phone, name, stage, needs_human, human_reason, last_message, unread, updated_at FROM wa_contacts
    WHERE restaurant_id = ? ORDER BY updated_at DESC LIMIT 100`, r.id);
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
    WHERE restaurant_id = ? AND phone = ? ORDER BY id DESC LIMIT 200`, r.id, phone)).reverse();
  return { contact: { ...contact, unread: 0 }, messages };
}

// Mensagem da equipe para o cliente. Com WA_N8N_URL (app no mesmo PC do n8n) envia na hora; sem ela (Vercel,
// que não alcança o PC) entra na fila (pending = 1) e o n8n busca a cada poucos segundos em /wa/bot/fila.
// Endereço do n8n: o vigia do PC (n8n-atendente/vigia) grava aqui quando o túnel muda; WA_N8N_URL é a reserva.
async function n8nUrl() {
  const m = await get("SELECT value FROM meta WHERE key = 'wa_n8n_url'");
  return (m?.value || config.waN8nUrl || '').replace(/\/$/, '');
}
export async function botSetN8nUrl(body) {
  const url = String(body?.url || '');
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) throw new HttpError(400, 'Endereço inválido');
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
    const { n } = await get(`SELECT COUNT(*) AS n FROM orders WHERE restaurant_id = ?
      AND date(created_at, 'localtime') = date('now', 'localtime')`, r.id);
    const note = [`WhatsApp nº ${o.number} · ${MODE_LABEL[o.mode] || o.mode}`, o.address, PAYMENTS[o.payment], o.note].filter(Boolean).join(' · ');
    const { lastInsertRowid } = await run(`INSERT INTO orders (restaurant_id, table_id, session_id, number, customer_name, note, total_cents, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'whatsapp')`, r.id, t.id, sid, n + 1, o.customer_name || 'WhatsApp', note.slice(0, 200), o.total_cents);
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
  await run('UPDATE restaurants SET wa_bot = ? WHERE id = ?', JSON.stringify({ ...botSettings(r), ...b, roteiro_v2: '1' }), r.id);
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
  await copy('wa_contacts', w.contacts, ['phone', 'name', 'stage', 'needs_human', 'human_reason', 'last_message', 'unread', 'created_at', 'updated_at']);
  await copy('wa_complaints', w.complaints || [], ['phone', 'name', 'topic', 'detail', 'created_at']);
  await copy('wa_messages', w.messages, ['phone', 'direction', 'origin', 'text', 'media', 'pending', 'wa_id', 'created_at']);
  // o pedido da cozinha some na recriação: kitchen_order_id não é copiado
  await copy('wa_orders', w.orders, ['number', 'phone', 'customer_name', 'items', 'total_cents', 'mode', 'address', 'payment', 'note', 'status', 'created_at', 'updated_at']);
}
