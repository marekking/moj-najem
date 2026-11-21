// Generates lightweight, spec-compliant PDF 1.4 documents directly in memory
// (used exclusively for sample blank templates and example demo attachments).

const PL_MAP = {
  'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
  'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',
  '–': '-', '—': '-', '„': '"', '”': '"', '’': "'", '…': '...', '²': '2', '°': ' ',
};

function toAscii(str) {
  return String(str || '').replace(/[^\x20-\x7E]/g, (ch) => PL_MAP[ch] || '?');
}

function pdfEsc(str) {
  return toAscii(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Builds a single-page A4 valid PDF document containing the provided title and text lines.
 * @returns {Uint8Array}
 */
export function buildSimplePdfBytes(title, subtitle, lines) {
  const ops = [];
  // Top green header bar
  ops.push('0.059 0.365 0.337 rg');
  ops.push('0 770 595 72 re f');
  // Title
  ops.push('1 1 1 rg');
  ops.push('BT /F2 17 Tf 48 806 Td (' + pdfEsc(title) + ') Tj ET');
  ops.push('BT /F1 10 Tf 48 786 Td (' + pdfEsc(subtitle) + ') Tj ET');
  // Body text
  ops.push('0.12 0.14 0.16 rg');
  let y = 735;
  for (const rawLine of lines) {
    if (y < 60) break;
    if (rawLine === '---') {
      ops.push('0.82 0.85 0.87 RG 0.6 w 48 ' + (y + 4) + ' m 547 ' + (y + 4) + ' l S');
      y -= 14;
      continue;
    }
    if (rawLine.startsWith('## ')) {
      y -= 6;
      ops.push('0.059 0.365 0.337 rg');
      ops.push('BT /F2 11.5 Tf 48 ' + y + ' Td (' + pdfEsc(rawLine.slice(3)) + ') Tj ET');
      ops.push('0.12 0.14 0.16 rg');
      y -= 18;
      continue;
    }
    ops.push('BT /F1 9.8 Tf 48 ' + y + ' Td (' + pdfEsc(rawLine) + ') Tj ET');
    y -= 14.5;
  }
  // Footer
  ops.push('0.45 0.5 0.54 rg');
  ops.push('BT /F1 8 Tf 48 34 Td (Wygenerowano przykladowo w aplikacji Moj Najem - mozesz zastapic wlasnym plikiem PDF/DOCX.) Tj ET');

  const stream = ops.join('\n');
  const enc = new TextEncoder();
  const streamBytes = enc.encode(stream);

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj\n',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n',
    `6 0 obj << /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(out.length);
    out += obj;
  }
  const xrefPos = out.length;
  out += `xref\n0 ${objects.length + 1}\n`;
  out += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return enc.encode(out);
}
