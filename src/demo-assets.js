// Lista separada para o script de build não precisar abrir o banco.
// Fotos e modelos 3D gerados por IA (Higgsfield). O npm run assets baixa para public/demo/ai/
// (a Vercel roda o mesmo script no build). Num cliente real, entram as fotos dele.
const CDN = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Hosr8YCDHqiELRUDqWQ82d3P3g/';
export const REMOTE = {
  'carne.webp': 'hf_20261016_194932_661d936e-fd63-47b4-9066-61046d6d4c3d_min.webp',
  'linguica.webp': 'hf_20261016_194932_136ff324-038e-4110-ad14-64aea134fed2_min.webp',
  'queijo.webp': 'hf_20261016_194931_19aa7b0d-110b-4588-8918-b60d12eeedec_min.webp',
  'coracao.webp': 'hf_20261016_194949_c7ac3278-e4ba-4bc3-a6ad-2e5bf2d9b543_min.webp',
  'jantinha.webp': 'hf_20261016_195012_e1f7d68d-b01c-40ae-b1cb-e478f39257d3_min.webp',
  'jantinha2.webp': 'hf_20261016_195028_a0bd2b62-35f5-4388-a1f6-d2c59660deed_min.webp',
  'pf.webp': 'hf_20261016_194931_5bb86d47-a379-4c52-88ba-44096baa06fc_min.webp',
  'mandioca.webp': 'hf_20261016_195027_857db8f1-caa1-4e85-9c1d-486664929930_min.webp',
  'tropeiro.webp': 'hf_20261016_195038_47ea22fc-d508-4038-925a-839b9ae41c6a_min.webp',
  'vinagrete.webp': 'hf_20261016_195036_297f15cd-23d3-4e11-a35d-f3d0c02c069d_min.webp',
  'refri.webp': 'hf_20261016_195044_8425b50e-ea54-4e6a-b88c-d49a11c9c5ec_min.webp',
  'cerveja.webp': 'hf_20261016_195051_4fd64186-d5af-4130-a2db-5eeb056a6ea0_min.webp',
  'linguica.glb': 'hf_20261017_020655_a27dbb93-6d19-4936-9452-b307d63c8f7f.glb',
  'jantinha.glb': 'hf_20261017_020647_e03920be-91bd-4b00-9723-65d60bc72249.glb',
  'pf.glb': 'hf_20261017_020650_ea4d7b0f-ccdb-43ce-b385-add3b5346d93.glb',
  'mandioca.glb': 'hf_20261017_020653_c161a11a-137c-46ad-a429-50484831c5ad.glb',
};
export const remoteUrls = file => [REMOTE[file]].flat().map(f => CDN + f);
