// Service worker do Modernizai Admin: guarda a "casca" do app e mostra as notificações.
// Nunca guarda respostas de /api (status sempre vem fresco).
const VERSAO = "mz-admin-v6";
const CASCA = ["/admin/", "/admin/admin.css", "/admin/admin.js", "/admin/icone-192.png", "/favicon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (para pegar versão nova); cache só se estiver sem internet.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && CASCA.includes(url.pathname)) {
          const copia = r.clone();
          caches.open(VERSAO).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/admin/")))
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.title || "Modernizai Admin", {
      body: d.body || "",
      tag: d.tag || "mz",
      renotify: true,
      icon: "/admin/icone-192.png",
      badge: "/admin/icone-badge-96.png",
      data: { url: d.url || "/admin/" },
      requireInteraction: d.nivel === "erro",
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = (e.notification.data && e.notification.data.url) || "/admin/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      const aberta = lista.find((c) => new URL(c.url).pathname.startsWith("/admin"));
      return aberta ? aberta.focus() : self.clients.openWindow(alvo);
    })
  );
});
