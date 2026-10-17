# Lições do projeto (críticas do Ribeiro, 16/10/2026)

O que deu errado na primeira entrega e a regra que vale daqui para frente.

| Crítica | Regra |
|---|---|
| "Cadê o cardápio?" A primeira tela era um painel técnico. | `localhost:3000` abre **direto no cardápio**. Painel da equipe fica em `/painel`. |
| "Não está fácil de entender essa interface." | O cliente faz só isto: vê o prato, toca no **+**, toca na sacola, escreve o nome e envia. Nada além disso na tela principal. |
| "Ainda pede PIN, sem necessidade alguma." | Sem PIN por padrão. Só liga com `STAFF_PIN=1` no `.env`, quando o cliente pedir. |
| "Horrível", "AI slop", "sem degradê". | Sem degradê, sem emoji como ícone, sem fonte padrão (Inter/Roboto/Arial), sem grade de cards iguais. Seguir as referências enviadas: foto escura no topo, título serifado na cor de destaque, folha clara arredondada, cards pretos que rolam de lado, barra inferior com botão central. |
| "Não me entregou um aplicativo." | Entregar algo que se usa no celular como app (tela cheia, barra inferior, sacola), testado em 390 px antes de mostrar. |
| "Tudo depende do restaurante." | O visual é por restaurante (`theme`: `premium` ou `claro`, cores e capa no cadastro). Novos temas entram via código. |
| "Ver 3D com 1 clique em cima da comida." | Tocar na foto abre o prato; se tiver modelo 3D, abre direto no 3D (com botão de realidade aumentada). |
| "A cozinha vê o pedido, ingredientes e observações." | Cada prato tem ingredientes; o cliente toca para tirar ("sem cebola") e escreve observação. A cozinha e o ticket impresso mostram **SEM ...** em destaque e a observação. |
| "Back-end sem burocracia." | Pedido chega na cozinha na hora, sem aprovação, sem cadastro, sem pagamento no celular. Conta fecha no caixa. |
| Restaurante real com preço inventado. | Demonstração usa restaurante **fictício** (Brasa Nobre). Cliente real só com cardápio real dele. |

## Antes de entregar qualquer tela
1. Abrir no celular (390 px) e fazer o pedido do começo ao fim.
2. Comparar lado a lado com as referências do cliente.
3. Conferir: sem PIN, sem degradê, sem emoji, abre direto no que o usuário pediu.
4. Mandar print junto com a entrega.
