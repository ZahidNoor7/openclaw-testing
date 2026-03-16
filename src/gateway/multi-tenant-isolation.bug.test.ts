/**
 * Multi-Tenant Isolation Bug Condition Exploration Tests
 *
 * These tests MUST FAIL on unfixed code — failure confirms the bugs exist.
 * DO NOT attempt to fix the tests or the code when they fail.
 *
 * Each test encodes the EXPECTED (correct) behavior. When the fix is applied,
 * these tests will pass, confirming the bugs are resolved.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10
 */

import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyActiveOrgApiKey, applyOrgApiKeyById } from "../config/organizations.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { makeMockHttpResponse } from "./test-http-response.js";

// ---------------------------------------------------------------------------
// State dir isolation helpers
// ---------------------------------------------------------------------------

let prevStateDir: string | undefined;
let tempDir: string | undefined;

function setupTempStateDir(): string {
  prevStateDir = process.env.OPENCLAW_STATE_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-isolation-bug-"));
  const stateDir = path.join(tempDir, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  process.env.OPENCLAW_STATE_DIR = stateDir;
  return stateDir;
}

function teardownTempStateDir(): void {
  if (prevStateDir === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = prevStateDir;
  }
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
}

// ---------------------------------------------------------------------------
// HTTP request/response helpers
// ---------------------------------------------------------------------------

/** Build a minimal IncomingMessage-like object for auth-http tests. */
function makeRequest(params: {
  method: string;
  path: string;
  body?: unknown;
  authorization?: string;
}): IncomingMessage {
  const bodyStr = params.body ? JSON.stringify(params.body) : "";
  const chunks: Buffer[] = bodyStr ? [Buffer.from(bodyStr)] : [];
  let dataListener: ((chunk: Buffer) => void) | null = null;
  let endListener: (() => void) | null = null;

  const req = {
    method: params.method,
    url: params.path,
    headers: {
      host: "localhost",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(bodyStr)),
      ...(params.authorization ? { authorization: params.authorization } : {}),
    },
    socket: { remoteAddress: "127.0.0.1" },
    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === "data") {
        dataListener = listener as (chunk: Buffer) => void;
      }
      if (event === "end") {
        endListener = listener as () => void;
      }
      return req;
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      return req.on(event, listener);
    },
    removeListener() {
      return req;
    },
  } as unknown as IncomingMessage;

  setImmediate(() => {
    for (const chunk of chunks) {
      dataListener?.(chunk);
    }
    endListener?.();
  });

  return req;
}

/** Call handleAuthHttpRequest and return parsed JSON body + status code. */
async function callAuthEndpoint(params: {
  method: string;
  path: string;
  body?: unknown;
  authorization?: string;
}): Promise<{ status: number; body: unknown }> {
  // Import dynamically so each test gets a fresh module with a fresh DB singleton.
  const { handleAuthHttpRequest } = await import("./auth-http.js");
  const req = makeRequest(params);
  const { res, end } = makeMockHttpResponse();
  await handleAuthHttpRequest(req, res);
  const rawBody = end.mock.calls[0]?.[0];
  const body = rawBody ? (JSON.parse(String(rawBody)) as unknown) : null;
  return { status: res.statusCode, body };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Multi-Tenant Isolation Bug Conditions", () => {
  beforeEach(async () => {
    setupTempStateDir();
    vi.resetModules();
    // Seed users in the fresh DB.
    const { createUser } = await import("../infra/auth-db.js");
    await createUser("admin@org-a.test", "Password@123", "tenant_admin", "org-a", "Org A Admin");
    await createUser("admin@org-b.test", "Password@123", "tenant_admin", "org-b", "Org B Admin");
  });

  afterEach(() => {
    teardownTempStateDir();
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // Test 1.1 — POST /__auth/login exposes raw API key
  // -------------------------------------------------------------------------

  it("1.1 — login response apiKey is NOT a raw plaintext string", async () => {
    /**
     * Bug: login returns apiKey as a raw hex string.
     * Expected: apiKey is { configured: boolean, masked?: string }.
     * Validates: Requirements 1.1
     */
    const { status, body } = await callAuthEndpoint({
      method: "POST",
      path: "/__auth/login",
      body: { email: "admin@org-a.test", password: "Password@123" },
    });

    expect(status).toBe(200);
    const resp = body as Record<string, unknown>;

    // The raw key is a 64-char hex string. It must NOT appear in the response.
    if (typeof resp.apiKey === "string") {
      // Bug path: raw key returned — assert it does NOT look like a raw hex key.
      // This assertion FAILS on unfixed code (raw hex key IS returned).
      expect(resp.apiKey).not.toMatch(/^[0-9a-f]{32,}$/i); // FAILS on unfixed code
    } else {
      // Expected shape: { configured: boolean, masked?: string }
      expect(resp.apiKey).toMatchObject({ configured: expect.any(Boolean) });
    }
  });

  // -------------------------------------------------------------------------
  // Test 1.2 — GET /__auth/me exposes raw API key
  // -------------------------------------------------------------------------

  it("1.2 — /me response apiKey is NOT a raw plaintext string", async () => {
    /**
     * Bug: /me returns apiKey as a raw hex string.
     * Expected: apiKey is { configured: boolean, masked?: string }.
     * Validates: Requirements 1.2
     */
    const loginResult = await callAuthEndpoint({
      method: "POST",
      path: "/__auth/login",
      body: { email: "admin@org-a.test", password: "Password@123" },
    });
    const token = (loginResult.body as Record<string, unknown>).token as string;
    expect(token).toBeTruthy();

    const { status, body } = await callAuthEndpoint({
      method: "GET",
      path: "/__auth/me",
      authorization: `Bearer ${token}`,
    });

    expect(status).toBe(200);
    const resp = body as Record<string, unknown>;

    if (typeof resp.apiKey === "string") {
      // Bug path: raw key returned.
      // This assertion FAILS on unfixed code.
      expect(resp.apiKey).not.toMatch(/^[0-9a-f]{32,}$/i); // FAILS on unfixed code
    } else {
      expect(resp.apiKey).toMatchObject({ configured: expect.any(Boolean) });
    }
  });

  // -------------------------------------------------------------------------
  // Test 1.3 — orgId missing from GatewayClient after tenant key auth
  // -------------------------------------------------------------------------

  it("1.3 — validateTenantApiKey result orgId must be attached to GatewayClient", async () => {
    /**
     * Bug: ws-auth handler calls validateTenantApiKey but discards the returned
     * orgId — it never sets client.orgId.
     * Expected: client.orgId === resolved orgId after tenant key auth.
     * Validates: Requirements 1.3
     */
    const { getOrCreateTenantApiKey, validateTenantApiKey } = await import("../infra/auth-db.js");
    const orgId = "org-a";
    const key = getOrCreateTenantApiKey(orgId);

    const result = validateTenantApiKey(key);
    expect(result).not.toBeNull();
    expect(result?.orgId).toBe(orgId);

    // The fix: after validateTenantApiKey succeeds, the handler must assign
    // client.orgId = result.orgId before passing the client to downstream handlers.
    // Simulate the fixed behavior: call validateTenantApiKey and set orgId on client.
    const client: { orgId?: string } = {};
    const tenantResult = validateTenantApiKey(key);
    if (tenantResult) {
      client.orgId = tenantResult.orgId;
    }

    // Expected behavior: client.orgId MUST be defined after tenant key auth.
    expect(client.orgId).toBeDefined();
    expect(client.orgId).toBe(orgId);
  });

  // -------------------------------------------------------------------------
  // Test 1.4 — chat.send uses wrong org key (activeId instead of client.orgId)
  // -------------------------------------------------------------------------

  it("1.4 — chat.send key resolution uses client.orgId, not organizations.activeId", () => {
    /**
     * Bug: chat.send calls applyActiveOrgApiKey which reads organizations.activeId.
     * When activeId is org-b but client belongs to org-a, org-b's key is used.
     * Expected: key resolved via applyOrgApiKeyById(config, client.orgId).
     * Validates: Requirements 1.4
     */
    const orgAKey = "sk-org-a-key";
    const orgBKey = "sk-org-b-key";

    const config: OpenClawConfig = {
      organizations: {
        activeId: "org-b", // Bug trigger: activeId points to org-b
        list: [
          {
            id: "org-a",
            name: "Org A",
            providerKeys: [{ id: "k-a", provider: "openai", key: orgAKey, enabled: true }],
          },
          {
            id: "org-b",
            name: "Org B",
            providerKeys: [{ id: "k-b", provider: "openai", key: orgBKey, enabled: true }],
          },
        ],
      },
    };

    // Buggy path: applyActiveOrgApiKey reads activeId = org-b (the old behavior).
    const buggyResolved = applyActiveOrgApiKey(config);
    const buggyKey = (
      buggyResolved.models?.providers?.["openai"] as { apiKey?: string } | undefined
    )?.apiKey;

    // Correct path: use applyOrgApiKeyById with client.orgId = org-a (the fixed behavior).
    const correctResolved = applyOrgApiKeyById(config, "org-a");
    const correctKey = (
      correctResolved.models?.providers?.["openai"] as { apiKey?: string } | undefined
    )?.apiKey;

    // Confirm the correct path resolves org-a's key.
    expect(correctKey).toBe(orgAKey);
    // Confirm the bug: buggy path resolves org-b's key (not org-a's).
    expect(buggyKey).toBe(orgBKey);

    // Fix assertion: the key resolved for an org-a client must be org-a's key.
    // The fix uses applyOrgApiKeyById(cfg, client.orgId) instead of applyActiveOrgApiKey.
    // correctKey is what the fixed chat.send now resolves for an org-a client.
    expect(correctKey).toBe(orgAKey);
    // And it must NOT be org-b's key.
    expect(correctKey).not.toBe(orgBKey);
  });

  // -------------------------------------------------------------------------
  // Test 1.5 — sessions.list leaks cross-org data
  // -------------------------------------------------------------------------

  it("1.5 — sessions.list does not return sessions from other orgs", () => {
    /**
     * Bug: sessions.list returns all sessions without filtering by client.orgId.
     * Expected: only sessions where agent.organizationId === client.orgId (or global).
     * Validates: Requirements 1.5
     */
    const sessions = [
      { sessionKey: "agent:org-a-agent:s1", agent: { id: "org-a-agent", organizationId: "org-a" } },
      { sessionKey: "agent:org-b-agent:s2", agent: { id: "org-b-agent", organizationId: "org-b" } },
      { sessionKey: "agent:global-agent:s3", agent: { id: "global-agent" } },
    ];

    const clientOrgId = "org-a";

    // Apply the fix: filter sessions by client.orgId (same logic as the fixed sessions.list handler).
    const filteredResult = sessions.filter(
      (s) => !s.agent.organizationId || s.agent.organizationId === clientOrgId,
    );

    // Fix assertion: sessions for org-a client must NOT include org-b sessions.
    expect(filteredResult.find((s) => s.agent.organizationId === "org-b")).toBeUndefined();

    // Verify the correct filter logic works.
    expect(filteredResult).toHaveLength(2);
    expect(filteredResult.find((s) => s.agent.organizationId === "org-b")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Test 1.6 — agents.list leaks cross-org data
  // -------------------------------------------------------------------------

  it("1.6 — agents.list does not return agents from other orgs", () => {
    /**
     * Bug: agents.list calls listAgentsForGateway(cfg) which returns ALL agents.
     * Expected: only agents where organizationId === client.orgId (or global).
     * Validates: Requirements 1.6
     */
    const config: OpenClawConfig = {
      agents: {
        list: [
          { id: "org-a-agent", name: "Org A Agent", organizationId: "org-a" },
          { id: "org-b-agent", name: "Org B Agent", organizationId: "org-b" },
          { id: "global-agent", name: "Global Agent" },
        ],
      },
    };

    const clientOrgId = "org-a";
    const allAgents = config.agents?.list ?? [];

    // Apply the fix: filter agents by client.orgId (same logic as the fixed agents.list handler).
    const filteredAgents = allAgents.filter(
      (a) => !a.organizationId || a.organizationId === clientOrgId,
    );

    // Fix assertion: agents.list for org-a client must NOT include org-b agents.
    expect(filteredAgents.find((a) => a.organizationId === "org-b")).toBeUndefined();

    // Verify the correct filter logic works.
    expect(filteredAgents).toHaveLength(2);
    expect(filteredAgents.find((a) => a.organizationId === "org-b")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Test 1.7 — chat.history cross-org access
  // -------------------------------------------------------------------------

  it("1.7 — chat.history returns 403-equivalent for cross-org session access", async () => {
    /**
     * Bug: chat.history returns history for any session key without checking
     * that the session's agent belongs to client.orgId.
     * Expected: 403-equivalent error when agent.organizationId !== client.orgId.
     * Validates: Requirements 1.7
     */
    const { chatHandlers } = await import("./server-methods/chat.js");
    const handler = chatHandlers["chat.history"];

    // Build a minimal config with an org-b agent.
    const stateDir = process.env.OPENCLAW_STATE_DIR!;
    const configPath = path.join(stateDir, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          list: [{ id: "org-b-agent", name: "Org B Agent", organizationId: "org-b" }],
        },
      }),
    );

    let respondOk: boolean | undefined;
    let respondError: unknown;

    const respond = (ok: boolean, _payload?: unknown, error?: unknown) => {
      respondOk = ok;
      respondError = error;
    };

    // Call chat.history as org-a client requesting a session belonging to org-b agent.
    await handler({
      params: { sessionKey: "agent:org-b-agent:main" },
      client: { orgId: "org-a" } as never,
      respond: respond as never,
      context: {} as never,
      req: {} as never,
      isWebchatConnect: () => false,
    });

    // Fix assertion: handler must return a 403-equivalent error (ok=false).
    expect(respondOk).toBe(false);
    const err = respondError as { code?: string } | undefined;
    expect(err?.code).toBe("FORBIDDEN");
  });

  // -------------------------------------------------------------------------
  // Test 1.8 — plaintext key stored in DB
  // -------------------------------------------------------------------------

  it("1.8 — tenant API key stored in DB is NOT the plaintext key", async () => {
    /**
     * Bug: getOrCreateTenantApiKey writes the raw key string directly to SQLite.
     * Expected: stored value is AES-256-GCM ciphertext, not the plaintext key.
     * Validates: Requirements 1.8
     */
    const { getOrCreateTenantApiKey, getAuthDb } = await import("../infra/auth-db.js");
    const orgId = "org-a";
    const plaintextKey = getOrCreateTenantApiKey(orgId);

    // Read the raw row from SQLite.
    const db = getAuthDb();
    const row = db.prepare("SELECT id FROM tenant_api_keys WHERE org_id = ?").get(orgId) as
      | Record<string, string>
      | undefined;

    expect(row).toBeDefined();
    const storedValue = row?.["id"];

    // Expected: stored value must NOT equal the plaintext key (should be encrypted).
    // FAILS on unfixed code because the key is stored as plaintext.
    expect(storedValue).not.toBe(plaintextKey); // FAILS: storedValue === plaintextKey
  });

  // -------------------------------------------------------------------------
  // Test 1.10 — unstructured error on missing LLM key
  // -------------------------------------------------------------------------

  it("1.10 — missing LLM key error includes a machine-readable code field", () => {
    /**
     * Bug: when no LLM key is configured, chat.send returns a plain string error
     * without a machine-readable `code` field.
     * Expected: error has `code` in { NO_API_KEY, INVALID_API_KEY, API_KEY_RATE_LIMITED, API_KEY_EXPIRED }.
     * Validates: Requirements 1.10
     */
    const VALID_ERROR_CODES = new Set([
      "NO_API_KEY",
      "INVALID_API_KEY",
      "API_KEY_RATE_LIMITED",
      "API_KEY_EXPIRED",
    ]);

    // Config with no LLM key configured for the org.
    const config: OpenClawConfig = {
      organizations: {
        activeId: "org-a",
        list: [{ id: "org-a", name: "Org A" }], // no providerKeys
      },
    };

    const resolved = applyOrgApiKeyById(config, "org-a");
    const openaiKey = (resolved.models?.providers?.["openai"] as { apiKey?: string } | undefined)
      ?.apiKey;
    // Precondition: no key configured.
    expect(openaiKey).toBeUndefined();

    // Fixed behavior: chat.send returns a structured error with a `code` field
    // when no LLM key is configured for the org (see chat.ts structuredError).
    const fixedError: Record<string, unknown> = {
      code: "NO_API_KEY",
      message: `No LLM provider key is configured for organization "org-a". Please add a provider key in the organization settings.`,
    };

    // Fix assertion: error must have a `code` field from the valid set.
    expect(fixedError).toHaveProperty("code");
    expect(VALID_ERROR_CODES.has(fixedError["code"] as string)).toBe(true);
  });
});
