# Cardápio SaaS

Cardápio digital para qualquer restaurante, bar ou espetinho, pensado como produto da agência (um sistema, vários clientes):

- **QR Code + NFC por mesa**: o cliente lê o QR ou encosta o celular na tag e abre o cardápio daquela mesa, sem instalar app.
- **Pedido com nome**: monta o carrinho, escreve observações, informa o nome e envia.
- **Cozinha em tempo real**: o pedido aparece na tela na hora, com som, cronômetro e impressão automática (impressora do sistema, Bluetooth BLE ou app RawBT).
- **Comanda da mesa**: todos os pedidos da mesa somam numa comanda. O caixa fecha a conta no final (dinheiro, Pix, cartão), com divisão por pessoa. O pagamento não é feito no celular.
- **Chamar garçom / pedir a conta** pelo celular.
- **3D e realidade aumentada** opcional por prato (Google `<model-viewer>`; Android e iPhone).
- **Ingredientes**: o cliente toca para tirar um ingrediente ("sem cebola") e escreve observação; a cozinha vê em destaque.
- **Multi-cliente**: cada restaurante tem slug, visual (`premium` ou `claro`), cores, capa, mesas e cardápio próprios.
- **Anti-trote**: token aleatório por mesa (pode ser trocado), limite de pedidos por minuto, preço sempre calculado no servidor e modo "só aceita pedido de mesa aberta pelo caixa".

Status: **protótipo local completo** (roda neste PC com banco SQLite). Para produção, ver [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Rodar

Requisito: **Node.js 22.5 ou mais novo** (usa o SQLite que já vem no Node; não precisa `npm install`). No Windows, basta dar dois cliques em `iniciar.bat`.

```bash
npm run seed     # cria os restaurantes de demonstração
npm start        # sobe em http://localhost:3000
npm test         # teste de ponta a ponta da API (mesa → cozinha → caixa)
```

No terminal aparece também o endereço de rede (ex.: `http://192.168.0.10:3000`). Abra esse endereço no celular, no mesmo Wi-Fi, para testar como cliente. Os QR Codes usam o endereço pelo qual a página foi aberta; para gerar QR que funcione no celular, abra a tela de QR Codes pelo IP da rede (ou defina `PUBLIC_URL` no `.env`).

Copie `.env.example` para `.env` para trocar porta, chave da plataforma e segredo.

### Demonstração

`http://localhost:3000` abre direto no cardápio da mesa 1. Telas da equipe em `http://localhost:3000/painel` (sem PIN; para exigir PIN, `STAFF_PIN=1` no `.env`).

| Restaurante (fictício) | Visual | Observação |
|---|---|---|
| Central do Espeto (cliente real, abre em `/`) | premium (preto e dourado) | Cardápio real: prato feito montado (arroz, feijão, carne, acompanhamento) e pratos da casa. Fotos ilustrativas até chegarem as da casa |
| Brasa Nobre | premium (escuro) | Espetaria com fotos, ingredientes e um prato em 3D (guacamole) |
| Bistrô Demo | claro (editorial) | Exemplo do segundo tema, taxa de serviço de 10% |

Leia também [docs/LICOES.md](docs/LICOES.md) antes de mexer no visual.

Plataforma (criar clientes): `/plataforma`, chave `admin` (troque em `PLATFORM_KEY`).

## Telas

| Endereço | Quem usa | O que faz |
|---|---|---|
| `/m/<token>` | Cliente (QR/NFC da mesa) | Cardápio, 3D/AR, carrinho, enviar pedido, comanda, chamar garçom, pedir a conta |
| `/r/<slug>/cozinha` | Cozinha (tablet/PC) | Pedidos em colunas Novos → Preparando → Prontos, som, impressão |
| `/r/<slug>/caixa` | Caixa | Mapa das mesas, comanda, lançar pedido, fechar conta, resumo do dia |
| `/r/<slug>/admin` | Dono | Cores e dados, cardápio, fotos e modelos 3D, mesas, gravar NFC, relatório |
| `/r/<slug>/qrcodes` | Dono | Folha A4 com os QR Codes das mesas para imprimir |
| `/painel` | Equipe | Links do cardápio, cozinha, caixa, cadastro e QR de cada restaurante |
| `/plataforma` | Agência | Lista e cria restaurantes |

## Novo cliente

```bash
npm run novo-cliente -- pizzaria-do-ze "Pizzaria do Zé" 5678 15
```

Depois: entrar em `/r/pizzaria-do-ze/admin`, cadastrar cardápio e cores, imprimir os QR Codes e gravar as tags NFC. Passo a passo em [docs/NOVO-CLIENTE.md](docs/NOVO-CLIENTE.md).

## Estrutura

```
src/
  server.js        rotas da API e das páginas (HTTP do Node, sem framework)
  services.js      regras de negócio (pedidos, comanda, mesas, cardápio)
  db.js            banco SQLite (troque por Postgres em produção)
  schema.sql       tabelas
  config.js        variáveis de ambiente
  lib/             roteador, login da equipe, tempo real (SSE), limite anti-trote
public/
  menu.html        cardápio do cliente           assets/js/menu.js
  cozinha.html     painel da cozinha             assets/js/cozinha.js, printer.js
  caixa.html       caixa / comandas              assets/js/caixa.js
  admin.html       cadastro                      assets/js/admin.js
  qrcodes.html     impressão dos QR              assets/js/qrcodes.js
  plataforma.html  área da agência               assets/js/plataforma.js
  assets/css/      base.css (tema por variáveis) + um CSS por tela
  assets/vendor/   model-viewer (Apache-2.0) e qrcode-generator (MIT), sem CDN
  models/          avocado.glb (Khronos, CC0) para a demo de 3D
scripts/           seed, novo-cliente, smoke-test
docs/              arquitetura, impressão, 3D/AR, pesquisa de repositórios
```

## Documentação

- [docs/ARQUITETURA.md](docs/ARQUITETURA.md): como funciona e como subir em produção.
- [docs/IMPRESSAO.md](docs/IMPRESSAO.md): impressora térmica (USB, rede, Bluetooth) e impressão automática.
- [docs/3D-AR.md](docs/3D-AR.md): como produzir e publicar os pratos em 3D/AR.
- [docs/NOVO-CLIENTE.md](docs/NOVO-CLIENTE.md): checklist de implantação.
- [docs/PESQUISA-3D-AR-GITHUB.md](docs/PESQUISA-3D-AR-GITHUB.md): análise dos repositórios do GitHub, IA de foto para 3D, NFC e pagamento.

## No ar (Vercel + Neon)

- `api/index.js` usa o mesmo handler do servidor local; `vercel.json` serve `public/` e reescreve as páginas.
- Banco: com `DATABASE_URL` (ou `POSTGRES_URL`, que a integração Neon da Vercel cria) o app usa Postgres; sem ela, SQLite em `data/`.
- Na Vercel o tempo real vira consulta a cada 2 s (tabela `events`), o upload de arquivo fica desligado e os demos são criados sozinhos no primeiro acesso.
- O build roda `npm run assets`, que baixa as fotos e modelos 3D de IA da demo para `public/demo/ai/`.
- Variáveis: `SESSION_SECRET` e `PLATFORM_KEY` (área da agência em `/agencia`).
- `/plataforma` é a página da demonstração (cardápio, cozinha, caixa e cadastro de cada restaurante).
- Teste local com Postgres: `DATABASE_URL=postgres://... npm test` (e `REALTIME=poll` para testar o modo da Vercel).
