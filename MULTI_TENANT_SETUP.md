# Multi-Tenancy / Multi-Organization Setup

OpenClaw supports running multiple independent organizations (tenants) from a
single installation. Each organization has its own set of agents and isolated
session history.

---

## Concepts

| Term                    | Description                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organization**        | A named tenant with a unique ID (e.g. `org_acme`). Stored in the top-level `organizations` array in `~/.openclaw/openclaw.json`.              |
| **Active Organization** | The currently-selected org, stored as `activeOrganizationId`. When set, only agents belonging to that org (plus global agents) are activated. |
| **Global agent**        | An agent with no `organizationId` — available in every org context and in single-user mode.                                                   |

---

## Quick Start

### 1. Create organizations

```sh
openclaw org create --name "Acme Corp"
# → creates org_acme

openclaw org create --name "Beta Team" --id org_beta --description "Internal beta users"
```

### 2. Switch the active organization

```sh
openclaw org switch org_acme

# Check which org is active
openclaw org current
```

### 3. Assign agents to an organization

Edit `~/.openclaw/openclaw.json` and add `organizationId` to an agent entry:

```json
{
  "agents": {
    "list": [
      {
        "id": "acme-support",
        "name": "Acme Support Bot",
        "organizationId": "org_acme",
        "workspace": "~/workspaces/acme-support"
      },
      {
        "id": "main",
        "name": "Global Agent",
        "workspace": "~/workspaces/main"
      }
    ]
  }
}
```

Or use the **Agents → Overview** tab in the dashboard UI: select an agent, then
pick an organization from the "Organization" dropdown and save.

### 4. List organizations

```sh
openclaw org list
openclaw org list --json
```

### 5. Delete an organization

```sh
openclaw org delete org_beta --force
```

> **Note:** Deleting an org removes it from `organizations` and clears
> `activeOrganizationId` if it pointed to the deleted org. Agents that
> referenced the org via `organizationId` are left in place but become
> "orphaned" — they won't appear under any org filter. Update or remove their
> `organizationId` field manually.

---

## Session Isolation

Sessions are stored under `~/.openclaw/agents/<agentId>/sessions/` and are
already agent-scoped by design. When an active org is set, the gateway loads
only agents that match that org (or have no `organizationId`), so session
directories for out-of-scope agents are simply not accessed — providing natural
isolation without any migration needed.

To query which agent IDs belong to an org from TypeScript code:

```typescript
import { getAgentsForOrganization } from "src/config/organizations.js";

const activeAgents = getAgentsForOrganization(config, "org_acme");
// Returns agents with organizationId === "org_acme" plus global agents.
```

---

## Dashboard UI

1. Open the OpenClaw dashboard.
2. Navigate to **Settings → Organizations**.
3. Use the form to create, switch, or delete organizations.
4. Navigate to **Agents**, select an agent, and use the **Organization** dropdown in the **Overview** panel to assign it to an org.

---

## Backward Compatibility

If `organizations` and `activeOrganizationId` are absent from the config,
OpenClaw operates in single-user mode exactly as before — no migration needed
for existing installs.

---

## Config schema reference

```json
{
  "organizations": {
    "list": [
      {
        "id": "org_acme",
        "name": "Acme Corp",
        "description": "Optional description",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "openaiApiKey": "sk-..."
      }
    ],
    "activeId": "org_acme"
  },
  "agents": {
    "list": [
      {
        "id": "acme-bot",
        "organizationId": "org_acme"
      }
    ]
  }
}
```
