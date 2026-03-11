/**
 * Organization management commands for multi-tenancy support.
 *
 * Usage:
 *   openclaw org list
 *   openclaw org create --name "Acme Corp" [--id org_acme] [--description "..."]
 *   openclaw org switch <id>
 *   openclaw org current
 *   openclaw org delete <id> [--force]
 */

import { writeConfigFile } from "../config/config.js";
import { logConfigUpdated } from "../config/logging.js";
import {
  findOrganization,
  getActiveOrganization,
  listOrganizations,
} from "../config/organizations.js";
import type { OrganizationConfig } from "../config/organizations.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { requireValidConfig } from "./agents.command-shared.js";

// ---------------------------------------------------------------------------
// org list
// ---------------------------------------------------------------------------

export async function orgListCommand(
  opts: { json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = await requireValidConfig(runtime);
  if (!cfg) {
    return;
  }

  const orgs = listOrganizations(cfg);
  const activeId = cfg.organizations?.activeId?.trim();

  if (opts.json) {
    runtime.log(JSON.stringify({ organizations: orgs, activeId: activeId ?? null }));
    return;
  }

  if (orgs.length === 0) {
    runtime.log("No organizations configured. Use `openclaw org create` to add one.");
    return;
  }

  for (const org of orgs) {
    const active = org.id === activeId ? " (active)" : "";
    runtime.log(`- ${org.id}${active}`);
    runtime.log(`    Name: ${org.name}`);
    if (org.description) {
      runtime.log(`    Description: ${org.description}`);
    }
    if (org.createdAt) {
      runtime.log(`    Created: ${org.createdAt}`);
    }
  }
}

// ---------------------------------------------------------------------------
// org current
// ---------------------------------------------------------------------------

export async function orgCurrentCommand(
  opts: { json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = await requireValidConfig(runtime);
  if (!cfg) {
    return;
  }

  const org = getActiveOrganization(cfg);
  if (opts.json) {
    runtime.log(JSON.stringify(org ?? null));
    return;
  }

  if (!org) {
    runtime.log("No active organization. Use `openclaw org switch <id>` to activate one.");
    return;
  }

  runtime.log(`Active organization: ${org.id} (${org.name})`);
  if (org.description) {
    runtime.log(`Description: ${org.description}`);
  }
}

// ---------------------------------------------------------------------------
// org create
// ---------------------------------------------------------------------------

type OrgCreateOptions = {
  name: string;
  id?: string;
  description?: string;
  json?: boolean;
};

/** Generate a safe org ID from a display name. */
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

export async function orgCreateCommand(
  opts: OrgCreateOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = await requireValidConfig(runtime);
  if (!cfg) {
    return;
  }

  const name = opts.name?.trim();
  if (!name) {
    runtime.error("--name is required.");
    runtime.exit(1);
    return;
  }

  const id = opts.id?.trim() || slugifyOrgName(name);

  const existing = findOrganization(cfg, id);
  if (existing) {
    runtime.error(`Organization "${id}" already exists.`);
    runtime.exit(1);
    return;
  }

  const newOrg: OrganizationConfig = {
    id,
    name,
    ...(opts.description?.trim() ? { description: opts.description.trim() } : {}),
    createdAt: new Date().toISOString(),
  };

  const currentList = cfg.organizations?.list ?? [];
  const nextConfig = {
    ...cfg,
    organizations: {
      ...cfg.organizations,
      list: [...currentList, newOrg],
    },
  };

  await writeConfigFile(nextConfig);
  if (!opts.json) {
    logConfigUpdated(runtime);
    runtime.log(`Created organization "${id}" (${name}).`);
  } else {
    runtime.log(JSON.stringify(newOrg));
  }
}

// ---------------------------------------------------------------------------
// org switch
// ---------------------------------------------------------------------------

export async function orgSwitchCommand(
  id: string,
  opts: { json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = await requireValidConfig(runtime);
  if (!cfg) {
    return;
  }

  const orgId = id?.trim();
  if (!orgId) {
    runtime.error("Organization ID is required.");
    runtime.exit(1);
    return;
  }

  const org = findOrganization(cfg, orgId);
  if (!org) {
    runtime.error(
      `Organization "${orgId}" not found. Use \`openclaw org list\` to see available organizations.`,
    );
    runtime.exit(1);
    return;
  }

  const nextConfig = {
    ...cfg,
    organizations: {
      ...cfg.organizations,
      activeId: orgId,
    },
  };
  await writeConfigFile(nextConfig);

  if (!opts.json) {
    logConfigUpdated(runtime);
    runtime.log(`Switched to organization "${orgId}" (${org.name}).`);
  } else {
    runtime.log(JSON.stringify({ activeId: orgId }));
  }
}

// ---------------------------------------------------------------------------
// org delete
// ---------------------------------------------------------------------------

type OrgDeleteOptions = {
  force?: boolean;
  json?: boolean;
};

export async function orgDeleteCommand(
  id: string,
  opts: OrgDeleteOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = await requireValidConfig(runtime);
  if (!cfg) {
    return;
  }

  const orgId = id?.trim();
  if (!orgId) {
    runtime.error("Organization ID is required.");
    runtime.exit(1);
    return;
  }

  const org = findOrganization(cfg, orgId);
  if (!org) {
    runtime.error(`Organization "${orgId}" not found.`);
    runtime.exit(1);
    return;
  }

  if (!opts.force) {
    if (!process.stdin.isTTY) {
      runtime.error("Non-interactive session. Re-run with --force.");
      runtime.exit(1);
      return;
    }
    // Simple readline-free confirmation in non-TTY-guard path.
    runtime.log(
      `About to delete organization "${orgId}" (${org.name}). Re-run with --force to confirm.`,
    );
    runtime.exit(1);
    return;
  }

  const currentList = cfg.organizations?.list ?? [];
  const nextList = currentList.filter((o) => o.id !== orgId);
  const currentActiveId = cfg.organizations?.activeId;

  const nextConfig = {
    ...cfg,
    organizations:
      nextList.length > 0 || currentActiveId !== orgId
        ? {
            ...cfg.organizations,
            list: nextList.length > 0 ? nextList : undefined,
            // Clear active org if it was the deleted one.
            activeId: currentActiveId === orgId ? undefined : currentActiveId,
          }
        : undefined,
  };

  await writeConfigFile(nextConfig);

  if (!opts.json) {
    logConfigUpdated(runtime);
    runtime.log(`Deleted organization "${orgId}".`);
    // Remind about orphaned agents.
    const orphaned = (cfg.agents?.list ?? []).filter((a) => a.organizationId === orgId);
    if (orphaned.length > 0) {
      runtime.log(
        `Note: ${orphaned.length} agent(s) still reference organizationId "${orgId}": ${orphaned.map((a) => a.id).join(", ")}`,
      );
      runtime.log(`Update or remove their "organizationId" field in openclaw.json to clean up.`);
    }
  } else {
    runtime.log(JSON.stringify({ deleted: orgId }));
  }
}
