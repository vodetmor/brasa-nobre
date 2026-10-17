// Restaurantes de demonstração (fictícios). Uso: npm run seed  (--reset recria à força)
// Os dados ficam em src/demo.js. Quando SEED_VERSION muda, os demos são recriados sozinhos.
import { seedDemos } from '../src/demo.js';

const done = await seedDemos({ force: process.argv.includes('--reset'), log: console.log });
if (!done) console.log('= demos já estão na versão atual');
