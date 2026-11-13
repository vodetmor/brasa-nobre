// Peças comuns do painel admin (só no servidor; nada daqui vai para o navegador).
// Variáveis de ambiente (arquivo .env na VPS, nunca no Git):
//   ADMIN_SENHA            senha do login do painel
//   ADMIN_SEGREDO          segredo para assinar o cookie de sessão
//   PAINEL_CHAVE_VPS       chave que a VPS manda no POST /api/admin/ingest
//   VAPID_PUBLICA / VAPID_PRIVADA   chaves das notificações push
//   ADMIN_DADOS            pasta onde ficam os dados (status, alertas, inscrições e saldo da IA) em arquivos JSON.
//                          É o padrão na VPS (volume do Docker). Sem ela, usa o Postgres de DATABASE_URL.
const crypto = require("crypto");

const COOKIE = "mz_admin";
const DIAS_SESSAO = 30;

// ---------- respostas ----------
function json(res, codigo, corpo) {
  res.statusCode = codigo;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.end(JSON.stringify(corpo));
}

async function lerCorpo(req, limite = 64 * 1024) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    const txt = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body);
    if (txt.length > limite) throw new Error("grande");
    return txt ? JSON.parse(txt) : {};
  }
  let txt = "";
  for await (const parte of req) {
    txt += parte;
    if (txt.length > limite) throw new Error("grande");
  }
  return txt ? JSON.parse(txt) : {};
}

// ---------- comparação segura ----------
function iguais(a, b) {
  const ha = crypto.createHash("sha256").update(String(a || "")).digest();
  const hb = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(ha, hb) && !!a && !!b;
}

// ---------- sessão (cookie assinado, HttpOnly) ----------
function assinar(txt) {
  return crypto.createHmac("sha256", process.env.ADMIN_SEGREDO || "").update(txt).digest("base64url");
}

function criarSessao(res) {
  const expira = Date.now() + DIAS_SESSAO * 864e5;
  const valor = expira + "." + assinar(String(expira));
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DIAS_SESSAO * 86400}`
  );
}

function encerrarSessao(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

function logado(req) {
  if (!process.env.ADMIN_SEGREDO) return false;
  const bruto = (req.headers.cookie || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE + "="));
  if (!bruto) return false;
  const [expira, sig] = bruto.slice(COOKIE.length + 1).split(".");
  if (!expira || !sig || Number(expira) < Date.now()) return false;
  return iguais(sig, assinar(expira));
}

// Bloqueia chamadas de outros sites (CSRF) nas rotas que mudam algo.
function mesmaOrigem(req) {
  const origem = req.headers.origin;
  if (!origem) return true;
  try {
    return new URL(origem).host === req.headers.host;
  } catch {
    return false;
  }
}

// ---------- armazenamento (Postgres do Neon) ----------
// Uma tabela chave → JSON. A conexão vem de DATABASE_URL (criada pelo Neon na Vercel).
let _pool;
let _pronta;
function banco() {
  if (!_pool) {
    const { Pool } = require("pg");
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL não configurada");
    _pool = new Pool({ connectionString: url, max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: false } });
    _pool.on("error", (e) => console.error("pg", e && e.message));
  }
  if (!_pronta) {
    _pronta = _pool
      .query("create table if not exists admin_kv (chave text primary key, valor jsonb not null, atualizado timestamptz not null default now())")
      .catch((e) => { _pronta = null; throw e; });
  }
  return _pronta.then(() => _pool);
}

// Na VPS os dados ficam em arquivos (um JSON por chave) dentro de ADMIN_DADOS.
const fs = require("fs");
const path = require("path");
const PASTA = process.env.ADMIN_DADOS || "";
const arquivo = (chave) => path.join(PASTA, chave.replace(/[^a-z0-9.]+/gi, "_"));

async function lerJson(caminho, padrao) {
  if (PASTA) {
    try {
      return JSON.parse(await fs.promises.readFile(arquivo(caminho), "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") console.error("lerJson", caminho, e.message);
      return padrao;
    }
  }
  try {
    const pool = await banco();
    const r = await pool.query("select valor from admin_kv where chave = $1", [caminho]);
    return r.rows.length ? r.rows[0].valor : padrao;
  } catch (e) {
    console.error("lerJson", caminho, e && e.message);
    return padrao;
  }
}

async function gravarJson(caminho, dados) {
  if (PASTA) {
    // grava num temporário e troca de uma vez, para nunca deixar arquivo pela metade
    const tmp = arquivo(caminho) + "." + process.pid + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    await fs.promises.writeFile(tmp, JSON.stringify(dados));
    await fs.promises.rename(tmp, arquivo(caminho));
    return;
  }
  const pool = await banco();
  await pool.query(
    "insert into admin_kv (chave, valor, atualizado) values ($1, $2::jsonb, now()) on conflict (chave) do update set valor = excluded.valor, atualizado = now()",
    [caminho, JSON.stringify(dados)]
  );
}

const ARQ = {
  status: "admin/status.json",
  inscricoes: "admin/inscricoes.json",
  alertas: "admin/alertas.json",
};

// ---------- push ----------
let webpush;
function pushPronto() {
  if (!process.env.VAPID_PUBLICA || !process.env.VAPID_PRIVADA) return null;
  if (!webpush) {
    webpush = require("web-push");
    webpush.setVapidDetails("mailto:contato@modernizai.com.br", process.env.VAPID_PUBLICA, process.env.VAPID_PRIVADA);
  }
  return webpush;
}

// Envia a mesma notificação para todos os celulares inscritos.
// Remove sozinho as inscrições que não existem mais (410/404).
async function enviarPush(notificacoes) {
  const wp = pushPronto();
  if (!wp || !notificacoes.length) return { enviados: 0 };
  const lista = await lerJson(ARQ.inscricoes, []);
  if (!lista.length) return { enviados: 0 };
  let enviados = 0;
  const mortas = new Set();
  for (const n of notificacoes) {
    const corpo = JSON.stringify({
      title: n.titulo,
      body: n.texto,
      tag: n.tag || "mz",
      nivel: n.nivel || "info",
      url: "/admin/",
    });
    await Promise.all(
      lista.map(async (sub) => {
        try {
          await wp.sendNotification(sub, corpo, { TTL: 6 * 3600, urgency: n.nivel === "erro" ? "high" : "normal" });
          enviados++;
        } catch (e) {
          if (e && (e.statusCode === 404 || e.statusCode === 410)) mortas.add(sub.endpoint);
          else console.error("push", e && e.statusCode, e && e.body);
        }
      })
    );
  }
  if (mortas.size) {
    const atual = await lerJson(ARQ.inscricoes, []);
    await gravarJson(ARQ.inscricoes, atual.filter((s) => !mortas.has(s.endpoint)));
  }
  return { enviados };
}

module.exports = {
  json,
  lerCorpo,
  iguais,
  criarSessao,
  encerrarSessao,
  logado,
  mesmaOrigem,
  lerJson,
  gravarJson,
  ARQ,
  enviarPush,
};
