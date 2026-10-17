// Restaurantes de demonstração (fictícios) e o seed que os cria.
// Usado pelo npm run seed (PC) e sozinho no primeiro acesso da Vercel (ensureDemo).
// Quando SEED_VERSION muda, os demos são recriados.
import { run, get, tx, engine } from './db.js';
import * as S from './services.js';

export const SEED_VERSION = '6';

const ai = f => `/demo/ai/${f}`;
const bn = f => `/demo/brasa-nobre/${f}`;
const bd = f => `/demo/bistro-demo/${f}`;
// Fotos reais do Pexels (créditos em public/demo/CREDITOS-PEXELS.json) e IA onde a foto do banco não servia.
const FOTO = {
  capa: bn('capa.jpg'), carne: ai('carne.webp'), frango: bn('frango.jpg'), linguica: ai('linguica.webp'),
  queijo: ai('queijo.webp'), coracao: ai('coracao.webp'), misto: bn('misto.jpg'), jantinha: ai('jantinha.webp'),
  jantinha2: ai('jantinha2.webp'), pf: ai('pf.webp'), mandioca: ai('mandioca.webp'), tropeiro: ai('tropeiro.webp'),
  vinagrete: ai('vinagrete.webp'), refri: ai('refri.webp'), agua: bn('agua.jpg'), suco: bn('suco.jpg'),
  cerveja: ai('cerveja.webp'),
};
const MODELO = {
  carne: bn('carne.glb'), frango: bn('frango.glb'), linguica: ai('linguica.glb'), queijo: bn('queijo.glb'),
  coracao: bn('coracao.glb'), misto: bn('misto.glb'), jantinha: ai('jantinha.glb'), jantinha2: '',
  pf: ai('pf.glb'), mandioca: ai('mandioca.glb'), tropeiro: bn('tropeiro.glb'), vinagrete: bn('vinagrete.glb'),
};

// Item: [nome, descrição, preço em centavos, { image_url, ingredients, badge, model_glb_url }]
export const DEMOS = [
  {
    slug: 'brasa-nobre', name: 'Brasa Nobre', staff_pin: '1234', tables: 12, theme: 'premium',
    tagline: 'Espetaria e cozinha de brasa. Restaurante fictício para demonstração.',
    address: 'Quadra 10, Sobradinho - DF (endereço fictício)', whatsapp: '61900000000', cover_url: FOTO.capa,
    instagram: '@brasanobre.demo', tiktok: '@brasanobre.demo',
    primary_color: '#d9a441', accent_color: '#d9a441', bg_color: '#121110', text_color: '#ffffff',
    menu: {
      'Espetinhos': [
        ['Espetinho de carne', 'Alcatra em cubos, sal grosso e brasa de carvão.', 1200, { image_url: FOTO.carne, model_glb_url: MODELO.carne, badge: 'Mais pedido', ingredients: 'Alcatra, Sal grosso, Farofa' }],
        ['Espetinho de frango', 'Peito de frango marinado no alho e limão.', 1000, { image_url: FOTO.frango, model_glb_url: MODELO.frango, ingredients: 'Frango, Alho, Limão, Farofa' }],
        ['Espetinho de linguiça', 'Linguiça toscana artesanal.', 1000, { image_url: FOTO.linguica, model_glb_url: MODELO.linguica, ingredients: 'Linguiça toscana, Farofa' }],
        ['Queijo coalho', 'Tostado na brasa, com melaço de cana.', 1000, { image_url: FOTO.queijo, model_glb_url: MODELO.queijo, ingredients: 'Queijo coalho, Melaço, Orégano' }],
        ['Coração de frango', 'Temperado com alho e cheiro-verde.', 1100, { image_url: FOTO.coracao, model_glb_url: MODELO.coracao, ingredients: 'Coração de frango, Alho, Cheiro-verde' }],
        ['Espetinho misto', 'Carne, frango e linguiça no mesmo espeto.', 1300, { image_url: FOTO.misto, model_glb_url: MODELO.misto, ingredients: 'Alcatra, Frango, Linguiça, Pimentão, Cebola' }],
      ],
      'Pratos': [
        ['Jantinha da casa', 'Arroz, tropeiro, vinagrete, mandioca e um espetinho à escolha.', 2600, { image_url: FOTO.jantinha, model_glb_url: MODELO.jantinha, badge: 'Completa', ingredients: 'Arroz, Feijão tropeiro, Vinagrete, Mandioca, Espetinho' }],
        ['Jantinha dupla', 'Acompanhamentos completos com dois espetinhos.', 3400, { image_url: FOTO.jantinha2, model_glb_url: MODELO.jantinha2, ingredients: 'Arroz, Feijão tropeiro, Vinagrete, Mandioca, 2 espetinhos' }],
        ['Prato executivo', 'Arroz, feijão, salada, farofa e bife acebolado.', 2800, { image_url: FOTO.pf, model_glb_url: MODELO.pf, ingredients: 'Arroz, Feijão, Alface, Tomate, Farofa, Bife, Cebola' }],
      ],
      'Porções': [
        ['Mandioca na manteiga', 'Mandioca cozida com manteiga de garrafa.', 1600, { image_url: FOTO.mandioca, model_glb_url: MODELO.mandioca, ingredients: 'Mandioca, Manteiga de garrafa, Sal' }],
        ['Feijão tropeiro', 'Com bacon, ovo, couve e cebolinha.', 1800, { image_url: FOTO.tropeiro, model_glb_url: MODELO.tropeiro, ingredients: 'Feijão, Farinha, Bacon, Ovo, Couve, Cebolinha' }],
        ['Vinagrete', 'Tomate, cebola, pimentão e salsinha.', 800, { image_url: FOTO.vinagrete, model_glb_url: MODELO.vinagrete, ingredients: 'Tomate, Cebola, Pimentão, Salsinha, Vinagre' }],
        ['Guacamole com chips', 'Abacate, limão e coentro. Toque na foto para ver em 3D.', 2400, { model_glb_url: '/models/avocado.glb', badge: 'Veja em 3D', ingredients: 'Abacate, Limão, Coentro, Cebola roxa, Chips de milho' }],
      ],
      'Bebidas': [
        ['Refrigerante lata', '350 ml.', 700, { image_url: FOTO.refri }],
        ['Água mineral', '500 ml, com ou sem gás.', 500, { image_url: FOTO.agua }],
        ['Suco de maracujá', 'Natural, 400 ml.', 1000, { image_url: FOTO.suco, ingredients: 'Maracujá, Açúcar, Gelo' }],
        ['Cerveja long neck', 'Pergunte as marcas do dia.', 1100, { image_url: FOTO.cerveja }],
      ],
    },
  },
  {
    slug: 'bistro-jardim', name: 'Bistrô Jardim', staff_pin: '4321', tables: 6, theme: 'claro',
    tagline: 'Cozinha caseira com tema claro. Restaurante fictício para demonstração.',
    address: 'Rua das Flores, 20 (endereço fictício)', whatsapp: '61900000001', cover_url: bd('capa.jpg'),
    instagram: '@bistrojardim.demo',
    primary_color: '#8a3b12', accent_color: '#8a3b12', bg_color: '#f3ede3', text_color: '#1b1714', service_fee_pct: 10,
    menu: {
      'Entradas': [
        ['Guacamole com nachos', 'Abacate, limão, coentro e tortilhas. Toque na foto para ver em 3D.', 3200, { model_glb_url: '/models/avocado.glb', badge: 'Veja em 3D', ingredients: 'Abacate, Limão, Coentro, Cebola roxa, Tortilhas' }],
        ['Mandioca na manteiga', 'Mandioca cozida com manteiga de garrafa.', 2200, { image_url: bd('mandioca.jpg'), model_glb_url: MODELO.mandioca, ingredients: 'Mandioca, Manteiga de garrafa' }],
      ],
      'Pratos': [
        ['Prato executivo', 'Arroz, feijão, salada, farofa e bife acebolado.', 4200, { image_url: FOTO.pf, model_glb_url: MODELO.pf, badge: 'Chef recomenda', ingredients: 'Arroz, Feijão, Alface, Tomate, Farofa, Bife, Cebola' }],
        ['Jantinha dupla', 'Dois espetinhos com acompanhamentos.', 4800, { image_url: bd('jantinha2.jpg'), ingredients: 'Arroz, Feijão tropeiro, Vinagrete, Mandioca, 2 espetinhos' }],
      ],
      'Bebidas': [
        ['Suco de maracujá', 'Natural, 400 ml.', 1400, { image_url: bd('suco.jpg'), ingredients: 'Maracujá, Açúcar, Gelo' }],
        ['Água mineral', '500 ml.', 700, { image_url: FOTO.agua }],
      ],
    },
  },
];

// Demos antigos que não existem mais.
const OLD = ['central-do-espeto', 'bistro-demo'];

export async function seedDemos({ force = false, log = () => {} } = {}) {
  return tx(async () => {
    if (engine === 'postgres') await run('SELECT pg_advisory_xact_lock(4243)');
    const current = (await get("SELECT value FROM meta WHERE key = 'seed_version'"))?.value;
    if (!force && current === SEED_VERSION) return false;
    for (const slug of [...OLD, ...DEMOS.map(d => d.slug)]) await run('DELETE FROM restaurants WHERE slug = ?', slug);
    for (const d of DEMOS) {
      const { menu, ...info } = d;
      const r = await S.createRestaurant(info);
      let pos = 0;
      for (const [cat, items] of Object.entries(menu)) {
        const c = await S.saveCategory(r.id, { name: cat, position: pos++ });
        for (const [i, [name, description, price_cents, extra = {}]] of items.entries())
          await S.saveProduct(r.id, { category_id: c.id, name, description, price_cents, position: i, ...extra });
      }
      const t = await get('SELECT token FROM tables WHERE restaurant_id = ? ORDER BY number LIMIT 1', r.id);
      log(`+ ${d.name}: mesa 1 em /m/${t.token}`);
    }
    await run("INSERT INTO meta (key, value) VALUES ('seed_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", SEED_VERSION);
    return true;
  });
}

// Vercel: cria os demos no primeiro acesso (banco novo do Neon vem vazio). Uma vez por instância.
let seeding;
export function ensureDemo() {
  seeding ||= seedDemos().catch(e => { seeding = null; throw e; });
  return seeding;
}
