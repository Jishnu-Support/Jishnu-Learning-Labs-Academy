function ascii(value: string) {
  return value.replace(/[^\x20-\x7E]/g, ' ');
}

function pdfString(value: string) {
  return ascii(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

export function createSamplePdf(title: string, pages: string[][]): Buffer {
  if (!pages.length) throw new Error('Sample PDFs require at least one page');
  const fontId = 3 + pages.length * 2;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ];
  pages.forEach((lines, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    const pageText = [
      'BT',
      '/F1 18 Tf',
      '50 790 Td',
      `(${pdfString(title)}) Tj`,
      '/F1 11 Tf',
      '0 -36 Td',
      ...lines.flatMap((line) => [`(${pdfString(line)}) Tj`, '0 -20 Td']),
      'ET',
    ].join('\n');
    const streamLength = Buffer.byteLength(pageText, 'ascii');
    objects.push(`<< /Length ${streamLength} >>\nstream\n${pageText}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'ascii')];
  const offsets = [0];
  let length = chunks[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'ascii');
    chunks.push(chunk);
    length += chunk.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    '%%EOF',
    '',
  ].join('\n');
  chunks.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(chunks);
}
