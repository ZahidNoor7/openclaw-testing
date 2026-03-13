import { html, nothing } from "lit";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../types.ts";
import {
  renderAgentFiles,
  renderAgentChannels,
  renderAgentCron,
} from "./agents-panels-status-files.ts";
import { renderAgentTools, renderAgentSkills } from "./agents-panels-tools-skills.ts";
import {
  agentBadgeText,
  buildAgentContext,
  buildModelOptions,
  normalizeAgentLabel,
  normalizeModelValue,
  parseFallbackList,
  resolveAgentConfig,
  resolveAgentEmoji,
  resolveEffectiveModelFallbacks,
  resolveModelLabel,
  resolveModelPrimary,
} from "./agents-utils.ts";

export type AgentsPanel = "overview" | "files" | "tools" | "skills" | "channels" | "cron";

export type AgentsProps = {
  loading: boolean;
  error: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  activePanel: AgentsPanel;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  channelsLoading: boolean;
  channelsError: string | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsLastSuccess: number | null;
  cronLoading: boolean;
  cronStatus: CronStatus | null;
  cronJobs: CronJob[];
  cronError: string | null;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileActive: string | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsError: string | null;
  agentSkillsAgentId: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
  skillsFilter: string;
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
  onToolsProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onToolsOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onOrganizationChange: (agentId: string, organizationId: string | null) => void;
  onChannelsRefresh: () => void;
  onCronRefresh: () => void;
  onSkillsFilterChange: (next: string) => void;
  onSkillsRefresh: () => void;
  onAgentSkillToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onAgentSkillsClear: (agentId: string) => void;
  onAgentSkillsDisableAll: (agentId: string) => void;
  /** Create agent form */
  agentCreateOpen: boolean;
  agentCreateName: string;
  agentCreateId: string;
  agentCreateSaving: boolean;
  agentCreateError: string | null;
  onCreateOpen: () => void;
  onCreateCancel: () => void;
  onCreateNameChange: (val: string) => void;
  onCreateIdChange: (val: string) => void;
  onCreate: () => void;
  /** Edit (rename) agent */
  agentEditOpen: boolean;
  agentEditName: string;
  agentEditSaving: boolean;
  agentEditError: string | null;
  onEditOpen: () => void;
  onEditCancel: () => void;
  onEditNameChange: (val: string) => void;
  onEditSave: () => void;
  /** Delete agent */
  agentDeleteConfirming: boolean;
  agentDeleteSaving: boolean;
  onDeleteOpen: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
};

export function slugifyAgentId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "agent"
  );
}

export type AgentContext = {
  workspace: string;
  model: string;
  identityName: string;
  identityEmoji: string;
  skillsLabel: string;
  isDefault: boolean;
};

export function renderAgents(props: AgentsProps) {
  const agents = props.agentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const selectedId = props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? null;
  const selectedAgent = selectedId
    ? (agents.find((agent) => agent.id === selectedId) ?? null)
    : null;

  return html`
    <div class="agents-layout">
      <section class="card agents-sidebar">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Agents</div>
            <div class="card-sub">${agents.length} configured.</div>
          </div>
          <div class="row" style="gap: 6px;">
            <button
              class="btn btn--sm primary"
              ?disabled=${props.loading || props.agentCreateSaving}
              @click=${props.onCreateOpen}
              title="Create a new agent"
            >+ New</button>
            <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
              ${props.loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        ${
          props.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
            : nothing
        }
        ${
          props.agentCreateOpen
            ? html`
                <div class="agent-create-form" style="margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius, 8px); background: var(--card-alt, var(--bg-subtle, var(--input-bg, rgba(0,0,0,0.03))));">
                  <div style="font-size: 13px; font-weight: 600; margin-bottom: 10px;">New Agent</div>
                  ${
                    props.agentCreateError
                      ? html`<div class="callout danger" style="margin-bottom: 8px; font-size: 12px;">${props.agentCreateError}</div>`
                      : nothing
                  }
                  <label class="field" style="margin-bottom: 8px;">
                    <span style="font-size: 12px;">Display name</span>
                    <input
                      type="text"
                      placeholder="My Agent"
                      .value=${props.agentCreateName}
                      ?disabled=${props.agentCreateSaving}
                      @input=${(e: Event) => props.onCreateNameChange((e.target as HTMLInputElement).value)}
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === "Enter") {
                          props.onCreate();
                        }
                        if (e.key === "Escape") {
                          props.onCreateCancel();
                        }
                      }}
                      style="font-size: 13px;"
                    />
                  </label>
                  <label class="field" style="margin-bottom: 10px;">
                    <span style="font-size: 12px;">Agent ID <span class="muted">(unique, lowercase)</span></span>
                    <input
                      type="text"
                      placeholder="my_agent"
                      .value=${props.agentCreateId}
                      ?disabled=${props.agentCreateSaving}
                      @input=${(e: Event) => props.onCreateIdChange((e.target as HTMLInputElement).value)}
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === "Enter") {
                          props.onCreate();
                        }
                        if (e.key === "Escape") {
                          props.onCreateCancel();
                        }
                      }}
                      style="font-size: 13px; font-family: var(--font-mono, monospace);"
                    />
                  </label>
                  <div class="row" style="gap: 6px; justify-content: flex-end;">
                    <button
                      class="btn btn--sm"
                      ?disabled=${props.agentCreateSaving}
                      @click=${props.onCreateCancel}
                    >Cancel</button>
                    <button
                      class="btn btn--sm primary"
                      ?disabled=${props.agentCreateSaving || !props.agentCreateId.trim()}
                      @click=${props.onCreate}
                    >${props.agentCreateSaving ? "Creating…" : "Create"}</button>
                  </div>
                </div>
              `
            : nothing
        }
        <div class="agent-list" style="margin-top: 12px;">
          ${
            agents.length === 0
              ? html`
                  <div class="muted">No agents found.</div>
                `
              : agents.map((agent) => {
                  const badge = agentBadgeText(agent.id, defaultId);
                  const emoji = resolveAgentEmoji(agent, props.agentIdentityById[agent.id] ?? null);
                  return html`
                    <button
                      type="button"
                      class="agent-row ${selectedId === agent.id ? "active" : ""}"
                      @click=${() => props.onSelectAgent(agent.id)}
                    >
                      <div class="agent-avatar">${emoji || normalizeAgentLabel(agent).slice(0, 1)}</div>
                      <div class="agent-info">
                        <div class="agent-title">${normalizeAgentLabel(agent)}</div>
                        <div class="agent-sub mono">${agent.id}</div>
                      </div>
                      ${badge ? html`<span class="agent-pill">${badge}</span>` : nothing}
                    </button>
                  `;
                })
          }
        </div>
      </section>
      <section class="agents-main">
        ${
          !selectedAgent
            ? html`
                <div class="card">
                  <div class="card-title">Select an agent</div>
                  <div class="card-sub">Pick an agent to inspect its workspace and tools.</div>
                </div>
              `
            : html`
                ${renderAgentHeader(
                  selectedAgent,
                  defaultId,
                  props.agentIdentityById[selectedAgent.id] ?? null,
                  {
                    onEditOpen: props.onEditOpen,
                    onDeleteOpen: props.onDeleteOpen,
                  },
                )}
                ${
                  props.agentEditOpen
                    ? html`
                        <section class="card" style="padding: 16px;">
                          <div style="font-size: 13px; font-weight: 600; margin-bottom: 10px;">Rename Agent</div>
                          ${
                            props.agentEditError
                              ? html`<div class="callout danger" style="margin-bottom: 8px; font-size: 12px;">${props.agentEditError}</div>`
                              : nothing
                          }
                          <label class="field" style="margin-bottom: 10px;">
                            <span style="font-size: 12px;">Display name</span>
                            <input
                              type="text"
                              .value=${props.agentEditName}
                              ?disabled=${props.agentEditSaving}
                              @input=${(e: Event) => props.onEditNameChange((e.target as HTMLInputElement).value)}
                              @keydown=${(e: KeyboardEvent) => {
                                if (e.key === "Enter") {
                                  props.onEditSave();
                                }
                                if (e.key === "Escape") {
                                  props.onEditCancel();
                                }
                              }}
                              style="font-size: 13px;"
                            />
                          </label>
                          <div class="row" style="gap: 6px; justify-content: flex-end;">
                            <button class="btn btn--sm" ?disabled=${props.agentEditSaving} @click=${props.onEditCancel}>Cancel</button>
                            <button
                              class="btn btn--sm primary"
                              ?disabled=${props.agentEditSaving || !props.agentEditName.trim()}
                              @click=${props.onEditSave}
                            >${props.agentEditSaving ? "Saving…" : "Save"}</button>
                          </div>
                        </section>
                      `
                    : nothing
                }
                ${
                  props.agentDeleteConfirming
                    ? html`
                        <section class="card" style="padding: 14px 16px; border-color: var(--danger, #e53e3e);">
                          <div class="row" style="gap: 12px; align-items: center; flex-wrap: wrap;">
                            <div style="flex: 1; min-width: 0;">
                              <div style="font-size: 13px; font-weight: 600; color: var(--danger, #e53e3e);">Delete agent "${selectedAgent.id}"?</div>
                              <div class="muted" style="font-size: 12px; margin-top: 2px;">This removes the agent from your config. Sessions and files on disk are not deleted.</div>
                            </div>
                            <div class="row" style="gap: 6px;">
                              <button class="btn btn--sm" ?disabled=${props.agentDeleteSaving} @click=${props.onDeleteCancel}>Cancel</button>
                              <button
                                class="btn btn--sm danger"
                                ?disabled=${props.agentDeleteSaving}
                                @click=${props.onDeleteConfirm}
                              >${props.agentDeleteSaving ? "Deleting…" : "Delete"}</button>
                            </div>
                          </div>
                        </section>
                      `
                    : nothing
                }
                ${renderAgentTabs(props.activePanel, (panel) => props.onSelectPanel(panel))}
                ${
                  props.activePanel === "overview"
                    ? renderAgentOverview({
                        agent: selectedAgent,
                        defaultId,
                        configForm: props.configForm,
                        agentFilesList: props.agentFilesList,
                        agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                        agentIdentityError: props.agentIdentityError,
                        agentIdentityLoading: props.agentIdentityLoading,
                        configLoading: props.configLoading,
                        configSaving: props.configSaving,
                        configDirty: props.configDirty,
                        onConfigReload: props.onConfigReload,
                        onConfigSave: props.onConfigSave,
                        onModelChange: props.onModelChange,
                        onModelFallbacksChange: props.onModelFallbacksChange,
                        onOrganizationChange: props.onOrganizationChange,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "files"
                    ? renderAgentFiles({
                        agentId: selectedAgent.id,
                        agentFilesList: props.agentFilesList,
                        agentFilesLoading: props.agentFilesLoading,
                        agentFilesError: props.agentFilesError,
                        agentFileActive: props.agentFileActive,
                        agentFileContents: props.agentFileContents,
                        agentFileDrafts: props.agentFileDrafts,
                        agentFileSaving: props.agentFileSaving,
                        onLoadFiles: props.onLoadFiles,
                        onSelectFile: props.onSelectFile,
                        onFileDraftChange: props.onFileDraftChange,
                        onFileReset: props.onFileReset,
                        onFileSave: props.onFileSave,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "tools"
                    ? renderAgentTools({
                        agentId: selectedAgent.id,
                        configForm: props.configForm,
                        configLoading: props.configLoading,
                        configSaving: props.configSaving,
                        configDirty: props.configDirty,
                        toolsCatalogLoading: props.toolsCatalogLoading,
                        toolsCatalogError: props.toolsCatalogError,
                        toolsCatalogResult: props.toolsCatalogResult,
                        onProfileChange: props.onToolsProfileChange,
                        onOverridesChange: props.onToolsOverridesChange,
                        onConfigReload: props.onConfigReload,
                        onConfigSave: props.onConfigSave,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "skills"
                    ? renderAgentSkills({
                        agentId: selectedAgent.id,
                        report: props.agentSkillsReport,
                        loading: props.agentSkillsLoading,
                        error: props.agentSkillsError,
                        activeAgentId: props.agentSkillsAgentId,
                        configForm: props.configForm,
                        configLoading: props.configLoading,
                        configSaving: props.configSaving,
                        configDirty: props.configDirty,
                        filter: props.skillsFilter,
                        onFilterChange: props.onSkillsFilterChange,
                        onRefresh: props.onSkillsRefresh,
                        onToggle: props.onAgentSkillToggle,
                        onClear: props.onAgentSkillsClear,
                        onDisableAll: props.onAgentSkillsDisableAll,
                        onConfigReload: props.onConfigReload,
                        onConfigSave: props.onConfigSave,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "channels"
                    ? renderAgentChannels({
                        context: buildAgentContext(
                          selectedAgent,
                          props.configForm,
                          props.agentFilesList,
                          defaultId,
                          props.agentIdentityById[selectedAgent.id] ?? null,
                        ),
                        configForm: props.configForm,
                        snapshot: props.channelsSnapshot,
                        loading: props.channelsLoading,
                        error: props.channelsError,
                        lastSuccess: props.channelsLastSuccess,
                        onRefresh: props.onChannelsRefresh,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "cron"
                    ? renderAgentCron({
                        context: buildAgentContext(
                          selectedAgent,
                          props.configForm,
                          props.agentFilesList,
                          defaultId,
                          props.agentIdentityById[selectedAgent.id] ?? null,
                        ),
                        agentId: selectedAgent.id,
                        jobs: props.cronJobs,
                        status: props.cronStatus,
                        loading: props.cronLoading,
                        error: props.cronError,
                        onRefresh: props.onCronRefresh,
                      })
                    : nothing
                }
              `
        }
      </section>
    </div>
  `;
}

function renderAgentHeader(
  agent: AgentsListResult["agents"][number],
  defaultId: string | null,
  agentIdentity: AgentIdentityResult | null,
  actions: { onEditOpen: () => void; onDeleteOpen: () => void },
) {
  const badge = agentBadgeText(agent.id, defaultId);
  const displayName = normalizeAgentLabel(agent);
  const subtitle = agent.identity?.theme?.trim() || "Agent workspace and routing.";
  const emoji = resolveAgentEmoji(agent, agentIdentity);
  return html`
    <section class="card agent-header">
      <div class="agent-header-main">
        <div class="agent-avatar agent-avatar--lg">${emoji || displayName.slice(0, 1)}</div>
        <div>
          <div class="card-title">${displayName}</div>
          <div class="card-sub">${subtitle}</div>
        </div>
      </div>
      <div class="agent-header-meta">
        <div class="mono">${agent.id}</div>
        ${badge ? html`<span class="agent-pill">${badge}</span>` : nothing}
        <div class="row" style="gap: 6px; margin-top: 4px;">
          <button
            class="btn btn--sm"
            @click=${actions.onEditOpen}
            title="Rename agent"
          >Rename</button>
          <button
            class="btn btn--sm danger"
            @click=${actions.onDeleteOpen}
            title="Delete agent"
          >Delete</button>
        </div>
      </div>
    </section>
  `;
}

function renderAgentTabs(active: AgentsPanel, onSelect: (panel: AgentsPanel) => void) {
  const tabs: Array<{ id: AgentsPanel; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "files", label: "Files" },
    { id: "tools", label: "Tools" },
    { id: "skills", label: "Skills" },
    { id: "channels", label: "Channels" },
    { id: "cron", label: "Cron Jobs" },
  ];
  return html`
    <div class="agent-tabs">
      ${tabs.map(
        (tab) => html`
          <button
            class="agent-tab ${active === tab.id ? "active" : ""}"
            type="button"
            @click=${() => onSelect(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderAgentOverview(params: {
  agent: AgentsListResult["agents"][number];
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onOrganizationChange: (agentId: string, organizationId: string | null) => void;
}) {
  const {
    agent,
    configForm,
    agentFilesList,
    agentIdentity,
    agentIdentityLoading,
    agentIdentityError,
    configLoading,
    configSaving,
    configDirty,
    onConfigReload,
    onConfigSave,
    onModelChange,
    onModelFallbacksChange,
    onOrganizationChange,
  } = params;
  const config = resolveAgentConfig(configForm, agent.id);
  // Organization: read from config form entry, then agent runtime value.
  const orgId =
    (config.entry as { organizationId?: string } | undefined)?.organizationId?.trim() ||
    (agent as { organizationId?: string }).organizationId?.trim() ||
    null;
  // Organizations list from top-level config (nested under organizations.list).
  type OrgOption = { id: string; name: string };
  const orgBlock = (configForm as { organizations?: { list?: unknown[] } } | null)?.organizations;
  const orgOptions = Array.isArray(orgBlock?.list) ? (orgBlock.list as OrgOption[]) : [];
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";
  const model = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const defaultModel = resolveModelLabel(config.defaults?.model);
  const modelPrimary =
    resolveModelPrimary(config.entry?.model) || (model !== "-" ? normalizeModelValue(model) : null);
  const defaultPrimary =
    resolveModelPrimary(config.defaults?.model) ||
    (defaultModel !== "-" ? normalizeModelValue(defaultModel) : null);
  const effectivePrimary = modelPrimary ?? defaultPrimary ?? null;
  const modelFallbacks = resolveEffectiveModelFallbacks(
    config.entry?.model,
    config.defaults?.model,
  );
  const fallbackText = modelFallbacks ? modelFallbacks.join(", ") : "";
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    "-";
  const resolvedEmoji = resolveAgentEmoji(agent, agentIdentity);
  const identityEmoji = resolvedEmoji || "-";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  const identityStatus = agentIdentityLoading
    ? "Loading…"
    : agentIdentityError
      ? "Unavailable"
      : "";
  const isDefault = Boolean(params.defaultId && agent.id === params.defaultId);

  return html`
    <section class="card">
      <div class="card-title">Overview</div>
      <div class="card-sub">Workspace paths and identity metadata.</div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div class="mono">${workspace}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Name</div>
          <div>${identityName}</div>
          ${identityStatus ? html`<div class="agent-kv-sub muted">${identityStatus}</div>` : nothing}
        </div>
        <div class="agent-kv">
          <div class="label">Default</div>
          <div>${isDefault ? "yes" : "no"}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Emoji</div>
          <div>${identityEmoji}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${skillFilter ? `${skillCount} selected` : "all skills"}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Organization</div>
          <div>${
            orgId ??
            html`
              <span class="muted">—</span>
            `
          }</div>
        </div>
      </div>

      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Model Selection</div>
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Primary model${isDefault ? " (default)" : ""}</span>
            <select
              .value=${effectivePrimary ?? ""}
              ?disabled=${!configForm || configLoading || configSaving}
              @change=${(e: Event) =>
                onModelChange(agent.id, (e.target as HTMLSelectElement).value || null)}
            >
              ${
                isDefault
                  ? nothing
                  : html`
                      <option value="">
                        ${defaultPrimary ? `Inherit default (${defaultPrimary})` : "Inherit default"}
                      </option>
                    `
              }
              ${buildModelOptions(configForm, effectivePrimary ?? undefined)}
            </select>
          </label>
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Fallbacks (comma-separated)</span>
            <input
              .value=${fallbackText}
              ?disabled=${!configForm || configLoading || configSaving}
              placeholder="provider/model, provider/model"
              @input=${(e: Event) =>
                onModelFallbacksChange(
                  agent.id,
                  parseFallbackList((e.target as HTMLInputElement).value),
                )}
            />
          </label>
        </div>
        ${
          orgOptions.length > 0
            ? html`
                <div style="margin-top: 12px;">
                  <label class="field" style="max-width: 360px;">
                    <span>Organization</span>
                    <select
                      .value=${orgId ?? ""}
                      ?disabled=${!configForm || configLoading || configSaving}
                      @change=${(e: Event) => {
                        const val = (e.target as HTMLSelectElement).value;
                        onOrganizationChange(agent.id, val || null);
                      }}
                    >
                      <option value="">— None (global agent) —</option>
                      ${orgOptions.map(
                        (org) =>
                          html`<option value=${org.id} ?selected=${org.id === orgId}>
                            ${org.name} (${org.id})
                          </option>`,
                      )}
                    </select>
                  </label>
                </div>
              `
            : nothing
        }
        <div class="row" style="justify-content: flex-end; gap: 8px;">
          <button class="btn btn--sm" ?disabled=${configLoading} @click=${onConfigReload}>
            Reload Config
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${configSaving || !configDirty}
            @click=${onConfigSave}
          >
            ${configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </section>
  `;
}
