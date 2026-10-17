# Pesquisa: repositórios GitHub, pipeline 3D/AR, NFC e pagamento na mesa

Para: SaaS multi-tenant de cardápio digital (QR + NFC por mesa, pedido com nome, painel da cozinha em tempo real, comanda fechada no caixa, 3D/AR opcional).
Stack do protótipo: Node.js (`node:sqlite`), Express, JS puro, SSE, `<model-viewer>`.
Data da pesquisa: 16/10/2026. Câmbio usado nas estimativas: **US$ 1 ≈ R$ 5,50** (suposição, não pesquisada; ajuste conforme o dia).
Legenda: **[inferência]** = conclusão minha, não afirmada pela fonte. **[verificar]** = dado conflitante ou de fonte secundária.

---

## 0. Recomendação (resumo executivo)

1. **Manter a stack atual.** Nenhum repositório revisado justifica migrar. O mais parecido com o nosso escopo é o `iamalidev/restofy` (QR/NFC + 3D/AR com model-viewer + KDS + POS de garçom), mas ele é Angular/NestJS/Redis, tem 4 commits e **não tem licença**. Use-o só como checklist de funcionalidades. O `xohaxed/Restaurant-OS` confirma que SSE basta para o KDS.
2. **Código que pode ser copiado de verdade (licença permissiva):** `rinchhen012/qr-restaurant` (MIT), `BaoDuong254/QRMeal` (MIT), `tastyigniter/TastyIgniter` (MIT), `google/model-viewer` (Apache-2.0) e `glTF-Transform` (MIT). O `elitale/restro` e o `proffalken/ByteOrder` são **AGPL-3.0**: não copie código para um SaaS fechado, só ideias. Os demais não têm arquivo LICENSE, o que significa "todos os direitos reservados". Só ideias.
3. **AR:** `<model-viewer>` 4.4.0 (npm, 09/10/2026) com `ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed" ar-placement="floor"`. Sirva **só GLB** e deixe o model-viewer gerar o USDZ na hora para iPhone. Só forneça `ios-src` se a geração automática falhar em algum prato.
4. **Orçamento por prato:** GLB de **≤ 3 MB** (teto de 5 MB), **20 a 50 mil triângulos**, texturas de **1024 px** (2048 só para pratos de destaque), escala real em metros. Comprima com `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024`, mas **teste no Scene Viewer**. Se der problema, use `--compress draco`, ou nenhuma compressão de geometria, e mantenha só o WebP. [inferência: o suporte do Scene Viewer a meshopt/WebP não foi confirmado]
5. **Produção dos modelos:** no padrão, use IA a partir de fotos do prato real (Meshy, Tripo ou Rodin), depois limpeza rápida no Blender e o gltf-transform. Custo de API de **~R$ 3 a 15 por prato** (com 2 ou 3 tentativas), mais 20 a 40 min de trabalho. Para 3 a 5 pratos-vitrine por cliente, use fotogrametria (RealityScan ou KIRI no celular, Object Capture no Mac/iPhone com LiDAR). É mais fiel, mas leva de 1 a 2 h por prato. Venda o 3D como **add-on pago por prato** (ex.: R$ 80 a 250/prato) [inferência comercial].
6. **NFC:** use **NTAG213** (144 bytes, cerca de 130 caracteres de URL), que basta para `https://dominio/m/<slug>/<token>`. Custa **~R$ 2,40 a 2,90 cada** em lotes de 10 a 100 (Kabum), e a versão para metal sai ~R$ 4 a 5. Grave as tags pelo próprio admin com **Web NFC** (Chrome Android) e trave com `makeReadOnly()`. O iPhone XS e posteriores leem a tag em segundo plano e abrem o Safari pela notificação. **Use sempre QR + NFC juntos**, porque o NFC não é universal.
7. **Segurança da mesa:** o token na URL da tag/QR deve ser opaco e rotacionável por mesa. Como alguém pode fotografar o QR e pedir de casa, exija a **abertura da comanda pelo garçom/caixa** ou mostre os pedidos para aprovação [inferência].
8. **Pagamento:** "NFC da mesa como maquininha" **não é viável**, porque uma tag passiva não processa cartão. O realista para o MVP é **Pix com QR dinâmico no fechamento da comanda** (Asaas, Mercado Pago, Efí etc. via API + webhook). Depois, **Tap to Pay no celular do garçom/caixa** (InfinitePay, SumUp, PicPay, C6, Ton, PagBank, Mercado Pago), operado fora do nosso sistema.

---

## 1. Repositórios indicados pelo dono

Método: páginas e READMEs no github.com e arquivos LICENSE via raw.githubusercontent.com. A API do GitHub não estava disponível nesta sessão, então só há datas de commit onde a página de commits foi lida.

### Tabela-resumo

| Repo | O que é | Stack | Licença (arquivo) | Atividade | Demo | Valor para nós |
|---|---|---|---|---|---|---|
| [elitale/restro](https://github.com/elitale/restro) | Gestão completa de restaurante: POS, KDS, mesas, estoque, faturamento (GST da Índia), autoatendimento por QR | Next.js 16, React 19, Prisma 7, Postgres, Twilio OTP | **AGPL-3.0** | 28 commits, 18/07 a 14/08/2026; 8★ | Não (só elitale.com) | Alto em **ideias** (OTP do cliente, PIN de garçom, KDS com alerta de voz, baixa de estoque por receita). Código: não |
| [rinchhen012/qr-restaurant](https://github.com/rinchhen012/qr-restaurant) | Pedido via QR por mesa + cozinha + planta de mesas | React/TS/Chakra, Express/TS, MongoDB, Socket.IO, Docker | **MIT** | 10 commits; 6★ | Não | Médio. Botão "chamar garçom/água", planta drag-and-drop, timers de mesa. **Código reutilizável** |
| [xohaxed/Restaurant-OS](https://github.com/xohaxed/Restaurant-OS) | SaaS multi-tenant de cardápio QR com Stripe e KDS | Next.js 14, Neon Postgres, JWT (jose), Stripe, **SSE** | README diz MIT, mas **não há arquivo LICENSE** [verificar] | 3 commits; 1★ | **Sim**: https://qr-command.vercel.app | Alto como referência de produto: SSE no KDS, fluxo Pending→Preparing→Ready→Served, timer e alerta sonoro, planos €29/79/199 como referência de preço |
| [devaqn/MesaZap](https://github.com/devaqn/MesaZap) | Pedido por QR na mesa (Brasil) que envia o pedido ao WhatsApp da cozinha | Fastify 5, Prisma 6, Postgres, Baileys (WhatsApp), **HTML/JS puro** | "Todos os direitos reservados" | 1 commit; 0★ | Não | Médio. É o mais próximo culturalmente (pt-BR, JS puro). Ideia: **notificação WhatsApp best-effort** como canal extra à cozinha. O roadmap dele ("comanda consolidada") é o que nós já temos |
| [Fritz24/Restauspace](https://github.com/Fritz24/Restauspace) | "TableScan MVP": QR por mesa + assistente de IA que monta o carrinho | Next.js 14, Supabase (realtime/RLS), API Anthropic | Sem licença | 8 commits; 0★ | Não | Ideias: **revalidar preço no servidor**, IA "monte um pedido de R$ X para 2 pessoas", gerar cardápio a partir de texto |
| [iamalidev/restofy](https://github.com/iamalidev/restofy) | "3D/AR Menu, Waiter POS & CRM" multi-tenant: QR/NFC, Three.js + model-viewer, KDS, papéis | Angular 17, NestJS, Socket.IO, Prisma, Postgres, Redis, Turborepo | **Sem licença** | 4 commits, todos em 15/08/2026; 0★ | Não | **Checklist de escopo**: papéis (Owner/Manager/Waiter/Kitchen), métricas de uso de 3D/AR, templates de impressão de QR em PNG/SVG, preço em Decimal. Arquitetura pesada demais para nós |
| [CalGuo/DishAR](https://github.com/CalGuo/DishAR) | Cardápio AR multi-tenant: dono sobe GLB/USDZ e cliente vê o prato em AR pelo QR | Next.js 16, Supabase, **model-viewer 4.3**, Vercel | **Sem licença** | 32 commits, 02/08 a 12/09/2026; 0★ | Não | **Alto (ideias)** para o nosso componente AR, detalhado abaixo |
| [sinu786/Interactive_menu](https://github.com/sinu786/Interactive_menu) | Cardápio 3D + WebAR "premium": prato em pedestal, depois AR com a câmera | React, Three.js, Zustand, Vite, Tailwind (AR próprio, **não** usa model-viewer) | README diz MIT, sem arquivo LICENSE [verificar] | 3 commits; 0★ | Não | Médio. Orçamento de modelos (<5 MB, <50k tris, textura de 1024 a 2048) e UI de detalhes (alérgenos, calorias, picância) |
| [itskv3018/restaurant](https://github.com/itskv3018/restaurant) | Site institucional de restaurante com hambúrguer 3D (Three.js); pedidos via links do Swiggy/Zomato | React 18, Vite, Three.js | Sem licença | 1 commit | Não | **Baixo**. É uma landing page, sem pedido, sem AR, sem QR |

### Detalhes úteis por repositório

**CalGuo/DishAR**, o mais relevante para o AR. O wrapper `src/components/ar-viewer.tsx` faz:
- `ar`, `ar-scale="fixed"` (tamanho real, sem pinça), `ar-modes="webxr scene-viewer quick-look"`, `camera-controls`, `auto-rotate`, `loading="eager"` e `ios-src` opcional.
- Checa `el.canActivateAR` após o load e, se for `false`, mostra um aviso de que o AR em tamanho real exige ARCore/ARKit.
- Usa um `MutationObserver` no atributo `ar-status` para mostrar overlays de "posicionando..." e "falhou".
- Tem timeout de 60 s, botão "Tentar de novo" (remove o `src` e recarrega) e um gerador procedural de GLB de demonstração (`/api/demo-model`).
- Mede scans do cardápio e visualizações por prato no painel do dono.
→ Vamos reimplementar o mesmo padrão em JS puro (não copiar, porque não há licença). Ver a seção 2.6.

**iamalidev/restofy**: README cita "QR/NFC table menus with table-scoped sessions", "procedural fallback" quando não há modelo 3D, analytics de "3D/AR usage", KDS kanban com timers e QR em PNG/SVG para impressão. Bom checklist para o roadmap.

**elitale/restro**: o fluxo `/order/[username]?table=…` usa **OTP por telefone** antes de aceitar o pedido. É uma solução para o problema de "pedido falso de fora do restaurante". Para nós, um OTP via WhatsApp custaria dinheiro. A alternativa barata é "garçom abre a comanda" [inferência].

**xohaxed/Restaurant-OS**: valida exatamente a nossa escolha de **SSE** para o tempo real (cozinha → mesa). Tem demo pública para benchmarking de UX.

### Outros repositórios encontrados

| Repo | O que é | Licença | Nota |
|---|---|---|---|
| [BaoDuong254/QRMeal](https://github.com/BaoDuong254/QRMeal) | Pedido por QR na mesa: Fastify + Next.js + **SQLite**/Prisma, Socket.IO, papéis Owner/Employee/Guest, i18n | **MIT** (arquivo confirmado) | 244 commits, demo em qrmeal.ticklab.site. O mais maduro dos pequenos e reaproveitável. Status de pedido Pending/Processing/Delivered/Paid/Rejected |
| [tastyigniter/TastyIgniter](https://github.com/tastyigniter/TastyIgniter) | Plataforma de pedidos online para restaurantes (Laravel), madura | **MIT** (LICENSE.md) | Referência de modelagem (cardápio, opções, locais). Stack PHP |
| [jakubczarnowski/FeastQR](https://github.com/jakubczarnowski/FeastQR) | SaaS de cardápio online com QR e PDF imprimível (Next.js, Supabase, tRPC, LemonSqueezy) | Não achei arquivo LICENSE [verificar] | Ideia: **templates de cardápio/QR imprimíveis em PDF** |
| [proffalken/ByteOrder](https://github.com/proffalken/ByteOrder) | Quiosque de autoatendimento com impressão em impressora térmica | **AGPL-3.0** | Ideia de impressão térmica na cozinha |
| [jrmasiero/arcoreweb](https://github.com/jrmasiero/arcoreweb) | Template de codelab do model-viewer para AR na web | ver repo | Ponto de partida mínimo de AR |
| [google/model-viewer](https://github.com/google/model-viewer) | O componente em si | Apache-2.0 | Fonte da documentação usada na seção 2 |

Não achei nenhum repositório open source maduro de "cardápio AR com model-viewer". O DishAR e o restofy são os mais próximos, mas ambos são recentes (2026) e sem licença. Busca: [WebSearch: AR food menu model-viewer](https://github.com/foodiesarmenu/foodies-app). O `foodiesarmenu/foodies-app` usa NeRF/iNGP, uma abordagem diferente e pesada.

---

## 2. Pipeline 3D/AR

### 2.1 Como o AR funciona a partir de uma página web

Fonte principal: docs do model-viewer (`packages/modelviewer.dev/data/docs.json` no [repo google/model-viewer](https://github.com/google/model-viewer)). Versão atual no npm: **4.4.0, de 09/10/2026** (registry.npmjs.org).

| Plataforma | Modo | Formato | Como abre |
|---|---|---|---|
| Android + Chrome com ARCore | `webxr` | GLB | AR dentro do navegador, com a nossa UI sobreposta (DOM overlay). Só nos navegadores Chromium ([tabela do modelviewer.dev](https://modelviewer.dev/)) |
| Android (ARCore ou não) | `scene-viewer` | GLB **por URL** | Abre o app Scene Viewer do Google. Sem ARCore, cai para visualização 3D |
| iPhone/iPad (iOS 12+) | `quick-look` | USDZ | AR Quick Look nativo. **Sem `ios-src`, o model-viewer gera o USDZ na hora** a partir do GLB |

Citações das docs:
- `ar-modes`, padrão `"webxr scene-viewer quick-look"`: "Including quick-look here without an ios-src (our default) will generate a USDZ on the fly rather than downloading a separate ios-src file."
- `ios-src`: "USDZ generation is not perfect, for instance animations are not yet supported, so in some cases supplying ios-src may give better results."
- `ar-scale`: `"fixed"` desativa a escala por pinça (100% do tamanho). O padrão é `auto`. **Para comida, use `fixed`**: o objetivo é mostrar o tamanho real da porção.
- `ar-placement`: `floor` (padrão, superfície horizontal, que serve para a mesa) ou `wall`.
- `ar-usdz-max-texture-size`: limita a textura do USDZ gerado automaticamente. É útil para o iPhone não engasgar.
- `xr-environment`: estimativa de luz no WebXR. Tem custo de desempenho e problemas conhecidos ("sometimes too dark").
- `canActivateAR` (propriedade), `activateAR()` (precisa ser chamado dentro de um gesto do usuário) e o evento `ar-status` (`not-presenting`, `session-started`, `object-placed`, `failed`). O evento só existe no WebXR, exceto `failed`.

Observações práticas:
- **HTTPS é obrigatório** (WebXR e câmera exigem contexto seguro). O Scene Viewer recebe a **URL do GLB** e baixa o arquivo, então o arquivo tem de ser acessível pelo celular. Use URL absoluta e CDN/estático com `Content-Type: model/gltf-binary` [inferência a partir do funcionamento do Scene Viewer].
- Navegadores embutidos (Instagram, Facebook e às vezes WhatsApp) costumam bloquear Quick Look/Scene Viewer [inferência, testar]. O QR lido pela câmera nativa abre o navegador padrão, o que resolve o caso principal.
- Problemas conhecidos com o USDZ automático surgiram em versões específicas do iOS (ex.: issue "AutoUSDZ broken in iOS 17.5 beta", corrigida depois) ([resumo](https://lightrun.com/answers/google-model-viewer-empty-usdz-when-entering-ar-before-load), [issues](https://github.com/google/model-viewer/issues)). Mantenha um caminho de fallback com `ios-src` por prato.

### 2.2 GLB x USDZ

- **GLB (glTF 2.0 binário)** é o formato-mestre. Web 3D, WebXR e Scene Viewer usam GLB.
- **USDZ** só serve para o Quick Look do iOS. Opções:
  1. **Automático** pelo model-viewer (zero trabalho; recomendado começar assim).
  2. **Pré-gerado** e servido em `ios-src`, para pratos que derem problema. Ferramentas: Reality Converter (Mac), Blender (export USD e empacotar), ou export direto do Meshy/Tripo/KIRI/Polycam, que exportam USDZ. Fotogrametria via Object Capture já gera USDZ nativo.

### 2.3 Orçamento por modelo (comida)

Não consegui ler as diretrizes oficiais do Scene Viewer (DNS bloqueado nesta sessão). Os números abaixo vêm de fornecedores que as citam [verificar]:
- Triângulos: **≤100k** recomendado, **30 a 50k** ideal ([maverickframe](https://maverickframe.com/blog/augmented-reality-furniture/)).
- Texturas: **máx. 2048×2048**, sRGB, JPG/PNG (mesma fonte).
- Arquivo: 10 MB recomendado e 15 MB máximo para Scene Viewer, segundo uma fonte. Outras citam ~5 MB ([wanna](https://wanna.helpjuice.com/3d-viewer-model-requirements), [mywebar](https://learn.mywebar.com/glb_assets_best_practices)).
- O README do `sinu786/Interactive_menu` recomenda GLB <5 MB, <50k tris e textura de 1024 sempre que possível.

**Nossa meta** [inferência, pensando em 4G de restaurante e celulares intermediários]: **1 a 3 MB por prato**, 20 a 50k triângulos, 1 material PBR, baseColor + normal (+ roughness) em **1024 px** (2048 só em prato-vitrine), sem transparência (alpha pesa e falha no Quick Look), **unidades em metros** (prato de ~0,27 m de diâmetro), origem no centro da base e "Y para cima".

### 2.4 Compressão com glTF-Transform

CLI `@gltf-transform/cli` (npm latest 4.5.1, MIT, [repo](https://github.com/donmccurdy/glTF-Transform)). Flags confirmadas no código-fonte (`packages/cli/src/cli.ts`):

```bash
npm i -g @gltf-transform/cli

# Tudo de uma vez (padrões: --compress meshopt, --simplify true, --texture-size 2048)
gltf-transform optimize prato.glb prato.opt.glb \
  --compress meshopt --texture-compress webp --texture-size 1024

# Alternativa mais conservadora para compatibilidade com Scene Viewer / Quick Look
gltf-transform optimize prato.glb prato.opt.glb \
  --compress draco --texture-compress webp --texture-size 1024
# ou sem compressão de geometria:  --compress false

# Controlar a simplificação (fração de vértices mantidos)
gltf-transform optimize in.glb out.glb --simplify-ratio 0.5 --simplify-error 0.001

# Inspecionar tamanho, triângulos e texturas
gltf-transform inspect prato.opt.glb
```

- `--compress`: `draco | meshopt | quantize | false`. Draco comprime só a geometria. Meshopt também cobre animação e morph.
- `--texture-compress`: `ktx2 | webp | avif | auto | false`. KTX2 economiza VRAM. WebP/AVIF economizam download.
- O model-viewer carrega Draco e KTX2/Basis (docs de loading). **O suporte a meshopt/WebP/KTX2 dentro do app Scene Viewer não foi confirmado** ([busca sem resultado oficial](https://modelviewer.dev/examples/loading/)). **Teste cada combinação em um Android real** antes de padronizar [verificar]. Para o USDZ automático, o model-viewer já decodificou a cena no navegador, então a compressão do GLB não deveria afetar o iOS [inferência]. Mesmo assim, teste.
- Escala: a CLI não normaliza tamanho de forma simples. Faça isso no Blender, ou com um script Node usando `@gltf-transform/core` que lê o bounding box e aplica uma escala para o diâmetro alvo [inferência]. Isso é importante porque modelos gerados por IA saem em escala arbitrária.

### 2.5 Como produzir os modelos 3D de comida

#### A) Fotogrametria (pratos reais, máxima fidelidade)

| Ferramenta | Plataforma | Custo | Notas |
|---|---|---|---|
| **RealityScan** (Epic) | iOS/Android, e desktop (RealityScan 2.0, ex-RealityCapture) | Grátis no mobile ([skyebrowse](https://www.skyebrowse.com/news/posts/best-photogrammetry-app)). Desktop grátis abaixo de US$ 1 mi de receita [verificar] | Processa em nuvem. Exporta para o Sketchfab/FBX/OBJ/GLB |
| **KIRI Engine** | iOS/Android/Web | Freemium. Pro com preço não confirmado (~US$ 60/ano?) [verificar] | Exporta GLB/USDZ. Tem modos para objetos sem textura e 3D Gaussian Splatting (splat não serve para AR) |
| **Polycam** | iOS/Android/Web | Em 2026: Free, Basic US$ 30/mês ou US$ 150/ano, Business US$ 400/ano [verificar: fontes conflitam] ([skyebrowse](https://www.skyebrowse.com/news/posts/best-photogrammetry-app), [costbench](https://costbench.com/software/ai-3d-generation/polycam-ai/)) | UX ótima, exporta GLB/USDZ |
| **Apple Object Capture** | macOS (app Reality Composer/API) e iOS 17+ em iPhone com LiDAR | Grátis | Gera USDZ direto, com qualidade muito boa em objetos de mesa [conhecimento prévio, verificar requisitos de hardware] |
| Luma (captura) | iOS/Web | Hoje foca em vídeo e Genie | Captura NeRF/splat, não é ideal para GLB leve [inferência] |

Dicas específicas para comida ([pix-pro: food photogrammetry](https://www.pix-pro.com/blog/food-photogrammetry), [fórum Revopoint](https://forum.revopoint3d.com/t/best-approach-to-food-scanning-tips-for-feature-turntable-scans/21885/2), [RealityScan / CreativeCrops](https://www.realityscan.com/spotlights/behind-ultra-realistic-3d-food-assets-with-creative-crops)):
- Use **luz difusa** sem sombras duras e **prato giratório** (turntable) com fundo neutro, com 2 ou 3 alturas de câmera e 40 a 80 fotos.
- Molho e brilho atrapalham. Use polarizador cruzado ou fotografe antes de finalizar com o brilho. Em props, um spray fosco funciona (amido + álcool, **não em comida que será servida**).
- Superfícies lisas e uniformes (purê, sopa) reconstroem mal. Prefira ângulos com guarnição e textura.
- O prato e o recipiente costumam sair melhor do que a comida. Pode-se reaproveitar um prato 3D "limpo" e escanear só a comida [inferência].
- Comida muda em minutos (derrete, murcha). Capture rápido, ou use uma versão "cenográfica".
- Tempo realista: 15 a 20 min de captura + processamento em nuvem + 30 a 60 min de limpeza no Blender (cortar a mesa, fechar o fundo, decimar, rebake) [inferência].

#### B) IA imagem → 3D (rápido e barato, menos fiel)

| Serviço | Preço (fontes secundárias, out/2026) | Custo por modelo [cálculo] | Licença de saída / observações |
|---|---|---|---|
| **Meshy** (Meshy 6) | Pro ~US$ 20/mês com 1.000 créditos (fontes variam de US$ 10 a 20). Image-to-3D = **20 créditos** (Meshy 5 = 10); texturização avulsa 10 ([busca: docs.meshy.ai](https://docs.meshy.ai/en/webapp/pricing), [sloyd](https://sloyd.ai/blog/3d-ai-price-comparison)). Free: 100 créditos/mês | ~US$ 0,40/geração, **≈ R$ 2,20** | No plano grátis, ativos ficam públicos/CC-BY [conhecimento prévio, verificar]. Tem multi-image-to-3D, remesh e export GLB/USDZ |
| **Tripo** (v3.x) | Pro ~US$ 19,90/mês (anual ~US$ 11,94) com 3.000 créditos. Free 300/mês. Geração padrão ~20+ créditos, modo P1 60 a 160 ([3daistudio](https://www.3daistudio.com/Platform/API/Tripo), [costbench](https://www.costbench.com/software/ai-3d-generation/tripo-ai/)). Via fal: US$ 0,20 a 0,40 ([wireflow](https://www.wireflow.ai/docs/nodes/3d--tripo_h31)) | ~US$ 0,13 a 0,40, **≈ R$ 0,70 a 2,20** | API e Studio são cobrados separadamente |
| **Rodin / Hyper3D** (Gen-2/2.5) | Creator ~US$ 24 a 30/mês (~60 modelos), Business US$ 120 (~416); API pay-as-you-go ~US$ 0,80/req ([picassoia](https://blog.picassoia.com/rodin-gen-2-5-hyper3d-image-to-3d-pricing-and-quality), [empiriolabs](https://empiriolabs.ai/models/hyper3d-gen2), [costbench](https://costbench.com/software/ai-3d-generation/rodin-hyper3d/)) | ~US$ 0,30 a 0,80, **≈ R$ 1,70 a 4,40** | Costuma ter a melhor geometria e PBR entre os comerciais [inferência baseada na reputação; testar com comida] |
| **Luma Genie** | Planos Luma: Plus US$ 30, Pro US$ 90, Ultra US$ 300/mês. Free com limite diário e marca d'água ([costbench](https://costbench.com/software/ai-3d-generation/luma-ai-3d/), [layer3labs](https://www.layer3labs.io/guides/is-luma-ai-worth-it)) | indefinido | Foco em texto→3D. Não é a melhor opção para reproduzir um prato real [inferência] |
| **Higgsfield** | Planos de US$ 15 a 47/mês com créditos por modelo. **Custo do 3D não publicado** ([creatify](https://creatify.ai/blog/higgsfield-pricing-(2026)-plans-and-what-you-ll-actually-pay)) | indefinido | Tem `generate_3d` (imagem → GLB). A conta da agência já tem integração/MCP Higgsfield disponível nesta sessão, o que vale um teste com 1 prato |
| **Open source, rodando local/GPU alugada** | | | |
| TRELLIS.2 (Microsoft, dez/2025) | grátis | custo de GPU (~centavos por modelo [inferência]) | **MIT** (LICENSE confirmado). PBR completo, texturas até 4096 ([trellis2 blog](https://trellis2.app/blog/best-image-to-3d-models-huggingface), [comfy](https://blog.comfy.org/p/trellis2-and-pixal3d-are-now-native)) |
| Hunyuan3D 2.1 (Tencent) | grátis | GPU | Licença comunitária própria. **Não vale na UE, no Reino Unido e na Coreia do Sul**. O Brasil está no "Territory" (LICENSE confirmado). A linha 3.x é só hospedada |
| Stable Fast 3D (Stability) | grátis | GPU (<1 s/modelo) | Stability Community License: uso comercial livre **abaixo de US$ 1 mi/ano de receita**, com registro (LICENSE confirmado). Qualidade inferior |
| TripoSR | grátis | GPU | **MIT** (LICENSE confirmado). Antigo e de baixa qualidade, só para protótipo |

**Qualidade para comida** [inferência, sem benchmark público específico encontrado]:
- A IA acerta bem o **volume geral** (hambúrguer, pizza, sobremesa em taça, espetinho) e a **textura frontal**. Erra o **lado escondido** (que ela inventa), detalhes finos (gergelim, ervas), líquidos e brilhos.
- Use **multi-imagem** (frente, 45° e topo) do **prato real** para reduzir a alucinação. Fotos de estúdio com fundo limpo ajudam muito.
- Risco comercial: o 3D precisa representar a **porção real**, para não virar propaganda enganosa (CDC). Use fotos do prato real e confira o tamanho [inferência].

#### C) Fluxo recomendado (por prato)

1. **Fotos**: o restaurante (ou nós) fotografa o prato real em fundo neutro, com 3 a 4 ângulos (frente, 45°, topo, lateral), boa luz e celular comum.
2. **Gerar**: Meshy ou Tripo (multi-image-to-3D), com 2 ou 3 tentativas. Escolha a melhor. Para pratos-vitrine, use Rodin, ou fotogrametria com RealityScan/KIRI/Object Capture.
3. **Limpar no Blender** (15 a 30 min): remover a base/mesa, fechar o fundo, **escalar para metros reais** (medir o prato com régua), centralizar a origem na base e checar as normais.
4. **Otimizar**: `gltf-transform optimize ... --texture-size 1024 --texture-compress webp --compress meshopt` (ou draco) e `gltf-transform inspect`, com meta de ≤3 MB.
5. **Testar** em um Android intermediário (Chrome: WebXR e Scene Viewer) e em um iPhone (Safari: Quick Look automático). Se o iPhone falhar, exporte o USDZ e use `ios-src`.
6. **Publicar**: subir no storage do tenant, gerar um `poster` (PNG/WebP do prato 3D) para carregar rápido e marcar `has3d` no item.

**Custo estimado por prato (R$)** [inferência a partir dos preços acima, câmbio de 5,50]:

| Rota | API/serviço | Mão de obra (R$ 80/h interna) | Total por prato |
|---|---|---|---|
| IA (Meshy/Tripo), 3 tentativas + limpeza | R$ 2 a 7 | 0,3 a 0,6 h ≈ R$ 25 a 50 | **≈ R$ 30 a 60** |
| IA premium (Rodin) + limpeza caprichada | R$ 5 a 15 | 0,5 a 1 h ≈ R$ 40 a 80 | **≈ R$ 50 a 100** |
| Fotogrametria (app grátis/freemium) | R$ 0 a 5 (rateio de assinatura) | 1 a 2 h ≈ R$ 80 a 160 | **≈ R$ 85 a 170** |
| Terceirizar para um artista 3D | n/a | n/a | R$ 150 a 600 [inferência, sem fonte] |

Sugestão comercial [inferência]: incluir de 3 a 5 pratos 3D no plano "Pro" e cobrar R$ 80 a 150 por prato extra (IA) ou R$ 200 a 300 (fotogrametria).

### 2.6 Snippet de integração (JS puro, nosso padrão)

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/dist/model-viewer.min.js"></script>

<model-viewer id="mv" src="/t/slug/models/picanha.glb" poster="/t/slug/models/picanha.webp"
  alt="Picanha na chapa" ar ar-modes="webxr scene-viewer quick-look"
  ar-scale="fixed" ar-placement="floor" camera-controls touch-action="pan-y"
  shadow-intensity="1" loading="lazy" reveal="interaction"
  ar-usdz-max-texture-size="1024">
  <button slot="ar-button" class="btn-ar">Ver na minha mesa</button>
</model-viewer>
<script>
  const mv = document.getElementById('mv');
  mv.addEventListener('load', () => { if (!mv.canActivateAR) document.querySelector('.btn-ar').hidden = true; });
  mv.addEventListener('ar-status', e => {
    if (e.detail.status === 'failed') alert('AR indisponível neste aparelho. Veja em 3D.');
    // enviar métrica: fetch('/api/metrics', {method:'POST', body: JSON.stringify({ev:'ar', status:e.detail.status})})
  });
  mv.addEventListener('error', () => mv.replaceWith(Object.assign(new Image(), { src: mv.poster })));
</script>
```

- Use `loading="lazy"` + `reveal="interaction"` para não baixar o GLB de todos os pratos ao abrir o cardápio [inferência: abrir o 3D em modal sob demanda é o melhor].
- Fixe a versão no CDN. Melhor ainda: hospede o JS do model-viewer no próprio servidor.

---

## 3. NFC por mesa

### 3.1 Tags

| Chip | Memória de usuário | URL máx. (aprox.) | Uso |
|---|---|---|---|
| **NTAG213** | 144 bytes | ~130 caracteres | **Recomendado**. Sobra espaço para `https://cardapio.app/m/abc/7Hk2Qp` |
| NTAG215 | 504 bytes | ~480 | Desnecessário |
| NTAG216 | 888 bytes | ~850 | Desnecessário |

Fontes: [datasheet NXP NTAG213/215/216](https://nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf) e [wakdev NTAG213](https://www.wakdev.com/en/knowledge-base/nfc-chips/nxp-ntag213.html). O prefixo `https://` (ou `https://www.`) é comprimido para 1 byte no registro URI NDEF.

**Preço no Brasil** (Kabum, lote):
- NTAG213 adesiva: 10 un. por R$ 28,90 (**~R$ 2,89 cada**) e 100 un. por R$ 239,90 (**~R$ 2,40**) ([10 un.](https://www.kabum.com.br/produto/1018354/etiqueta-rfid-13-56-mhz-nfc-ntag213-10-unidades), [100 un.](https://www.kabum.com.br/produto/1018338/etiqueta-rfid-13-56-mhz-nfc-ntag213-100-unidades)).
- **Anti-metal** (para mesa de inox/alumínio): 10 un. por R$ 49,90 e 100 un. por R$ 399,90 (**~R$ 4 a 5**) ([10 un.](https://www.kabum.com.br/produto/1018357/etiqueta-rfid-13-56-mhz-nfc-ntag213-para-metal-10-unidades), [100 un.](https://www.kabum.com.br/produto/1018352/etiqueta-rfid-13-56-mhz-nfc-ntag213-para-metal-100-unidades)).
- Na Europa, rolos saem a €0,23 a 0,39/un. em volume ([rfid.it](https://rfid.it/en/iq-labels/5320-ntag213-nfc-sticker-29-mm-for-fast-and-secure-communication.html)). No AliExpress e no Mercado Livre o preço tende a ser menor que R$ 1/un. em lotes grandes [inferência, não verificado].
- Produto final sugerido [inferência]: **display de acrílico de mesa com QR impresso + tag NFC colada atrás** e o texto "Aproxime o celular ou leia o QR". Custo de material de R$ 15 a 35 por mesa, dependendo do acrílico.
- Metal sob a tag "mata" a leitura. Mesa metálica exige tag anti-metal ou o display de acrílico.

### 3.2 Gravar tags pelo admin web (Web NFC)

- Funciona **só no Chrome para Android**, em contexto seguro (HTTPS), aba em primeiro plano, **disparado por gesto do usuário** e com permissão de NFC concedida ([Chrome Developers: NFC](https://developer.chrome.com/docs/capabilities/nfc)). Não funciona no iOS nem no desktop. Suporta apenas NDEF.
- `makeReadOnly()` exige Chrome 100+ no Android. É irreversível (a mesma fonte recomenda detectar o recurso antes).

```js
// Página /admin/mesas: botão "Gravar tag da Mesa 7"
async function gravarTag(url) {
  if (!('NDEFReader' in window)) return alert('Use o Chrome no Android para gravar tags.');
  const ndef = new NDEFReader();
  await ndef.write({ records: [{ recordType: 'url', data: url }] }); // aproxime a tag
  if (confirm('Travar a tag (somente leitura, irreversível)?') && 'makeReadOnly' in ndef) {
    await ndef.makeReadOnly(); // aproxime de novo
  }
}
```

- Sem Android no cliente, use um app grátis (ex.: **NFC Tools**, da wakdev, iOS/Android) e cole a URL. Também dá para encomendar as tags já gravadas do fornecedor.
- **Travar ou não?** Travar evita que alguém regrave a tag com um link malicioso (risco real em local público). O custo é que trocar de URL exige uma tag nova. Por isso, grave uma **URL curta e estável** (`/m/<slug>/<tokenMesa>`) e resolva tudo no servidor. Assim a tag nunca precisa mudar, e dá para travar [inferência].

### 3.3 Leitura no iPhone

([Apple Tech Talk 702](https://developer.apple.com/videos/play/tech-talks/702))
- **Leitura em segundo plano** a partir do iPhone XS/XR, com tela acesa e o aparelho desbloqueado ao menos uma vez após o boot. Lê o **primeiro registro de URL** do NDEF e mostra uma **notificação**. O usuário toca nela e o **Safari** abre (sem app nosso). Se a tela estiver bloqueada, ele precisa desbloquear.
- Não lê enquanto a câmera, a Wallet/Apple Pay ou uma sessão NFC de outro app estão ativas, nem em modo avião.
- iPhone 7 a X só leem com um app, via o atalho "Leitor NFC" da Central de Controle.
- Android: com NFC ligado e tela desbloqueada, abre a URL direto no navegador padrão. Muita gente deixa o NFC desligado [inferência]. Daí a necessidade do **QR sempre junto**.

### 3.4 Segurança da URL da mesa (para o nosso backend)

- O token da mesa deve ser opaco (ex.: 8 a 10 caracteres base62) e não o ID sequencial. Precisa ser rotacionável no admin (regenerar o QR imprime um novo, mas a tag travada continuaria apontando ao token antigo). Resolva com um **token fixo por mesa + "sessão de comanda"** aberta no servidor [inferência].
- Antipedido remoto: a comanda só aceita pedido quando estiver **aberta** (pelo garçom/caixa ou pelo primeiro pedido com aprovação). Opcionalmente, use um código de 4 dígitos exibido no display da mesa [inferência]. O `elitale/restro` resolve com OTP por SMS, que é caro.

---

## 4. "Pagar pela mesa" / NFC como maquininha

**Realidade:** uma tag NFC passiva **não processa cartão**. Para o cliente pagar por aproximação, alguém precisa de um **terminal**: maquininha, ou celular com Tap to Pay. Para o cliente pagar sozinho na mesa pelo celular dele, o caminho é **Pix** (ou checkout online com cartão).

Opções, em ordem de viabilidade:
1. **Pix com QR dinâmico no fechamento da comanda (MVP recomendado).** O caixa clica em "Fechar conta", o backend cria a cobrança via API do PSP (Asaas, Mercado Pago, Efí, PagBank, Stone...), e a tela do cliente/garçom mostra o QR + "copia e cola". Um **webhook** confirma o pagamento e a comanda fecha sozinha.
   - Asaas: cobrança Pix com QR dinâmico via API, a R$ 0,99 por cobrança nos 3 primeiros meses e depois R$ 1,99 (tabela padrão) ([docs Asaas](https://docs.asaas.com/docs/cobrancas-via-pix), [Asaas Pix](https://asaas.com/pix-asaas)). Outros PSPs cobram percentual (~0,99% é comum [verificar]).
   - Multi-tenant: **cada restaurante usa a própria conta/chave do PSP** (credenciais por tenant). Nós não intermediamos dinheiro, o que evita sermos subadquirente ou instituição de pagamento [inferência regulatória, consultar contador/jurídico].
   - Divisão de conta: gerar N cobranças Pix parciais contra a mesma comanda [inferência].
   - Exemplo de referência: [Mercado Pago: QR estático x dinâmico](https://www.mercadopago.com.br/blog/gerar-qr-code-pix-estatico-dinamico).
2. **Tap to Pay no celular do garçom/caixa** (o celular vira maquininha por NFC). Em geral exige Android 11+ com NFC, ou iPhone XS+. Provedores no Brasil:
   - InfinitePay (InfiniteTap): 2,29% débito e 5,49% crédito à vista no plano "na hora" (blog do próprio fornecedor) ([InfinitePay](https://www.infinitepay.io/blog/melhor-tap-to-pay)).
   - SumUp: débito ~0,8 a 2,49% e crédito ~2,1% (calculadora de afiliado) ([calculadora](https://www.calculadoradetaxas.com.br/sumup/tap-to-pay)).
   - PicPay Tap (2026) ([letsmoney](https://www.letsmoney.com.br/noticias/picpay-tap-pessoa-fisica-celular-maquininha/)), C6 Tap to Pay (abr/2026) ([ABC da Comunicação](https://www.abcdacomunicacao.com.br/c6-bank-lanca-funcionalidade-que-transforma-o-celular-em-maquininha-de-cartao/)), RecargaPay ([ABC](https://www.abcdacomunicacao.com.br/recargapay-transforma-celular-em-maquininha-com-lancamento-de-novo-servico/)). Ton (Stone), PagBank e Mercado Pago também oferecem Tap to Pay [conhecimento prévio, taxas não verificadas].
   - **Integração:** estes apps são fechados. No MVP, o garçom cobra no app do PSP e marca "pago (cartão)" na comanda. Integração profunda (deep link/SDK de pagamento para enviar o valor ao app) existe em alguns PSPs com SDK para parceiros (Stone, PagBank e Mercado Pago Point têm APIs para maquininhas [conhecimento prévio, verificar]). Fica para a fase 2.
3. **Checkout online com cartão** (link de pagamento do PSP) para quem não usa Pix. Funciona, mas tem taxa maior e mais atrito.

**Conclusão:** no MVP, **Pix dinâmico + webhook** no fechamento (opcionalmente na própria tela da mesa) e "marcar como pago" manual para cartão/dinheiro. "NFC da mesa" serve só para **abrir o cardápio/comanda**, nunca para pagar.

---

## 5. Próximos passos sugeridos

1. Componente `<model-viewer>` em modal sob demanda, com poster, métrica de `ar-status` e esconder o botão se `!canActivateAR`.
2. Gerar 3 pratos de teste (um "fácil": hambúrguer; um "difícil": prato com molho; um "espetinho"), pelo menos por 2 rotas (Meshy ou Tripo vs Rodin ou Higgsfield) a partir das mesmas fotos, e comparar em Android + iPhone.
3. Padronizar o script `scripts/otimizar-glb.sh` (gltf-transform), com escala-alvo e checagem de ≤3 MB.
4. Tela admin "Mesas", com QR em PNG/SVG para impressão e botão "Gravar NFC" (Web NFC).
5. Modelo `comanda.status` (aberta/fechando/paga) + integração Pix por tenant (começar com 1 PSP, ex.: Asaas ou Mercado Pago).
