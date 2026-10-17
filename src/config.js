import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Carrega .env simples (CHAVE=valor), sem dependências.
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  platformKey: process.env.PLATFORM_KEY || 'admin',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-troque',
  dbPath: process.env.DB_PATH || 'data/cardapio.db',
  // Postgres (Neon/Supabase). Vazio = SQLite local. A Vercel+Neon preenche DATABASE_URL/POSTGRES_URL sozinha.
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  // fuso usado no relatório do dia e na numeração diária dos pedidos
  timezone: process.env.APP_TZ || 'America/Sao_Paulo',
  // Vercel: sem disco gravável nem conexão longa; tempo real vira consulta a cada 2 s e upload fica desligado
  serverless: !!process.env.VERCEL,
  // PIN da equipe nas telas de cozinha/caixa/admin: desligado por padrão (STAFF_PIN=1 liga)
  requirePin: process.env.STAFF_PIN === '1',
  // restaurante aberto em http://localhost:3000/
  defaultSlug: process.env.DEFAULT_SLUG || 'brasa-nobre',
  // anti-trote: pedidos por mesa por janela de tempo
  orderLimit: { max: Number(process.env.ORDER_LIMIT_MAX || 10), windowMs: 60_000 },
};
