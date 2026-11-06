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

### Saldo da IA (z.ai)
Saldo REAL: a VPS consulta `GET https://api.z.ai/api/biz/account/query-customer-account-report`
(`Authorization: Bearer <chave dos robôs>`, lida do .env só na VPS) a cada 5 min e manda `ia.saldo_real`
(disponível, recarregado, gasto total). Recarga detectada pelo total recarregado libera os avisos de novo.
Se a consulta falhar por mais de 30 min, o painel volta para a estimativa:
`saldo estimado = último saldo informado − custo dos tokens gastos desde então`.
- A VPS (`painel_status.py`) lê as execuções do n8n (nó `lmChatOpenAi` → `tokenUsage`; nós HTTP com `usage` e `model` glm),
  guarda os eventos em `~/painel/zai_uso.json` (35 dias) e manda os totais no campo `ia` do relatório.
- `api/admin/_zai.js`: tabela de preços (US$/1M tokens), cálculo e avisos (abaixo de US$ 1,50, de US$ 0,50, ou acabando em < 2 dias).
  Cada aviso vai uma vez por saldo informado, por push e por WhatsApp (a resposta do ingest devolve `whatsapp`; a VPS envia
  para `whatsapp_destino` do config.json pelo WhatsApp que estiver conectado).
- `POST /api/admin/zai {saldo}`: botão "Informar saldo atual" no painel. Use depois de cada recarga. Blob `admin/zai.json`.
