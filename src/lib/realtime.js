// Tempo real. Dois modos, mesma interface para as regras de negócio (publish):
// - servidor comum (PC): Server-Sent Events, o navegador mantém uma conexão aberta e recebe os eventos na hora;
// - serverless (Vercel): cada evento vai para a tabela events e a tela consulta os novos a cada 2 s (pollEvents).
// Canais: "staff:<restaurantId>" (cozinha/caixa) e "table:<tableId>" (celular do cliente).
import { config } from '../config.js';
import { all, get, run } from '../db.js';

export const realtimeMode = config.serverless || process.env.REALTIME === 'poll' ? 'poll' : 'sse';
const channels = new Map();

export function subscribe(req, res, channel) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  let set = channels.get(channel);
  if (!set) channels.set(channel, (set = new Set()));
  set.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => { clearInterval(ping); set.delete(res); });
}

export async function publish(channel, event, data) {
  if (realtimeMode === 'poll') {
    await run('INSERT INTO events (channel, type, data) VALUES (?, ?, ?)', channel, event, JSON.stringify(data));
    if (Math.random() < 0.02) await run("DELETE FROM events WHERE created_at < datetime('now', '-1 days')");
    return;
  }
  const set = channels.get(channel);
  if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(msg);
}

// Sem "after": devolve só o último id (a tela já carregou o estado atual). Com "after": os eventos novos.
export async function pollEvents(channel, after) {
  if (after == null || after === '') {
    const r = await get('SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE channel = ?', channel);
    return { last: r.id, events: [] };
  }
  const events = (await all('SELECT id, type, data FROM events WHERE channel = ? AND id > ? ORDER BY id LIMIT 100', channel, Number(after) || 0))
    .map(e => ({ id: e.id, type: e.type, data: JSON.parse(e.data) }));
  return { last: events.length ? events[events.length - 1].id : Number(after) || 0, events };
}

export const staffChannel = restaurantId => `staff:${restaurantId}`;
export const tableChannel = tableId => `table:${tableId}`;
