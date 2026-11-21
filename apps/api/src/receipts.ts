import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from './db.js';
import { env } from './env.js';
import { notFound } from './errors.js';
import { prettyDate, prettyTime } from './time.js';

const { tokens, sessions, doctors, chambers, payments, specialties } = schema;

/* ---------------- links ---------------- */

const sign = (tokenId: string) => createHmac('sha256', env.jwtSecret).update(`receipt:${tokenId}`).digest('hex').slice(0, 24);
export const receiptOk = (tokenId: string, sig: string) => sig === sign(tokenId);
/** A link anyone with it can open (it is sent on WhatsApp), but nobody can guess. */
export const receiptUrl = (tokenId: string) => `${env.publicUrl}/v1/receipts/${tokenId}.pdf?sig=${sign(tokenId)}`;

/* ---------------- fonts ---------------- */

const require_ = createRequire(import.meta.url);
const fontDir = (pkg: string) => path.dirname(require_.resolve(`@expo-google-fonts/${pkg}/package.json`));
const FONTS = {
  regular: path.join(fontDir('inter'), '400Regular/Inter_400Regular.ttf'),
  semibold: path.join(fontDir('inter'), '600SemiBold/Inter_600SemiBold.ttf'),
  black: path.join(fontDir('inter'), '900Black/Inter_900Black.ttf'),
  bn: path.join(fontDir('noto-sans-bengali'), '400Regular/NotoSansBengali_400Regular.ttf'),
  bnBold: path.join(fontDir('noto-sans-bengali'), '700Bold/NotoSansBengali_700Bold.ttf'),
};
const hasBengali = (s: string) => /[ঀ-৿]/.test(s);

/* ---------------- data ---------------- */

export async function receiptData(tokenId: string) {
  const [r] = await db.select().from(tokens)
    .innerJoin(sessions, eq(sessions.id, tokens.sessionId))
    .innerJoin(doctors, eq(doctors.id, sessions.doctorId))
    .innerJoin(chambers, eq(chambers.id, sessions.chamberId))
    .leftJoin(specialties, eq(specialties.id, doctors.specialtyId))
    .leftJoin(payments, eq(payments.tokenId, tokens.id))
    .where(eq(tokens.id, tokenId));
  if (!r || r.tokens.number === null) throw notFound('Receipt');
  return r;
}

const C = { teal: '#16ACB2', brand: '#1ACDD4', night: '#00191A', ink: '#0B1220', sec: '#5B6270', line: '#E4E7EC', tint: '#E3F8F9' };
// The MedicSeba mark (rounded square with the plus cut out), from the brand SVG, 512 units wide.
const MARK = 'M412 0C467.228 0 512 44.7715 512 100V221.004H366.847V68.7773C366.847 58.2841 358.34 49.7775 347.847 49.7773H315.855C305.362 49.7775 296.855 58.284 296.855 68.7773V221.004H144.629C134.135 221.004 125.629 229.51 125.629 240.004V271.994C125.629 282.488 134.135 290.994 144.629 290.994H296.855V443.222C296.856 453.715 305.362 462.222 315.855 462.222H347.847C358.34 462.221 366.846 453.715 366.847 443.222V290.994H512V412C512 467.228 467.228 512 412 512H100C44.7715 512 0 467.228 0 412V100C0 44.7715 44.7715 0 100 0H412Z';

/**
 * The receipt as a PDF, 80 mm wide so it prints on a counter thermal printer and reads well on a phone.
 * Height grows with the content.
 */
export async function receiptPdf(tokenId: string): Promise<Buffer> {
  const r = await receiptData(tokenId);
  const t = r.tokens, s = r.sessions, d = r.doctors, c = r.chambers, p = r.payments;
  const W = 227; // 80 mm in points
  const M = 16;
  const online = t.source === 'ONLINE';
  const qr = online ? await QRCode.toBuffer(`${env.publicUrl}/live/${t.id}`, { margin: 0, width: 160, color: { dark: C.night, light: '#ffffff' } }) : null;
  // Drawn twice: once to measure the height, then for real on a page that fits.
  const first = await draw(2000, false);
  return (await draw(Math.ceil(first.height) + 18, true)).pdf;

  async function draw(H: number, keep: boolean): Promise<{ height: number; pdf: Buffer }> {
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `MedicSeba serial ${t.number}`, Author: 'MedicSeba' } });
  doc.registerFont('r', FONTS.regular); doc.registerFont('sb', FONTS.semibold); doc.registerFont('bl', FONTS.black);
  doc.registerFont('bn', FONTS.bn); doc.registerFont('bnb', FONTS.bnBold);
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const text = (str: string, x: number, y: number, o: { font?: 'r' | 'sb' | 'bl'; size?: number; color?: string; width?: number; align?: 'left' | 'right' | 'center' } = {}) => {
    const bold = o.font === 'sb' || o.font === 'bl';
    doc.font(hasBengali(str) ? (bold ? 'bnb' : 'bn') : (o.font ?? 'r')).fontSize(o.size ?? 9).fillColor(o.color ?? C.ink)
      .text(str, x, y, { width: o.width ?? W - M * 2, align: o.align ?? 'left', lineBreak: true, features: ['kern', 'liga'] });
    return doc.y;
  };
  const row = (label: string, value: string, y: number, strong = false) => {
    text(label, M, y, { color: C.sec, size: 8.5 });
    text(value, M + 70, y, { width: W - M * 2 - 70, align: 'right', font: strong ? 'sb' : 'r', size: strong ? 10 : 8.5 });
    return Math.max(doc.y, y + 12) + 3;
  };
  const rule = (y: number, dashed = false) => {
    doc.save().moveTo(M, y).lineTo(W - M, y).lineWidth(0.7).strokeColor(C.line);
    if (dashed) doc.dash(3, { space: 2 });
    doc.stroke().undash().restore();
    return y + 8;
  };

  // Header: mark + wordmark
  doc.save().translate(M, 16).scale(20 / 512).path(MARK).fill(C.teal).restore();
  text('medic', M + 26, 17, { font: 'bl', size: 15, color: C.teal, width: 60 });
  const mw = doc.font('bl').fontSize(15).widthOfString('medic');
  text('seba', M + 26 + mw, 17, { font: 'r', size: 15, color: C.teal, width: 60 });
  text(online ? 'Online serial' : 'Counter serial', M, 21, { size: 8, color: C.sec, align: 'right' });

  // Serial block
  let y = 48;
  doc.roundedRect(M, y, W - M * 2, 78, 10).fill(C.night);
  text('SERIAL', M + 12, y + 12, { size: 7.5, color: '#9FB3B4', font: 'sb' });
  text(String(t.number), M + 12, y + 20, { size: 40, color: '#FFFFFF', font: 'bl', width: 110 });
  text(prettyDate(s.date), M + 110, y + 22, { size: 10, color: C.brand, font: 'sb', width: W - M * 2 - 122, align: 'right' });
  text(prettyTime(s.startTime), M + 110, y + 37, { size: 10, color: '#FFFFFF', font: 'sb', width: W - M * 2 - 122, align: 'right' });
  text(t.state === 'MOVED' ? 'Moved' : t.state === 'REFUNDED' ? 'Refunded' : 'Valid', M + 110, y + 54, { size: 8, color: '#9FB3B4', width: W - M * 2 - 122, align: 'right' });
  y += 92;

  // Patient
  text('Patient', M, y, { size: 7.5, color: C.sec, font: 'sb' }); y += 11;
  y = text(t.patientName, M, y, { size: 12, font: 'sb' }) + 1;
  const who = [t.patientAge ? `${t.patientAge} yrs` : null, t.patientGender ? { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' }[t.patientGender] : null].filter(Boolean).join(', ');
  if (who) y = text(who, M, y, { size: 8.5, color: C.sec }) + 2;
  y = rule(y + 6);

  // Doctor and chamber
  text('Doctor', M, y, { size: 7.5, color: C.sec, font: 'sb' }); y += 11;
  y = text(d.name, M, y, { size: 11, font: 'sb' }) + 1;
  y = text([r.specialties?.name, d.degrees].filter(Boolean).join(', '), M, y, { size: 8.5, color: C.sec }) + 6;
  text('Chamber', M, y, { size: 7.5, color: C.sec, font: 'sb' }); y += 11;
  y = text(c.name, M, y, { size: 10, font: 'sb' }) + 1;
  y = text([c.address, c.landmark].filter(Boolean).join('. '), M, y, { size: 8.5, color: C.sec }) + 2;
  if (c.phone) y = text(`Phone ${c.phone}`, M, y, { size: 8.5, color: C.sec }) + 2;
  y = rule(y + 6);

  // Payment
  text('Payment', M, y, { size: 7.5, color: C.sec, font: 'sb' }); y += 12;
  if (online && p) {
    y = row('Booking fee', `₹${p.bookingFee}`, y);
    y = row('Service fee', `₹${p.platformFee}`, y);
    y = rule(y + 2, true);
    y = row(p.status === 'REFUNDED' ? 'Refunded' : 'Paid online', `₹${p.amount}`, y, true);
    if (p.providerPaymentId) y = row('Payment ID', p.providerPaymentId, y);
  } else if (t.paidAmount) {
    y = row(`Paid at counter (${t.paidMethod === 'UPI' ? 'UPI' : 'cash'})`, `₹${t.paidAmount}`, y, true);
  } else {
    y = row('Paid at counter', 'Not recorded', y);
  }
  y = rule(y + 4);

  // Track live
  if (qr) {
    doc.image(qr, M, y, { width: 58 });
    text('Scan to see the live queue and how many patients are ahead of you.', M + 68, y + 8, { size: 8, color: C.sec, width: W - M * 2 - 68 });
    y += 66;
    y = rule(y);
  }

  // Terms
  y = text('No refunds. If the doctor does not come, or the sitting ends before your turn, move your serial to another day free of charge in the MedicSeba app. If you are called and not there, you go to the end of the line once; after that the serial is missed and cannot be moved.', M, y, { size: 6.8, color: C.sec }) + 6;
  y = text(`Receipt ${t.id.slice(0, 8).toUpperCase()}, issued ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`, M, y, { size: 6.8, color: C.sec });

  doc.end();
  const pdf = await done;
  return { height: y, pdf: keep ? pdf : Buffer.alloc(0) };
  }
}
