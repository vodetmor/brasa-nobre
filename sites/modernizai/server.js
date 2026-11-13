// Servidor próprio do site + painel admin (VPS Hostinger). Sem framework e sem build:
// serve os arquivos estáticos e executa as funções de api/admin/*.js.
// Porta: PORT (padrão 3000). Variáveis: ver api/admin/_lib.js.
const http = require("http");
const fs = require("fs");
const path = require("path");

const RAIZ = __dirname;
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};
// Só estas pastas/arquivos saem para a internet (api/, vps/, node_modules/ e o resto ficam de fora).
const PASTAS = ["admin/", "css/", "js/", "img/", "fonts/"];
const SOLTOS = new Set(["index.html", "favicon.svg"]);
const CSP_ADMIN = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const rotas = {};
for (const f of fs.readdirSync(path.join(RAIZ, "api", "admin"))) {
  if (f.endsWith(".js") && !f.startsWith("_")) rotas[f.slice(0, -3)] = require(path.join(RAIZ, "api", "admin", f));
}

function cache(rel) {
  if (rel === "admin/sw.js" || /^admin\/(admin\.js|admin\.css|manifest\.webmanifest|index\.html)$/.test(rel) || rel === "index.html") return "no-cache";
  if (/^(fonts|img)\//.test(rel)) return "public, max-age=31536000, immutable";
  return "public, max-age=86400";
}

const servidor = http.createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (pathname.startsWith("/api/admin/")) {
      const h = rotas[pathname.slice(11).replace(/\/$/, "")];
      if (!h) { res.statusCode = 404; res.setHeader("Content-Type", "application/json"); return res.end('{"erro":"rota"}'); }
      return await h(req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; return res.end(); }
    if (pathname === "/admin") { res.statusCode = 307; res.setHeader("Location", "/admin/"); return res.end(); }
    if (pathname.endsWith("/")) pathname += "index.html";
    const rel = path.posix.normalize(pathname).replace(/^\/+/, "");
    if (rel.includes("..") || !(SOLTOS.has(rel) || PASTAS.some((p) => rel.startsWith(p)))) { res.statusCode = 404; return res.end("Não encontrado"); }
    const buf = await fs.promises.readFile(path.join(RAIZ, rel));
    res.setHeader("Content-Type", TIPOS[path.extname(rel)] || "application/octet-stream");
    res.setHeader("Cache-Control", cache(rel));
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (rel.startsWith("admin/")) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader("Content-Security-Policy", CSP_ADMIN);
      if (rel === "admin/sw.js") res.setHeader("Service-Worker-Allowed", "/admin/");
    }
    res.end(req.method === "HEAD" ? undefined : buf);
  } catch (e) {
    if (e && (e.code === "ENOENT" || e.code === "EISDIR")) { res.statusCode = 404; return res.end("Não encontrado"); }
    console.error("erro", e && e.message);
    if (!res.headersSent) res.statusCode = 500;
    res.end("Erro interno");
  }
});

servidor.listen(Number(process.env.PORT) || 3000, () => console.log("modernizai no ar"));

// Vigia: se o relatório da VPS parar de chegar (cron parado), avisa por push.
// Antes era o GitHub Actions que chamava /api/admin/vigia; agora roda aqui dentro.
const falso = () => ({ statusCode: 200, setHeader() {}, end() {} });
setInterval(() => { Promise.resolve(rotas.vigia({ method: "GET", headers: {} }, falso())).catch((e) => console.error("vigia", e && e.message)); }, 5 * 60 * 1000).unref();
