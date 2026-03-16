import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { AssistantIdentity } from "../assistant-identity.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";
import { detectTextDirection } from "../text-direction.ts";
import type { MessageGroup } from "../types/chat-types.ts";
import { renderCopyAsMarkdownButton } from "./copy-as-markdown.ts";
import {
  extractTextCached,
  extractThinkingCached,
  formatReasoningMarkdown,
} from "./message-extract.ts";
import { isToolResultMessage, normalizeRoleForGrouping } from "./message-normalizer.ts";
import { extractToolCards, renderToolCardSidebar } from "./tool-cards.ts";

type ImageBlock = {
  url: string;
  alt?: string;
};

type DocumentBlock = {
  fileName: string;
  mimeType: string;
  content?: string;
};

type DocTypeInfo = { label: string; cssClass: string };

function docTypeInfo(fileName: string, mimeType: string): DocTypeInfo {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const m = mimeType.toLowerCase();
  if (m === "application/pdf" || ext === "pdf") {
    return { label: "PDF", cssClass: "doc-type--pdf" };
  }
  if (
    m.includes("wordprocessingml") ||
    m === "application/msword" ||
    ext === "docx" ||
    ext === "doc"
  ) {
    return { label: "Word", cssClass: "doc-type--word" };
  }
  if (m.includes("spreadsheetml") || m.includes("ms-excel") || ext === "xlsx" || ext === "xls") {
    return { label: ext === "xls" ? "XLS" : "Excel", cssClass: "doc-type--excel" };
  }
  if (ext === "csv" || m === "text/csv") {
    return { label: "CSV", cssClass: "doc-type--excel" };
  }
  if (
    m.includes("presentationml") ||
    m.includes("ms-powerpoint") ||
    ext === "pptx" ||
    ext === "ppt"
  ) {
    return { label: "Slides", cssClass: "doc-type--pptx" };
  }
  if (m === "application/json" || ext === "json" || ext === "ts" || ext === "js") {
    return { label: ext.toUpperCase() || "Code", cssClass: "doc-type--code" };
  }
  if (ext === "md" || ext === "markdown") {
    return { label: "MD", cssClass: "doc-type--code" };
  }
  if (m.startsWith("text/") || ext === "txt") {
    return { label: "TXT", cssClass: "doc-type--text" };
  }
  return { label: ext.toUpperCase() || "FILE", cssClass: "doc-type--default" };
}

function extractDocumentBlocks(message: unknown): DocumentBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const docs: DocumentBlock[] = [];

  if (!Array.isArray(content)) {
    return docs;
  }
  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue;
    }
    const b = block as Record<string, unknown>;
    if (b.type === "document") {
      docs.push({
        fileName: typeof b.fileName === "string" ? b.fileName : "document",
        mimeType: typeof b.mimeType === "string" ? b.mimeType : "",
      });
    }
  }
  return docs;
}

function extractImages(message: unknown): ImageBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const images: ImageBlock[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;

      if (b.type === "image") {
        // Local display format (from sendChatMessage, before history sync)
        const source = b.source as Record<string, unknown> | undefined;
        if (source?.type === "base64" && typeof source.data === "string") {
          const data = source.data;
          const mediaType = (source.media_type as string) || "image/png";
          const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
          images.push({ url });
        } else if (typeof b.data === "string") {
          // pi-ai / session transcript format: { type: "image", data: "base64…", mimeType: "image/png" }
          const mimeType = typeof b.mimeType === "string" ? b.mimeType : "image/png";
          const url = b.data.startsWith("data:") ? b.data : `data:${mimeType};base64,${b.data}`;
          images.push({ url });
        } else if (typeof b.url === "string") {
          images.push({ url: b.url });
        }
      } else if (b.type === "image_url") {
        // OpenAI format
        const imageUrl = b.image_url as Record<string, unknown> | undefined;
        if (typeof imageUrl?.url === "string") {
          images.push({ url: imageUrl.url });
        }
      }
    }
  }

  return images;
}

/**
 * For user messages loaded from history, the server injects document content as
 * `<document filename="…">…</document>` XML blocks into the message text.
 * Strip them from the display text and return their filenames for chip rendering.
 */
function stripDocumentBlocksFromText(text: string): { cleanText: string; docs: DocumentBlock[] } {
  const docs: DocumentBlock[] = [];
  const cleanText = text
    .replace(
      /<document filename="([^"]*)">([\s\S]*?)<\/document>/g,
      (_, fileName: string, body: string) => {
        docs.push({ fileName, mimeType: "", content: body.trim() });
        return "";
      },
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanText, docs };
}

export function renderReadingIndicatorGroup(assistant?: AssistantIdentity) {
  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant)}
      <div class="chat-group-messages">
        <div class="chat-bubble chat-reading-indicator" aria-hidden="true">
          <span class="chat-reading-indicator__dots">
            <span></span><span></span><span></span>
          </span>
        </div>
      </div>
    </div>
  `;
}

export function renderStreamingGroup(
  text: string,
  startedAt: number,
  onOpenSidebar?: (content: string) => void,
  assistant?: AssistantIdentity,
) {
  const timestamp = new Date(startedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const name = assistant?.name ?? "Assistant";

  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant)}
      <div class="chat-group-messages">
        ${renderGroupedMessage(
          {
            role: "assistant",
            content: [{ type: "text", text }],
            timestamp: startedAt,
          },
          { isStreaming: true, showReasoning: false },
          onOpenSidebar,
        )}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${name}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

export function renderMessageGroup(
  group: MessageGroup,
  opts: {
    onOpenSidebar?: (content: string) => void;
    showReasoning: boolean;
    assistantName?: string;
    assistantAvatar?: string | null;
  },
) {
  const normalizedRole = normalizeRoleForGrouping(group.role);
  const assistantName = opts.assistantName ?? "Assistant";
  const userLabel = group.senderLabel?.trim();
  const who =
    normalizedRole === "user"
      ? (userLabel ?? "You")
      : normalizedRole === "assistant"
        ? assistantName
        : normalizedRole;
  const roleClass =
    normalizedRole === "user" ? "user" : normalizedRole === "assistant" ? "assistant" : "other";
  const timestamp = new Date(group.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return html`
    <div class="chat-group ${roleClass}">
      ${renderAvatar(group.role, {
        name: assistantName,
        avatar: opts.assistantAvatar ?? null,
      })}
      <div class="chat-group-messages">
        ${group.messages.map((item, index) =>
          renderGroupedMessage(
            item.message,
            {
              isStreaming: group.isStreaming && index === group.messages.length - 1,
              showReasoning: opts.showReasoning,
            },
            opts.onOpenSidebar,
          ),
        )}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${who}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

function renderAvatar(role: string, assistant?: Pick<AssistantIdentity, "name" | "avatar">) {
  const normalized = normalizeRoleForGrouping(role);
  const assistantName = assistant?.name?.trim() || "Assistant";
  const assistantAvatar = assistant?.avatar?.trim() || "";
  const initial =
    normalized === "user"
      ? "U"
      : normalized === "assistant"
        ? assistantName.charAt(0).toUpperCase() || "A"
        : normalized === "tool"
          ? "⚙"
          : "?";
  const className =
    normalized === "user"
      ? "user"
      : normalized === "assistant"
        ? "assistant"
        : normalized === "tool"
          ? "tool"
          : "other";

  if (assistantAvatar && normalized === "assistant") {
    if (isAvatarUrl(assistantAvatar)) {
      return html`<img
        class="chat-avatar ${className}"
        src="${assistantAvatar}"
        alt="${assistantName}"
      />`;
    }
    return html`<div class="chat-avatar ${className}">${assistantAvatar}</div>`;
  }

  return html`<div class="chat-avatar ${className}">${initial}</div>`;
}

function isAvatarUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/") // Relative paths from avatar endpoint
  );
}

function renderMessageImages(images: ImageBlock[]) {
  if (images.length === 0) {
    return nothing;
  }

  const openImage = (url: string) => {
    openExternalUrlSafe(url, { allowDataImage: true });
  };

  return html`
    <div class="chat-message-images">
      ${images.map(
        (img) => html`
          <img
            src=${img.url}
            alt=${img.alt ?? "Attached image"}
            class="chat-message-image"
            @click=${() => openImage(img.url)}
          />
        `,
      )}
    </div>
  `;
}

function renderMessageDocuments(docs: DocumentBlock[], onOpenSidebar?: (content: string) => void) {
  if (docs.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-message-docs">
      ${docs.map((doc) => {
        const { label, cssClass } = docTypeInfo(doc.fileName, doc.mimeType);
        const preview = doc.content ? doc.content.replace(/\s+/g, " ").trim().slice(0, 120) : null;
        const canView = Boolean(doc.content) && Boolean(onOpenSidebar);
        const handleClick = canView ? () => onOpenSidebar!(doc.content!) : undefined;
        const handleKey = canView
          ? (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenSidebar!(doc.content!);
              }
            }
          : undefined;
        return html`
          <div
            class="chat-message-doc-card ${cssClass}${canView ? " clickable" : ""}"
            role=${canView ? "button" : "presentation"}
            tabindex=${canView ? "0" : "-1"}
            title=${canView ? `View ${doc.fileName}` : doc.fileName}
            @click=${handleClick}
            @keydown=${handleKey}
          >
            <div class="chat-message-doc-type-badge">
              ${icons.fileText}
              <span class="chat-message-doc-ext">${label}</span>
            </div>
            <div class="chat-message-doc-body">
              <span class="chat-message-doc-name">${doc.fileName}</span>
              ${preview ? html`<span class="chat-message-doc-preview">${preview}</span>` : nothing}
            </div>
            ${
              canView
                ? html`<div class="chat-message-doc-view-btn" aria-hidden="true">
                  ${icons.chevronRight}
                </div>`
                : nothing
            }
          </div>
        `;
      })}
    </div>
  `;
}

function renderGroupedMessage(
  message: unknown,
  opts: { isStreaming: boolean; showReasoning: boolean },
  onOpenSidebar?: (content: string) => void,
) {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "unknown";
  const isToolResult =
    isToolResultMessage(message) ||
    role.toLowerCase() === "toolresult" ||
    role.toLowerCase() === "tool_result" ||
    typeof m.toolCallId === "string" ||
    typeof m.tool_call_id === "string";

  const toolCards = extractToolCards(message);
  const hasToolCards = toolCards.length > 0;
  const images = extractImages(message);
  const hasImages = images.length > 0;

  // Content-block docs (local display format, pre-sync)
  const contentDocBlocks = extractDocumentBlocks(message);

  const extractedText = extractTextCached(message);
  const extractedThinking =
    opts.showReasoning && role === "assistant" ? extractThinkingCached(message) : null;

  // For user messages: strip <document> XML injected for the AI and surface as chips.
  // For non-user messages: pass text through unchanged.
  let displayText = extractedText;
  let textDocBlocks: DocumentBlock[] = [];
  if (role === "user" && extractedText?.includes("<document ")) {
    const { cleanText, docs } = stripDocumentBlocksFromText(extractedText);
    displayText = cleanText || null;
    textDocBlocks = docs;
  }

  // Merge: content-block chips (local) + text-parsed chips (history). Dedupe by filename.
  const seenFileNames = new Set<string>();
  const docBlocks: DocumentBlock[] = [];
  for (const doc of [...contentDocBlocks, ...textDocBlocks]) {
    if (!seenFileNames.has(doc.fileName)) {
      seenFileNames.add(doc.fileName);
      docBlocks.push(doc);
    }
  }
  const hasDocuments = docBlocks.length > 0;

  const markdownBase = displayText?.trim() ? displayText : null;
  const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking) : null;
  const markdown = markdownBase;
  const canCopyMarkdown = role === "assistant" && Boolean(markdown?.trim());

  const bubbleClasses = [
    "chat-bubble",
    canCopyMarkdown ? "has-copy" : "",
    opts.isStreaming ? "streaming" : "",
    "fade-in",
  ]
    .filter(Boolean)
    .join(" ");

  if (!markdown && hasToolCards && isToolResult) {
    return html`${toolCards.map((card) => renderToolCardSidebar(card, onOpenSidebar))}`;
  }

  if (!markdown && !hasToolCards && !hasImages && !hasDocuments) {
    return nothing;
  }

  return html`
    <div class="${bubbleClasses}">
      ${canCopyMarkdown ? renderCopyAsMarkdownButton(markdown!) : nothing}
      ${renderMessageDocuments(docBlocks, onOpenSidebar)}
      ${renderMessageImages(images)}
      ${
        reasoningMarkdown
          ? html`<div class="chat-thinking">${unsafeHTML(
              toSanitizedMarkdownHtml(reasoningMarkdown),
            )}</div>`
          : nothing
      }
      ${
        markdown
          ? html`<div class="chat-text" dir="${detectTextDirection(markdown)}">${unsafeHTML(toSanitizedMarkdownHtml(markdown))}</div>`
          : nothing
      }
      ${toolCards.map((card) => renderToolCardSidebar(card, onOpenSidebar))}
    </div>
  `;
}
