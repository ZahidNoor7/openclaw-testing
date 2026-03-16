# Multi-Tenant Isolation Fix — Bugfix Design

## Overview

OpenClaw's gateway and auth layer have several isolation gaps that allow tenant API keys and
session/agent data to leak across organization boundaries. This fix targets ten discrete defects
spanning the auth HTTP endpoints, the gateway WebSocket layer, the SQLite key store, and the
structured error surface. The approach is surgical: each change is scoped to the exact code path
identified in the bug condition, with no changes to unaffected flows (super_admin auth,
single-user mode, global agents, non-tenant WS auth).

---

## Glossary

- **Bug_Condition (C)**: Any of the ten conditions (1.1–1.10) that cause data to leak across org
  boundaries or expose raw keys to the frontend.
- **Property (P)**: The desired behavior for each bug condition — masked keys, org-scoped
  filtering, encrypted storage, and structured errors.
- **Preservation**: Existing behaviors for super_admin, single-user, global agents, and
  non-tenant WS auth that must remain unchanged.
- **GatewayClient**: The per-connection object maintained by the gateway WS layer; carries auth
  state for downstream handlers.
- **orgId**: The organization identifier resolved from a tenant API key during WS authentication.
- **isBugCondition**: Pseudocode predicate that returns true when an input triggers one of the
  ten defects.
- **applyOrgApiKeyById**: Config helper that resolves an LLM provider key for a specific orgId
  (the correct replacement for `applyActiveOrgApiKey`).
- **getAgentsForOrganization**: Config helper that returns agents scoped to a given orgId,
  including global agents.
- **tenant_api_keys**: SQLite table in `~/.openclaw/db/auth.db` that stores per-org API keys.
- **AES-256-GCM**: Authenticated encryption scheme used for key-at-rest protection.

---

## Bug Details

### Bug Condition

The bug manifests across ten distinct code paths in the auth HTTP layer and gateway WS handlers.
Each path either exposes raw key material to the frontend, omits org-scoped filtering, stores
keys in plaintext, or returns unstructured errors when key configuration is missing.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input — one of { HttpRequest, WsAuthEvent, GatewayMethodCall, DbWriteEvent }
  OUTPUT: boolean

  IF input IS HttpRequest AND input.path IN ['/__auth/login', '/__auth/me']
    AND input.response.apiKey IS raw_plaintext_key
    RETURN true

  IF input IS WsAuthEvent AND input.authMode = 'tenant_api_key'
    AND input.resolvedClient.orgId IS undefined
    RETURN true

  IF input IS GatewayMethodCall AND input.method = 'chat.send'
    AND input.keyResolution USES organizations.activeId INSTEAD OF client.orgId
    RETURN true

  IF input IS GatewayMethodCall AND input.method IN ['sessions.list', 'agents.list']
    AND input.result CONTAINS entries FROM other_orgs
    RETURN true

  IF input IS GatewayMethodCall AND input.method = 'chat.history'
    AND input.session.agent.organizationId != input.client.orgId
    AND input.result IS NOT error_403
    RETURN true

  IF input IS DbWriteEvent AND input.table = 'tenant_api_keys'
    AND input.storedValue = raw_plaintext_key
    RETURN true

  IF input IS HttpRequest AND input.path = '/__auth/api-keys/regenerate'
    AND no GET status-only endpoint EXISTS at '/__auth/api-key/status'
    RETURN true

  IF input IS GatewayMethodCall AND input.method IN ['chat.send', 'agents.list']
    AND no_llm_key_configured
    AND input.error LACKS machine_readable_code
    RETURN true

  RETURN false
END FUNCTION
```

### Examples

- **1.1/1.2**: `POST /__auth/login` with valid tenant_admin credentials returns
  `{ apiKey: "sk-abc123..." }` — raw key visible in browser devtools / network tab.
  Expected: `{ apiKey: { configured: true, masked: "sk-...123" } }`.

- **1.3**: After WS handshake with a tenant API key, `client.orgId` is `undefined`; all
  downstream handlers that read `client.orgId` silently fall back to unscoped behavior.
  Expected: `client.orgId === "org_xyz"` after successful tenant key auth.

- **1.4**: Org A's tenant connects; `organizations.activeId` is set to org B; `chat.send`
  resolves org B's LLM key and bills org B. Expected: key resolved from `client.orgId` (org A).

- **1.5/1.6**: Tenant A calls `sessions.list` and receives sessions belonging to tenant B's
  agents. Expected: only sessions/agents where `agent.organizationId === client.orgId`.

- **1.7**: Tenant A calls `chat.history` with a session key belonging to tenant B's agent.
  Response returns full history. Expected: 403-equivalent error.

- **1.8**: `SELECT value FROM tenant_api_keys WHERE org_id = ?` returns `"sk-abc123..."` in
  plaintext. Expected: encrypted ciphertext; decryption happens server-side only.

- **1.10**: No LLM key configured for org; `chat.send` returns `{ error: "No API key" }`.
  Expected: `{ error: { code: "NO_API_KEY", message: "..." } }`.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Super_admin authentication must continue to return the full user/role/orgId payload with no
  per-org API key field changes (super_admin has no tenant key).
- Single-user (no active org) gateway sessions must continue to resolve the LLM provider key
  from the global config with no regression.
- `openclaw org create` / `openclaw org switch` CLI commands must continue to manage
  organizations in `openclaw.json` exactly as before.
- Agents with no `organizationId` (global agents) must remain visible to all org contexts and
  to single-user mode.
- `/__auth/orgs/:orgId/status` suspension must continue to invalidate all active sessions for
  that org via `deleteSessionsByOrgId`.
- Gateway WS auth using token or password mode (not tenant API key) must continue to
  authenticate and operate without requiring `orgId` on the client object.
- `applyOrgApiKeyById` called with an orgId that has no configured keys must continue to return
  the config unchanged (no crash, no fallback to another org's key).
- `chat.abort` must continue to abort the correct run regardless of org context.

**Scope:**

All inputs that do NOT satisfy `isBugCondition` must be completely unaffected by this fix. This
includes super_admin HTTP flows, single-user WS sessions, global-agent lookups, non-tenant WS
auth modes, and all CLI org management commands.

---

## Hypothesized Root Cause

1. **Auth endpoint serialization**: The login and `/me` handlers serialize the full org config
   object (or a direct DB row) into the HTTP response without stripping or masking the `apiKey`
   field before sending.

2. **Missing orgId propagation in WS auth**: The `validateTenantApiKey` call in the WS auth
   handler returns the resolved `orgId` but the result is not assigned to `client.orgId` before
   the connection is handed off to method handlers.

3. **Global activeId used for key resolution**: `chat.send` calls `applyActiveOrgApiKey` which
   reads `organizations.activeId` from the global config file rather than accepting an explicit
   `orgId` parameter — the `client.orgId` value is available but not threaded through.

4. **No org filter in list handlers**: `sessions.list` and `agents.list` return the full
   unfiltered collections from the config/DB without applying an org predicate; the
   `getAgentsForOrganization` helper exists but is not called in the WS handler path.

5. **No ownership check in chat.history**: The handler fetches history by session key without
   first verifying that the session's agent belongs to `client.orgId`.

6. **Plaintext key storage**: The `tenant_api_keys` insert/update path writes the raw key string
   directly to SQLite with no encryption wrapper; no encryption key derivation is performed at
   write time.

7. **Missing status endpoint**: There is no `GET /__auth/api-key/status` route; the frontend
   has no way to check key validity without receiving the raw key from login/me.

8. **Unstructured error codes**: The `chat.send` and related handlers throw or return plain
   string errors when the LLM key is absent; no `code` field is included in the error payload.

---

## Correctness Properties

Property 1: Bug Condition — Auth Endpoints Return Masked Key Only

_For any_ HTTP request to `/__auth/login` or `/__auth/me` by a tenant_admin user, the fixed
handlers SHALL return a key representation of the form `{ configured: boolean, masked?: string }`
and SHALL NOT include the raw plaintext key value anywhere in the response body.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition — orgId Attached to GatewayClient After Tenant Key Auth

_For any_ WS authentication event where `authMode === 'tenant_api_key'` and the key is valid,
the fixed auth handler SHALL set `client.orgId` to the orgId resolved by `validateTenantApiKey`
before passing the client to any downstream method handler.

**Validates: Requirements 2.3**

Property 3: Bug Condition — chat.send Uses client.orgId for Key Resolution

_For any_ `chat.send` call where `client.orgId` is defined, the fixed handler SHALL resolve the
LLM provider key via `applyOrgApiKeyById(config, client.orgId)` and SHALL NOT use
`organizations.activeId` for key selection.

**Validates: Requirements 2.4**

Property 4: Bug Condition — sessions.list and agents.list Are Org-Scoped

_For any_ `sessions.list` or `agents.list` call where `client.orgId` is defined, the fixed
handlers SHALL return only entries whose agent has `organizationId === client.orgId` or is a
global agent (no `organizationId`), and SHALL NOT include entries belonging to other orgs.

**Validates: Requirements 2.5, 2.6**

Property 5: Bug Condition — chat.history Enforces Org Ownership

_For any_ `chat.history` call where the requested session key's agent has an `organizationId`
that does not match `client.orgId`, the fixed handler SHALL return a 403-equivalent error and
SHALL NOT return any history data.

**Validates: Requirements 2.7**

Property 6: Bug Condition — Tenant API Keys Encrypted at Rest

_For any_ write to the `tenant_api_keys` table, the fixed storage layer SHALL store an
AES-256-GCM ciphertext (not the raw plaintext key), and the plaintext SHALL only be recoverable
server-side using the gateway-level secret.

**Validates: Requirements 2.8**

Property 7: Bug Condition — Structured Error Codes on Missing/Invalid LLM Key

_For any_ gateway method call that fails because no LLM provider key is configured or the key
is invalid/expired/rate-limited, the fixed handler SHALL return an error object containing a
`code` field with one of `NO_API_KEY`, `INVALID_API_KEY`, `API_KEY_RATE_LIMITED`,
`API_KEY_EXPIRED`.

**Validates: Requirements 2.10**

Property 8: Preservation — Super_admin Auth Unaffected

_For any_ authentication request by a super_admin user, the fixed handlers SHALL produce
exactly the same response shape as the original handlers (full user/role/orgId payload, no
per-org key field).

**Validates: Requirements 3.1**

Property 9: Preservation — Single-User Mode Unaffected

_For any_ gateway WS session where `client.orgId` is undefined (single-user / no active org),
the fixed `chat.send` handler SHALL resolve the LLM provider key from the global config exactly
as the original code does, with no behavioral change.

**Validates: Requirements 3.2, 3.6, 3.7**

Property 10: Preservation — Global Agents Visible to All Contexts

_For any_ `agents.list` call regardless of `client.orgId`, the fixed handler SHALL include all
agents that have no `organizationId` (global agents) in the result, matching the behavior of
`getAgentsForOrganization`.

**Validates: Requirements 3.4**

---

## Fix Implementation

### Changes Required

Assuming the root cause analysis above is correct:

**File**: `src/infra/auth/routes.ts` (or equivalent auth HTTP handler)

**Changes**:

1. **Mask key in login response**: Replace direct serialization of the org config / DB row with
   a response mapper that converts `apiKey` → `{ configured: !!apiKey, masked: maskKey(apiKey) }`
   before sending. Never include the raw value.
2. **Mask key in /me response**: Apply the same mapper to the `/me` handler response.
3. **Add GET /\_\_auth/api-key/status route**: New route that reads the key from the DB (server-
   side only), returns `{ configured: boolean, masked?: string }`, never the raw value.

**File**: `src/infra/gateway/ws-auth.ts` (or equivalent WS auth handler)

**Changes**: 4. **Propagate orgId to GatewayClient**: After `validateTenantApiKey` succeeds, assign
`client.orgId = resolvedOrgId` before yielding/returning the client object.

**File**: `src/infra/gateway/methods/chat.ts`

**Changes**: 5. **Scope key resolution to client.orgId**: Replace `applyActiveOrgApiKey(config)` with
`applyOrgApiKeyById(config, client.orgId)` when `client.orgId` is defined. Keep the existing
global-config path for `client.orgId === undefined` (single-user preservation). 6. **Return structured error codes**: Wrap LLM key errors in `{ code: 'NO_API_KEY' | ... }`.

**File**: `src/infra/gateway/methods/sessions.ts`

**Changes**: 7. **Filter sessions by orgId**: After fetching the full session list, apply
`sessions.filter(s => !s.agent.organizationId || s.agent.organizationId === client.orgId)`.

**File**: `src/infra/gateway/methods/agents.ts`

**Changes**: 8. **Use getAgentsForOrganization**: Replace the unfiltered agent fetch with
`getAgentsForOrganization(config, client.orgId)`.

**File**: `src/infra/gateway/methods/chat-history.ts` (or within `chat.ts`)

**Changes**: 9. **Verify session ownership**: Before returning history, resolve the session's agent and check
`agent.organizationId === client.orgId || !agent.organizationId`. Return a 403-equivalent
error if the check fails.

**File**: `src/infra/db/tenant-api-keys.ts` (or equivalent DB layer)

**Changes**: 10. **Encrypt at write, decrypt at read**: Wrap insert/update with AES-256-GCM encryption using
a key derived from the gateway-level secret (e.g. `OPENCLAW_GATEWAY_SECRET` env var or
config). Wrap the read path with the corresponding decryption. Store `iv + ciphertext` as
hex or base64 in the existing column (or add a migration to widen the column).

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that
demonstrate each bug on unfixed code to confirm root cause; then verify the fix works correctly
and preserves all existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix.
Confirm or refute the root cause analysis. If refuted, re-hypothesize.

**Test Plan**: Write unit tests that call the affected handlers/functions directly with
controlled inputs and assert on the defective output. Run on UNFIXED code to observe failures.

**Test Cases**:

1. **Login exposes raw key** (1.1): Call the login handler with valid tenant_admin credentials;
   assert `response.apiKey` is a string matching `/^sk-/`. Will fail on unfixed code (it passes
   — confirming the bug).
2. **/me exposes raw key** (1.2): Same as above for the `/me` handler.
3. **orgId missing from client** (1.3): Simulate WS tenant key auth; assert `client.orgId` is
   defined after auth. Will fail on unfixed code.
4. **Wrong org key used in chat.send** (1.4): Set `activeId` to org B, call `chat.send` as org
   A client; assert the key resolved belongs to org A. Will fail on unfixed code.
5. **sessions.list leaks cross-org** (1.5): Populate sessions for two orgs; call `sessions.list`
   as org A; assert no org B sessions appear. Will fail on unfixed code.
6. **agents.list leaks cross-org** (1.6): Same pattern for agents.
7. **chat.history cross-org access** (1.7): Call `chat.history` with a session key belonging to
   org B as an org A client; assert a 403-equivalent is returned. Will fail on unfixed code.
8. **Plaintext key in DB** (1.8): Write a key via the storage layer; read the raw DB row; assert
   the stored value does not equal the plaintext key. Will fail on unfixed code.
9. **Unstructured error on missing key** (1.10): Call `chat.send` with no LLM key configured;
   assert `error.code` is one of the defined codes. Will fail on unfixed code.

**Expected Counterexamples**:

- Login/me responses contain raw `apiKey` strings.
- `client.orgId` is `undefined` after tenant key WS auth.
- `chat.send` resolves the wrong org's LLM key when `activeId !== client.orgId`.
- List handlers return entries from all orgs.
- `chat.history` returns data for out-of-scope sessions.
- DB row contains plaintext key.
- Error objects lack a `code` field.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the
expected behavior.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedHandler(input)
  ASSERT expectedBehavior(result)   -- per Property 1–7 above
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code
produces the same result as the original code.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalHandler(input) = fixedHandler(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across the input domain.
- It catches edge cases that manual unit tests might miss.
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Cases**:

1. **Super_admin login preservation**: Generate random super_admin credentials; verify login
   response shape is unchanged (Properties 8).
2. **Single-user chat.send preservation**: Generate random chat inputs with `client.orgId`
   undefined; verify key resolution path is unchanged (Property 9).
3. **Global agent visibility preservation**: Generate agent lists mixing global and org-scoped
   agents; verify global agents always appear regardless of `client.orgId` (Property 10).
4. **Non-tenant WS auth preservation**: Simulate token/password WS auth; verify `client.orgId`
   is not required and auth succeeds as before.
5. **chat.abort preservation**: Verify abort behavior is unaffected by org context changes.
6. **org CLI commands preservation**: Verify `openclaw org create/switch` behavior is unchanged.

### Unit Tests

- Test login/me response mapper: raw key in → masked shape out; undefined key → `configured: false`.
- Test `GET /__auth/api-key/status`: returns `{ configured, masked }` only.
- Test WS auth handler: `client.orgId` set correctly for tenant key auth; undefined for token/password auth.
- Test `chat.send` key resolution: org A client with `activeId` = org B → org A key used.
- Test `sessions.list` filter: mixed-org session list → only client's org sessions returned.
- Test `agents.list` filter: mixed-org agent list → only client's org + global agents returned.
- Test `chat.history` ownership check: out-of-scope session key → 403-equivalent error.
- Test AES-256-GCM round-trip: encrypt then decrypt → original plaintext; stored value ≠ plaintext.
- Test structured error codes: each missing-key scenario → correct `code` value.

### Property-Based Tests

- Generate random org configs and tenant clients; verify `sessions.list` never returns sessions
  from a different org (Property 4).
- Generate random agent sets with mixed `organizationId` values; verify `agents.list` always
  includes global agents and excludes other-org agents (Properties 4, 10).
- Generate random `(client.orgId, activeId)` pairs; verify `chat.send` always uses `client.orgId`
  for key resolution when defined (Property 3).
- Generate random key strings; verify encrypt→store→read→decrypt round-trip is lossless and
  stored bytes never equal plaintext (Property 6).
- Generate random error scenarios (no key, invalid key, rate-limited, expired); verify each
  returns a `code` from the defined enum (Property 7).

### Integration Tests

- Full tenant login → WS connect → `agents.list` → `chat.send` flow for two orgs in parallel;
  verify complete isolation (no cross-org data at any step).
- Tenant A calls `chat.history` with tenant B's session key; verify 403-equivalent at the
  integration boundary.
- Super_admin login flow end-to-end; verify response shape unchanged and no regression.
- Single-user (no org) chat flow end-to-end; verify LLM key resolution unchanged.
- `GET /__auth/api-key/status` after key regeneration; verify only masked status returned.
