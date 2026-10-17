# Impressão na cozinha

A tela da cozinha (`/r/<slug>/cozinha`) tem o seletor **Impressão automática**. Quando ligado, cada pedido novo imprime sozinho. Há também o botão 🖨 em cada pedido e o botão **Testar impressão**.

| Modo | Impressora | Onde roda | Automático de verdade? |
|---|---|---|---|
| Impressora do sistema | USB ou rede, instalada no Windows/Android | Qualquer navegador | Sim, com o Chrome em modo quiosque (abaixo). Sem isso, abre a janela de impressão a cada pedido |
| Bluetooth BLE | Térmica portátil Bluetooth Low Energy | Chrome no Android ou no PC (HTTPS ou localhost) | Sim. Parear uma vez com "Conectar impressora" |
| RawBT | Térmica Bluetooth clássica (a maioria das genéricas baratas) | Android com o app gratuito RawBT | Abre o RawBT a cada pedido; o RawBT pode ser configurado para imprimir direto |

Papel: escolha **58 mm** (32 colunas) ou **80 mm** (48 colunas). Acentos são removidos no modo ESC/POS (Bluetooth/RawBT) porque cada impressora usa uma tabela de caracteres diferente.

## Central do Espeto (impressora portátil Bluetooth 58 mm, "Android+iOS")

1. Descobrir o tipo: no Chrome do Android, abrir a cozinha, escolher **Bluetooth BLE** e tocar em **Conectar impressora**. Se ela aparecer na lista e o **Testar impressão** sair, é BLE: pronto.
2. Se não aparecer, é Bluetooth clássico: instalar o **RawBT** (Play Store), parear a impressora nas configurações do Android, abrir o RawBT e selecionar a impressora; depois escolher **RawBT** na cozinha.
3. Deixar o celular/tablet da cozinha carregando, com a tela da cozinha aberta. A tela pede um toque para ativar o som e mantém a tela acesa.

## Impressora USB/rede num PC Windows sem janela de confirmação

Criar um atalho do Chrome com:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=http://localhost:3000/r/<slug>/cozinha
```

`--kiosk-printing` imprime direto na **impressora padrão** do Windows. Defina a térmica como padrão.

## Limitações conhecidas

- Web Bluetooth não existe no iPhone (Safari). Para iPhone na cozinha, usar impressora de rede ou só a tela.
- Impressora Bluetooth pode desconectar; a tela avisa "desconectada" e o pedido continua na tela. O botão 🖨 reimprime.
- Os UUIDs BLE testados no código são os mais comuns em impressoras genéricas; um modelo diferente pode precisar de um UUID novo em `public/assets/js/printer.js` (`BLE_SERVICES`).
- Nada disto foi testado com uma impressora física ainda: testar com a do cliente antes de instalar.
