// Impressão de ticket da cozinha. Três caminhos, escolhidos na tela da cozinha:
//  1. "navegador": imprime pela janela de impressão do sistema (impressora USB/rede instalada no Windows/Android).
//     Para imprimir SEM a janela de confirmação, abra o Chrome com --kiosk-printing (ver docs/IMPRESSAO.md).
//  2. "bluetooth": Web Bluetooth (Chrome no Android/PC) direto na impressora térmica BLE, em ESC/POS.
//  3. "rawbt": app Android RawBT (impressoras Bluetooth clássicas, que o navegador não acessa).
import { money, hhmm } from './common.js';

const noAccents = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Linhas de texto do ticket (largura em caracteres: 58 mm ≈ 32, 80 mm ≈ 48).
export function ticketLines(order, restaurant, cols = 32) {
  const line = '-'.repeat(cols);
  const out = [];
  out.push({ t: restaurant.name, center: true });
  out.push({ t: `MESA ${order.table_number}`, big: true, center: true });
  out.push({ t: `Pedido #${order.number}  ${hhmm(order.created_at)}`, center: true });
  out.push({ t: `Cliente: ${order.customer_name}`, bold: true });
  out.push({ t: line });
  for (const i of order.items) {
    out.push({ t: `${i.qty}x ${i.name}`, bold: true });
    for (const c of i.choices || []) out.push({ t: `   ${c.split(': ').pop()}`, bold: true });
    if (i.removed?.length) out.push({ t: `   SEM ${i.removed.join(', ')}`, bold: true });
    if (i.note) out.push({ t: `   OBS: ${i.note}` });
  }
  if (order.note) { out.push({ t: line }); out.push({ t: `OBS: ${order.note}`, bold: true }); }
  out.push({ t: line });
  out.push({ t: `Total: ${money(order.total_cents)}` });
  out.push({ t: `Origem: ${order.source === 'nfc' ? 'NFC' : order.source === 'garcom' ? 'Garcom' : 'QR Code'}` });
  return out;
}

// ---------- 1. navegador ----------
export function printViaBrowser(order, restaurant, paperMm = 58) {
  const lines = ticketLines(order, restaurant, paperMm >= 80 ? 48 : 32);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${paperMm}mm auto; margin: 0; }
    body { margin: 0; padding: 2mm 3mm; width: ${paperMm - 6}mm; font: ${paperMm >= 80 ? 13 : 11}px/1.35 "Courier New", monospace; color: #000; }
    p { margin: 0; white-space: pre-wrap; word-break: break-word; }
    hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
    .c { text-align: center; } .b { font-weight: 700; } .big { font-size: 22px; font-weight: 800; margin: 2px 0; }
  </style></head><body>${lines.map(l => /^-+$/.test(l.t) ? '<hr>' :
    `<p class="${l.center ? 'c' : ''} ${l.bold ? 'b' : ''} ${l.big ? 'big' : ''}">${escapeHtml(l.t)}</p>`).join('')}
  <p>&nbsp;</p></body></html>`;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(iframe);
  iframe.contentDocument.open(); iframe.contentDocument.write(html); iframe.contentDocument.close();
  setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => iframe.remove(), 2000); }, 150);
}
const escapeHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------- ESC/POS ----------
export function escposBytes(order, restaurant, cols = 32) {
  const enc = new TextEncoder();
  const bytes = [0x1b, 0x40]; // inicializa
  for (const l of ticketLines(order, restaurant, cols)) {
    bytes.push(0x1b, 0x61, l.center ? 1 : 0);           // alinhamento
    bytes.push(0x1b, 0x45, l.bold || l.big ? 1 : 0);     // negrito
    bytes.push(0x1d, 0x21, l.big ? 0x11 : 0x00);         // tamanho duplo
    bytes.push(...enc.encode(noAccents(l.t)), 0x0a);
  }
  bytes.push(0x1d, 0x21, 0x00, 0x1b, 0x45, 0, 0x1b, 0x64, 4); // avança 4 linhas
  bytes.push(0x1d, 0x56, 0x42, 0x00);                         // corte (ignorado por impressoras sem guilhotina)
  return new Uint8Array(bytes);
}

// ---------- 2. Web Bluetooth (impressoras BLE) ----------
// Serviços BLE mais comuns em impressoras térmicas genéricas.
const BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
];
let bleChar = null;
let bleDevice = null;

export const bluetoothSupported = () => !!navigator.bluetooth;
export const bluetoothConnected = () => !!(bleDevice?.gatt?.connected && bleChar);
export const bluetoothName = () => bleDevice?.name || '';

async function findWritable(server) {
  for (const uuid of BLE_SERVICES) {
    try {
      const svc = await server.getPrimaryService(uuid);
      for (const ch of await svc.getCharacteristics()) {
        if (ch.properties.write || ch.properties.writeWithoutResponse) return ch;
      }
    } catch { /* serviço não existe nesta impressora */ }
  }
  throw new Error('Impressora conectada, mas sem canal de escrita conhecido. Ela pode ser Bluetooth clássico: use o modo RawBT.');
}

async function connectDevice(device) {
  bleDevice = device;
  device.addEventListener('gattserverdisconnected', () => { bleChar = null; });
  const server = await device.gatt.connect();
  bleChar = await findWritable(server);
  localStorage.setItem('ble_printer_id', device.id);
  return device.name || 'Impressora';
}

// Precisa ser chamada a partir de um clique (exigência do navegador).
export async function bluetoothPair() {
  if (!navigator.bluetooth) throw new Error('Este navegador não tem Web Bluetooth. Use o Chrome no Android ou no PC.');
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  return connectDevice(device);
}

// Reconecta sem clique, se o navegador permitir (getDevices). Retorna false se não der.
export async function bluetoothReconnect() {
  if (bluetoothConnected()) return true;
  try {
    if (bleDevice) { await connectDevice(bleDevice); return true; }
    const id = localStorage.getItem('ble_printer_id');
    const devices = (await navigator.bluetooth?.getDevices?.()) || [];
    const dev = devices.find(d => d.id === id) || devices[0];
    if (!dev) return false;
    await connectDevice(dev);
    return true;
  } catch { return false; }
}

export async function printViaBluetooth(order, restaurant, paperMm = 58) {
  if (!bluetoothConnected() && !(await bluetoothReconnect())) throw new Error('Impressora Bluetooth desconectada');
  const data = escposBytes(order, restaurant, paperMm >= 80 ? 48 : 32);
  const chunk = 180;
  for (let i = 0; i < data.length; i += chunk) {
    const part = data.slice(i, i + chunk);
    if (bleChar.properties.writeWithoutResponse) await bleChar.writeValueWithoutResponse(part);
    else await bleChar.writeValue(part);
    await new Promise(r => setTimeout(r, 30));
  }
}

// ---------- 3. RawBT (Android, Bluetooth clássico) ----------
// O app RawBT recebe os bytes ESC/POS por link e imprime na impressora pareada no Android.
export function printViaRawBT(order, restaurant, paperMm = 58) {
  const data = escposBytes(order, restaurant, paperMm >= 80 ? 48 : 32);
  let bin = ''; data.forEach(b => { bin += String.fromCharCode(b); });
  location.href = `intent:base64,${btoa(bin)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

export async function printOrder(mode, order, restaurant, paperMm) {
  if (mode === 'bluetooth') return printViaBluetooth(order, restaurant, paperMm);
  if (mode === 'rawbt') return printViaRawBT(order, restaurant, paperMm);
  return printViaBrowser(order, restaurant, paperMm);
}
