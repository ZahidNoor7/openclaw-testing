import { html, nothing } from "lit";
import type { OrgApiKey, OrganizationConfig } from "../../../../src/config/types.openclaw.js";

/** The default/admin org ID. Only this org can create orgs and see all orgs. */
const DEFAULT_ORG_ID = "openclaw";

/**
 * Sentinel value used by the gateway to redact sensitive config fields.
 * The `key` field of each providerKey entry will always arrive as this value
 * since it is marked sensitive.  We detect it to show a safe placeholder.
 */
const REDACTED_SENTINEL = "__OPENCLAW_REDACTED__";

type ProviderDef = { id: string; label: string; placeholder: string };

const PROVIDERS: ProviderDef[] = [
  { id: "openai", label: "OpenAI", placeholder: "sk-…" },
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-api03-…" },
  { id: "gemini", label: "Google Gemini", placeholder: "AIzaSy…" },
  { id: "xai", label: "xAI (Grok)", placeholder: "xai-…" },
  { id: "deepseek", label: "DeepSeek", placeholder: "sk-…" },
  { id: "groq", label: "Groq", placeholder: "gsk_…" },
  { id: "mistral", label: "Mistral AI", placeholder: "…" },
  { id: "cohere", label: "Cohere", placeholder: "…" },
  { id: "kimi", label: "Kimi (Moonshot)", placeholder: "sk-…" },
  { id: "nanobana", label: "Nano Bana", placeholder: "nb-…" },
  { id: "perplexity", label: "Perplexity", placeholder: "pplx-…" },
  { id: "together", label: "Together AI", placeholder: "…" },
  { id: "fireworks", label: "Fireworks AI", placeholder: "…" },
  { id: "ollama", label: "Ollama (local)", placeholder: "http://localhost:11434" },
];

function providerLabel(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

function providerPlaceholder(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.placeholder ?? "…";
}

export type OrganizationsProps = {
  loading: boolean;
  saving: boolean;
  /** Whether the gateway WebSocket is currently connected */
  connected: boolean;
  lastError: string | null;
  organizations: OrganizationConfig[];
  activeOrganizationId: string | null;
  /** Create form state */
  createName: string;
  createId: string;
  createDescription: string;
  /** Admin account fields for new org */
  createAdminName: string;
  createEmail: string;
  createPassword: string;
  createPasswordShow: boolean;
  /** Multi-key state for create form */
  createApiKeys: OrgApiKey[];
  createApiKeyProvider: string;
  createApiKeyLabel: string;
  createApiKeyValue: string;
  createApiKeyShowValue: boolean;
  /** Edit form state */
  editingId: string | null;
  editName: string;
  editDescription: string;
  /** Multi-key state for edit form */
  editApiKeyProvider: string;
  editApiKeyLabel: string;
  editApiKeyValue: string;
  editApiKeyShowValue: boolean;
  /** Set of key IDs whose values are currently revealed */
  keyShowIds: Set<string>;
  /** Inline replace-key state */
  replaceKeyId: string | null;
  replaceKeyValue: string;
  replaceKeyShowValue: boolean;
  /** Callbacks */
  onRefresh: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateNameChange: (val: string) => void;
  onCreateIdChange: (val: string) => void;
  onCreateDescriptionChange: (val: string) => void;
  onCreateAdminNameChange: (val: string) => void;
  onCreateEmailChange: (val: string) => void;
  onCreatePasswordChange: (val: string) => void;
  onCreatePasswordToggleShow: () => void;
  onCreate: () => void;
  onEditStart: (org: OrganizationConfig) => void;
  onEditCancel: () => void;
  onEditNameChange: (val: string) => void;
  onEditDescriptionChange: (val: string) => void;
  /** Admin credentials for the org being edited */
  editAdminEmail: string;
  editAdminPassword: string;
  editAdminPasswordShow: boolean;
  onEditAdminEmailChange: (val: string) => void;
  onEditAdminPasswordChange: (val: string) => void;
  onEditAdminPasswordToggleShow: () => void;
  onUpdate: () => void;
  // Multi-key callbacks — create form
  onCreateApiKeyProviderChange: (val: string) => void;
  onCreateApiKeyLabelChange: (val: string) => void;
  onCreateApiKeyValueChange: (val: string) => void;
  onCreateApiKeyToggleShow: () => void;
  onCreateApiKeyAdd: () => void;
  onCreateApiKeyRemove: (keyId: string) => void;
  // Multi-key callbacks — edit form
  onEditApiKeyProviderChange: (val: string) => void;
  onEditApiKeyLabelChange: (val: string) => void;
  onEditApiKeyValueChange: (val: string) => void;
  onEditApiKeyToggleShow: () => void;
  onEditApiKeyAdd: (orgId: string) => void;
  onEditApiKeyRemove: (orgId: string, keyId: string) => void;
  onEditApiKeyToggleEnabled: (orgId: string, keyId: string, enabled: boolean) => void;
  onToggleKeyShow: (keyId: string) => void;
  // Replace key inline callbacks
  onStartReplaceKey: (keyId: string) => void;
  onCancelReplaceKey: () => void;
  onReplaceKeyValueChange: (val: string) => void;
  onReplaceKeyToggleShow: () => void;
  onConfirmReplaceKey: (orgId: string, keyId: string, newValue: string) => void;
  /** Whether the current session user is a super admin */
  isSuperAdmin: boolean;
  /** Users per org, populated by onLoadUsers */
  orgUsers: Record<
    string,
    Array<{ id: string; email: string; displayName: string; status: string; role: string }>
  >;
  /** Which org's user list is expanded */
  expandedUsersOrgId: string | null;
  onLoadUsers: (orgId: string) => void;
  onToggleUsers: (orgId: string) => void;
  onActivateOrg: (orgId: string) => void;
  onSuspendOrg: (orgId: string) => void;
};

function eyeIcon(open: boolean) {
  return open
    ? html`
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="display: block"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      `
    : html`
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="display: block"
        >
          <path
            d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"
          />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      `;
}

function slugify(name: string): string {
  return (
    "org_" +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48)
  );
}

function formatDate(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Mask an API key: show first 4 and last 4 chars. */
function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return "••••••••";
  }
  return `${key.slice(0, 4)}${"•".repeat(Math.min(key.length - 8, 12))}${key.slice(-4)}`;
}

export function renderOrganizations(props: OrganizationsProps) {
  const rootOrgId =
    props.organizations.find((o) => o.id === DEFAULT_ORG_ID)?.id ??
    props.organizations[0]?.id ??
    null;

  const isAdminOrg =
    !props.activeOrganizationId || (rootOrgId !== null && props.activeOrganizationId === rootOrgId);
  const visibleOrgs = isAdminOrg
    ? props.organizations
    : props.organizations.filter((o) => o.id === props.activeOrganizationId);
  const hasOrgs = visibleOrgs.length > 0;

  return html`
    <style>
      .org-page { display: flex; flex-direction: column; gap: 20px; }

      .org-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
      }

      .org-card {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 10px);
        background: var(--card);
        overflow: hidden;
        transition: border-color 0.15s ease;
      }
      .org-card:hover { border-color: var(--border-strong); }
      .org-card.org-card--active {
        border-color: var(--accent, var(--ring));
        box-shadow: 0 0 0 1px var(--accent, var(--ring));
      }

      .org-card-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 18px 14px;
      }
      .org-card-info { flex: 1; min-width: 0; }
      .org-card-name {
        font-size: 15px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .org-card-id {
        font-size: 11px;
        color: var(--text-muted, var(--muted));
        font-family: var(--font-mono, monospace);
        margin-top: 3px;
      }
      .org-card-desc {
        font-size: 12px;
        color: var(--text-muted, var(--muted));
        margin-top: 6px;
        line-height: 1.5;
      }
      .org-card-meta {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 8px;
        flex-wrap: wrap;
      }
      .org-meta-item {
        font-size: 11px;
        color: var(--text-muted, var(--muted));
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .org-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      /* Inline edit panel */
      .org-edit-panel {
        border-top: 1px solid var(--border);
        padding: 16px 18px;
        background: var(--bg-subtle, var(--bg));
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .org-edit-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-muted, var(--muted));
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .org-edit-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      @media (max-width: 560px) {
        .org-edit-grid { grid-template-columns: 1fr; }
      }
      .org-edit-field { display: flex; flex-direction: column; gap: 4px; }
      .org-edit-field--full { grid-column: 1 / -1; }
      .org-edit-label {
        font-size: 11px;
        color: var(--text-muted, var(--muted));
        font-weight: 500;
      }
      .org-edit-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
      }

      /* Create form card */
      .org-create-card {
        border: 1px dashed var(--border);
        border-radius: var(--radius-lg, 10px);
        padding: 20px 18px;
        background: var(--card);
      }
      .org-create-title {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .org-create-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      @media (max-width: 560px) {
        .org-create-grid { grid-template-columns: 1fr; }
      }
      .org-create-field { display: flex; flex-direction: column; gap: 4px; }
      .org-create-field--full { grid-column: 1 / -1; }
      .org-create-label {
        font-size: 11px;
        color: var(--text-muted, var(--muted));
        font-weight: 500;
      }
      .org-create-section-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, #888);
        margin-bottom: 10px;
      }
      .org-create-divider {
        border: none;
        border-top: 1px solid var(--border, #262626);
        margin: 14px 0;
      }
      .org-create-footer {
        margin-top: 14px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      /* API Key section */
      .keys-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .keys-section-title {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted, var(--muted));
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 2px;
      }

      /* Key list */
      .key-list { display: flex; flex-direction: column; gap: 6px; }
      .key-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--card);
        transition: border-color 0.12s;
      }
      .key-row:hover { border-color: var(--border-strong); }
      .key-row--disabled { opacity: 0.55; }
      .key-row--replacing {
        flex-wrap: wrap;
        align-items: flex-start;
        border-color: var(--accent, #6366f1);
        background: color-mix(in srgb, var(--accent, #6366f1) 4%, var(--card));
      }
      .key-provider-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
        color: var(--accent, #6366f1);
        border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 28%, transparent);
        white-space: nowrap;
        flex-shrink: 0;
      }
      .key-label {
        font-size: 12px;
        color: var(--text-muted, var(--muted));
        flex-shrink: 0;
        max-width: 100px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .key-value {
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        color: var(--text);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: text;
      }
      .key-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      /* Toggle switch */
      .toggle-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      .toggle {
        position: relative;
        width: 32px;
        height: 18px;
        flex-shrink: 0;
      }
      .toggle input {
        opacity: 0;
        width: 0;
        height: 0;
        position: absolute;
      }
      .toggle-track {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: var(--border-strong, #444);
        cursor: pointer;
        transition: background 0.15s;
      }
      .toggle input:checked + .toggle-track {
        background: var(--accent, #6366f1);
      }
      .toggle-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        transition: transform 0.15s;
        pointer-events: none;
      }
      .toggle input:checked ~ .toggle-thumb {
        transform: translateX(14px);
      }

      /* Equal-height inputs and selects */
      .input, select.input {
        box-sizing: border-box;
        height: 36px;
        line-height: 1.4;
      }

      /* Key add form */
      .key-add-form {
        display: grid;
        grid-template-columns: 160px 1fr auto;
        gap: 8px;
        align-items: end;
        padding: 10px;
        border: 1px dashed var(--border);
        border-radius: 8px;
        background: var(--bg-subtle, var(--bg));
      }
      @media (max-width: 600px) {
        .key-add-form { grid-template-columns: 1fr; }
      }
      .key-add-field { display: flex; flex-direction: column; gap: 3px; }
      .key-add-label {
        font-size: 10px;
        color: var(--text-muted, var(--muted));
        font-weight: 500;
      }
      .key-add-value-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }
      .key-add-value-wrap .input {
        padding-right: 36px;
        width: 100%;
      }
      .key-show-btn {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text-muted, var(--muted));
        padding: 2px;
        font-size: 13px;
        line-height: 1;
        display: flex;
        align-items: center;
      }
      .key-show-btn:hover { color: var(--text); }
      .key-add-actions {
        display: flex;
        gap: 6px;
        align-items: flex-end;
        padding-bottom: 1px;
      }

      /* Inline key-replace form */
      .key-replace-col {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        padding: 4px 0 2px;
      }
      .key-replace-wrap {
        position: relative;
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
      }
      .key-replace-wrap .input {
        padding-right: 34px;
        width: 100%;
        font-size: 12px;
        height: 30px;
      }
      .key-replace-show-btn {
        position: absolute;
        right: 5px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text-muted, var(--muted));
        font-size: 12px;
        padding: 2px;
        line-height: 1;
      }
      .key-replace-show-btn:hover { color: var(--text); }

      /* Save/reconnect overlay */
      .org-status-overlay {
        position: fixed;
        inset: 0;
        z-index: 9997;
        background: rgba(0,0,0,0.45);
        backdrop-filter: blur(3px);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .org-status-box {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 28px 36px;
        text-align: center;
        min-width: 200px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      .org-status-spinner {
        width: 28px;
        height: 28px;
        border: 3px solid color-mix(in srgb, var(--accent, #6366f1) 25%, transparent);
        border-top-color: var(--accent, #6366f1);
        border-radius: 50%;
        animation: org-spin 0.7s linear infinite;
      }
      @keyframes org-spin { to { transform: rotate(360deg); } }
      .org-status-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
      }
      .org-status-sub {
        font-size: 11px;
        color: var(--text-muted, var(--muted));
        margin-top: -4px;
      }

      .badge-active {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: var(--radius-full, 999px);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        background: color-mix(in srgb, var(--accent, var(--ok)) 15%, transparent);
        color: var(--accent, var(--ok));
        border: 1px solid color-mix(in srgb, var(--accent, var(--ok)) 35%, transparent);
      }

      .badge-status-active {
        display: inline-flex; align-items: center; padding: 2px 7px;
        border-radius: 999px; font-size: 10px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.05em;
        background: color-mix(in srgb, #22c55e 12%, transparent);
        color: #22c55e;
        border: 1px solid color-mix(in srgb, #22c55e 30%, transparent);
      }
      .badge-status-suspended {
        display: inline-flex; align-items: center; padding: 2px 7px;
        border-radius: 999px; font-size: 10px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.05em;
        background: color-mix(in srgb, #ef4444 12%, transparent);
        color: #ef4444;
        border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
      }

      .org-users-panel {
        border-top: 1px solid var(--border);
        padding: 12px 18px;
        background: var(--bg-subtle, var(--bg));
      }
      .org-users-title {
        font-size: 11px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.06em; color: var(--text-muted, var(--muted));
        margin-bottom: 8px;
      }
      .org-user-row {
        display: flex; align-items: center; gap: 10px; padding: 5px 0;
        border-bottom: 1px solid var(--border); font-size: 12px;
      }
      .org-user-row:last-child { border-bottom: none; }
      .org-user-email { flex: 1; color: var(--text); }
      .org-user-name { color: var(--text-muted, var(--muted)); font-size: 11px; }

      .org-empty {
        text-align: center;
        padding: 40px 20px;
        color: var(--text-muted, var(--muted));
      }
      .org-empty-icon {
        font-size: 32px;
        margin-bottom: 10px;
        opacity: 0.4;
      }
      .org-empty-text { font-size: 14px; margin-bottom: 4px; }
      .org-empty-sub { font-size: 12px; opacity: 0.7; }
    </style>

    <!-- Save / reconnect overlay -->
    ${
      props.saving || !props.connected
        ? html`
          <div class="org-status-overlay">
            <div class="org-status-box">
              <div class="org-status-spinner"></div>
              <div class="org-status-label">${props.saving ? "Saving changes…" : "Reconnecting…"}</div>
              <div class="org-status-sub">${props.saving ? "Applying config, gateway will restart." : "Waiting for gateway to come back online."}</div>
            </div>
          </div>
        `
        : nothing
    }

    <div class="org-page">
      <!-- Header -->
      <div class="org-header-row">
        <div>
          <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;">Organizations</div>
          <div style="font-size:12px;color:var(--text-muted,var(--muted));margin-top:3px;">
            Manage tenants — each org has isolated agents, sessions, and chat history.
          </div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      ${props.lastError ? html`<div class="callout danger">${props.lastError}</div>` : nothing}

      <!-- Org list -->
      ${
        hasOrgs
          ? html`<div style="display:flex;flex-direction:column;gap:10px;">
            ${visibleOrgs.map((org) => renderOrgCard(org, props, isAdminOrg, rootOrgId, props.isSuperAdmin))}
          </div>`
          : html`
              <div class="org-empty">
                <div class="org-empty-icon">🏢</div>
                <div class="org-empty-text">No organizations yet</div>
                <div class="org-empty-sub">Create one below to get started with multi-tenancy.</div>
              </div>
            `
      }

      <!-- Create form — admin only -->
      ${isAdminOrg ? renderCreateForm(props) : nothing}
    </div>
  `;
}

function renderToggle(checked: boolean, onChange: (val: boolean) => void, disabled = false) {
  return html`
    <label class="toggle" title=${checked ? "Enabled" : "Disabled"}>
      <input
        type="checkbox"
        ?checked=${checked}
        ?disabled=${disabled}
        @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span class="toggle-track"></span>
      <span class="toggle-thumb"></span>
    </label>
  `;
}

function renderKeyList(
  keys: OrgApiKey[],
  props: OrganizationsProps,
  orgId: string | null,
  opts: {
    allowToggle: boolean;
    allowDelete: boolean;
    onRemove?: (keyId: string) => void;
  },
) {
  if (keys.length === 0) {
    return html`
      <div style="font-size: 12px; color: var(--text-muted, var(--muted)); padding: 6px 0">
        No API keys configured.
      </div>
    `;
  }
  return html`
    <div class="key-list">
      ${keys.map((k) => {
        const isShown = props.keyShowIds.has(k.id);
        const keyIsRedacted = k.key === REDACTED_SENTINEL;
        const isReplacing = k.id === props.replaceKeyId;
        const onRemove = opts.onRemove
          ? () => opts.onRemove!(k.id)
          : orgId
            ? () => props.onEditApiKeyRemove(orgId, k.id)
            : null;

        // Inline replace form — replaces the key-value display when active
        const valueSection =
          isReplacing && orgId
            ? html`
              <div class="key-replace-col">
                <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;">
                  <span style="font-size:11px;color:var(--text-muted,var(--muted));">🔒</span>
                  <span style="font-size:10px;color:var(--text-muted,var(--muted));font-style:italic;">
                    Existing key is stored securely and cannot be displayed — enter a new value below to replace it.
                  </span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <div class="key-replace-wrap">
                    <input
                      class="input"
                      type=${props.replaceKeyShowValue ? "text" : "password"}
                      placeholder="Paste new ${providerLabel(k.provider)} key here…"
                      .value=${props.replaceKeyValue}
                      @input=${(e: Event) => props.onReplaceKeyValueChange((e.target as HTMLInputElement).value)}
                      autocomplete="off"
                      spellcheck="false"
                    />
                    <button type="button" class="key-replace-show-btn" title=${props.replaceKeyShowValue ? "Hide" : "Show"}
                      @click=${props.onReplaceKeyToggleShow}>${props.replaceKeyShowValue ? "🙈" : "👁"}</button>
                  </div>
                  <button
                    class="btn btn--sm btn-primary"
                    style="font-size:11px;white-space:nowrap;"
                    ?disabled=${!props.replaceKeyValue.trim() || props.saving}
                    @click=${() => props.onConfirmReplaceKey(orgId, k.id, props.replaceKeyValue)}
                  >Save</button>
                  <button
                    class="btn btn--sm"
                    style="font-size:11px;"
                    @click=${props.onCancelReplaceKey}
                  >Cancel</button>
                </div>
              </div>
            `
            : html`
              <span class="key-value">
                ${
                  keyIsRedacted
                    ? html`
                        <span style="opacity: 0.45; font-style: italic; font-size: 11px">stored securely</span>
                      `
                    : isShown
                      ? html`${k.key}`
                      : html`${maskApiKey(k.key)}`
                }
              </span>
            `;

        return html`
          <div class="key-row ${k.enabled ? "" : "key-row--disabled"} ${isReplacing ? "key-row--replacing" : ""}">
            <span class="key-provider-badge" style="flex-shrink:0;">${providerLabel(k.provider)}</span>
            ${k.label && !isReplacing ? html`<span class="key-label" title=${k.label}>${k.label}</span>` : nothing}
            ${valueSection}
            ${
              isReplacing
                ? nothing
                : html`
                <div class="key-actions">
                  ${
                    !keyIsRedacted
                      ? html`<button
                        class="btn btn--sm"
                        title=${isShown ? "Hide key" : "Reveal key"}
                        style="padding:2px 6px;font-size:13px;"
                        @click=${() => props.onToggleKeyShow(k.id)}
                      >${isShown ? "🙈" : "👁"}</button>`
                      : nothing
                  }
                  ${
                    keyIsRedacted && orgId
                      ? html`<button
                        class="btn btn--sm"
                        title="Replace key value"
                        style="padding:2px 6px;font-size:12px;"
                        ?disabled=${props.saving}
                        @click=${() => props.onStartReplaceKey(k.id)}
                      >✏️</button>`
                      : nothing
                  }
                  ${
                    opts.allowToggle && orgId
                      ? html`<div class="toggle-wrap" title=${k.enabled ? "Disable key" : "Enable key"}>
                        ${renderToggle(k.enabled, (val) => props.onEditApiKeyToggleEnabled(orgId, k.id, val), props.saving)}
                      </div>`
                      : nothing
                  }
                  ${
                    opts.allowDelete && onRemove
                      ? html`<button
                        class="btn btn--sm"
                        style="color:var(--error,#ef4444);border-color:color-mix(in srgb,var(--error,#ef4444) 30%,transparent);padding:2px 6px;"
                        ?disabled=${props.saving}
                        title="Remove key"
                        @click=${() => {
                          if (window.confirm(`Remove this ${providerLabel(k.provider)} key?`)) {
                            onRemove();
                          }
                        }}
                      >✕</button>`
                      : nothing
                  }
                </div>
              `
            }
          </div>
        `;
      })}
    </div>
  `;
}

function renderAddKeyForm(
  props: OrganizationsProps,
  mode: "create" | "edit",
  orgId: string | null,
) {
  const provider = mode === "create" ? props.createApiKeyProvider : props.editApiKeyProvider;
  const label = mode === "create" ? props.createApiKeyLabel : props.editApiKeyLabel;
  const value = mode === "create" ? props.createApiKeyValue : props.editApiKeyValue;
  const showValue = mode === "create" ? props.createApiKeyShowValue : props.editApiKeyShowValue;

  const onProviderChange =
    mode === "create" ? props.onCreateApiKeyProviderChange : props.onEditApiKeyProviderChange;
  const onLabelChange =
    mode === "create" ? props.onCreateApiKeyLabelChange : props.onEditApiKeyLabelChange;
  const onValueChange =
    mode === "create" ? props.onCreateApiKeyValueChange : props.onEditApiKeyValueChange;
  const onToggleShow =
    mode === "create" ? props.onCreateApiKeyToggleShow : props.onEditApiKeyToggleShow;

  const placeholder = providerPlaceholder(provider);
  const canAdd = value.trim().length > 0;

  return html`
    <div class="key-add-form">
      <div class="key-add-field">
        <label class="key-add-label">Provider</label>
        <select
          class="input"
          style="font-size:12px;"
          .value=${provider}
          @change=${(e: Event) => onProviderChange((e.target as HTMLSelectElement).value)}
        >
          ${PROVIDERS.map((p) => html`<option value=${p.id} ?selected=${p.id === provider}>${p.label}</option>`)}
        </select>
      </div>
      <div class="key-add-field" style="min-width:0;">
        <label class="key-add-label">API Key *</label>
        <div class="key-add-value-wrap">
          <input
            class="input"
            type=${showValue ? "text" : "password"}
            placeholder=${placeholder}
            .value=${value}
            @input=${(e: Event) => onValueChange((e.target as HTMLInputElement).value)}
            autocomplete="off"
            spellcheck="false"
          />
          <button
            type="button"
            class="key-show-btn"
            title=${showValue ? "Hide" : "Show"}
            @click=${onToggleShow}
          >${showValue ? "🙈" : "👁"}</button>
        </div>
      </div>
      <div class="key-add-field" style="min-width:80px;max-width:130px;">
        <label class="key-add-label">Label (optional)</label>
        <input
          class="input"
          type="text"
          style="font-size:12px;"
          placeholder="e.g. prod"
          .value=${label}
          @input=${(e: Event) => onLabelChange((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="key-add-actions">
        <button
          class="btn btn--sm btn-primary"
          ?disabled=${!canAdd || props.saving}
          @click=${() => {
            if (mode === "create") {
              props.onCreateApiKeyAdd();
            } else if (orgId) {
              props.onEditApiKeyAdd(orgId);
            }
          }}
        >Add Key</button>
      </div>
    </div>
  `;
}

function renderOrgCard(
  org: OrganizationConfig,
  props: OrganizationsProps,
  isAdminOrg: boolean,
  rootOrgId: string | null,
  isSuperAdmin: boolean,
) {
  const isActive = org.id === props.activeOrganizationId;
  const isEditing = org.id === props.editingId;
  const canEdit = isSuperAdmin || org.id === props.activeOrganizationId;
  const canDelete = isAdminOrg && org.id !== rootOrgId;
  const isSuspended = (org as OrganizationConfig & { status?: string }).status === "suspended";
  const isUsersExpanded = props.expandedUsersOrgId === org.id;
  const orgUsers = props.orgUsers[org.id] ?? null;
  // Merge both providerKeys and legacy apiKeys so existing configs display correctly.
  const apiKeys = [...(org.providerKeys ?? []), ...(org.apiKeys ?? [])];
  const enabledKeyCount = apiKeys.filter((k) => k.enabled).length;

  return html`
    <div class="org-card ${isActive ? "org-card--active" : ""}">
      <div class="org-card-top">
        <div class="org-card-info">
          <div class="org-card-name">
            ${org.name}
            ${
              isActive
                ? html`
                    <span class="badge-active">active</span>
                  `
                : nothing
            }
            ${
              isSuspended
                ? html`
                    <span class="badge-status-suspended">Suspended</span>
                  `
                : html`
                    <span class="badge-status-active">Active</span>
                  `
            }
          </div>
          <div class="org-card-id">${org.id}</div>
          ${org.description ? html`<div class="org-card-desc">${org.description}</div>` : nothing}
          <div class="org-card-meta">
            ${
              org.createdAt
                ? html`<span class="org-meta-item">
                  <span style="opacity:0.5;">Created</span>
                  ${formatDate(org.createdAt)}
                </span>`
                : nothing
            }
            ${
              apiKeys.length > 0
                ? html`<span class="org-meta-item" style="gap:5px;">
                  <span style="width:6px;height:6px;border-radius:50%;background:var(--ok,#22c55e);flex-shrink:0;display:inline-block;"></span>
                  ${enabledKeyCount}/${apiKeys.length} key${apiKeys.length !== 1 ? "s" : ""}
                </span>`
                : nothing
            }
          </div>
        </div>

        <div class="org-actions">
          ${
            !isActive
              ? html`<button
                class="btn btn--sm"
                ?disabled=${props.saving}
                @click=${() => props.onSwitch(org.id)}
              >Switch to</button>`
              : nothing
          }
          ${
            canEdit
              ? html`<button
                class="btn btn--sm"
                ?disabled=${props.saving}
                @click=${() => {
                  if (isEditing) {
                    props.onEditCancel();
                  } else {
                    props.onEditStart(org);
                  }
                }}
              >${isEditing ? "Cancel" : "Edit"}</button>`
              : nothing
          }
          ${
            canDelete
              ? html`<button
                class="btn btn--sm btn-danger"
                ?disabled=${props.saving}
                @click=${() => {
                  if (window.confirm(`Delete organization "${org.id}" (${org.name})?`)) {
                    props.onDelete(org.id);
                  }
                }}
              >Delete</button>`
              : nothing
          }
          ${
            isSuperAdmin && org.id !== rootOrgId
              ? isSuspended
                ? html`<button
                  class="btn btn--sm"
                  style="color:#22c55e;border-color:color-mix(in srgb,#22c55e 30%,transparent);"
                  ?disabled=${props.saving}
                  @click=${() => props.onActivateOrg(org.id)}
                >Activate</button>`
                : html`<button
                  class="btn btn--sm"
                  style="color:#ef4444;border-color:color-mix(in srgb,#ef4444 30%,transparent);"
                  ?disabled=${props.saving}
                  @click=${() => {
                    if (
                      window.confirm(
                        `Suspend organization "${org.name}"?\n\nAll active sessions will be invalidated.`,
                      )
                    ) {
                      props.onSuspendOrg(org.id);
                    }
                  }}
                >Suspend</button>`
              : nothing
          }
          ${
            isSuperAdmin
              ? html`<button
                class="btn btn--sm"
                ?disabled=${props.saving}
                @click=${() => {
                  props.onToggleUsers(org.id);
                  if (!isUsersExpanded && !orgUsers) {
                    props.onLoadUsers(org.id);
                  }
                }}
              >${isUsersExpanded ? "Hide users" : "Users"}</button>`
              : nothing
          }
        </div>
      </div>

      ${isEditing ? renderEditPanel(props, org) : nothing}
      ${isUsersExpanded ? renderUsersPanel(orgUsers) : nothing}
    </div>
  `;
}

function renderUsersPanel(
  users: Array<{
    id: string;
    email: string;
    displayName: string;
    status: string;
    role: string;
  }> | null,
) {
  if (!users) {
    return html`
      <div class="org-users-panel"><span style="font-size: 12px; opacity: 0.6">Loading users…</span></div>
    `;
  }
  if (users.length === 0) {
    return html`
      <div class="org-users-panel"><span style="font-size: 12px; opacity: 0.6">No users.</span></div>
    `;
  }
  return html`
    <div class="org-users-panel">
      <div class="org-users-title">Users (${users.length})</div>
      ${users.map(
        (u) => html`
        <div class="org-user-row">
          <span class="org-user-email">${u.email}</span>
          <span class="org-user-name">${u.displayName}</span>
          <span style="font-size:10px;opacity:0.6;">${u.role}</span>
          <span class="${u.status === "suspended" ? "badge-status-suspended" : "badge-status-active"}">${u.status}</span>
        </div>
      `,
      )}
    </div>
  `;
}

function renderEditPanel(props: OrganizationsProps, org: OrganizationConfig) {
  // Merge both providerKeys and legacy apiKeys so existing configs display correctly.
  const apiKeys = [...(org.providerKeys ?? []), ...(org.apiKeys ?? [])];

  return html`
    <div class="org-edit-panel">
      <div class="org-edit-title">Edit Organization</div>

      <div class="org-create-section-label" style="margin-top:0;">Organization</div>
      <div class="org-edit-grid">
        <div class="org-edit-field">
          <label class="org-edit-label">Name *</label>
          <input
            class="input"
            type="text"
            placeholder="Display name"
            .value=${props.editName}
            @input=${(e: Event) => props.onEditNameChange((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="org-edit-field">
          <label class="org-edit-label">Description</label>
          <input
            class="input"
            type="text"
            placeholder="Optional description"
            .value=${props.editDescription}
            @input=${(e: Event) => props.onEditDescriptionChange((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      <hr class="org-create-divider" />
      <div class="org-create-section-label">Admin credentials</div>
      <div class="org-edit-grid">
        <div class="org-edit-field">
          <label class="org-edit-label">Email</label>
          <input
            class="input"
            type="email"
            placeholder="Leave blank to keep current"
            .value=${props.editAdminEmail}
            @input=${(e: Event) => props.onEditAdminEmailChange((e.target as HTMLInputElement).value)}
            autocomplete="email"
          />
        </div>
        <div class="org-edit-field">
          <label class="org-edit-label">New password</label>
          <div style="position:relative;">
            <input
              class="input"
              type=${props.editAdminPasswordShow ? "text" : "password"}
              placeholder="Leave blank to keep current"
              .value=${props.editAdminPassword}
              @input=${(e: Event) => props.onEditAdminPasswordChange((e.target as HTMLInputElement).value)}
              autocomplete="new-password"
              style="padding-right:36px;"
            />
            <button
              type="button"
              @click=${props.onEditAdminPasswordToggleShow}
              style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted-foreground,#888);padding:2px 4px;display:flex;align-items:center;"
              title=${props.editAdminPasswordShow ? "Hide password" : "Show password"}
            >${eyeIcon(!props.editAdminPasswordShow)}</button>
          </div>
        </div>
      </div>

      <!-- API Keys management -->
      <div class="keys-section" style="margin-top:14px;">
        <div class="keys-section-title">API Keys</div>
        ${renderKeyList(apiKeys, props, org.id, { allowToggle: true, allowDelete: true })}
        ${renderAddKeyForm(props, "edit", org.id)}
      </div>

      <div class="org-edit-actions">
        <button
          class="btn btn-primary btn--sm"
          ?disabled=${!props.editName.trim() || props.saving}
          @click=${props.onUpdate}
        >${props.saving ? "Saving…" : "Save changes"}</button>
        <button
          class="btn btn--sm"
          ?disabled=${props.saving}
          @click=${props.onEditCancel}
        >Cancel</button>
      </div>
    </div>
  `;
}

function renderCreateForm(props: OrganizationsProps) {
  const hasInput =
    props.createName ||
    props.createId ||
    props.createDescription ||
    props.createAdminName ||
    props.createEmail ||
    props.createPassword ||
    props.createApiKeys.length > 0;

  const canSubmit =
    !!props.createName.trim() &&
    !!props.createAdminName.trim() &&
    !!props.createEmail.trim() &&
    props.createPassword.length >= 8 &&
    !props.saving;

  return html`
    <div class="org-create-card">
      <div class="org-create-title">
        <span style="opacity:0.5;font-size:16px;">+</span>
        New Organization
      </div>

      <div class="org-create-section-label">Organization</div>
      <div class="org-create-grid">
        <div class="org-create-field">
          <label class="org-create-label">Organization name *</label>
          <input
            class="input"
            type="text"
            placeholder="Acme Corp"
            .value=${props.createName}
            @input=${(e: Event) => props.onCreateNameChange((e.target as HTMLInputElement).value)}
            autocomplete="organization"
          />
        </div>
        <div class="org-create-field">
          <label class="org-create-label">ID (auto-generated if empty)</label>
          <input
            class="input"
            type="text"
            placeholder=${props.createName ? slugify(props.createName) : "e.g. org_acme"}
            .value=${props.createId}
            @input=${(e: Event) => props.onCreateIdChange((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="org-create-field org-create-field--full">
          <label class="org-create-label">Description</label>
          <input
            class="input"
            type="text"
            placeholder="Optional description"
            .value=${props.createDescription}
            @input=${(e: Event) => props.onCreateDescriptionChange((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      <hr class="org-create-divider" />
      <div class="org-create-section-label">Admin account</div>
      <div class="org-create-grid">
        <div class="org-create-field">
          <label class="org-create-label">Your name *</label>
          <input
            class="input"
            type="text"
            placeholder="Jane Smith"
            .value=${props.createAdminName}
            @input=${(e: Event) => props.onCreateAdminNameChange((e.target as HTMLInputElement).value)}
            autocomplete="name"
          />
        </div>
        <div class="org-create-field">
          <label class="org-create-label">Email *</label>
          <input
            class="input"
            type="email"
            placeholder="jane@acme.com"
            .value=${props.createEmail}
            @input=${(e: Event) => props.onCreateEmailChange((e.target as HTMLInputElement).value)}
            autocomplete="email"
          />
        </div>
        <div class="org-create-field org-create-field--full">
          <label class="org-create-label">Password *</label>
          <div style="position:relative;">
            <input
              class="input"
              type=${props.createPasswordShow ? "text" : "password"}
              placeholder="Min. 8 characters"
              .value=${props.createPassword}
              @input=${(e: Event) => props.onCreatePasswordChange((e.target as HTMLInputElement).value)}
              autocomplete="new-password"
              style="padding-right:40px;"
            />
            <button
              type="button"
              @click=${props.onCreatePasswordToggleShow}
              style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted-foreground,#888);padding:2px 4px;display:flex;align-items:center;"
              title=${props.createPasswordShow ? "Hide password" : "Show password"}
            >${eyeIcon(!props.createPasswordShow)}</button>
          </div>
        </div>
      </div>

      <!-- API Keys for new org -->
      <div class="keys-section" style="margin-top:14px;">
        <div class="keys-section-title">API Keys (optional)</div>
        ${renderKeyList(props.createApiKeys, props, null, {
          allowToggle: false,
          allowDelete: true,
          onRemove: (keyId) => props.onCreateApiKeyRemove(keyId),
        })}
        ${renderAddKeyForm(props, "create", null)}
      </div>

      <div class="org-create-footer">
        <button
          class="btn btn-primary"
          ?disabled=${!canSubmit}
          @click=${props.onCreate}
        >${props.saving ? "Creating…" : "Create Organization"}</button>
        ${
          hasInput
            ? html`<button
              class="btn"
              @click=${() => {
                props.onCreateNameChange("");
                props.onCreateIdChange("");
                props.onCreateDescriptionChange("");
                props.onCreateAdminNameChange("");
                props.onCreateEmailChange("");
                props.onCreatePasswordChange("");
                for (const k of props.createApiKeys) {
                  props.onCreateApiKeyRemove(k.id);
                }
              }}
            >Clear</button>`
            : nothing
        }
      </div>
    </div>
  `;
}
