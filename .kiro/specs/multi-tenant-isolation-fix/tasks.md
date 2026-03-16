# Implementation Plan

- [x] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - Multi-Tenant Isolation Gaps
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior — they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate each of the ten isolation defects
  - **Scoped PBT Approach**: For deterministic bugs, scope each property to the concrete failing case(s) to ensure reproducibility
  - Test 1.1/1.2 — Auth endpoints expose raw key: call login and /me handlers with valid tenant_admin credentials; assert `response.apiKey` is NOT a raw plaintext string (e.g. does not match `/^sk-/`); assert shape is `{ configured: boolean, masked?: string }` (from Bug Condition in design)
  - Test 1.3 — orgId missing from GatewayClient: simulate WS tenant key auth event; assert `client.orgId` is defined after `validateTenantApiKey` completes (from Bug Condition in design)
  - Test 1.4 — chat.send uses wrong org key: set `organizations.activeId` to org B, call `chat.send` as org A client; assert the resolved LLM key belongs to org A, not org B (from Bug Condition in design)
  - Test 1.5/1.6 — sessions.list and agents.list leak cross-org data: populate sessions/agents for two orgs; call each list method as org A; assert no org B entries appear in results (from Bug Condition in design)
  - Test 1.7 — chat.history cross-org access: call `chat.history` with a session key belonging to org B as an org A client; assert a 403-equivalent error is returned, not history data (from Bug Condition in design)
  - Test 1.8 — plaintext key in DB: write a key via the storage layer; read the raw SQLite row; assert stored value does NOT equal the plaintext key (from Bug Condition in design)
  - Test 1.10 — unstructured error on missing key: call `chat.send` with no LLM key configured; assert `error.code` is one of `NO_API_KEY | INVALID_API_KEY | API_KEY_RATE_LIMITED | API_KEY_EXPIRED` (from Bug Condition in design)
  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bugs exist)
  - Document counterexamples found (e.g. raw key strings in responses, undefined orgId, wrong org key resolved, cross-org list entries, history returned without 403, plaintext in DB, missing error code)
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy Flows Unaffected
  - **IMPORTANT**: Follow observation-first methodology — run UNFIXED code with non-buggy inputs, observe outputs, then write tests asserting those outputs
  - Observe: super_admin login returns full `{ user, role, orgId }` payload with no per-org key field on unfixed code
  - Observe: single-user (no active org) `chat.send` with `client.orgId` undefined resolves LLM key from global config on unfixed code
  - Observe: `agents.list` with mixed global/org-scoped agents always includes global agents (no `organizationId`) regardless of `client.orgId` on unfixed code
  - Observe: non-tenant WS auth (token/password mode) succeeds without `orgId` on client on unfixed code
  - Observe: `chat.abort` aborts the correct run regardless of org context on unfixed code
  - Write property-based test: for all super_admin auth requests, response shape equals `{ user, role, orgId }` with no per-org key mutation (from Preservation Requirements in design — Property 8)
  - Write property-based test: for all `chat.send` calls where `client.orgId` is undefined, key resolution path uses global config unchanged (from Preservation Requirements in design — Property 9)
  - Write property-based test: for all `agents.list` calls with any `client.orgId` value, global agents (no `organizationId`) always appear in results (from Preservation Requirements in design — Property 10)
  - Write property-based test: for all non-tenant WS auth events (token/password mode), `client.orgId` is not required and auth succeeds as before (from Preservation Requirements in design — Requirements 3.6)
  - Write property-based test: `applyOrgApiKeyById` called with an orgId that has no configured keys returns config unchanged, no crash (from Preservation Requirements in design — Requirements 3.7)
  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.4, 3.6, 3.7, 3.8_

- [x] 3. Fix multi-tenant isolation gaps
  - [x] 3.1 Mask API key in auth HTTP responses and add status endpoint
    - In login and `/me` handlers (`src/infra/auth/routes.ts` or equivalent): replace direct serialization of org config / DB row with a response mapper that converts `apiKey` → `{ configured: !!apiKey, masked: maskKey(apiKey) }` before sending
    - Never include the raw key value in any HTTP response body
    - Add `GET /__auth/api-key/status` route that reads the key server-side and returns only `{ configured: boolean, masked?: string }`
    - _Bug_Condition: isBugCondition(input) where input.path IN ['/__auth/login', '/__auth/me'] AND input.response.apiKey IS raw_plaintext_key_
    - _Expected_Behavior: response.apiKey shape is { configured: boolean, masked?: string }; raw key never present in response body (Properties 1, 2 from design)_
    - _Preservation: super_admin login response shape unchanged — full user/role/orgId payload, no per-org key field affected (Property 8 from design)_
    - _Requirements: 2.1, 2.2, 2.9, 3.1_

  - [x] 3.2 Propagate orgId to GatewayClient after tenant key auth
    - In WS auth handler (`src/infra/gateway/ws-auth.ts` or equivalent): after `validateTenantApiKey` succeeds, assign `client.orgId = resolvedOrgId` before yielding/returning the client object
    - For token/password auth modes, leave `client.orgId` undefined (no change to non-tenant paths)
    - _Bug_Condition: isBugCondition(input) where input IS WsAuthEvent AND input.authMode = 'tenant_api_key' AND input.resolvedClient.orgId IS undefined_
    - _Expected_Behavior: client.orgId equals the orgId resolved by validateTenantApiKey for all tenant key auth events (Property 2 from design)_
    - _Preservation: token/password WS auth continues to operate without orgId on client (Requirements 3.6)_
    - _Requirements: 2.3, 3.6_

  - [x] 3.3 Scope chat.send key resolution to client.orgId
    - In `src/infra/gateway/methods/chat.ts`: replace `applyActiveOrgApiKey(config)` with `applyOrgApiKeyById(config, client.orgId)` when `client.orgId` is defined
    - Keep the existing global-config path for `client.orgId === undefined` (single-user preservation)
    - Wrap LLM key errors in structured error objects: `{ code: 'NO_API_KEY' | 'INVALID_API_KEY' | 'API_KEY_RATE_LIMITED' | 'API_KEY_EXPIRED', message: string }`
    - _Bug_Condition: isBugCondition(input) where input.method = 'chat.send' AND input.keyResolution USES organizations.activeId INSTEAD OF client.orgId_
    - _Expected_Behavior: key resolved via applyOrgApiKeyById(config, client.orgId) when orgId defined; structured error code returned on missing/invalid key (Properties 3, 7 from design)_
    - _Preservation: single-user sessions with client.orgId undefined continue to resolve key from global config unchanged (Property 9 from design)_
    - _Requirements: 2.4, 2.10, 3.2, 3.7_

  - [x] 3.4 Filter sessions.list and agents.list by orgId
    - In `src/infra/gateway/methods/sessions.ts`: after fetching the full session list, apply `sessions.filter(s => !s.agent.organizationId || s.agent.organizationId === client.orgId)`
    - In `src/infra/gateway/methods/agents.ts`: replace the unfiltered agent fetch with `getAgentsForOrganization(config, client.orgId)`
    - _Bug_Condition: isBugCondition(input) where input.method IN ['sessions.list', 'agents.list'] AND input.result CONTAINS entries FROM other_orgs_
    - _Expected_Behavior: only sessions/agents where agent.organizationId === client.orgId or agent has no organizationId (global) are returned (Property 4 from design)_
    - _Preservation: global agents (no organizationId) remain visible to all org contexts and single-user mode (Property 10 from design)_
    - _Requirements: 2.5, 2.6, 3.4_

  - [x] 3.5 Enforce org ownership check in chat.history
    - In `src/infra/gateway/methods/chat-history.ts` (or within `chat.ts`): before returning history, resolve the session's agent and check `agent.organizationId === client.orgId || !agent.organizationId`
    - Return a 403-equivalent error if the ownership check fails; do not return any history data
    - _Bug_Condition: isBugCondition(input) where input.method = 'chat.history' AND input.session.agent.organizationId != input.client.orgId AND input.result IS NOT error_403_
    - _Expected_Behavior: 403-equivalent error returned for out-of-scope session keys; no history data leaked (Property 5 from design)_
    - _Preservation: global-agent sessions (no organizationId) remain accessible to all org contexts_
    - _Requirements: 2.7, 3.4_

  - [x] 3.6 Encrypt tenant API keys at rest (AES-256-GCM)
    - In `src/infra/db/tenant-api-keys.ts` (or equivalent DB layer): wrap insert/update with AES-256-GCM encryption using a key derived from the gateway-level secret (`OPENCLAW_GATEWAY_SECRET` env var or config)
    - Store `iv + ciphertext` as hex or base64 in the existing column (add a migration to widen the column if needed)
    - Wrap the read path with the corresponding decryption; plaintext is only available server-side after decryption
    - _Bug_Condition: isBugCondition(input) where input IS DbWriteEvent AND input.table = 'tenant_api_keys' AND input.storedValue = raw_plaintext_key_
    - _Expected_Behavior: stored value is AES-256-GCM ciphertext; plaintext only recoverable server-side with gateway secret (Property 6 from design)_
    - _Preservation: encrypt→store→read→decrypt round-trip is lossless; no crash when orgId has no configured keys (Requirements 3.7)_
    - _Requirements: 2.8, 3.7_

  - [x] 3.7 Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Multi-Tenant Isolation Gaps Resolved
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior across all ten defects
    - When these tests pass, it confirms the expected behavior is satisfied for all bug conditions
    - Run all bug condition exploration tests from step 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms all ten isolation bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10_

  - [x] 3.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Buggy Flows Unaffected
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run all preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in super_admin auth, single-user mode, global agents, non-tenant WS auth, chat.abort)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run `pnpm test` and confirm all tests pass
  - Ensure bug condition exploration tests (task 1) now pass — confirming all ten isolation bugs are fixed
  - Ensure preservation property tests (task 2) still pass — confirming no regressions
  - Ask the user if any questions arise
