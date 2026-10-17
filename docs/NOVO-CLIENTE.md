# Implantar um novo cliente

1. **Criar o restaurante**: `/plataforma` (ou `npm run novo-cliente -- <slug> "<Nome>" <PIN> <mesas>`).
2. **Identidade**: em `/r/<slug>/admin` → Configurações: nome, frase, logo, capa, cores, WhatsApp, endereço, taxa de serviço.
3. **Cardápio**: categorias e produtos com preço e foto. Fotos quadradas, até ~300 KB (WebP ou JPG).
4. **Mesas**: conferir a quantidade; rótulos opcionais ("Varanda", "Balcão").
5. **QR Codes**: `/r/<slug>/qrcodes` aberto pelo endereço público (não `localhost`) → imprimir em adesivo/acrílico.
6. **NFC**: tags NTAG213 coladas sob o QR. Gravar pelo admin (Chrome no Android, botão "Gravar tag NFC") ou pelo app NFC Tools com o link da mesa.
7. **Cozinha**: tablet/celular com `/r/<slug>/cozinha`, PIN, "Ativar som", impressora (ver [IMPRESSAO.md](IMPRESSAO.md)).
8. **Caixa**: `/r/<slug>/caixa` no PC ou celular do caixa.
9. **Teste com a equipe**: fazer 2 pedidos de mesas diferentes, mudar status, chamar garçom, fechar uma conta.
10. **Anti-trote**: se aparecer pedido falso, ligar "Só aceitar pedidos de mesas abertas pelo caixa" e/ou gerar novo QR para a mesa.
11. **Opcional**: pratos em 3D ([3D-AR.md](3D-AR.md)).

Manter também um cardápio impresso: alguns municípios discutem proibir cardápio só digital.
