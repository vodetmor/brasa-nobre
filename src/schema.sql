-- Esquema do cardápio SaaS (multi-restaurante).
-- SQL simples e portátil: roda no SQLite local e migra para Postgres (Supabase/Neon)
-- trocando INTEGER PRIMARY KEY AUTOINCREMENT por BIGSERIAL/IDENTITY.
-- Valores em dinheiro ficam em centavos (inteiro) para evitar erro de arredondamento.

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  primary_color TEXT DEFAULT '#c62828',
  accent_color TEXT DEFAULT '#ff9800',
  bg_color TEXT DEFAULT '#111111',
  text_color TEXT DEFAULT '#ffffff',
  whatsapp TEXT DEFAULT '',
  address TEXT DEFAULT '',
  -- redes do botão Contato do cardápio (@usuário ou link)
  instagram TEXT DEFAULT '',
  tiktok TEXT DEFAULT '',
  facebook TEXT DEFAULT '',
  ifood TEXT DEFAULT '',
  website TEXT DEFAULT '',
  staff_pin TEXT NOT NULL,
  -- 1 = só aceita pedido se o caixa abriu a mesa (proteção contra trote)
  require_open_table INTEGER NOT NULL DEFAULT 0,
  -- 1 = pedidos aceitos; 0 = cardápio só para consulta (fechado)
  accepting_orders INTEGER NOT NULL DEFAULT 1,
  service_fee_pct REAL NOT NULL DEFAULT 0,
  -- visual do cardápio do cliente: 'premium' (escuro) ou 'claro' (editorial)
  theme TEXT NOT NULL DEFAULT 'premium',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  label TEXT DEFAULT '',
  -- token aleatório usado no QR/NFC (não expõe o número da mesa e pode ser trocado)
  token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (restaurant_id, number)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_cents INTEGER NOT NULL,
  image_url TEXT DEFAULT '',
  -- 3D/AR: GLB (Android/web) e USDZ (AR no iPhone). Opcionais.
  model_glb_url TEXT DEFAULT '',
  model_usdz_url TEXT DEFAULT '',
  -- tag livre: "mais pedido", "picante", "vegetariano"...
  badge TEXT DEFAULT '',
  -- ingredientes separados por vírgula; o cliente pode tirar algum e a cozinha vê
  ingredients TEXT DEFAULT '',
  -- escolhas do prato, uma linha por grupo: "Arroz: Branco, Com brócolis" ("+5" soma R$ 5)
  options TEXT DEFAULT '',
  available INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

-- Comanda da mesa: junta todos os pedidos até o caixa fechar a conta.
CREATE TABLE IF NOT EXISTS table_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',          -- open | closed
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  payment_method TEXT,                          -- dinheiro | pix | cartao | outro
  subtotal_cents INTEGER,
  service_cents INTEGER,
  total_cents INTEGER,
  payment_provider TEXT DEFAULT '',             -- maquininha usada (simulado, mercadopago, stone...)
  payment_ref TEXT DEFAULT ''                   -- código da transação na maquininha
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,                      -- número do pedido no dia, por restaurante
  customer_name TEXT NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received',      -- received | preparing | ready | delivered | canceled
  total_cents INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'qr',            -- qr | nfc | garcom | whatsapp
  client_ip TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,                           -- cópia do nome no momento do pedido
  unit_price_cents INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  note TEXT DEFAULT '',
  removed TEXT DEFAULT '',                      -- ingredientes que o cliente pediu para tirar
  choices TEXT DEFAULT ''                       -- escolhas feitas ("Arroz: Branco; Carne: Cupim")
);

-- Chamados da mesa: chamar garçom, pedir a conta.
CREATE TABLE IF NOT EXISTS service_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                           -- garcom | conta
  customer_name TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',          -- open | done
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_rest_status ON orders(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_table ON table_sessions(table_id, status);
CREATE INDEX IF NOT EXISTS idx_products_rest ON products(restaurant_id, category_id);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- Fila de eventos para o tempo real em servidor sem conexão longa (Vercel): a tela busca os novos a cada 2 s.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_channel ON events(channel, id);

-- Atendimento pelo WhatsApp (robô no n8n + equipe no /r/<slug>/atendimento).
CREATE TABLE IF NOT EXISTS wa_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,                          -- só dígitos, com DDI (5561...)
  name TEXT DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'conversando',    -- conversando | pedido
  -- 1 = robô pausado: a equipe responde por aqui
  needs_human INTEGER NOT NULL DEFAULT 0,
  human_reason TEXT DEFAULT '',
  last_message TEXT DEFAULT '',
  usual TEXT DEFAULT '',                        -- "o de sempre" definido pela casa
  unread INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (restaurant_id, phone)
);

CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL,                      -- in | out
  origin TEXT NOT NULL DEFAULT 'cliente',       -- cliente | robo | equipe
  text TEXT NOT NULL DEFAULT '',
  media TEXT DEFAULT '',                        -- audio | imagem | video | outro
  pending INTEGER NOT NULL DEFAULT 0,           -- mensagem da equipe na fila do n8n: 1 = esperando, -1 = falhou
  wa_id TEXT DEFAULT '',                        -- id da mensagem no WhatsApp (descarta entrega repetida)
  media_file TEXT DEFAULT '',                   -- arquivo guardado pelo WAHA no PC (foto, vídeo, documento)
  media_name TEXT DEFAULT '',                   -- nome do documento enviado
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_phone ON wa_messages(restaurant_id, phone, id);

-- Pedido de entrega/retirada feito pelo WhatsApp. Preço calculado no servidor a partir do cardápio.
CREATE TABLE IF NOT EXISTS wa_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,                      -- número do pedido no dia
  phone TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '[]',             -- JSON: [{ name, qty, unit_price_cents, choices, note }]
  total_cents INTEGER NOT NULL,                 -- só os itens; taxa de entrega a equipe combina
  mode TEXT NOT NULL DEFAULT 'retirada',        -- entrega | retirada | local
  address TEXT DEFAULT '',
  payment TEXT DEFAULT '',                      -- dinheiro | pix | cartao
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'novo',          -- novo | confirmado | saiu | pronto | entregue | cancelado
  kitchen_order_id INTEGER,                     -- pedido criado na cozinha quando a equipe confirma
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_orders_rest ON wa_orders(restaurant_id, status);

-- Reclamações dos clientes (o robô classifica ao passar para a equipe; a equipe também marca). Só aviso para o dono.
CREATE TABLE IF NOT EXISTS wa_complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT DEFAULT '',
  topic TEXT NOT NULL DEFAULT 'Outro',          -- assunto curto: Comida fria, Atraso na entrega...
  detail TEXT DEFAULT '',                       -- o que o cliente escreveu
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_complaints_rest ON wa_complaints(restaurant_id, created_at);
