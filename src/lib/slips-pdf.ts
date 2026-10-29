import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export type Slip = { name: string; username: string; link: string; telegramLink?: string };
export type SlipText = { hotel: string; scan: string; username: string; telegram: string; valid: string; steps: string };

const FONTS = path.join(process.cwd(), "src", "fonts");

/** A4 sheets with 2 × 4 cut-out invite slips: name, username, password QR, Telegram QR. */
export async function renderSlipsPdf(slips: Slip[], text: SlipText): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 24, font: path.join(FONTS, "PT_Sans-Web-Regular.ttf"), info: { Title: text.hotel } });
  doc.registerFont("R", path.join(FONTS, "PT_Sans-Web-Regular.ttf"));
  doc.registerFont("B", path.join(FONTS, "PT_Sans-Web-Bold.ttf"));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = (595.28 - 48) / 2;
  const H = (841.89 - 48) / 4;
  for (const [i, s] of slips.entries()) {
    if (i > 0 && i % 8 === 0) doc.addPage();
    const x = 24 + (i % 2) * W;
    const y = 24 + (Math.floor(i / 2) % 4) * H;
    doc.save().dash(3, { space: 3 }).lineWidth(0.5).strokeColor("#9ca3af").rect(x, y, W, H).stroke().restore();
    const pad = 12;
    doc.font("B").fontSize(9).fillColor("#6b7280").text(text.hotel, x + pad, y + pad, { width: W - 2 * pad, lineBreak: false, ellipsis: true });
    doc.font("B").fontSize(13).fillColor("#111827").text(s.name, x + pad, y + pad + 13, { width: W - 2 * pad, lineBreak: false, ellipsis: true });
    doc.font("R").fontSize(9).fillColor("#374151").text(`${text.username}: `, x + pad, y + pad + 32, { continued: true }).font("B").text(s.username);
    const qr = 92;
    const png = await QRCode.toBuffer(s.link, { margin: 1, width: 300, errorCorrectionLevel: "M" });
    doc.image(png, x + pad, y + pad + 48, { width: qr });
    doc.font("B").fontSize(8.5).fillColor("#111827").text(text.scan, x + pad, y + pad + 48 + qr + 2, { width: qr + 10 });
    if (s.telegramLink) {
      const tg = await QRCode.toBuffer(s.telegramLink, { margin: 1, width: 300, errorCorrectionLevel: "M" });
      doc.image(tg, x + W - pad - qr, y + pad + 48, { width: qr });
      doc.font("R").fontSize(8).fillColor("#374151").text(text.telegram, x + W - pad - qr - 10, y + pad + 48 + qr + 2, { width: qr + 10, align: "right" });
    } else {
      doc.font("R").fontSize(8.5).fillColor("#374151").text(text.steps, x + pad + qr + 12, y + pad + 52, { width: W - qr - 3 * pad });
    }
    doc.font("R").fontSize(7.5).fillColor("#6b7280").text(text.valid, x + pad, y + H - pad - 10, { width: W - 2 * pad, lineBreak: false });
  }
  doc.end();
  return done;
}
