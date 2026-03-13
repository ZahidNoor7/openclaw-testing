import { html, nothing } from "lit";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { t } from "../i18n/index.ts";
import { refreshChatAvatar } from "./app-chat.ts";
import { renderUsageTab } from "./app-render-usage-tab.ts";
import { renderChatControls, renderTab, renderThemeToggle } from "./app-render.helpers.ts";
import type { AppViewState } from "./app-view-state.ts";
import { loadAgentFileContent, loadAgentFiles, saveAgentFile } from "./controllers/agent-files.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import { loadAgentSkills } from "./controllers/agent-skills.ts";
import { loadAgents, loadToolsCatalog, saveAgentsConfig } from "./controllers/agents.ts";
import { loadChannels } from "./controllers/channels.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import {
  applyConfig,
  ensureAgentConfigEntry,
  findAgentConfigEntryIndex,
  loadConfig,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
  removeConfigFormValue,
} from "./controllers/config.ts";
import {
  loadCronRuns,
  loadMoreCronJobs,
  loadMoreCronRuns,
  reloadCronJobs,
  toggleCronJob,
  runCronJob,
  removeCronJob,
  addCronJob,
  startCronEdit,
  startCronClone,
  cancelCronEdit,
  validateCronForm,
  hasCronFormErrors,
  normalizeCronFormState,
  getVisibleCronJobs,
  updateCronJobsFilter,
  updateCronRunsFilter,
} from "./controllers/cron.ts";
import { loadDebug, callDebugMethod } from "./controllers/debug.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "./controllers/devices.ts";
import {
  loadExecApprovals,
  removeExecApprovalsFormValue,
  saveExecApprovals,
  updateExecApprovalsFormValue,
} from "./controllers/exec-approvals.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadPresence } from "./controllers/presence.ts";
import { deleteSessionAndRefresh, loadSessions, patchSession } from "./controllers/sessions.ts";
import {
  installSkill,
  loadSkills,
  saveSkillApiKey,
  updateSkillEdit,
  updateSkillEnabled,
} from "./controllers/skills.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "./external-link.ts";
import { icons } from "./icons.ts";
import { normalizeBasePath, TAB_GROUPS, subtitleForTab, titleForTab } from "./navigation.ts";
import {
  normalizeAgentLabel,
  resolveAgentConfig,
  resolveConfiguredCronModelSuggestions,
  resolveEffectiveModelFallbacks,
  resolveModelPrimary,
  sortLocaleStrings,
} from "./views/agents-utils.ts";
import { renderAgents, slugifyAgentId } from "./views/agents.ts";
import { renderChannels } from "./views/channels.ts";
import { renderChat } from "./views/chat.ts";
import { renderConfig } from "./views/config.ts";
import { renderCron } from "./views/cron.ts";
import { renderDebug } from "./views/debug.ts";
import { renderExecApprovalPrompt } from "./views/exec-approval.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import { renderInstances } from "./views/instances.ts";
import { renderLogs } from "./views/logs.ts";
import { renderNodes } from "./views/nodes.ts";
import { renderOrganizations } from "./views/organizations.ts";
import { renderOverview } from "./views/overview.ts";
import { renderSessions } from "./views/sessions.ts";
import { renderSkills } from "./views/skills.ts";

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
const CRON_THINKING_SUGGESTIONS = ["off", "minimal", "low", "medium", "high"];
const CRON_TIMEZONE_SUGGESTIONS = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeSuggestionValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
}

export function renderApp(state: AppViewState) {
  const openClawVersion =
    (typeof state.hello?.server?.version === "string" && state.hello.server.version.trim()) ||
    state.updateAvailable?.currentVersion ||
    t("common.na");
  const availableUpdate =
    state.updateAvailable &&
    state.updateAvailable.latestVersion !== state.updateAvailable.currentVersion
      ? state.updateAvailable
      : null;
  const versionStatusClass = availableUpdate ? "warn" : "ok";
  const presenceCount = state.presenceEntries.length;
  const sessionsCount = state.sessionsResult?.count ?? null;
  const cronNext = state.cronStatus?.nextWakeAtMs ?? null;
  const isChat = state.tab === "chat";
  const chatFocus = isChat && (state.settings.chatFocusMode || state.onboarding);
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const configValue =
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  // Org switcher data — read from snapshot so it's always available without visiting config tab.
  const _topbarOrgBlock =
    state.configSnapshot?.config?.organizations != null &&
    typeof state.configSnapshot.config.organizations === "object"
      ? (state.configSnapshot.config.organizations as {
          list?: Array<{ id: string; name: string; openaiApiKey?: string }>;
          activeId?: string;
        })
      : null;
  const topbarOrgs = Array.isArray(_topbarOrgBlock?.list)
    ? (_topbarOrgBlock.list as Array<{ id: string; name: string }>)
    : [];
  const topbarActiveOrgId = _topbarOrgBlock?.activeId ?? null;
  // API key isolation: when an org is active and has no openaiApiKey, block chat.
  const _activeOrgFull = topbarActiveOrgId
    ? (_topbarOrgBlock?.list ?? []).find((o) => o.id === topbarActiveOrgId)
    : null;
  const orgMissingApiKey = _activeOrgFull !== undefined && !_activeOrgFull?.openaiApiKey?.trim();
  const chatDisabledReason = !state.connected
    ? t("chat.disconnected")
    : orgMissingApiKey
      ? "Add an OpenAI API key for this organization in Settings → Organizations before chatting."
      : null;

  // Org-filtered agents list: strict isolation — only show agents explicitly assigned
  // to the active org.  Global agents (no organizationId) are only visible when no
  // org is active (single-user mode).  configSnapshot has the full agent config
  // including organizationId; agentsList only has runtime rows.
  const _agentsConfig =
    (
      state.configSnapshot?.config?.agents as
        | { list?: Array<{ id: string; organizationId?: string }> }
        | undefined
    )?.list ?? [];
  const _visibleAgentIds: Set<string> = topbarActiveOrgId
    ? new Set(_agentsConfig.filter((a) => a.organizationId === topbarActiveOrgId).map((a) => a.id))
    : null!; // null signals "show all" — checked below
  const orgFilteredAgentsList =
    state.agentsList && topbarActiveOrgId
      ? {
          ...state.agentsList,
          agents: state.agentsList.agents.filter((a) => _visibleAgentIds.has(a.id)),
          defaultId: _visibleAgentIds.has(state.agentsList.defaultId ?? "")
            ? (state.agentsList.defaultId ?? "")
            : (state.agentsList.agents.find((a) => _visibleAgentIds.has(a.id))?.id ?? ""),
        }
      : state.agentsList;

  const basePath = normalizeBasePath(state.basePath ?? "");
  const resolvedAgentId =
    state.agentsSelectedId ??
    orgFilteredAgentsList?.defaultId ??
    orgFilteredAgentsList?.agents?.[0]?.id ??
    null;
  const getCurrentConfigValue = () =>
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const findAgentIndex = (agentId: string) =>
    findAgentConfigEntryIndex(getCurrentConfigValue(), agentId);
  const ensureAgentIndex = (agentId: string) => ensureAgentConfigEntry(state, agentId);
  const cronAgentSuggestions = sortLocaleStrings(
    new Set(
      [
        ...(orgFilteredAgentsList?.agents?.map((entry) => entry.id.trim()) ?? []),
        ...state.cronJobs
          .map((job) => (typeof job.agentId === "string" ? job.agentId.trim() : ""))
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const cronModelSuggestions = sortLocaleStrings(
    new Set(
      [
        ...state.cronModelSuggestions,
        ...resolveConfiguredCronModelSuggestions(configValue),
        ...state.cronJobs
          .map((job) => {
            if (job.payload.kind !== "agentTurn" || typeof job.payload.model !== "string") {
              return "";
            }
            return job.payload.model.trim();
          })
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const visibleCronJobs = getVisibleCronJobs(state);
  const selectedDeliveryChannel =
    state.cronForm.deliveryChannel && state.cronForm.deliveryChannel.trim()
      ? state.cronForm.deliveryChannel.trim()
      : "last";
  const jobToSuggestions = state.cronJobs
    .map((job) => normalizeSuggestionValue(job.delivery?.to))
    .filter(Boolean);
  const accountToSuggestions = (
    selectedDeliveryChannel === "last"
      ? Object.values(state.channelsSnapshot?.channelAccounts ?? {}).flat()
      : (state.channelsSnapshot?.channelAccounts?.[selectedDeliveryChannel] ?? [])
  )
    .flatMap((account) => [
      normalizeSuggestionValue(account.accountId),
      normalizeSuggestionValue(account.name),
    ])
    .filter(Boolean);
  const rawDeliveryToSuggestions = uniquePreserveOrder([
    ...jobToSuggestions,
    ...accountToSuggestions,
  ]);
  const accountSuggestions = uniquePreserveOrder(accountToSuggestions);
  const deliveryToSuggestions =
    state.cronForm.deliveryMode === "webhook"
      ? rawDeliveryToSuggestions.filter((value) => isHttpUrl(value))
      : rawDeliveryToSuggestions;

  return html`
    ${
      state.orgSwitching
        ? html`<div class="org-switch-overlay" role="status" aria-live="polite">
          <style>
            @keyframes org-switch-spin {
              to { transform: rotate(360deg); }
            }
            .org-switch-overlay {
              position: fixed;
              inset: 0;
              background: var(--bg);
              z-index: 9999;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 20px;
            }
            .org-switch-overlay__logo {
              display: flex;
              align-items: center;
              gap: 12px;
              opacity: 0.9;
            }
            .org-switch-overlay__logo img {
              width: 36px;
              height: 36px;
            }
            .org-switch-overlay__title {
              font-size: 18px;
              font-weight: 600;
              letter-spacing: 0.08em;
              color: var(--text);
            }
            .org-switch-overlay__spinner {
              width: 28px;
              height: 28px;
              border: 2px solid var(--border-strong);
              border-top-color: var(--accent, var(--text));
              border-radius: 50%;
              animation: org-switch-spin 0.7s linear infinite;
            }
            .org-switch-overlay__label {
              font-size: 13px;
              color: var(--text-muted, var(--text));
              opacity: 0.6;
              letter-spacing: 0.02em;
            }
          </style>
          <div class="org-switch-overlay__logo">
            <img src=${state.basePath ? `${state.basePath}/favicon.svg` : "/favicon.svg"} alt="OpenClaw" />
            <span class="org-switch-overlay__title">OPENCLAW</span>
          </div>
          <div class="org-switch-overlay__spinner"></div>
          <span class="org-switch-overlay__label">Switching organization…</span>
        </div>`
        : nothing
    }
    ${
      state.orgSwitchPending
        ? html`<div class="org-confirm-backdrop" role="dialog" aria-modal="true" aria-label="Switch organization">
          <style>
            .org-confirm-backdrop {
              position: fixed;
              inset: 0;
              background: rgba(0,0,0,0.45);
              z-index: 9998;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .org-confirm-dialog {
              background: var(--bg);
              border: 1px solid var(--border-strong);
              border-radius: 10px;
              padding: 28px 32px;
              max-width: 380px;
              width: 90%;
              display: flex;
              flex-direction: column;
              gap: 14px;
              box-shadow: 0 8px 32px rgba(0,0,0,0.28);
            }
            .org-confirm-dialog__title {
              font-size: 16px;
              font-weight: 600;
              color: var(--text);
              margin: 0;
            }
            .org-confirm-dialog__body {
              font-size: 13px;
              color: var(--text-muted, var(--text));
              line-height: 1.5;
              opacity: 0.8;
            }
            .org-confirm-dialog__org-name {
              font-weight: 600;
              color: var(--text);
              opacity: 1;
            }
            .org-confirm-dialog__actions {
              display: flex;
              gap: 10px;
              justify-content: flex-end;
              margin-top: 4px;
            }
          </style>
          <div class="org-confirm-dialog">
            <p class="org-confirm-dialog__title">Switch organization?</p>
            <p class="org-confirm-dialog__body">
              Switching to
              <span class="org-confirm-dialog__org-name">${state.orgSwitchPending.name}</span>
              will reload your agents and chat history.
            </p>
            <div class="org-confirm-dialog__actions">
              <button
                class="btn btn--sm"
                @click=${() => {
                  state.orgSwitchPending = null;
                }}
              >Cancel</button>
              <button
                class="btn btn--sm btn--primary"
                @click=${async () => {
                  const pending = state.orgSwitchPending;
                  if (!pending) {
                    return;
                  }
                  state.orgSwitchPending = null;
                  state.orgSwitching = true;
                  state.orgSwitchingToId = pending.id;
                  // Clear chat immediately so the previous org's history never shows
                  // during the gateway-restart window (onHello also clears, but this
                  // is earlier and covers the disconnect gap).
                  state.chatMessages = [];
                  state.chatToolMessages = [];
                  if (!state.configForm) {
                    await loadConfig(state);
                  }
                  updateConfigFormValue(state, ["organizations", "activeId"], pending.id);
                  await saveConfig(state);
                  await loadConfig(state);
                }}
              >Switch</button>
            </div>
          </div>
        </div>`
        : nothing
    }
    <div class="shell ${isChat ? "shell--chat" : ""} ${chatFocus ? "shell--chat-focus" : ""} ${state.settings.navCollapsed ? "shell--nav-collapsed" : ""} ${state.onboarding ? "shell--onboarding" : ""}">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="nav-collapse-toggle"
            @click=${() =>
              state.applySettings({
                ...state.settings,
                navCollapsed: !state.settings.navCollapsed,
              })}
            title="${state.settings.navCollapsed ? t("nav.expand") : t("nav.collapse")}"
            aria-label="${state.settings.navCollapsed ? t("nav.expand") : t("nav.collapse")}"
          >
            <span class="nav-collapse-toggle__icon">${icons.menu}</span>
          </button>
          <div class="brand">
            <div class="brand-logo">
              <img src=${basePath ? `${basePath}/favicon.svg` : "/favicon.svg"} alt="OpenClaw" />
            </div>
            <div class="brand-text">
              <div class="brand-title">OPENCLAW</div>
              <div class="brand-sub">Gateway Dashboard</div>
            </div>
          </div>
        </div>
        <div class="topbar-status">
          <div class="pill">
            <span class="statusDot ${versionStatusClass}"></span>
            <span>${t("common.version")}</span>
            <span class="mono">${openClawVersion}</span>
          </div>
          <div class="pill">
            <span class="statusDot ${state.connected ? "ok" : ""}"></span>
            <span>${t("common.health")}</span>
            <span class="mono">${state.connected ? t("common.ok") : t("common.offline")}</span>
          </div>
          ${
            topbarOrgs.length > 0
              ? html`<div class="pill">
                <span style="opacity:0.6;font-size:11px;">org</span>
                ${
                  topbarOrgs.length === 1
                    ? html`<span class="mono" style="font-size:12px;">${topbarOrgs[0].name}</span>`
                    : html`<select
                      style="background:transparent;border:none;color:inherit;font-size:12px;font-family:inherit;cursor:pointer;padding:0;"
                      .value=${topbarActiveOrgId ?? ""}
                      @change=${(e: Event) => {
                        const newId = (e.target as HTMLSelectElement).value;
                        if (!newId || newId === topbarActiveOrgId) {
                          return;
                        }
                        const orgName = topbarOrgs.find((o) => o.id === newId)?.name ?? newId;
                        state.orgSwitchPending = { id: newId, name: orgName };
                      }}
                    >
                      ${topbarOrgs.map((org) => html`<option value=${org.id}>${org.name}</option>`)}
                    </select>`
                }
              </div>`
              : nothing
          }
          ${renderThemeToggle(state)}
        </div>
      </header>
      <aside class="nav ${state.settings.navCollapsed ? "nav--collapsed" : ""}">
        ${TAB_GROUPS.map((group) => {
          const isGroupCollapsed = state.settings.navGroupsCollapsed[group.label] ?? false;
          const hasActiveTab = group.tabs.some((tab) => tab === state.tab);
          return html`
            <div class="nav-group ${isGroupCollapsed && !hasActiveTab ? "nav-group--collapsed" : ""}">
              <button
                class="nav-label"
                @click=${() => {
                  const next = { ...state.settings.navGroupsCollapsed };
                  next[group.label] = !isGroupCollapsed;
                  state.applySettings({
                    ...state.settings,
                    navGroupsCollapsed: next,
                  });
                }}
                aria-expanded=${!isGroupCollapsed}
              >
                <span class="nav-label__text">${t(`nav.${group.label}`)}</span>
                <span class="nav-label__chevron">${isGroupCollapsed ? "+" : "−"}</span>
              </button>
              <div class="nav-group__items">
                ${group.tabs.map((tab) => renderTab(state, tab))}
              </div>
            </div>
          `;
        })}
        <div class="nav-group nav-group--links">
          <div class="nav-label nav-label--static">
            <span class="nav-label__text">${t("common.resources")}</span>
          </div>
          <div class="nav-group__items">
            <a
              class="nav-item nav-item--external"
              href="https://docs.openclaw.ai"
              target=${EXTERNAL_LINK_TARGET}
              rel=${buildExternalLinkRel()}
              title="${t("common.docs")} (opens in new tab)"
            >
              <span class="nav-item__icon" aria-hidden="true">${icons.book}</span>
              <span class="nav-item__text">${t("common.docs")}</span>
            </a>
          </div>
        </div>
      </aside>
      <main class="content ${isChat ? "content--chat" : ""}">
        ${
          availableUpdate
            ? html`<div class="update-banner callout danger" role="alert">
              <strong>Update available:</strong> v${availableUpdate.latestVersion}
              (running v${availableUpdate.currentVersion}).
              <button
                class="btn btn--sm update-banner__btn"
                ?disabled=${state.updateRunning || !state.connected}
                @click=${() => runUpdate(state)}
              >${state.updateRunning ? "Updating…" : "Update now"}</button>
            </div>`
            : nothing
        }
        <section class="content-header">
          <div>
            ${state.tab === "usage" ? nothing : html`<div class="page-title">${titleForTab(state.tab)}</div>`}
            ${state.tab === "usage" ? nothing : html`<div class="page-sub">${subtitleForTab(state.tab)}</div>`}
          </div>
          <div class="page-meta">
            ${state.lastError ? html`<div class="pill danger">${state.lastError}</div>` : nothing}
            ${isChat ? renderChatControls(state) : nothing}
          </div>
        </section>

        ${
          state.tab === "overview"
            ? renderOverview({
                connected: state.connected,
                hello: state.hello,
                settings: state.settings,
                password: state.password,
                lastError: state.lastError,
                lastErrorCode: state.lastErrorCode,
                presenceCount,
                sessionsCount,
                cronEnabled: state.cronStatus?.enabled ?? null,
                cronNext,
                lastChannelsRefresh: state.channelsLastSuccess,
                onSettingsChange: (next) => state.applySettings(next),
                onPasswordChange: (next) => (state.password = next),
                onSessionKeyChange: (next) => {
                  state.sessionKey = next;
                  state.chatMessage = "";
                  state.resetToolStream();
                  state.applySettings({
                    ...state.settings,
                    sessionKey: next,
                    lastActiveSessionKey: next,
                  });
                  void state.loadAssistantIdentity();
                },
                onConnect: () => state.connect(),
                onRefresh: () => state.loadOverview(),
              })
            : nothing
        }

        ${
          state.tab === "channels"
            ? renderChannels({
                connected: state.connected,
                loading: state.channelsLoading,
                snapshot: state.channelsSnapshot,
                lastError: state.channelsError,
                lastSuccessAt: state.channelsLastSuccess,
                whatsappMessage: state.whatsappLoginMessage,
                whatsappQrDataUrl: state.whatsappLoginQrDataUrl,
                whatsappConnected: state.whatsappLoginConnected,
                whatsappBusy: state.whatsappBusy,
                configSchema: state.configSchema,
                configSchemaLoading: state.configSchemaLoading,
                configForm: state.configForm,
                configUiHints: state.configUiHints,
                configSaving: state.configSaving,
                configFormDirty: state.configFormDirty,
                nostrProfileFormState: state.nostrProfileFormState,
                nostrProfileAccountId: state.nostrProfileAccountId,
                onRefresh: (probe) => loadChannels(state, probe),
                onWhatsAppStart: (force) => state.handleWhatsAppStart(force),
                onWhatsAppWait: () => state.handleWhatsAppWait(),
                onWhatsAppLogout: () => state.handleWhatsAppLogout(),
                onConfigPatch: (path, value) => updateConfigFormValue(state, path, value),
                onConfigSave: () => state.handleChannelConfigSave(),
                onConfigReload: () => state.handleChannelConfigReload(),
                onNostrProfileEdit: (accountId, profile) =>
                  state.handleNostrProfileEdit(accountId, profile),
                onNostrProfileCancel: () => state.handleNostrProfileCancel(),
                onNostrProfileFieldChange: (field, value) =>
                  state.handleNostrProfileFieldChange(field, value),
                onNostrProfileSave: () => state.handleNostrProfileSave(),
                onNostrProfileImport: () => state.handleNostrProfileImport(),
                onNostrProfileToggleAdvanced: () => state.handleNostrProfileToggleAdvanced(),
              })
            : nothing
        }

        ${
          state.tab === "instances"
            ? renderInstances({
                loading: state.presenceLoading,
                entries: state.presenceEntries,
                lastError: state.presenceError,
                statusMessage: state.presenceStatus,
                onRefresh: () => loadPresence(state),
              })
            : nothing
        }

        ${
          state.tab === "sessions"
            ? renderSessions({
                loading: state.sessionsLoading,
                result: state.sessionsResult,
                error: state.sessionsError,
                activeMinutes: state.sessionsFilterActive,
                limit: state.sessionsFilterLimit,
                includeGlobal: state.sessionsIncludeGlobal,
                includeUnknown: state.sessionsIncludeUnknown,
                basePath: state.basePath,
                onFiltersChange: (next) => {
                  state.sessionsFilterActive = next.activeMinutes;
                  state.sessionsFilterLimit = next.limit;
                  state.sessionsIncludeGlobal = next.includeGlobal;
                  state.sessionsIncludeUnknown = next.includeUnknown;
                },
                onRefresh: () => loadSessions(state),
                onPatch: (key, patch) => patchSession(state, key, patch),
                onDelete: (key) => deleteSessionAndRefresh(state, key),
              })
            : nothing
        }

        ${renderUsageTab(state)}

        ${
          state.tab === "cron"
            ? renderCron({
                basePath: state.basePath,
                loading: state.cronLoading,
                jobsLoadingMore: state.cronJobsLoadingMore,
                status: state.cronStatus,
                jobs: visibleCronJobs,
                jobsTotal: state.cronJobsTotal,
                jobsHasMore: state.cronJobsHasMore,
                jobsQuery: state.cronJobsQuery,
                jobsEnabledFilter: state.cronJobsEnabledFilter,
                jobsScheduleKindFilter: state.cronJobsScheduleKindFilter,
                jobsLastStatusFilter: state.cronJobsLastStatusFilter,
                jobsSortBy: state.cronJobsSortBy,
                jobsSortDir: state.cronJobsSortDir,
                error: state.cronError,
                busy: state.cronBusy,
                form: state.cronForm,
                fieldErrors: state.cronFieldErrors,
                canSubmit: !hasCronFormErrors(state.cronFieldErrors),
                editingJobId: state.cronEditingJobId,
                channels: state.channelsSnapshot?.channelMeta?.length
                  ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
                  : (state.channelsSnapshot?.channelOrder ?? []),
                channelLabels: state.channelsSnapshot?.channelLabels ?? {},
                channelMeta: state.channelsSnapshot?.channelMeta ?? [],
                runsJobId: state.cronRunsJobId,
                runs: state.cronRuns,
                runsTotal: state.cronRunsTotal,
                runsHasMore: state.cronRunsHasMore,
                runsLoadingMore: state.cronRunsLoadingMore,
                runsScope: state.cronRunsScope,
                runsStatuses: state.cronRunsStatuses,
                runsDeliveryStatuses: state.cronRunsDeliveryStatuses,
                runsStatusFilter: state.cronRunsStatusFilter,
                runsQuery: state.cronRunsQuery,
                runsSortDir: state.cronRunsSortDir,
                agentSuggestions: cronAgentSuggestions,
                modelSuggestions: cronModelSuggestions,
                thinkingSuggestions: CRON_THINKING_SUGGESTIONS,
                timezoneSuggestions: CRON_TIMEZONE_SUGGESTIONS,
                deliveryToSuggestions,
                accountSuggestions,
                onFormChange: (patch) => {
                  state.cronForm = normalizeCronFormState({ ...state.cronForm, ...patch });
                  state.cronFieldErrors = validateCronForm(state.cronForm);
                },
                onRefresh: () => state.loadCron(),
                onAdd: () => addCronJob(state),
                onEdit: (job) => startCronEdit(state, job),
                onClone: (job) => startCronClone(state, job),
                onCancelEdit: () => cancelCronEdit(state),
                onToggle: (job, enabled) => toggleCronJob(state, job, enabled),
                onRun: (job, mode) => runCronJob(state, job, mode ?? "force"),
                onRemove: (job) => removeCronJob(state, job),
                onLoadRuns: async (jobId) => {
                  updateCronRunsFilter(state, { cronRunsScope: "job" });
                  await loadCronRuns(state, jobId);
                },
                onLoadMoreJobs: () => loadMoreCronJobs(state),
                onJobsFiltersChange: async (patch) => {
                  updateCronJobsFilter(state, patch);
                  const shouldReload =
                    typeof patch.cronJobsQuery === "string" ||
                    Boolean(patch.cronJobsEnabledFilter) ||
                    Boolean(patch.cronJobsSortBy) ||
                    Boolean(patch.cronJobsSortDir);
                  if (shouldReload) {
                    await reloadCronJobs(state);
                  }
                },
                onJobsFiltersReset: async () => {
                  updateCronJobsFilter(state, {
                    cronJobsQuery: "",
                    cronJobsEnabledFilter: "all",
                    cronJobsScheduleKindFilter: "all",
                    cronJobsLastStatusFilter: "all",
                    cronJobsSortBy: "nextRunAtMs",
                    cronJobsSortDir: "asc",
                  });
                  await reloadCronJobs(state);
                },
                onLoadMoreRuns: () => loadMoreCronRuns(state),
                onRunsFiltersChange: async (patch) => {
                  updateCronRunsFilter(state, patch);
                  if (state.cronRunsScope === "all") {
                    await loadCronRuns(state, null);
                    return;
                  }
                  await loadCronRuns(state, state.cronRunsJobId);
                },
              })
            : nothing
        }

        ${
          state.tab === "agents"
            ? renderAgents({
                loading: state.agentsLoading,
                error: state.agentsError,
                agentsList: orgFilteredAgentsList,
                selectedAgentId: resolvedAgentId,
                activePanel: state.agentsPanel,
                configForm: configValue,
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                channelsLoading: state.channelsLoading,
                channelsError: state.channelsError,
                channelsSnapshot: state.channelsSnapshot,
                channelsLastSuccess: state.channelsLastSuccess,
                cronLoading: state.cronLoading,
                cronStatus: state.cronStatus,
                cronJobs: state.cronJobs,
                cronError: state.cronError,
                agentFilesLoading: state.agentFilesLoading,
                agentFilesError: state.agentFilesError,
                agentFilesList: state.agentFilesList,
                agentFileActive: state.agentFileActive,
                agentFileContents: state.agentFileContents,
                agentFileDrafts: state.agentFileDrafts,
                agentFileSaving: state.agentFileSaving,
                agentIdentityLoading: state.agentIdentityLoading,
                agentIdentityError: state.agentIdentityError,
                agentIdentityById: state.agentIdentityById,
                agentSkillsLoading: state.agentSkillsLoading,
                agentSkillsReport: state.agentSkillsReport,
                agentSkillsError: state.agentSkillsError,
                agentSkillsAgentId: state.agentSkillsAgentId,
                toolsCatalogLoading: state.toolsCatalogLoading,
                toolsCatalogError: state.toolsCatalogError,
                toolsCatalogResult: state.toolsCatalogResult,
                skillsFilter: state.skillsFilter,
                agentCreateOpen: state.agentCreateOpen,
                agentCreateName: state.agentCreateName,
                agentCreateId: state.agentCreateId,
                agentCreateSaving: state.agentCreateSaving,
                agentCreateError: state.agentCreateError,
                onCreateOpen: () => {
                  state.agentCreateOpen = true;
                  state.agentCreateError = null;
                },
                onCreateCancel: () => {
                  state.agentCreateOpen = false;
                  state.agentCreateName = "";
                  state.agentCreateId = "";
                  state.agentCreateError = null;
                },
                onCreateNameChange: (val) => {
                  // Auto-fill ID when it still matches the slug of the previous name.
                  const prevSlug = slugifyAgentId(state.agentCreateName);
                  state.agentCreateName = val;
                  if (!state.agentCreateId.trim() || state.agentCreateId === prevSlug) {
                    state.agentCreateId = slugifyAgentId(val);
                  }
                },
                onCreateIdChange: (val) => {
                  state.agentCreateId = val;
                },
                onCreate: async () => {
                  const id = state.agentCreateId.trim();
                  const name = state.agentCreateName.trim();
                  if (!id) {
                    state.agentCreateError = "Agent ID is required.";
                    return;
                  }
                  if (!/^[a-z0-9_-]+$/.test(id)) {
                    state.agentCreateError =
                      "Agent ID may only contain lowercase letters, digits, underscores, and hyphens.";
                    return;
                  }
                  // Ensure config is loaded.
                  if (!state.configForm) {
                    await loadConfig(state);
                  }
                  const config = getCurrentConfigValue();
                  if (findAgentConfigEntryIndex(config, id) >= 0) {
                    state.agentCreateError = `Agent "${id}" already exists.`;
                    return;
                  }
                  state.agentCreateSaving = true;
                  state.agentCreateError = null;
                  try {
                    const list = (config as { agents?: { list?: unknown[] } } | null)?.agents?.list;
                    const nextIndex = Array.isArray(list) ? list.length : 0;
                    const entry: Record<string, unknown> = { id };
                    if (name) {
                      entry["name"] = name;
                    }
                    // Assign to active org so the agent is visible under that org's filter.
                    if (topbarActiveOrgId) {
                      entry["organizationId"] = topbarActiveOrgId;
                    }
                    updateConfigFormValue(state, ["agents", "list", nextIndex], entry);
                    await saveAgentsConfig(state);
                    state.agentsSelectedId = id;
                    state.agentCreateOpen = false;
                    state.agentCreateName = "";
                    state.agentCreateId = "";
                  } catch (err) {
                    state.agentCreateError = String(err);
                  } finally {
                    state.agentCreateSaving = false;
                  }
                },
                agentEditOpen: state.agentEditOpen,
                agentEditName: state.agentEditName,
                agentEditSaving: state.agentEditSaving,
                agentEditError: state.agentEditError,
                onEditOpen: () => {
                  const agent = orgFilteredAgentsList?.agents?.find(
                    (a) => a.id === resolvedAgentId,
                  );
                  state.agentEditName = agent
                    ? normalizeAgentLabel(agent)
                    : (resolvedAgentId ?? "");
                  state.agentEditOpen = true;
                  state.agentEditError = null;
                  state.agentDeleteConfirming = false;
                },
                onEditCancel: () => {
                  state.agentEditOpen = false;
                  state.agentEditName = "";
                  state.agentEditError = null;
                },
                onEditNameChange: (val) => {
                  state.agentEditName = val;
                },
                onEditSave: async () => {
                  const agentId = resolvedAgentId;
                  const name = state.agentEditName.trim();
                  if (!agentId || !name) {
                    state.agentEditError = "Name cannot be empty.";
                    return;
                  }
                  const index = findAgentIndex(agentId);
                  if (index < 0) {
                    state.agentEditError = "Agent not found in config.";
                    return;
                  }
                  state.agentEditSaving = true;
                  state.agentEditError = null;
                  try {
                    updateConfigFormValue(state, ["agents", "list", index, "name"], name);
                    await saveAgentsConfig(state);
                    state.agentEditOpen = false;
                    state.agentEditName = "";
                  } catch (err) {
                    state.agentEditError = String(err);
                  } finally {
                    state.agentEditSaving = false;
                  }
                },
                agentDeleteConfirming: state.agentDeleteConfirming,
                agentDeleteSaving: state.agentDeleteSaving,
                onDeleteOpen: () => {
                  state.agentDeleteConfirming = true;
                  state.agentEditOpen = false;
                },
                onDeleteCancel: () => {
                  state.agentDeleteConfirming = false;
                },
                onDeleteConfirm: async () => {
                  const agentId = resolvedAgentId;
                  if (!agentId) {
                    return;
                  }
                  if (!state.configForm) {
                    await loadConfig(state);
                  }
                  const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)
                    ?.agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const filtered = list.filter(
                    (e) =>
                      !(
                        e &&
                        typeof e === "object" &&
                        "id" in e &&
                        (e as { id?: string }).id === agentId
                      ),
                  );
                  state.agentDeleteSaving = true;
                  try {
                    updateConfigFormValue(state, ["agents", "list"], filtered);
                    await saveAgentsConfig(state);
                    state.agentDeleteConfirming = false;
                    state.agentsSelectedId = null;
                  } catch {
                    // restore and surface error by keeping confirming state open
                    state.agentDeleteConfirming = true;
                  } finally {
                    state.agentDeleteSaving = false;
                  }
                },
                onRefresh: async () => {
                  await loadAgents(state);
                  const nextSelected =
                    state.agentsSelectedId ??
                    orgFilteredAgentsList?.defaultId ??
                    orgFilteredAgentsList?.agents?.[0]?.id ??
                    null;
                  await loadToolsCatalog(state, nextSelected);
                  const agentIds = orgFilteredAgentsList?.agents?.map((entry) => entry.id) ?? [];
                  if (agentIds.length > 0) {
                    void loadAgentIdentities(state, agentIds);
                  }
                },
                onSelectAgent: (agentId) => {
                  if (state.agentsSelectedId === agentId) {
                    return;
                  }
                  state.agentsSelectedId = agentId;
                  state.agentEditOpen = false;
                  state.agentEditName = "";
                  state.agentEditError = null;
                  state.agentDeleteConfirming = false;
                  state.agentFilesList = null;
                  state.agentFilesError = null;
                  state.agentFilesLoading = false;
                  state.agentFileActive = null;
                  state.agentFileContents = {};
                  state.agentFileDrafts = {};
                  state.agentSkillsReport = null;
                  state.agentSkillsError = null;
                  state.agentSkillsAgentId = null;
                  void loadAgentIdentity(state, agentId);
                  if (state.agentsPanel === "tools") {
                    void loadToolsCatalog(state, agentId);
                  }
                  if (state.agentsPanel === "files") {
                    void loadAgentFiles(state, agentId);
                  }
                  if (state.agentsPanel === "skills") {
                    void loadAgentSkills(state, agentId);
                  }
                },
                onSelectPanel: (panel) => {
                  state.agentsPanel = panel;
                  if (panel === "files" && resolvedAgentId) {
                    if (state.agentFilesList?.agentId !== resolvedAgentId) {
                      state.agentFilesList = null;
                      state.agentFilesError = null;
                      state.agentFileActive = null;
                      state.agentFileContents = {};
                      state.agentFileDrafts = {};
                      void loadAgentFiles(state, resolvedAgentId);
                    }
                  }
                  if (panel === "tools") {
                    void loadToolsCatalog(state, resolvedAgentId);
                  }
                  if (panel === "skills") {
                    if (resolvedAgentId) {
                      void loadAgentSkills(state, resolvedAgentId);
                    }
                  }
                  if (panel === "channels") {
                    void loadChannels(state, false);
                  }
                  if (panel === "cron") {
                    void state.loadCron();
                  }
                },
                onLoadFiles: (agentId) => loadAgentFiles(state, agentId),
                onSelectFile: (name) => {
                  state.agentFileActive = name;
                  if (!resolvedAgentId) {
                    return;
                  }
                  void loadAgentFileContent(state, resolvedAgentId, name);
                },
                onFileDraftChange: (name, content) => {
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
                },
                onFileReset: (name) => {
                  const base = state.agentFileContents[name] ?? "";
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
                },
                onFileSave: (name) => {
                  if (!resolvedAgentId) {
                    return;
                  }
                  const content =
                    state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
                  void saveAgentFile(state, resolvedAgentId, name, content);
                },
                onToolsProfileChange: (agentId, profile, clearAllow) => {
                  const index =
                    profile || clearAllow ? ensureAgentIndex(agentId) : findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (profile) {
                    updateConfigFormValue(state, [...basePath, "profile"], profile);
                  } else {
                    removeConfigFormValue(state, [...basePath, "profile"]);
                  }
                  if (clearAllow) {
                    removeConfigFormValue(state, [...basePath, "allow"]);
                  }
                },
                onToolsOverridesChange: (agentId, alsoAllow, deny) => {
                  const index =
                    alsoAllow.length > 0 || deny.length > 0
                      ? ensureAgentIndex(agentId)
                      : findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (alsoAllow.length > 0) {
                    updateConfigFormValue(state, [...basePath, "alsoAllow"], alsoAllow);
                  } else {
                    removeConfigFormValue(state, [...basePath, "alsoAllow"]);
                  }
                  if (deny.length > 0) {
                    updateConfigFormValue(state, [...basePath, "deny"], deny);
                  } else {
                    removeConfigFormValue(state, [...basePath, "deny"]);
                  }
                },
                onConfigReload: () => loadConfig(state),
                onConfigSave: () => saveAgentsConfig(state),
                onChannelsRefresh: () => loadChannels(state, false),
                onCronRefresh: () => state.loadCron(),
                onSkillsFilterChange: (next) => (state.skillsFilter = next),
                onSkillsRefresh: () => {
                  if (resolvedAgentId) {
                    void loadAgentSkills(state, resolvedAgentId);
                  }
                },
                onAgentSkillToggle: (agentId, skillName, enabled) => {
                  const index = ensureAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)
                    ?.agents?.list;
                  const entry = Array.isArray(list)
                    ? (list[index] as { skills?: unknown })
                    : undefined;
                  const normalizedSkill = skillName.trim();
                  if (!normalizedSkill) {
                    return;
                  }
                  const allSkills =
                    state.agentSkillsReport?.skills?.map((skill) => skill.name).filter(Boolean) ??
                    [];
                  const existing = Array.isArray(entry?.skills)
                    ? entry.skills.map((name) => String(name).trim()).filter(Boolean)
                    : undefined;
                  const base = existing ?? allSkills;
                  const next = new Set(base);
                  if (enabled) {
                    next.add(normalizedSkill);
                  } else {
                    next.delete(normalizedSkill);
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], [...next]);
                },
                onAgentSkillsClear: (agentId) => {
                  const index = findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  removeConfigFormValue(state, ["agents", "list", index, "skills"]);
                },
                onAgentSkillsDisableAll: (agentId) => {
                  const index = ensureAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], []);
                },
                onModelChange: (agentId, modelId) => {
                  const index = modelId ? ensureAgentIndex(agentId) : findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)
                    ?.agents?.list;
                  const basePath = ["agents", "list", index, "model"];
                  if (!modelId) {
                    removeConfigFormValue(state, basePath);
                    return;
                  }
                  const entry = Array.isArray(list)
                    ? (list[index] as { model?: unknown })
                    : undefined;
                  const existing = entry?.model;
                  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                    const fallbacks = (existing as { fallbacks?: unknown }).fallbacks;
                    const next = {
                      primary: modelId,
                      ...(Array.isArray(fallbacks) ? { fallbacks } : {}),
                    };
                    updateConfigFormValue(state, basePath, next);
                  } else {
                    updateConfigFormValue(state, basePath, modelId);
                  }
                },
                onOrganizationChange: (agentId, organizationId) => {
                  const index = ensureAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "organizationId"];
                  if (!organizationId) {
                    removeConfigFormValue(state, basePath);
                  } else {
                    updateConfigFormValue(state, basePath, organizationId);
                  }
                },
                onModelFallbacksChange: (agentId, fallbacks) => {
                  const normalized = fallbacks.map((name) => name.trim()).filter(Boolean);
                  const currentConfig = getCurrentConfigValue();
                  const resolvedConfig = resolveAgentConfig(currentConfig, agentId);
                  const effectivePrimary =
                    resolveModelPrimary(resolvedConfig.entry?.model) ??
                    resolveModelPrimary(resolvedConfig.defaults?.model);
                  const effectiveFallbacks = resolveEffectiveModelFallbacks(
                    resolvedConfig.entry?.model,
                    resolvedConfig.defaults?.model,
                  );
                  const index =
                    normalized.length > 0
                      ? effectivePrimary
                        ? ensureAgentIndex(agentId)
                        : -1
                      : (effectiveFallbacks?.length ?? 0) > 0 || findAgentIndex(agentId) >= 0
                        ? ensureAgentIndex(agentId)
                        : -1;
                  if (index < 0) {
                    return;
                  }
                  const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)
                    ?.agents?.list;
                  const basePath = ["agents", "list", index, "model"];
                  const entry = Array.isArray(list)
                    ? (list[index] as { model?: unknown })
                    : undefined;
                  const existing = entry?.model;
                  const resolvePrimary = () => {
                    if (typeof existing === "string") {
                      return existing.trim() || null;
                    }
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const primary = (existing as { primary?: unknown }).primary;
                      if (typeof primary === "string") {
                        const trimmed = primary.trim();
                        return trimmed || null;
                      }
                    }
                    return null;
                  };
                  const primary = resolvePrimary() ?? effectivePrimary;
                  if (normalized.length === 0) {
                    if (primary) {
                      updateConfigFormValue(state, basePath, primary);
                    } else {
                      removeConfigFormValue(state, basePath);
                    }
                    return;
                  }
                  if (!primary) {
                    return;
                  }
                  updateConfigFormValue(state, basePath, { primary, fallbacks: normalized });
                },
              })
            : nothing
        }

        ${
          state.tab === "skills"
            ? renderSkills({
                loading: state.skillsLoading,
                report: state.skillsReport,
                error: state.skillsError,
                filter: state.skillsFilter,
                edits: state.skillEdits,
                messages: state.skillMessages,
                busyKey: state.skillsBusyKey,
                onFilterChange: (next) => (state.skillsFilter = next),
                onRefresh: () => loadSkills(state, { clearMessages: true }),
                onToggle: (key, enabled) => updateSkillEnabled(state, key, enabled),
                onEdit: (key, value) => updateSkillEdit(state, key, value),
                onSaveKey: (key) => saveSkillApiKey(state, key),
                onInstall: (skillKey, name, installId) =>
                  installSkill(state, skillKey, name, installId),
              })
            : nothing
        }

        ${
          state.tab === "nodes"
            ? renderNodes({
                loading: state.nodesLoading,
                nodes: state.nodes,
                devicesLoading: state.devicesLoading,
                devicesError: state.devicesError,
                devicesList: state.devicesList,
                configForm:
                  state.configForm ??
                  (state.configSnapshot?.config as Record<string, unknown> | null),
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                configFormMode: state.configFormMode,
                execApprovalsLoading: state.execApprovalsLoading,
                execApprovalsSaving: state.execApprovalsSaving,
                execApprovalsDirty: state.execApprovalsDirty,
                execApprovalsSnapshot: state.execApprovalsSnapshot,
                execApprovalsForm: state.execApprovalsForm,
                execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
                execApprovalsTarget: state.execApprovalsTarget,
                execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
                onRefresh: () => loadNodes(state),
                onDevicesRefresh: () => loadDevices(state),
                onDeviceApprove: (requestId) => approveDevicePairing(state, requestId),
                onDeviceReject: (requestId) => rejectDevicePairing(state, requestId),
                onDeviceRotate: (deviceId, role, scopes) =>
                  rotateDeviceToken(state, { deviceId, role, scopes }),
                onDeviceRevoke: (deviceId, role) => revokeDeviceToken(state, { deviceId, role }),
                onLoadConfig: () => loadConfig(state),
                onLoadExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return loadExecApprovals(state, target);
                },
                onBindDefault: (nodeId) => {
                  if (nodeId) {
                    updateConfigFormValue(state, ["tools", "exec", "node"], nodeId);
                  } else {
                    removeConfigFormValue(state, ["tools", "exec", "node"]);
                  }
                },
                onBindAgent: (agentIndex, nodeId) => {
                  const basePath = ["agents", "list", agentIndex, "tools", "exec", "node"];
                  if (nodeId) {
                    updateConfigFormValue(state, basePath, nodeId);
                  } else {
                    removeConfigFormValue(state, basePath);
                  }
                },
                onSaveBindings: () => saveConfig(state),
                onExecApprovalsTargetChange: (kind, nodeId) => {
                  state.execApprovalsTarget = kind;
                  state.execApprovalsTargetNodeId = nodeId;
                  state.execApprovalsSnapshot = null;
                  state.execApprovalsForm = null;
                  state.execApprovalsDirty = false;
                  state.execApprovalsSelectedAgent = null;
                },
                onExecApprovalsSelectAgent: (agentId) => {
                  state.execApprovalsSelectedAgent = agentId;
                },
                onExecApprovalsPatch: (path, value) =>
                  updateExecApprovalsFormValue(state, path, value),
                onExecApprovalsRemove: (path) => removeExecApprovalsFormValue(state, path),
                onSaveExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return saveExecApprovals(state, target);
                },
              })
            : nothing
        }

        ${
          state.tab === "chat"
            ? renderChat({
                sessionKey: state.sessionKey,
                onSessionKeyChange: (next) => {
                  state.sessionKey = next;
                  state.chatMessage = "";
                  state.chatAttachments = [];
                  state.chatStream = null;
                  state.chatStreamStartedAt = null;
                  state.chatRunId = null;
                  state.chatQueue = [];
                  state.resetToolStream();
                  state.resetChatScroll();
                  state.applySettings({
                    ...state.settings,
                    sessionKey: next,
                    lastActiveSessionKey: next,
                  });
                  void state.loadAssistantIdentity();
                  void loadChatHistory(state);
                  void refreshChatAvatar(state);
                },
                thinkingLevel: state.chatThinkingLevel,
                showThinking,
                loading: state.chatLoading,
                sending: state.chatSending,
                compactionStatus: state.compactionStatus,
                fallbackStatus: state.fallbackStatus,
                assistantAvatarUrl: chatAvatarUrl,
                messages: state.chatMessages,
                toolMessages: state.chatToolMessages,
                streamSegments: state.chatStreamSegments,
                stream: state.chatStream,
                streamStartedAt: state.chatStreamStartedAt,
                draft: state.chatMessage,
                queue: state.chatQueue,
                connected: state.connected,
                canSend: state.connected,
                disabledReason: chatDisabledReason,
                error: state.lastError,
                sessions: state.sessionsResult,
                focusMode: chatFocus,
                onRefresh: () => {
                  state.resetToolStream();
                  return Promise.all([loadChatHistory(state), refreshChatAvatar(state)]);
                },
                onToggleFocusMode: () => {
                  if (state.onboarding) {
                    return;
                  }
                  state.applySettings({
                    ...state.settings,
                    chatFocusMode: !state.settings.chatFocusMode,
                  });
                },
                onChatScroll: (event) => state.handleChatScroll(event),
                onDraftChange: (next) => (state.chatMessage = next),
                attachments: state.chatAttachments,
                onAttachmentsChange: (next) => (state.chatAttachments = next),
                onSend: () => state.handleSendChat(),
                canAbort: Boolean(state.chatRunId),
                onAbort: () => void state.handleAbortChat(),
                onQueueRemove: (id) => state.removeQueuedMessage(id),
                onNewSession: () => state.handleSendChat("/new", { restoreDraft: true }),
                showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
                onScrollToBottom: () => state.scrollToBottom(),
                // Sidebar props for tool output viewing
                sidebarOpen: state.sidebarOpen,
                sidebarContent: state.sidebarContent,
                sidebarError: state.sidebarError,
                splitRatio: state.splitRatio,
                onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
                onCloseSidebar: () => state.handleCloseSidebar(),
                onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
                assistantName: state.assistantName,
                assistantAvatar: state.assistantAvatar,
              })
            : nothing
        }

        ${
          state.tab === "config"
            ? renderConfig({
                raw: state.configRaw,
                originalRaw: state.configRawOriginal,
                valid: state.configValid,
                issues: state.configIssues,
                loading: state.configLoading,
                saving: state.configSaving,
                applying: state.configApplying,
                updating: state.updateRunning,
                connected: state.connected,
                schema: state.configSchema,
                schemaLoading: state.configSchemaLoading,
                uiHints: state.configUiHints,
                formMode: state.configFormMode,
                formValue: state.configForm,
                originalValue: state.configFormOriginal,
                searchQuery: state.configSearchQuery,
                activeSection: state.configActiveSection,
                activeSubsection: state.configActiveSubsection,
                onRawChange: (next) => {
                  state.configRaw = next;
                },
                onFormModeChange: (mode) => (state.configFormMode = mode),
                onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                onSearchChange: (query) => (state.configSearchQuery = query),
                onSectionChange: (section) => {
                  state.configActiveSection = section;
                  state.configActiveSubsection = null;
                },
                onSubsectionChange: (section) => (state.configActiveSubsection = section),
                onReload: () => loadConfig(state),
                onSave: () => saveConfig(state),
                onApply: () => applyConfig(state),
                onUpdate: () => runUpdate(state),
              })
            : nothing
        }

        ${
          state.tab === "organizations"
            ? (() => {
                const cfg = state.configSnapshot?.config;
                const orgBlock =
                  cfg?.organizations != null && typeof cfg.organizations === "object"
                    ? (cfg.organizations as { list?: unknown[]; activeId?: string })
                    : null;
                type OrgEntry = {
                  id: string;
                  name: string;
                  description?: string;
                  createdAt?: string;
                  openaiApiKey?: string;
                };
                const orgs = Array.isArray(orgBlock?.list) ? (orgBlock.list as OrgEntry[]) : [];
                const activeOrgId =
                  typeof orgBlock?.activeId === "string" ? orgBlock.activeId : null;

                function slugifyOrgName(name: string): string {
                  return (
                    "org_" +
                    name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "_")
                      .replace(/^_+|_+$/g, "")
                      .slice(0, 48)
                  );
                }

                async function orgSaveWith(patch: Record<string, unknown>, clearCreate = true) {
                  if (!state.configForm) {
                    await loadConfig(state);
                  }
                  if (!state.configForm) {
                    state.orgLastError = "Failed to load config.";
                    return;
                  }
                  state.orgSaving = true;
                  state.orgLastError = null;
                  try {
                    Object.assign(state.configForm, patch);
                    state.configFormDirty = true;
                    await saveConfig(state);
                    await loadConfig(state);
                  } catch (err) {
                    state.orgLastError = String(err);
                  } finally {
                    state.orgSaving = false;
                    if (clearCreate) {
                      state.orgCreateName = "";
                      state.orgCreateId = "";
                      state.orgCreateDescription = "";
                      state.orgCreateOpenAiKey = "";
                    }
                  }
                }

                return renderOrganizations({
                  loading: state.configLoading,
                  saving: state.orgSaving,
                  lastError: state.orgLastError,
                  organizations: orgs,
                  activeOrganizationId: activeOrgId,
                  createName: state.orgCreateName,
                  createId: state.orgCreateId,
                  createDescription: state.orgCreateDescription,
                  createOpenAiKey: state.orgCreateOpenAiKey,
                  editingId: state.orgEditingId,
                  editName: state.orgEditName,
                  editDescription: state.orgEditDescription,
                  editOpenAiKey: state.orgEditOpenAiKey,
                  onRefresh: () => loadConfig(state),
                  onCreateNameChange: (val) => (state.orgCreateName = val),
                  onCreateIdChange: (val) => (state.orgCreateId = val),
                  onCreateDescriptionChange: (val) => (state.orgCreateDescription = val),
                  onCreateOpenAiKeyChange: (val) => (state.orgCreateOpenAiKey = val),
                  onCreate: async () => {
                    const name = state.orgCreateName.trim();
                    const id = state.orgCreateId.trim() || slugifyOrgName(name);
                    if (!name) {
                      return;
                    }
                    if (orgs.some((o) => o.id === id)) {
                      state.orgLastError = `Organization "${id}" already exists.`;
                      return;
                    }
                    const newOrg: OrgEntry = {
                      id,
                      name,
                      ...(state.orgCreateDescription.trim()
                        ? { description: state.orgCreateDescription.trim() }
                        : {}),
                      ...(state.orgCreateOpenAiKey.trim()
                        ? { openaiApiKey: state.orgCreateOpenAiKey.trim() }
                        : {}),
                      createdAt: new Date().toISOString(),
                    };
                    await orgSaveWith({
                      organizations: { ...orgBlock, list: [...orgs, newOrg] },
                    });
                  },
                  onEditStart: (org) => {
                    state.orgEditingId = org.id;
                    state.orgEditName = org.name;
                    state.orgEditDescription = org.description ?? "";
                    state.orgEditOpenAiKey = "";
                  },
                  onEditCancel: () => {
                    state.orgEditingId = null;
                    state.orgEditName = "";
                    state.orgEditDescription = "";
                    state.orgEditOpenAiKey = "";
                  },
                  onEditNameChange: (val) => (state.orgEditName = val),
                  onEditDescriptionChange: (val) => (state.orgEditDescription = val),
                  onEditOpenAiKeyChange: (val) => (state.orgEditOpenAiKey = val),
                  onUpdate: async () => {
                    const editId = state.orgEditingId;
                    if (!editId) {
                      return;
                    }
                    const existingOrg = orgs.find((o) => o.id === editId);
                    if (!existingOrg) {
                      return;
                    }
                    const updatedOrg: OrgEntry = {
                      ...existingOrg,
                      name: state.orgEditName.trim() || existingOrg.name,
                      description: state.orgEditDescription.trim() || undefined,
                      // Only update key if user typed a new one; blank = keep existing
                      ...(state.orgEditOpenAiKey.trim()
                        ? { openaiApiKey: state.orgEditOpenAiKey.trim() }
                        : {}),
                    };
                    const nextList = orgs.map((o) => (o.id === editId ? updatedOrg : o));
                    await orgSaveWith({ organizations: { ...orgBlock, list: nextList } }, false);
                    state.orgEditingId = null;
                    state.orgEditName = "";
                    state.orgEditDescription = "";
                    state.orgEditOpenAiKey = "";
                  },
                  onSwitch: (id) => {
                    const orgName = orgs.find((o) => o.id === id)?.name ?? id;
                    state.orgSwitchPending = { id, name: orgName };
                  },
                  onDelete: (id) => {
                    const nextList = orgs.filter((o) => o.id !== id);
                    const patch: Record<string, unknown> = {
                      organizations: {
                        ...orgBlock,
                        list: nextList.length > 0 ? nextList : undefined,
                        activeId: activeOrgId === id ? undefined : activeOrgId,
                      },
                    };
                    return orgSaveWith(patch);
                  },
                });
              })()
            : nothing
        }

        ${
          state.tab === "debug"
            ? renderDebug({
                loading: state.debugLoading,
                status: state.debugStatus,
                health: state.debugHealth,
                models: state.debugModels,
                heartbeat: state.debugHeartbeat,
                eventLog: state.eventLog,
                methods: (state.hello?.features?.methods ?? []).toSorted(),
                callMethod: state.debugCallMethod,
                callParams: state.debugCallParams,
                callResult: state.debugCallResult,
                callError: state.debugCallError,
                onCallMethodChange: (next) => (state.debugCallMethod = next),
                onCallParamsChange: (next) => (state.debugCallParams = next),
                onRefresh: () => loadDebug(state),
                onCall: () => callDebugMethod(state),
              })
            : nothing
        }

        ${
          state.tab === "logs"
            ? renderLogs({
                loading: state.logsLoading,
                error: state.logsError,
                file: state.logsFile,
                entries: state.logsEntries,
                filterText: state.logsFilterText,
                levelFilters: state.logsLevelFilters,
                autoFollow: state.logsAutoFollow,
                truncated: state.logsTruncated,
                onFilterTextChange: (next) => (state.logsFilterText = next),
                onLevelToggle: (level, enabled) => {
                  state.logsLevelFilters = { ...state.logsLevelFilters, [level]: enabled };
                },
                onToggleAutoFollow: (next) => (state.logsAutoFollow = next),
                onRefresh: () => loadLogs(state, { reset: true }),
                onExport: (lines, label) => state.exportLogs(lines, label),
                onScroll: (event) => state.handleLogsScroll(event),
              })
            : nothing
        }
      </main>
      ${renderExecApprovalPrompt(state)}
      ${renderGatewayUrlConfirmation(state)}
    </div>
  `;
}
