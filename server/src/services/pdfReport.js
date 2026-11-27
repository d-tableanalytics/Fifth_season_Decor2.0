// Generic table-report PDF (spec 14). reportPdf({ title, subtitle, blocks }) -> Promise<Buffer>
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { istParts, fmtDateTime } from '../utils/ist.js';

export const COMPANY_NAME = process.env.COMPANY_NAME || 'Fifth Season Decor';
const LOGO = fileURLToPath(new URL('../../../client/public/Assets/FSD_LOGO.png', import.meta.url));
const YELLOW = '#fdb913';
const ALT = '#fff8e8';
const MARGIN = 28;

/**
 * block = { pageBreak?, heading?, note?, title?, columns: ['Col', ...], rows: [[cell, ...]], align?: ['left'|'right'] }
 * Numbers are right-aligned; empty cells show "—"; an empty table shows "Nothing to show for this period.".
 */
export function reportPdf({ title, subtitle = '', blocks = [] }) {
  const landscape = blocks.some((b) => (b.columns || []).length > 6);
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: MARGIN, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const W = () => doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN - 18;

  // header
  if (existsSync(LOGO)) {
    try { doc.image(LOGO, doc.page.width - MARGIN - 60, MARGIN - 6, { fit: [60, 30] }); } catch { /* logo is optional */ }
  }
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#000').text(title, MARGIN, MARGIN, { width: W() - 70 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#666').text(
    `${subtitle ? `${subtitle} · ` : ''}Generated ${fmtDateTime(new Date(), true)} · ${COMPANY_NAME}`, { width: W() }
  );
  doc.moveDown(0.3);
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + W(), doc.y).lineWidth(1).strokeColor('#000').stroke();
  doc.moveDown(0.6);

  const cellText = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
  const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?[\d,.]+%?$/.test(v.trim()));

  for (const b of blocks) {
    if (b.pageBreak) doc.addPage();
    if (b.heading) {
      if (doc.y > bottom() - 60) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text(b.heading, MARGIN, doc.y, { width: W(), continued: !!b.note });
      if (b.note) doc.font('Helvetica').fontSize(9).fillColor('#666').text(`   ${b.note}`);
      doc.moveTo(MARGIN, doc.y + 1).lineTo(MARGIN + W(), doc.y + 1).lineWidth(2).strokeColor(YELLOW).stroke();
      doc.moveDown(0.5);
    }
    if (b.title) {
      if (doc.y > bottom() - 50) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#8b1a1a').text(b.title, MARGIN, doc.y, { width: W() });
      doc.moveDown(0.25);
    }
    const cols = b.columns || [];
    if (!cols.length) continue;
    const rows = b.rows || [];
    if (!rows.length) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666').text('Nothing to show for this period.', MARGIN, doc.y);
      doc.moveDown(0.8);
      continue;
    }
    // proportional widths: longest text (5…40) per column
    const weights = cols.map((c, i) => Math.min(40, Math.max(5, c.length + 3, ...rows.map((r) => cellText(r[i]).length))));
    const total = weights.reduce((a, x) => a + x, 0);
    const widths = weights.map((x) => (x / total) * W());
    // a column is right-aligned only when every cell is numeric (keeps mixed Measure/Value columns tidy)
    const numCol = cols.map((_, i) => rows.every((r) => cellText(r[i]) === '—' || isNum(r[i])) && rows.some((r) => isNum(r[i])));
    const align = (i) => b.align?.[i] || (numCol[i] ? 'right' : 'left');

    const drawRow = (cells, { head = false, alt = false } = {}) => {
      doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(cellText(c), { width: widths[i] - 8 }))) + 8;
      if (doc.y + h > bottom()) {
        doc.addPage();
        if (!head) drawRow(cols, { head: true });
      }
      const y = doc.y;
      let x = MARGIN;
      cells.forEach((c, i) => {
        if (head) doc.rect(x, y, widths[i], h).fill(YELLOW);
        else if (alt) doc.rect(x, y, widths[i], h).fill(ALT);
        doc.fillColor('#111').font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
          .text(cellText(c), x + 4, y + 4, { width: widths[i] - 8, align: head ? (numCol[i] ? 'right' : 'left') : align(i) });
        x += widths[i];
      });
      doc.y = y + h;
      doc.x = MARGIN;
    };
    drawRow(cols, { head: true });
    rows.forEach((r, i) => drawRow(r, { alt: i % 2 === 1 }));
    doc.moveDown(0.8);
  }

  // footer: Page i of n
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // otherwise drawing in the footer area appends an extra blank page
    doc.font('Helvetica').fontSize(8).fillColor('#888')
      .text(`Page ${i + 1} of ${range.count}`, MARGIN, doc.page.height - MARGIN - 4, { width: W(), align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
}

export const sendPdf = (res, buf, filename) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\-]+/g, '_')}"`);
  res.send(buf);
};
export { istParts };
