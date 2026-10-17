// Login da equipe por PIN do restaurante. O cookie guarda "slug.expira.assinatura" (HMAC).
// Em produção: trocar por login de usuário (Supabase Auth ou similar) com papéis cozinha/caixa/admin.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { HttpError, parseCookies } from './http.js';

const COOKIE = 'cs_staff';
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias: tablet da cozinha fica logado

const sign = s => createHmac('sha256', config.sessionSecret).update(s).digest('base64url');

export function issueStaffCookie(res, slug) {
  const exp = Date.now() + TTL_MS;
  const value = `${slug}.${exp}.${sign(`${slug}.${exp}`)}`;
  res.setHeader('Set-Cookie', `${COOKIE}_${slug}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}`);
}

export function clearStaffCookie(res, slug) {
  res.setHeader('Set-Cookie', `${COOKIE}_${slug}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function isStaff(req, slug) {
  if (!config.requirePin) return true;
  const raw = parseCookies(req)[`${COOKIE}_${slug}`];
  if (!raw) return false;
  const [s, exp, sig] = raw.split('.');
  if (s !== slug || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(`${s}.${exp}`));
  const got = Buffer.from(sig || '');
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function requireStaff(req, slug) {
  if (!isStaff(req, slug)) throw new HttpError(401, 'Faça login com o PIN da equipe');
}

export function requirePlatform(req) {
  const key = req.headers['x-platform-key'] || '';
  if (key !== config.platformKey) throw new HttpError(401, 'Chave da plataforma inválida');
}
