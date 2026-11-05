# Site Modernizai + painel admin

HTML/CSS/JS puro. Publicado na Vercel (projeto `modernizai`) pela nuvem via conector Vercel.
- Número do WhatsApp: `js/site.js`, constante `WHATSAPP` (vazia = botões levam para #contato).
- Fotos da equipe: trocar o `<span>`/`<small>` dentro de `.pessoa__foto` por `<img src="img/ruan.webp" alt="Ruan" loading="lazy">`.
- Nomes/cargos: seção `#equipe` do index.html.
- Logo: SVG embutido no index.html (symbol #logo), cores por CSS (--l1/--l2). Fonte Inter pelo Google Fonts.

## Painel admin (`/admin`)
App instalável (PWA) com login, status dos WhatsApps, robôs, VPS, clientes e notificações push.

```
VPS (cron, 1/min)  --POST HTTPS-->  /api/admin/ingest  --> Vercel Blob privado (status, inscrições, alertas)
                                                       --> push para os celulares inscritos
celular (/admin)   --cookie-->      /api/admin/status, /api/admin/push
GitHub Actions (10 min) -->         /api/admin/vigia   --> push "VPS sem sinal" se parou de chegar relatório
```

- `admin/` tela (index, css, js, manifest, service worker, ícones). Nenhum segredo no navegador.
- `api/admin/` funções: `login`, `status`, `push`, `ingest`, `vigia`. Regras de alerta em `_regras.js`
  (problema só vira alerta depois de 2 relatórios seguidos; avisa de novo quando volta).
  Clientes mostrados em `_clientes.js`.
- `vps/painel_status.py` script da VPS (só leitura, stdlib). Não vai para a Vercel (`.vercelignore`).
- Variáveis na Vercel: `ADMIN_SENHA`, `ADMIN_SEGREDO`, `PAINEL_CHAVE_VPS`, `VAPID_PUBLICA`, `VAPID_PRIVADA`,
  `BLOB_READ_WRITE_TOKEN` (Blob privado `modernizai-admin`).
- iPhone: push só funciona com o app instalado (Compartilhar → Adicionar à Tela de Início), iOS 16.4+.
