import { createHash } from 'node:crypto'

/**
 * A minimal, structurally valid single-page PDF 1.4 (catalog, page tree, one A4 page, a Helvetica
 * text stream, a byte-exact cross-reference table and trailer), generated in memory so every test
 * run can upload a file with its own content and therefore its own SHA-256.
 *
 * `lines` are printed top to bottom. Only printable ASCII is allowed, so byte offsets equal string
 * offsets and nothing needs escaping beyond the PDF string delimiters.
 */
export function buildStatementPdf(lines: readonly string[]): Uint8Array<ArrayBuffer> {
  for (const line of lines) {
    if (!/^[\x20-\x7e]*$/.test(line)) throw new Error(`PDF fixture lines must be printable ASCII: ${JSON.stringify(line)}`)
  }
  const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`)
  const content = [
    'BT',
    '/F1 11 Tf',
    '14 TL',
    '56 780 Td',
    ...lines.map((line) => `(${escape(line)}) Tj T*`),
    'ET',
  ].join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
