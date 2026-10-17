// Cobrança na maquininha. O caixa toca em "Cobrar", o valor vai para a máquina e a conta fecha sozinha quando aprova.
// Hoje só existe o provedor "simulado" (demonstração). Para ligar uma maquininha de verdade, crie aqui um provedor
// com a mesma função charge() usando a API da operadora, e escolha com PAYMENT_PROVIDER no .env:
// - mercadopago: Mercado Pago Point (ordem de pagamento enviada ao terminal)
// - stone: Stone Connect / Pagar.me POS
// - pagbank: PagBank (Smart POS)
// - cielo: Cielo LIO / Cielo Smart
// Cada restaurante precisa da própria conta e chave na operadora (ficam no .env dele, nunca no código).
import { HttpError } from './http.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const providers = {
  // Aprova depois de um instante, como se o cliente tivesse passado o cartão.
  async simulado({ amount_cents }) {
    await sleep(600);
    return { approved: true, ref: `SIM-${Date.now().toString(36).toUpperCase()}`, amount_cents };
  },
};

export const paymentProvider = process.env.PAYMENT_PROVIDER || 'simulado';

export async function charge({ amount_cents, method }) {
  const p = providers[paymentProvider];
  if (!p) throw new HttpError(501, `Maquininha "${paymentProvider}" ainda não foi integrada`);
  const r = await p({ amount_cents, method });
  if (!r.approved) throw new HttpError(402, r.message || 'Pagamento recusado na maquininha');
  return { ...r, provider: paymentProvider };
}
