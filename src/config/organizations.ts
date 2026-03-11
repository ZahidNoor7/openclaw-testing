/**
 * Multi-tenancy helpers: organization-aware agent filtering and session
 * namespace resolution.
 *
 * Design: organizations are stored under `organizations.list[]` in
 * openclaw.json.  The currently-active org is set via `organizations.activeId`.
 * Each agent may carry an optional `organizationId` field that scopes it to
 * one org.  Agents without `organizationId` are "global" and are available in
 * every org context (and in single-user / no-org mode).
 */

import type { OpenClawConfig, OrganizationConfig } from "./types.openclaw.js";

export type { OrganizationConfig };

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
