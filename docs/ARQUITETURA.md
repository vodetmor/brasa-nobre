# Arquitetura

## Como o pedido chega na cozinha

```
Celular do cliente                Servidor (Node)                     Cozinha / Caixa
QR ou NFC → /m/<token>  ───────►  GET /api/m/<token> (cardápio)
Envia pedido            ───────►  POST /api/m/<token>/orders
                                  - valida mesa, nome, itens
                                  - recalcula preço pelo banco
                                  - abre a comanda da mesa se preciso
                                  - grava no SQLite
                                  - publica evento "order"  ───────►  /api/r/<slug>/stream (SSE)
                                                                      tela atualiza, toca som, imprime
Acompanha status        ◄───────  /api/m/<token>/stream (SSE)  ◄────  cozinha muda status (PATCH)
```

- **Tempo real**: Server-Sent Events. O navegador mantém uma conexão aberta e recebe os eventos `order`, `call` e `session`. Reconecta sozinho se a internet oscilar; ao reconectar, a tela recarrega a lista.
- **Mesa**: cada mesa tem um `token` aleatório de 8 caracteres. O QR aponta para `/m/<token>` e a tag NFC para `/m/<token>?src=nfc` (fica registrado de onde veio o pedido). Se alguém fotografar o QR, o admin pode gerar um token novo para a mesa.
- **Comanda** (`table_sessions`): abre no primeiro pedido (ou pelo caixa) e junta todos os pedidos da mesa até o caixa fechar a conta. Ao fechar, registra a forma de pagamento e o total; os pedidos viram "entregue".
- **Equipe**: login por PIN do restaurante, com cookie assinado (HMAC) que dura 30 dias, para o tablet da cozinha ficar logado.
- **Multi-cliente**: tudo tem `restaurant_id`; o login de um restaurante não acessa outro (testado em `npm test`).

## Proteções

| Risco | O que o sistema faz |
|---|---|
| Pedido falso de fora do restaurante | Token por mesa; modo "só mesa aberta pelo caixa" (`require_open_table`); cozinha pode cancelar |
| Clique repetido / spam | Limite de 10 pedidos por minuto por mesa e 8 por IP; 3 chamados por minuto |
| Cliente altera preço | Preço sempre vem do banco; o servidor ignora o que o celular manda |
| Internet cai | SSE reconecta e recarrega; o pedido só some do carrinho depois que o servidor confirma |
| PIN vazando | O cardápio público nunca devolve o PIN; login tem limite de tentativas |

## Banco

`src/schema.sql`: `restaurants`, `tables`, `categories`, `products`, `table_sessions` (comanda), `orders`, `order_items`, `service_calls`. Dinheiro em centavos. SQL simples, portável para Postgres.

## Produção (quando o cliente fechar)

O protótipo roda num processo Node. Caminho recomendado, do mais simples ao mais robusto:

1. **Um servidor Node + Postgres** (recomendado para começar com vários clientes)
   - Hospedagem com processo contínuo, porque o SSE precisa de conexão aberta: Railway, Render, Fly.io ou uma VPS (Hetzner/Contabo/Hostinger), de US$ 5 a 20 por mês.
   - Banco: Postgres gerenciado (Supabase, Neon ou o do próprio Railway). Trocar `src/db.js` por um adaptador Postgres (`pg`); o SQL quase não muda (`AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY`, `datetime('now')` → `now()`).
   - Fotos e modelos 3D: Supabase Storage, Cloudflare R2 ou S3 no lugar da pasta `uploads/`.
   - Domínio único com um caminho por cliente (`cardapio.agencia.com.br/m/<token>`), ou subdomínio por cliente.
2. **Vercel + Supabase** (se quiser tudo serverless)
   - Vercel não segura bem conexões SSE longas; nesse caso trocar o tempo real por **Supabase Realtime** (o navegador assina as mudanças da tabela `orders`). O resto da lógica vira funções em `/api`.
   - Exige reescrever `realtime.js` e o login (Supabase Auth com papéis cozinha/caixa/admin + Row Level Security por restaurante).

Em ambos: HTTPS é obrigatório (Web NFC, Web Bluetooth, AR e câmera só funcionam em HTTPS), backup diário do banco e um `PLATFORM_KEY`/`SESSION_SECRET` fortes.

## Próximos passos sugeridos

- Pix no fechamento da comanda (QR dinâmico via Asaas/Mercado Pago/Efí + webhook marca "pago").
- Adicionais e variações por produto (ponto da carne, tamanho, "sem cebola" como opção).
- Usuários da equipe com papéis (garçom, cozinha, caixa, dono) em vez de um PIN só.
- Estoque simples ("esgotou" automático) e relatórios por período.
- Aviso por WhatsApp quando o pedido fica pronto (opcional, custo por mensagem).
- Métricas de uso do 3D/AR por prato, para vender o adicional com dados.
