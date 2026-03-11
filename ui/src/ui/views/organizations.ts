import { html, nothing } from "lit";
import type { OrganizationConfig } from "../../../../src/config/organizations.js";

export type OrganizationsProps = {
  loading: boolean;
  saving: boolean;
  lastError: string | null;
  organizations: OrganizationConfig[];
  activeOrganizationId: string | null;
  /** Create form state */
  createName: string;
  createId: string;
  createDescription: string;
  createOpenAiKey: string;
  /** Edit form state */
  editingId: string | null;
  editName: string;
  editDescription: string;
  editOpenAiKey: string;
  /** Callbacks */
  onRefresh: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateNameChange: (val: string) => void;
  onCreateIdChange: (val: string) => void;
  onCreateDescriptionChange: (val: string) => void;
  onCreateOpenAiKeyChange: (val: string) => void;
  onCreate: () => void;
  onEditStart: (org: OrganizationConfig) => void;
  onEditCancel: () => void;
  onEditNameChange: (val: string) => void;
  onEditDescriptionChange: (val: string) => void;
  onEditOpenAiKeyChange: (val: string) => void;
  onUpdate: () => void;
};

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

export function renderOrganizations(props: OrganizationsProps) {
  const hasOrgs = props.organizations.length > 0;

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
      .org-key-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: var(--ok, #22c55e);
        flex-shrink: 0;
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
        gap: 12px;
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
      .org-create-footer {
        margin-top: 14px;
        display: flex;
        align-items: center;
        gap: 10px;
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
            ${props.organizations.map((org) => renderOrgCard(org, props))}
          </div>`
          : html`
              <div class="org-empty">
                <div class="org-empty-icon">🏢</div>
                <div class="org-empty-text">No organizations yet</div>
                <div class="org-empty-sub">Create one below to get started with multi-tenancy.</div>
              </div>
            `
      }

      <!-- Create form -->
      ${renderCreateForm(props)}
    </div>
  `;
}

function renderOrgCard(org: OrganizationConfig, props: OrganizationsProps) {
  const isActive = org.id === props.activeOrganizationId;
  const isEditing = org.id === props.editingId;

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
              org.openaiApiKey
                ? html`
                    <span class="org-meta-item">
                      <span class="org-key-dot"></span>
                      OpenAI key set
                    </span>
                  `
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
          <button
            class="btn btn--sm"
            ?disabled=${props.saving}
            @click=${() => {
              if (isEditing) {
                props.onEditCancel();
              } else {
                props.onEditStart(org);
              }
            }}
          >${isEditing ? "Cancel" : "Edit"}</button>
          <button
            class="btn btn--sm btn-danger"
            ?disabled=${props.saving}
            @click=${() => {
              if (window.confirm(`Delete organization "${org.id}" (${org.name})?`)) {
                props.onDelete(org.id);
              }
            }}
          >Delete</button>
        </div>
      </div>

      ${isEditing ? renderEditPanel(props) : nothing}
    </div>
  `;
}

function renderEditPanel(props: OrganizationsProps) {
  return html`
    <div class="org-edit-panel">
      <div class="org-edit-title">Edit Organization</div>
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
            @input=${(e: Event) =>
              props.onEditDescriptionChange((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="org-edit-field org-edit-field--full">
          <label class="org-edit-label">OpenAI API Key (optional — overrides global key for this org)</label>
          <input
            class="input"
            type="password"
            placeholder="sk-… (leave blank to keep current)"
            .value=${props.editOpenAiKey}
            @input=${(e: Event) =>
              props.onEditOpenAiKeyChange((e.target as HTMLInputElement).value)}
            autocomplete="off"
            spellcheck="false"
          />
        </div>
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
  return html`
    <div class="org-create-card">
      <div class="org-create-title">
        <span style="opacity:0.5;font-size:16px;">+</span>
        New Organization
      </div>
      <div class="org-create-grid">
        <div class="org-create-field">
          <label class="org-create-label">Name *</label>
          <input
            class="input"
            type="text"
            placeholder="e.g. Acme Corp"
            .value=${props.createName}
            @input=${(e: Event) => props.onCreateNameChange((e.target as HTMLInputElement).value)}
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
        <div class="org-create-field">
          <label class="org-create-label">Description</label>
          <input
            class="input"
            type="text"
            placeholder="Optional description"
            .value=${props.createDescription}
            @input=${(e: Event) =>
              props.onCreateDescriptionChange((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="org-create-field">
          <label class="org-create-label">OpenAI API Key (optional)</label>
          <input
            class="input"
            type="password"
            placeholder="sk-…"
            .value=${props.createOpenAiKey}
            @input=${(e: Event) =>
              props.onCreateOpenAiKeyChange((e.target as HTMLInputElement).value)}
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      </div>
      <div class="org-create-footer">
        <button
          class="btn btn-primary"
          ?disabled=${!props.createName.trim() || props.saving}
          @click=${props.onCreate}
        >${props.saving ? "Creating…" : "Create Organization"}</button>
        ${
          props.createName || props.createId || props.createDescription || props.createOpenAiKey
            ? html`<button
              class="btn"
              @click=${() => {
                props.onCreateNameChange("");
                props.onCreateIdChange("");
                props.onCreateDescriptionChange("");
                props.onCreateOpenAiKeyChange("");
              }}
            >Clear</button>`
            : nothing
        }
      </div>
    </div>
  `;
}
