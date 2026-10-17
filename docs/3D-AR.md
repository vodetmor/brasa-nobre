# Pratos em 3D e realidade aumentada

Resumo prático. A pesquisa completa (ferramentas, preços, fontes) está em [PESQUISA-3D-AR-GITHUB.md](PESQUISA-3D-AR-GITHUB.md).

## Como funciona no sistema

- Cada produto tem `model_glb_url` (obrigatório para 3D) e `model_usdz_url` (opcional).
- No cardápio, o prato com modelo mostra o selo **3D**. Ao abrir, o cliente gira o prato com o dedo e toca em **Ver na minha mesa (AR)**:
  - Android: abre o Scene Viewer / WebXR (ARCore).
  - iPhone: abre o AR Quick Look. Se não houver USDZ, o `<model-viewer>` gera um na hora a partir do GLB.
- Configuração usada: `ar ar-modes="webxr scene-viewer quick-look" ar-placement="floor" ar-scale="fixed"` (tamanho real, sem o cliente aumentar o prato).
- O `<model-viewer>` fica em `public/assets/vendor/` (sem depender de CDN). A demo usa `public/models/avocado.glb` (Khronos, CC0), que tem 8 MB: acima do orçamento abaixo, serve só para teste.

## Orçamento por prato

- GLB de até **3 MB** (máximo 5 MB), 20 a 50 mil triângulos, texturas de 1024 px, **escala real em metros**, base do prato na origem.
- Otimizar com glTF-Transform:

```bash
npx @gltf-transform/cli optimize entrada.glb saida.glb --compress meshopt --texture-compress webp --texture-size 1024
```

Testar o resultado num Android real; se o AR falhar, trocar `meshopt` por `draco`.

## Produzir o modelo

1. **IA a partir de fotos** (padrão, mais barato): 3 ou 4 fotos do prato real, boa luz, fundo neutro → Meshy, Tripo ou Rodin (ou open source: TRELLIS, Hunyuan3D, Stable Fast 3D) → limpeza rápida no Blender → glTF-Transform. Estimativa: R$ 30 a 60 por prato com o trabalho.
2. **Fotogrametria** (pratos-vitrine): 60 a 150 fotos em volta do prato (RealityScan, KIRI Engine, Polycam ou Object Capture no iPhone/Mac). Mais fiel, 1 a 2 h por prato.
3. Subir o `.glb` em **Cardápio e mesas → produto → Modelo 3D**.

Comida brilhante, transparente ou com fumaça é difícil para as duas técnicas; escolha pratos com forma clara (hambúrguer, espetinho, sobremesa, pizza).

## Proposta comercial sugerida

Vender o 3D como adicional por prato (só 3 a 5 pratos de destaque por cliente), depois de o cardápio com fotos estar rodando. Para espetinho/bar o retorno é menor; para hamburgueria, sobremesas e restaurantes "instagramáveis" é maior (inferência).
