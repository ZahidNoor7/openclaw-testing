import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function safeExt(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? "bin";
}

function mimeFromExt(ext: string): string {
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

export function chatImagesDir(stateDir: string): string {
  return path.join(stateDir, "chat-images");
}

/**
 * Save image data to content-addressed storage.
 * Returns the imageId like "abc123...def.png".
 * Skips writing if the file already exists (idempotent).
 */
export function saveChatImageSync(params: {
  data: Buffer;
  mimeType: string;
  stateDir: string;
}): string {
  const { data, mimeType, stateDir } = params;
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  const ext = safeExt(mimeType);
  const imageId = `${hash}.${ext}`;
  const dir = chatImagesDir(stateDir);
  const filePath = path.join(dir, imageId);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, data);
  }
  return imageId;
}

/**
 * Look up a chat image by ID. Validates the ID format to prevent path traversal.
 * Returns { filePath, mimeType } or null if not found / invalid.
 */
export function resolveChatImageById(params: {
  imageId: string;
  stateDir: string;
}): { filePath: string; mimeType: string } | null {
  const { imageId, stateDir } = params;
  // Allow only <64-hex>.<safe-ext> — no dots in the hash, one dot as separator
  if (!/^[a-f0-9]{64}\.[a-z]{2,4}$/.test(imageId)) {
    return null;
  }
  const filePath = path.join(chatImagesDir(stateDir), imageId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const ext = imageId.slice(65); // skip "<64 hex chars>."
  return { filePath, mimeType: mimeFromExt(ext) };
}

// ── Per-session metadata (image IDs keyed to message text hash) ──────────────

type MessageImageEntry = { hash: string; ids: string[] };

function metaPath(sessionId: string, stateDir: string): string {
  return path.join(chatImagesDir(stateDir), `${sessionId}.meta.jsonl`);
}

function textHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * Append image metadata for a sent user message to the session's sidecar file.
 * Called at chat.send time, before the agent prunes image blocks from history.
 */
export function recordChatMessageImages(params: {
  sessionId: string;
  messageText: string;
  imageIds: string[];
  stateDir: string;
}): void {
  const { sessionId, messageText, imageIds, stateDir } = params;
  if (imageIds.length === 0) {
    return;
  }
  const dir = chatImagesDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const entry: MessageImageEntry = { hash: textHash(messageText), ids: imageIds };
  fs.appendFileSync(metaPath(sessionId, stateDir), JSON.stringify(entry) + "\n", "utf-8");
}

function loadMeta(sessionId: string, stateDir: string): MessageImageEntry[] {
  const p = metaPath(sessionId, stateDir);
  if (!fs.existsSync(p)) {
    return [];
  }
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as MessageImageEntry];
      } catch {
        return [];
      }
    });
}

/** Extract text from a chat history message's content array. */
function extractMessageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (b): b is Record<string, unknown> =>
        typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text",
    )
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .join("\n");
}

/**
 * For each user message in history, look up saved image IDs (by text hash +
 * insertion order) and inject URL reference blocks so images render after reload.
 *
 * Background: `pruneProcessedHistoryImages` in attempt.ts removes inline image
 * blocks from already-answered turns on every run, so the transcript no longer
 * contains raw base64 after the first AI reply.  The metadata sidecar (written
 * at chat.send time) is the only durable source of the original image IDs.
 */
export function injectSavedImageUrls(
  messages: unknown[],
  sessionId: string,
  stateDir: string,
): unknown[] {
  const meta = loadMeta(sessionId, stateDir);
  if (meta.length === 0) {
    return messages;
  }

  // Track how many times each hash has been matched to handle duplicate texts.
  const usedCount = new Map<string, number>();

  return messages.map((message) => {
    if (typeof message !== "object" || message === null) {
      return message;
    }
    const m = message as Record<string, unknown>;
    if (m.role !== "user") {
      return message;
    }

    // Use text hash even when text is empty (image-only messages all share the
    // same empty-string hash, disambiguated by usedCount insertion order).
    const text = extractMessageText(m);
    const h = textHash(text);

    const used = usedCount.get(h) ?? 0;
    // Find the (used+1)-th occurrence of this hash in metadata
    let seen = 0;
    const entry = meta.find((e) => {
      if (e.hash !== h) {
        return false;
      }
      if (seen === used) {
        return true;
      }
      seen++;
      return false;
    });
    if (!entry || entry.ids.length === 0) {
      return message;
    }

    usedCount.set(h, used + 1);

    // Prepend image URL blocks to the message content
    const imageBlocks = entry.ids
      .filter((id) => resolveChatImageById({ imageId: id, stateDir }) !== null)
      .map((id) => ({ type: "image", url: `/chat-image/${id}` }));

    if (imageBlocks.length === 0) {
      return message;
    }

    const existingContent = Array.isArray(m.content) ? m.content : [];
    return { ...m, content: [...imageBlocks, ...existingContent] };
  });
}

/**
 * Safety-net: for any user message that still has inline base64 image data
 * (e.g. first history load before agent pruning happens), lazily save to disk
 * and replace with URL refs.  Handles both pi-agent-core format
 * `{ type:"image", data, mimeType }` and Anthropic source format
 * `{ type:"image", source:{ type:"base64", data, media_type } }`.
 */
export function inlineImagesToUrls(messages: unknown[], stateDir: string): unknown[] {
  return messages.map((message) => {
    if (typeof message !== "object" || message === null) {
      return message;
    }
    const m = message as Record<string, unknown>;
    if (m.role !== "user") {
      return message;
    }
    const content = m.content;
    if (!Array.isArray(content)) {
      return message;
    }

    let hasInlineImage = false;
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;
      if (b.type === "image") {
        if (typeof b.data === "string") {
          hasInlineImage = true;
          break;
        }
        const src = b.source as Record<string, unknown> | undefined;
        if (src?.type === "base64" && typeof src.data === "string") {
          hasInlineImage = true;
          break;
        }
      }
    }
    if (!hasInlineImage) {
      return message;
    }

    const newContent = content.map((block) => {
      if (typeof block !== "object" || block === null) {
        return block;
      }
      const b = block as Record<string, unknown>;
      if (b.type !== "image") {
        return block;
      }
      try {
        if (typeof b.data === "string") {
          const mimeType = typeof b.mimeType === "string" ? b.mimeType : "image/png";
          const imageId = saveChatImageSync({
            data: Buffer.from(b.data, "base64"),
            mimeType,
            stateDir,
          });
          return { type: "image", url: `/chat-image/${imageId}`, mimeType };
        }
        const src = b.source as Record<string, unknown> | undefined;
        if (src?.type === "base64" && typeof src.data === "string") {
          const mimeType = typeof src.media_type === "string" ? src.media_type : "image/png";
          const imageId = saveChatImageSync({
            data: Buffer.from(src.data, "base64"),
            mimeType,
            stateDir,
          });
          return { type: "image", url: `/chat-image/${imageId}`, mimeType };
        }
      } catch {
        /* keep original on error */
      }
      return block;
    });
    return { ...m, content: newContent };
  });
}
