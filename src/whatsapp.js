// Atendimento pelo WhatsApp. O robô (n8n + WAHA + IA) chama as rotas /api/r/<slug>/wa/bot/* com a chave
// WA_BOT_TOKEN; a equipe usa a tela /r/<slug>/atendimento (conversas, pedidos, assumir a conversa).
// O cardápio e os preços saem sempre do banco: a IA só repassa o que o cliente escolheu.
import { timingSafeEqual } from 'node:crypto';
import { all, get, run, tx } from './db.js';
import { config } from './config.js';
import { HttpError } from './lib/http.js';
import { menuFor, parseOptions } from './services.js';

const ORDER_STATUSES = ['novo', 'confirmado', 'saiu', 'pronto', 'entregue', 'cancelado'];
const OPEN_ORDER = "('novo', 'confirmado', 'saiu', 'pronto')";
const PAYMENTS = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão' };
const STATUS_LABEL = { novo: 'recebido, aguardando a equipe confirmar', confirmado: 'confirmado, em preparo', saiu: 'saiu para entrega',
  pronto: 'pronto para retirar', entregue: 'entregue', cancelado: 'cancelado' };
// Aviso automático para o cliente quando a equipe muda o status do pedido no painel
const STATUS_MSG = {
  confirmado: (o, r) => `Pedido nº ${o.number} confirmado! Já estamos preparando aqui na ${r.name}.`,
  saiu: o => `Seu pedido nº ${o.number} saiu para entrega. Já já chega aí!`,
  pronto: (o, r) => `Seu pedido nº ${o.number} está pronto. Pode vir retirar na ${r.name}.`,
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
export async function botInbound(r, body) {
  const phone = cleanPhone(body.telefone);
  if (!phone) throw new HttpError(400, 'telefone obrigatório');
  const text = clip(body.texto, 4000);
  const media = ['audio', 'imagem', 'video', 'outro'].includes(body.midia) ? body.midia : '';
  const pushName = clip(body.nome_whatsapp, 60);

  const history = await all(`SELECT direction, origin, text, created_at FROM wa_messages WHERE restaurant_id = ? AND phone = ?
    ORDER BY id DESC LIMIT 14`, r.id, phone);
  const contact = await tx(async () => {
    await run(`INSERT INTO wa_contacts (restaurant_id, phone, name) VALUES (?, ?, ?)
      ON CONFLICT (restaurant_id, phone) DO NOTHING`, r.id, phone, pushName);
    await run(`UPDATE wa_contacts SET last_message = ?, unread = unread + 1, updated_at = datetime('now')
      WHERE restaurant_id = ? AND phone = ?`, text.slice(0, 200), r.id, phone);
    await run('INSERT INTO wa_messages (restaurant_id, phone, direction, origin, text, media) VALUES (?, ?, ?, ?, ?, ?)',
      r.id, phone, 'in', 'cliente', text, media);
    return get('SELECT * FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, phone);
  });
  const orders = await all(`SELECT * FROM wa_orders WHERE restaurant_id = ? AND phone = ? AND status IN ${OPEN_ORDER}
    ORDER BY id DESC LIMIT 3`, r.id, phone);

  const who = { cliente: 'CLIENTE', robo: 'VOCÊ', equipe: 'EQUIPE (pessoa da casa)' };
  const contexto = [
    `RESTAURANTE: ${r.name}. Endereço: ${r.address || '(não informado)'}.` +
      (r.instagram ? ` Instagram: ${r.instagram}.` : ''),
    r.accepting_orders ? 'Pedidos: abertos.' : 'Pedidos: FECHADOS agora (o restaurante não está recebendo pedidos). Não registre pedido; diga isso com gentileza.',
    '',
    'CARDÁPIO (a única fonte de pratos e preços):',
    await menuText(r.id),
    '',
    'INFORMAÇÕES DA CASA (escritas pela equipe; o que não estiver aqui você não sabe):',
    clip(r.wa_info, 3000) || '(a equipe ainda não preencheu: horário, entrega, taxa e Pix você não sabe)',
    '',
    `CLIENTE: ${contact.name ? `nome "${contact.name}" (pode ser só o apelido do WhatsApp; confirme o nome para o pedido)` : "(nome ainda não informado)"}. ${history.length ? 'Já conversou antes.' : 'Primeira mensagem dele.'}`,
    `PEDIDOS EM ANDAMENTO DESTE CLIENTE: ${orders.length ? orders.map(o => `nº ${o.number} (${STATUS_LABEL[o.status]}, ${brl(o.total_cents)})`).join('; ') : 'nenhum'}`,
    '',
    history.some(m => m.direction === 'out') ? 'ATENÇÃO: esta conversa já começou. NÃO cumprimente nem se apresente de novo; responda direto à última mensagem.' : '',
    'ÚLTIMAS MENSAGENS (fonte da verdade; inclui o que a equipe escreveu):',
    history.length ? history.reverse().map(m => `${who[m.origin] || m.origin}: ${m.text.slice(0, 400)}`).join('\n') : '(nenhuma)',
  ].join('\n');

  return { pausado: !!contact.needs_human, contexto, restaurante: r.name };
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

export async function botHuman(r, body) {
  const phone = cleanPhone(body.telefone);
  const reason = clip(body.motivo, 60) || 'outro';
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
  const mode = norm(body.tipo).startsWith('entreg') ? 'entrega' : 'retirada';
  const address = clip(body.endereco, 300);
  if (mode === 'entrega' && address.length < 8) return { resultado: 'ERRO: pedido de entrega sem endereço completo (rua, número, bairro e referência). Pergunte ao cliente.' };
  const payment = Object.keys(PAYMENTS).find(k => norm(body.pagamento).includes(k === 'cartao' ? 'cart' : k)) || '';
  if (!payment) return { resultado: 'ERRO: falta a forma de pagamento (dinheiro, Pix ou cartão). Pergunte ao cliente.' };

  const { products } = await menuFor(r.id);
  const problems = [];
  const lines = [];
  for (const it of items.slice(0, 30)) {
    const want = norm(it.produto || it.nome);
    const exact = products.filter(p => norm(p.name) === want);
    const near = exact.length ? exact : products.filter(p => want.length >= 3 && (want.includes(norm(p.name)) || norm(p.name).includes(want)));
    if (near.length !== 1) {
      problems.push(near.length ? `"${it.produto}" pode ser ${near.map(p => p.name).join(' ou ')}; confirme qual.` : `"${it.produto}" não está no cardápio.`);
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
  return { contacts, orders, info: r.wa_info || '', robot: !!config.waBotToken, can_send: !!config.waBotToken };
}

export async function conversation(r, phone) {
  phone = cleanPhone(phone);
  const contact = await get('SELECT * FROM wa_contacts WHERE restaurant_id = ? AND phone = ?', r.id, phone);
  if (!contact) throw new HttpError(404, 'Conversa não encontrada');
  await run('UPDATE wa_contacts SET unread = 0 WHERE id = ?', contact.id);
  const messages = (await all(`SELECT id, direction, origin, text, media, pending, created_at FROM wa_messages
    WHERE restaurant_id = ? AND phone = ? ORDER BY id DESC LIMIT 200`, r.id, phone)).reverse();
  return { contact: { ...contact, unread: 0 }, messages };
}

// Mensagem da equipe para o cliente. Com WA_N8N_URL (app no mesmo PC do n8n) envia na hora; sem ela (Vercel,
// que não alcança o PC) entra na fila (pending = 1) e o n8n busca a cada poucos segundos em /wa/bot/fila.
async function deliver(r, phone, text) {
  if (!config.waN8nUrl) {
    await logOut(r, phone, text, 'equipe', 1);
    return;
  }
  let res;
  try {
    res = await fetch(`${config.waN8nUrl}/webhook/espeto/enviar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': config.waBotToken },
      body: JSON.stringify({ telefone: phone, texto: text }), signal: AbortSignal.timeout(12000),
    });
  } catch { throw new HttpError(502, 'O WhatsApp não respondeu. Confira se o PC do atendente está ligado.'); }
  if (!res.ok) throw new HttpError(502, `O WhatsApp recusou o envio (erro ${res.status})`);
  await logOut(r, phone, text, 'equipe', 0);
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
  const msg = STATUS_MSG[status]?.(o, r);
  if (msg) {
    try { await deliver(r, o.phone, msg); }
    catch (e) { warning = `Status salvo, mas o aviso ao cliente não foi: ${e.message}`; }
  }
  return { ok: true, warning };
}

export async function saveInfo(r, body) {
  await run('UPDATE restaurants SET wa_info = ? WHERE id = ?', clip(body.info, 3000), r.id);
  return { ok: true };
}
