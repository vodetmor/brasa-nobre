// Camada de banco com dois motores e as mesmas funções (all/get/run/tx, todas assíncronas):
// - sem DATABASE_URL: SQLite embutido no Node (node:sqlite), arquivo em data/ (PC, sem instalar nada);
// - com DATABASE_URL (ou POSTGRES_URL): Postgres (Neon/Supabase), usado na Vercel.
// O SQL do app é escrito no dialeto do SQLite; toPg() traduz o pouco que muda.
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config, ROOT } from './config.js';

const schema = readFileSync(resolve(ROOT, 'src/schema.sql'), 'utf8');

// Colunas novas em bancos criados por versões antigas.
const MIGRATIONS = [
  ['restaurants', 'theme', "TEXT NOT NULL DEFAULT 'premium'"],
  ['products', 'ingredients', "TEXT DEFAULT ''"],
  ['order_items', 'removed', "TEXT DEFAULT ''"],
  ['table_sessions', 'payment_provider', "TEXT DEFAULT ''"],
  ['table_sessions', 'payment_ref', "TEXT DEFAULT ''"],
  ['restaurants', 'instagram', "TEXT DEFAULT ''"],
  ['restaurants', 'tiktok', "TEXT DEFAULT ''"],
  ['restaurants', 'facebook', "TEXT DEFAULT ''"],
  ['restaurants', 'ifood', "TEXT DEFAULT ''"],
  ['restaurants', 'website', "TEXT DEFAULT ''"],
  ['products', 'options', "TEXT DEFAULT ''"],
  ['order_items', 'choices', "TEXT DEFAULT ''"],
  // informações que o robô do WhatsApp pode usar (horário, entrega, Pix...), escritas pela equipe
  ['restaurants', 'wa_info', "TEXT DEFAULT ''"],
  ['wa_messages', 'pending', 'INTEGER NOT NULL DEFAULT 0'],
];

export const engine = config.databaseUrl ? 'postgres' : 'sqlite';
let impl;

if (engine === 'sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = resolve(ROOT, config.dbPath);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(schema);
  for (const [table, col, def] of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  const cache = new Map();
  const stmt = sql => { let s = cache.get(sql); if (!s) cache.set(sql, (s = db.prepare(sql))); return s; };
  impl = {
    all: (sql, p) => stmt(sql).all(...p),
    get: (sql, p) => stmt(sql).get(...p),
    run: (sql, p) => { const r = stmt(sql).run(...p); return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes }; },
    // Chamadas do SQLite são síncronas: dentro da transação só há microtarefas, nenhuma outra requisição entra no meio.
    async tx(fn) {
      if (db.isTransaction) return fn(); // transação aninhada: entra na de fora
      db.exec('BEGIN');
      try { const r = await fn(); db.exec('COMMIT'); return r; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
} else {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, Number);   // COUNT/SUM (bigint) como número
  pg.types.setTypeParser(1700, Number); // numeric
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? false : { rejectUnauthorized: false },
    max: 3,
  });
  const txClient = new AsyncLocalStorage();
  const q = (sql, p) => (txClient.getStore() || pool).query(toPg(sql), p);
  const ready = (async () => {
    const c = await pool.connect();
    try {
      await c.query('SELECT pg_advisory_lock(4242)');
      await c.query(toPg(schema));
      for (const [table, col, def] of MIGRATIONS) await c.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    } finally { await c.query('SELECT pg_advisory_unlock(4242)').catch(() => {}); c.release(); }
  })();
  impl = {
    async all(sql, p) { await ready; return (await q(sql, p)).rows; },
    async get(sql, p) { await ready; return (await q(sql, p)).rows[0]; },
    async run(sql, p) {
      await ready;
      const insert = /^\s*INSERT\s+INTO\s+(?!meta\b)/i.test(sql) && !/RETURNING/i.test(sql);
      const r = await q(insert ? `${sql} RETURNING id` : sql, p);
      return { lastInsertRowid: insert ? r.rows[0]?.id : undefined, changes: r.rowCount };
    },
    async tx(fn) {
      if (txClient.getStore()) return fn();
      await ready;
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await txClient.run(c, fn);
        await c.query('COMMIT');
        return r;
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    },
  };
}

// SQLite → Postgres: placeholders, chave autoincremento e as poucas funções de data usadas no app.
const TZ = config.timezone;
const TXT = "'YYYY-MM-DD HH24:MI:SS'";
const nowUtc = "(now() AT TIME ZONE 'UTC')";
function toPg(sql) {
  let n = 0;
  return sql
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
    .replace(/datetime\('now', '(-?\d+) (\w+)'\)/g, (_, k, unit) => `to_char(${nowUtc} + interval '${k} ${unit}', ${TXT})`)
    .replace(/datetime\('now'\)/g, `to_char(${nowUtc}, ${TXT})`)
    .replace(/date\('now', 'localtime'\)/g, `to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`)
    .replace(/date\(([\w.]+), 'localtime'\)/g, (_, c) => `to_char((${c}::timestamp AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`)
    .replace(/\?/g, () => `$${++n}`);
}

export const all = (sql, ...p) => impl.all(sql, p);
export const get = (sql, ...p) => impl.get(sql, p);
export const run = (sql, ...p) => impl.run(sql, p);
export const tx = fn => impl.tx(fn);

export const newToken = () => randomBytes(6).toString('base64url'); // 8 caracteres
