// Binary-safe multipart/form-data parser with zero runtime dependencies.

export interface MultipartFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
}

/**
 * Extracts boundary from a Content-Type header value.
 */
export function parseBoundary(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return m ? (m[1] || m[2] || null) : null;
}

/**
 * Parses a multipart/form-data payload strictly on raw Buffer boundaries so binary
 * payloads (WebP, PNG) are never corrupted by UTF-8 string decoding.
 */
export function parseMultipart(body: Buffer, boundary: string): ParsedMultipart {
  const fields: Record<string, string> = {};
  const files: Record<string, MultipartFile> = {};
  const sep = Buffer.from(`--${boundary}`);
  const headerEndMarker = Buffer.from('\r\n\r\n');

  let pos = body.indexOf(sep);
  while (pos !== -1) {
    const afterSep = pos + sep.length;
    // End of multipart body (`--`)
    if (body[afterSep] === 0x2d && body[afterSep + 1] === 0x2d) break;

    let partStart = afterSep;
    if (body[partStart] === 0x0d && body[partStart + 1] === 0x0a) partStart += 2;
    else if (body[partStart] === 0x0a) partStart += 1;

    const nextSep = body.indexOf(sep, partStart);
    if (nextSep === -1) break;

    let partEnd = nextSep;
    if (partEnd >= 2 && body[partEnd - 2] === 0x0d && body[partEnd - 1] === 0x0a) partEnd -= 2;
    else if (partEnd >= 1 && body[partEnd - 1] === 0x0a) partEnd -= 1;

    const headerEnd = body.indexOf(headerEndMarker, partStart);
    if (headerEnd !== -1 && headerEnd < partEnd) {
      const rawHeaders = body.subarray(partStart, headerEnd).toString('utf8');
      const data = body.subarray(headerEnd + 4, partEnd);

      const dispMatch = /Content-Disposition:\s*form-data;\s*([^\r\n]+)/i.exec(rawHeaders);
      const nameMatch = dispMatch ? /\bname="([^"]+)"/i.exec(dispMatch[1]) : null;
      if (nameMatch) {
        const fieldName = nameMatch[1];
        const fileMatch = /\bfilename="([^"]*)"/i.exec(dispMatch![1]);
        const ctMatch = /Content-Type:\s*([^\r\n;]+)/i.exec(rawHeaders);
        if (fileMatch) {
          files[fieldName] = {
            filename: fileMatch[1],
            contentType: (ctMatch?.[1] ?? 'application/octet-stream').trim().toLowerCase(),
            data: Buffer.from(data),
          };
        } else {
          fields[fieldName] = data.toString('utf8');
        }
      }
    }

    pos = nextSep;
  }

  return { fields, files };
}
