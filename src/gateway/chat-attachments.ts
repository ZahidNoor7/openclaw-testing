import JSZip from "jszip";
import { estimateBase64DecodedBytes } from "../media/base64.js";
import { extractPdfContent } from "../media/pdf-extract.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content?: unknown;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type ParsedMessageWithImages = {
  message: string;
  images: ChatImageContent[];
};

type AttachmentLog = {
  warn: (message: string) => void;
};

type NormalizedAttachment = {
  label: string;
  mime: string;
  base64: string;
};

function normalizeMime(mime?: string): string | undefined {
  if (!mime) {
    return undefined;
  }
  const cleaned = mime.split(";")[0]?.trim().toLowerCase();
  return cleaned || undefined;
}

function isImageMime(mime?: string): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

/** Returns true for MIME types whose content can be decoded to readable UTF-8 text. */
function isTextMime(mime?: string): boolean {
  if (!mime) {
    return false;
  }
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/x-javascript"
  );
}

function isValidBase64(value: string): boolean {
  // Minimal validation; avoid full decode allocations for large payloads.
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function normalizeAttachment(
  att: ChatAttachment,
  idx: number,
  opts: { stripDataUrlPrefix: boolean; requireImageMime: boolean },
): NormalizedAttachment {
  const mime = att.mimeType ?? "";
  const content = att.content;
  const label = att.fileName || att.type || `attachment-${idx + 1}`;

  if (typeof content !== "string") {
    throw new Error(`attachment ${label}: content must be base64 string`);
  }
  if (opts.requireImageMime && !mime.startsWith("image/")) {
    throw new Error(`attachment ${label}: only image/* supported`);
  }

  let base64 = content.trim();
  if (opts.stripDataUrlPrefix) {
    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,...").
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(base64);
    if (dataUrlMatch) {
      base64 = dataUrlMatch[1];
    }
  }
  return { label, mime, base64 };
}

function validateAttachmentBase64OrThrow(
  normalized: NormalizedAttachment,
  opts: { maxBytes: number },
): number {
  if (!isValidBase64(normalized.base64)) {
    throw new Error(`attachment ${normalized.label}: invalid base64 content`);
  }
  const sizeBytes = estimateBase64DecodedBytes(normalized.base64);
  if (sizeBytes <= 0 || sizeBytes > opts.maxBytes) {
    throw new Error(
      `attachment ${normalized.label}: exceeds size limit (${sizeBytes} > ${opts.maxBytes} bytes)`,
    );
  }
  return sizeBytes;
}

/** Strip data URL prefix and return raw base64 string. */
function stripDataUrlPrefix(content: string): string {
  const m = /^data:[^;]+;base64,(.*)$/.exec(content.trim());
  return m ? m[1] : content.trim();
}

// ─── Office document extraction helpers ──────────────────────────────────────

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Convert a column letter (e.g. "A", "Z", "AA") to a zero-based index. */
function colLetterToIndex(col: string): number {
  if (!col) {
    return -1;
  }
  let idx = 0;
  for (const ch of col.toUpperCase()) {
    idx = idx * 26 + (ch.charCodeAt(0) - 64);
  }
  return idx - 1;
}

/** Extract plain text from a DOCX buffer using jszip. */
async function extractDocxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    return "";
  }
  const xml = await docFile.async("text");
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract plain text from an XLSX buffer as tab-separated rows. */
async function extractXlsxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);

  // Parse shared strings table
  const sharedStrings: string[] = [];
  const ssFile = zip.file("xl/sharedStrings.xml");
  if (ssFile) {
    const ssXml = await ssFile.async("text");
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let siM: RegExpExecArray | null;
    while ((siM = siRe.exec(ssXml)) !== null) {
      const tRe = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g;
      let tM: RegExpExecArray | null;
      let s = "";
      while ((tM = tRe.exec(siM[1])) !== null) {
        s += tM[1];
      }
      sharedStrings.push(decodeXmlEntities(s));
    }
  }

  // Find worksheets sorted numerically
  const sheetPaths = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .toSorted((a, b) => {
      const na = parseInt(/(\d+)/.exec(a)?.[1] ?? "0", 10);
      const nb = parseInt(/(\d+)/.exec(b)?.[1] ?? "0", 10);
      return na - nb;
    });

  const lines: string[] = [];
  for (const sheetPath of sheetPaths) {
    const sf = zip.file(sheetPath);
    if (!sf) {
      continue;
    }
    const sheetXml = await sf.async("text");
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowM: RegExpExecArray | null;
    while ((rowM = rowRe.exec(sheetXml)) !== null) {
      const cells: Array<{ col: number; value: string }> = [];
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cellM: RegExpExecArray | null;
      while ((cellM = cellRe.exec(rowM[1])) !== null) {
        const attrs = cellM[1];
        const body = cellM[2];
        const colStr = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? "";
        const cellType = /\bt="([^"]*)"/.exec(attrs)?.[1] ?? "";
        const col = colLetterToIndex(colStr);
        if (col < 0) {
          continue;
        }
        // Inline string (<is><t>...</t></is>) takes priority over <v>
        const isText = /<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(
          /<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "",
        )?.[1];
        const vVal = /<v>([^<]*)<\/v>/.exec(body)?.[1] ?? "";
        let value = "";
        if (isText !== undefined) {
          value = decodeXmlEntities(isText);
        } else if (cellType === "s") {
          value = sharedStrings[parseInt(vVal, 10)] ?? "";
        } else {
          value = vVal;
        }
        cells.push({ col, value });
      }
      if (cells.some((c) => c.value.trim())) {
        const maxCol = Math.max(...cells.map((c) => c.col));
        const rowArr = Array.from({ length: maxCol + 1 }, () => "");
        for (const cell of cells) {
          rowArr[cell.col] = cell.value;
        }
        lines.push(rowArr.join("\t"));
      }
    }
  }
  return lines.join("\n");
}

/** Extract plain text from a PPTX buffer (slide text only). */
async function extractPptxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slidePaths = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .toSorted((a, b) => {
      const na = parseInt(/(\d+)/.exec(a)?.[1] ?? "0", 10);
      const nb = parseInt(/(\d+)/.exec(b)?.[1] ?? "0", 10);
      return na - nb;
    });

  const slideTexts: string[] = [];
  for (const slidePath of slidePaths) {
    const sf = zip.file(slidePath);
    if (!sf) {
      continue;
    }
    const xml = await sf.async("text");
    const tRe = /<a:t>([^<]*)<\/a:t>/g;
    let tM: RegExpExecArray | null;
    const parts: string[] = [];
    while ((tM = tRe.exec(xml)) !== null) {
      const t = decodeXmlEntities(tM[1]).trim();
      if (t) {
        parts.push(t);
      }
    }
    if (parts.length > 0) {
      slideTexts.push(parts.join(" "));
    }
  }
  return slideTexts.join("\n\n");
}

function isModernOfficeOpenXmlMime(mime?: string): boolean {
  return (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}

function isLegacyOfficeMime(mime?: string): boolean {
  return (
    mime === "application/msword" ||
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.ms-powerpoint"
  );
}

/**
 * Parse attachments and extract images as structured content blocks, and inject
 * document/text file content into the message text.
 *
 * Routing by declared MIME type:
 * - image/* or no declared MIME (sniff-based): extracted as ChatImageContent[].
 *   Throws on invalid base64 or size violations (preserves original behaviour).
 * - application/pdf: text extracted via pdfjs-dist; injected as <document> block.
 * - text/* / application/json / application/xml / application/javascript:
 *   decoded as UTF-8; injected as <document> block.
 * - .docx / .xlsx / .pptx (Open XML): text extracted via jszip; injected as <document> block.
 * - .doc / .xls / .ppt (legacy binary): fallback hint injected as <document> block.
 * - Other binary types: logged and skipped.
 */
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number; log?: AttachmentLog },
): Promise<ParsedMessageWithImages> {
  const maxBytes = opts?.maxBytes ?? 5_000_000; // decoded bytes (5,000,000)
  const log = opts?.log;
  if (!attachments || attachments.length === 0) {
    return { message, images: [] };
  }

  const images: ChatImageContent[] = [];
  const docBlocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }

    const label = att.fileName || att.type || `attachment-${idx + 1}`;
    const declaredMime = normalizeMime(att.mimeType);

    // ── PDFs ─────────────────────────────────────────────────────────────────
    if (declaredMime === "application/pdf") {
      if (typeof att.content !== "string") {
        log?.warn(`attachment ${label}: content must be base64 string, skipping`);
        continue;
      }
      const raw = stripDataUrlPrefix(att.content);
      if (!raw) {
        log?.warn(`attachment ${label}: empty content, skipping`);
        continue;
      }
      try {
        const buf = Buffer.from(raw, "base64");
        if (buf.byteLength > maxBytes) {
          log?.warn(
            `attachment ${label}: exceeds size limit (${buf.byteLength} > ${maxBytes} bytes), skipping`,
          );
          continue;
        }
        const extracted = await extractPdfContent({
          buffer: buf,
          maxPages: 20,
          maxPixels: 0,
          minTextChars: 0,
        });
        if (extracted.text.trim()) {
          docBlocks.push(`<document filename="${label}">\n${extracted.text.trim()}\n</document>`);
        } else {
          log?.warn(`attachment ${label}: PDF has no extractable text`);
          docBlocks.push(
            `<document filename="${label}">\n[PDF attached — no extractable text]\n</document>`,
          );
        }
        // Pass along any images extracted from scanned PDF pages
        for (const img of extracted.images) {
          images.push({ type: "image", data: img.data, mimeType: img.mimeType });
        }
      } catch (err) {
        log?.warn(`attachment ${label}: PDF extraction failed: ${String(err)}`);
      }
      continue;
    }

    // ── Text / JSON / XML / JS ───────────────────────────────────────────────
    if (isTextMime(declaredMime)) {
      if (typeof att.content !== "string") {
        log?.warn(`attachment ${label}: content must be base64 string, skipping`);
        continue;
      }
      const raw = stripDataUrlPrefix(att.content);
      if (!raw) {
        continue;
      }
      try {
        const buf = Buffer.from(raw, "base64");
        if (buf.byteLength > maxBytes) {
          log?.warn(
            `attachment ${label}: exceeds size limit (${buf.byteLength} > ${maxBytes} bytes), skipping`,
          );
          continue;
        }
        const text = buf.toString("utf-8");
        if (text.trim()) {
          docBlocks.push(`<document filename="${label}">\n${text.trim()}\n</document>`);
        }
      } catch (err) {
        log?.warn(`attachment ${label}: text decoding failed: ${String(err)}`);
      }
      continue;
    }

    // ── Modern Office Open XML (.docx, .xlsx, .pptx) ─────────────────────────
    if (isModernOfficeOpenXmlMime(declaredMime)) {
      if (typeof att.content !== "string") {
        log?.warn(`attachment ${label}: content must be base64 string, skipping`);
        continue;
      }
      const raw = stripDataUrlPrefix(att.content);
      if (!raw) {
        log?.warn(`attachment ${label}: empty content, skipping`);
        continue;
      }
      try {
        const buf = Buffer.from(raw, "base64");
        if (buf.byteLength > maxBytes) {
          log?.warn(
            `attachment ${label}: exceeds size limit (${buf.byteLength} > ${maxBytes} bytes), skipping`,
          );
          continue;
        }
        let text = "";
        if (
          declaredMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          text = await extractDocxText(buf);
        } else if (
          declaredMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ) {
          text = await extractXlsxText(buf);
        } else if (
          declaredMime ===
          "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ) {
          text = await extractPptxText(buf);
        }
        if (text.trim()) {
          docBlocks.push(`<document filename="${label}">\n${text.trim()}\n</document>`);
        } else {
          log?.warn(`attachment ${label}: no extractable text found`);
          docBlocks.push(
            `<document filename="${label}">\n[No extractable text found]\n</document>`,
          );
        }
      } catch (err) {
        log?.warn(`attachment ${label}: Office document extraction failed: ${String(err)}`);
      }
      continue;
    }

    // ── Legacy binary Office formats (.doc, .xls, .ppt) ──────────────────────
    if (isLegacyOfficeMime(declaredMime)) {
      // OLE2 binary format — cannot extract text without a dedicated parser.
      const suggestion =
        declaredMime === "application/msword"
          ? ".docx"
          : declaredMime === "application/vnd.ms-excel"
            ? ".csv or .xlsx"
            : ".pptx";
      docBlocks.push(
        `<document filename="${label}">\n[Legacy Office file attached — re-save as ${suggestion} to enable text extraction]\n</document>`,
      );
      continue;
    }

    // ── Images + untyped (sniff-based) — preserves original throw-on-error behaviour ──
    if (isImageMime(declaredMime) || !declaredMime) {
      const normalized = normalizeAttachment(att, idx, {
        stripDataUrlPrefix: true,
        requireImageMime: false,
      });
      // Throws for invalid base64 or size violations — intentional (unchanged from original)
      validateAttachmentBase64OrThrow(normalized, { maxBytes });
      const { base64: b64, label: attLabel, mime } = normalized;

      const providedMime = normalizeMime(mime);
      const sniffedMime = normalizeMime(await sniffMimeFromBase64(b64));
      if (sniffedMime && !isImageMime(sniffedMime)) {
        log?.warn(`attachment ${attLabel}: detected non-image (${sniffedMime}), dropping`);
        continue;
      }
      if (!sniffedMime && !isImageMime(providedMime)) {
        log?.warn(`attachment ${attLabel}: unable to detect image mime type, dropping`);
        continue;
      }
      if (sniffedMime && providedMime && sniffedMime !== providedMime) {
        log?.warn(
          `attachment ${attLabel}: mime mismatch (${providedMime} -> ${sniffedMime}), using sniffed`,
        );
      }
      images.push({
        type: "image",
        data: b64,
        mimeType: sniffedMime ?? providedMime ?? mime,
      });
      continue;
    }

    // ── Remaining unsupported binary types ───────────────────────────────────
    log?.warn(`attachment ${label}: unsupported type "${declaredMime}", skipping`);
  }

  // Inject document blocks before the user message so Claude sees the files first
  let finalMessage = message;
  if (docBlocks.length > 0) {
    const docSection = docBlocks.join("\n\n");
    finalMessage = finalMessage.trim() ? `${docSection}\n\n${finalMessage}` : docSection;
  }

  return { message: finalMessage, images };
}

/**
 * @deprecated Use parseMessageWithAttachments instead.
 * This function converts images to markdown data URLs which Claude API cannot process as images.
 */
export function buildMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number },
): string {
  const maxBytes = opts?.maxBytes ?? 2_000_000; // 2 MB
  if (!attachments || attachments.length === 0) {
    return message;
  }

  const blocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: false,
      requireImageMime: true,
    });
    validateAttachmentBase64OrThrow(normalized, { maxBytes });
    const { base64, label, mime } = normalized;

    const safeLabel = label.replace(/\s+/g, "_");
    const dataUrl = `![${safeLabel}](data:${mime};base64,${base64})`;
    blocks.push(dataUrl);
  }

  if (blocks.length === 0) {
    return message;
  }
  const separator = message.trim().length > 0 ? "\n\n" : "";
  return `${message}${separator}${blocks.join("\n\n")}`;
}
