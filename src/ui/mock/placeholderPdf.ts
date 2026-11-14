// Builds a tiny, valid one-page PDF so the mock can return a file for the fixture documents.
// Text is ASCII only; anything else becomes '?'.
export function placeholderPdf(lines: string[]): Blob {
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`).replace(/[^\x20-\x7e]/g, '?');
  const text = lines.flatMap((line, i) =>
    i === 0 ? ['/F1 22 Tf', `(${esc(line)}) Tj`] : ['/F1 13 Tf', `0 ${i === 1 ? -32 : -20} Td`, `(${esc(line)}) Tj`],
  );
  const stream = ['BT', '56 770 Td', ...text, 'ET'].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return new Blob([body], { type: 'application/pdf' });
}
