# Bugfix Requirements Document

## Introduction

OpenClaw's multi-tenant architecture has several isolation gaps that allow data, API keys, and
session context to leak across organization boundaries. The system stores per-org LLM provider
keys in the config file (`~/.openclaw/openclaw.json`) and uses a SQLite auth database
(`~/.openclaw/db/auth.db`) for user/session management, but the gateway WebSocket layer does not
consistently enforce org-scoped filtering when serving sessions, chat history, and agent lists.
Additionally, the `/__auth/me` and `/__auth/login` endpoints return the raw tenant API key to the
frontend, and the gateway WS connection carries no org context — meaning all authenticated clients
share the same unscoped view of agents and sessions regardless of which org they belong to.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a tenant_admin user authenticates via `POST /__auth/login` THEN the system returns the
raw tenant API key (`apiKey`) in the HTTP response body, exposing it to the frontend.

1.2 WHEN a tenant_admin user calls `GET /__auth/me` THEN the system returns the raw tenant API
key (`apiKey`) in the HTTP response body, exposing it to the frontend.

1.3 WHEN the gateway WebSocket connection is established with a tenant API key THEN the system
does not attach the resolved `orgId` to the `GatewayClient` object, so downstream handlers have
no org context available.

1.4 WHEN the `chat.send` gateway method resolves the LLM provider API key THEN the system calls
`applyActiveOrgApiKey` (which reads `organizations.activeId` from the global config) rather than
scoping the key lookup to the authenticated session's `orgId`, so the wrong org's key can be used
when `activeId` does not match the requesting tenant.

1.5 WHEN the `sessions.list` gateway method returns sessions to the client THEN the system does
not filter sessions by the authenticated client's `orgId`, so a tenant can see session entries
belonging to agents of other organizations.

1.6 WHEN the `agents.list` gateway method returns agents to the client THEN the system does not
filter the agent list by the authenticated client's `orgId`, so a tenant can see agents belonging
to other organizations.

1.7 WHEN the `chat.history` gateway method returns chat history THEN the system does not verify
that the requested session key belongs to an agent scoped to the authenticated client's `orgId`,
so a tenant can read another tenant's chat history by guessing a session key.

1.8 WHEN the `tenant_api_keys` SQLite table stores a tenant API key THEN the system stores only
the raw plaintext key with no encryption at rest, violating the requirement that keys be encrypted
in the database.

1.9 WHEN the `/__auth/api-keys/regenerate` endpoint is called THEN the system does not verify
that the caller's `orgId` matches the key being regenerated, relying solely on the session's
`orgId` — however the endpoint does not expose a status-only view, so the frontend has no way to
check key validity without receiving the raw key.

1.10 WHEN a chat or agent request fails because no LLM provider key is configured for the org
THEN the system returns a generic error rather than a structured, actionable error code that the
frontend can map to a user-facing message.

### Expected Behavior (Correct)

2.1 WHEN a tenant_admin user authenticates via `POST /__auth/login` THEN the system SHALL return
only `{ configured: true, masked: "sk-...XXXX" }` for the key field — never the raw key value.

2.2 WHEN a tenant_admin user calls `GET /__auth/me` THEN the system SHALL return only the masked
key representation — never the raw key value.

2.3 WHEN the gateway WebSocket connection is established with a tenant API key THEN the system
SHALL resolve the `orgId` from `validateTenantApiKey` and attach it to the `GatewayClient` object
so all downstream handlers can read `client.orgId`.

2.4 WHEN the `chat.send` gateway method resolves the LLM provider API key THEN the system SHALL
call `applyOrgApiKeyById(config, client.orgId)` using the authenticated client's `orgId`, not the
global `activeId`.

2.5 WHEN the `sessions.list` gateway method returns sessions to the client THEN the system SHALL
filter the session list to include only sessions whose agent has `organizationId === client.orgId`
(or is a global agent when `client.orgId` is undefined).

2.6 WHEN the `agents.list` gateway method returns agents to the client THEN the system SHALL
filter the agent list using `getAgentsForOrganization(config, client.orgId)`.

2.7 WHEN the `chat.history` gateway method returns chat history THEN the system SHALL verify that
the requested session key's agent belongs to the authenticated client's org before returning data,
and SHALL return a 403-equivalent error if the agent is out of scope.

2.8 WHEN a tenant API key is written to the `tenant_api_keys` SQLite table THEN the system SHALL
encrypt the key at rest using AES-256-GCM with a key derived from a gateway-level secret, and
SHALL decrypt it only server-side when needed.

2.9 WHEN the frontend needs to display API key status THEN the system SHALL expose a
`GET /__auth/api-key/status` endpoint that returns only `{ configured: boolean, masked?: string }`
— never the raw key — and the frontend SHALL use this endpoint instead of reading the key from
login/me responses.

2.10 WHEN a chat or agent request fails because no LLM provider key is configured or the key is
invalid THEN the system SHALL return a structured error with a machine-readable code
(`NO_API_KEY`, `INVALID_API_KEY`, `API_KEY_RATE_LIMITED`, `API_KEY_EXPIRED`) so the frontend can
display the correct user-facing message and disable chat input until the key is updated.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a super_admin user authenticates THEN the system SHALL CONTINUE TO authenticate
successfully and return the full user/role/orgId payload (super_admin has no per-org API key).

3.2 WHEN a single-user (no active org) gateway session sends a chat message THEN the system SHALL
CONTINUE TO resolve the LLM provider key from the global config as before, with no regression in
single-tenant mode.

3.3 WHEN the `openclaw org create` / `openclaw org switch` CLI commands are used THEN the system
SHALL CONTINUE TO manage organizations in `openclaw.json` exactly as before.

3.4 WHEN an agent has no `organizationId` (global agent) THEN the system SHALL CONTINUE TO make
that agent available to all org contexts and to single-user mode.

3.5 WHEN the `/__auth/orgs/:orgId/status` endpoint suspends an org THEN the system SHALL
CONTINUE TO invalidate all active sessions for that org via `deleteSessionsByOrgId`.

3.6 WHEN the gateway WS auth uses token or password mode (not tenant API key) THEN the system
SHALL CONTINUE TO authenticate and operate without requiring an `orgId` on the client object.

3.7 WHEN the `applyOrgApiKeyById` function is called with an `orgId` that has no configured keys
THEN the system SHALL CONTINUE TO return the config unchanged (no crash, no fallback to another
org's key).

3.8 WHEN the `chat.abort` gateway method is called THEN the system SHALL CONTINUE TO abort the
correct run regardless of org context changes.
