// Função da Vercel: todas as rotas de API (e o "/") passam pelo mesmo handler do servidor local.
export { handle as default } from '../src/server.js';
