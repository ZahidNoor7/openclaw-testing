/**
 * Multi-tenancy helpers: organization-aware agent filtering, session
 * namespace resolution, and per-org model configuration.
 *
 * Design: organizations are stored under `organizations.list[]` in
 * openclaw.json.  The currently-active org is set via `organizations.activeId`.
 * Each agent may carry an optional `organizationId` field that scopes it to
 * one org.  Agents without `organizationId` are "global" and are available in
 * every org context (and in single-user / no-org mode).
 */

import type { ModelProviderConfig } from "./types.models.js";
import type { OpenClawConfig, OrganizationConfig } from "./types.openclaw.js";

export type { OrganizationConfig };

/**
 * Default base URLs for known providers. Used when injecting a key for a
 * provider that has no existing entry in `models.providers`.
 */
const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  xai: "https://api.x.ai/v1",
  cohere: "https://api.cohere.ai/v1",
  perplexity: "https://api.perplexity.ai",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
};

/**
 * Return all organizations defined in the config, or an empty array when
 * multi-tenancy is not configured.
 */
export function listOrganizations(config: OpenClawConfig): OrganizationConfig[] {
  return config.organizations?.list ?? [];
}

/**
 * Find an organization by its ID, or undefined when not found.
 */
export function findOrganization(
  config: OpenClawConfig,
  orgId: string,
): OrganizationConfig | undefined {
  return listOrganizations(config).find((org) => org.id === orgId);
}

/**
 * Return the currently-active organization, or undefined when none is set or
 * multi-tenancy is not configured.
 */
export function getActiveOrganization(config: OpenClawConfig): OrganizationConfig | undefined {
  const activeId = config.organizations?.activeId?.trim();
  if (!activeId) {
    return undefined;
  }
  return findOrganization(config, activeId);
}

/**
 * Return the agents that should be active given an organization context.
 *
 * Rules:
 *  - If `orgId` is provided, include agents whose `organizationId` matches
 *    `orgId` **plus** agents with no `organizationId` (global agents).
 *  - If `orgId` is undefined/empty (single-user / no-org mode), return all
 *    agents so that existing single-tenant configs continue to work unchanged.
 */
export function getAgentsForOrganization(
  config: OpenClawConfig,
  orgId: string | undefined,
): NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]> {
  const agents = config.agents?.list ?? [];
  if (!orgId) {
    // No active org → single-user mode; surface all agents.
    return agents;
  }
  return agents.filter((agent) => !agent.organizationId || agent.organizationId === orgId);
}

/**
 * Convenience wrapper that reads the active org from the config and returns
 * the filtered agent list.
 */
export function getAgentsForActiveOrganization(
  config: OpenClawConfig,
): NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]> {
  return getAgentsForOrganization(config, config.organizations?.activeId?.trim());
}

/**
 * Core helper: inject an org's provider API keys into `config.models.providers`.
 *
 * Resolution order (highest priority last wins per provider):
 *  1. Legacy `apiKeys[]` entries (deprecated alias — kept for old configs)
 *  2. `providerKeys[]` entries (current field — overrides apiKeys for same provider)
 *  3. Deprecated top-level `openaiApiKey` field (used when no OpenAI entry in either array)
 *
 * Only enabled keys are injected. First enabled key per provider wins within
 * each array; `providerKeys` overrides `apiKeys` for the same provider.
 *
 * The injected provider entry gets `auth: "api-key"` to ensure model-auth
 * uses the config key directly, bypassing any stored auth profiles.
 */
function applyOrgProviderKeys(config: OpenClawConfig, org: OrganizationConfig): OpenClawConfig {
  // Collect the first enabled key per provider.
  // Process apiKeys (legacy) first, then providerKeys (current) so providerKeys wins.
  const keysByProvider = new Map<string, string>();

  for (const entry of org.apiKeys ?? []) {
    if (entry.enabled && entry.key?.trim() && !keysByProvider.has(entry.provider)) {
      keysByProvider.set(entry.provider, entry.key.trim());
    }
  }
  for (const entry of org.providerKeys ?? []) {
    if (entry.enabled && entry.key?.trim()) {
      // providerKeys always overrides apiKeys for the same provider
      keysByProvider.set(entry.provider, entry.key.trim());
    }
  }

  // Backwards compat: top-level openaiApiKey field wins if no OpenAI entry yet
  const legacyOpenAiKey = org.openaiApiKey?.trim();
  if (legacyOpenAiKey && !keysByProvider.has("openai")) {
    keysByProvider.set("openai", legacyOpenAiKey);
  }

  if (keysByProvider.size === 0) {
    return config;
  }

  let result = config;
  for (const [provider, key] of keysByProvider) {
    const existing = result.models?.providers?.[provider];
    const merged: ModelProviderConfig = existing
      ? { ...existing, apiKey: key, auth: "api-key" }
      : {
          baseUrl: PROVIDER_DEFAULT_BASE_URLS[provider] ?? "",
          models: [],
          apiKey: key,
          auth: "api-key",
        };
    result = {
      ...result,
      models: {
        ...result.models,
        providers: {
          ...result.models?.providers,
          [provider]: merged,
        },
      },
    };
  }

  return result;
}

/**
 * Return a copy of `config` with the active organization's provider API keys
 * merged into `config.models.providers.[provider].apiKey`.
 *
 * Reads from `org.providerKeys[]` (current), `org.apiKeys[]` (legacy alias),
 * and `org.openaiApiKey` (deprecated top-level field) — in that precedence
 * order.  Only enabled keys are applied.
 *
 * Call this after secrets are resolved but before model auth is read so that
 * org-specific keys take precedence over any global provider key or stored
 * auth profile.  When no active org or the org has no keys, returns the
 * original config unchanged.
 */
export function applyActiveOrgApiKey(config: OpenClawConfig): OpenClawConfig {
  const org = getActiveOrganization(config);
  if (!org) {
    return config;
  }
  return applyOrgProviderKeys(config, org);
}

/**
 * Same as `applyActiveOrgApiKey` but takes an explicit org ID instead of
 * reading `organizations.activeId`.  Use this in per-request contexts (e.g.
 * gateway chat handler) where the org is known from the agent's
 * `organizationId` field rather than from the global active org setting.
 */
export function applyOrgApiKeyById(
  config: OpenClawConfig,
  orgId: string | undefined,
): OpenClawConfig {
  if (!orgId) {
    return config;
  }
  const org = findOrganization(config, orgId);
  if (!org) {
    return config;
  }
  return applyOrgProviderKeys(config, org);
}

/**
 * Session storage is already scoped per-agent under
 * `~/.openclaw/agents/<agentId>/sessions/`.  Because agents are filtered by
 * `organizationId`, their sessions are effectively isolated: activating org A
 * loads only org-A agents, so only their session directories are accessed.
 *
 * This function returns the set of agent IDs whose sessions belong to the
 * given org (or all agent IDs when no org is active).
 */
export function getAgentIdsForOrganization(
  config: OpenClawConfig,
  orgId: string | undefined,
): string[] {
  return getAgentsForOrganization(config, orgId).map((a) => a.id);
}
