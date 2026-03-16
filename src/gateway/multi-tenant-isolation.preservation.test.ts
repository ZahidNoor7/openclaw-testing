/**
 * Multi-Tenant Isolation Preservation Property Tests
 *
 * These tests MUST PASS on unfixed code — they establish the baseline behavior
 * that must not regress after the fix is applied.
 *
 * Methodology: observation-first — each test was written by observing the
 * actual behavior of the unfixed code for non-buggy inputs, then asserting
 * those observed behaviors hold.
 *
 * Validates: Requirements 3.1, 3.2, 3.4, 3.6, 3.7, 3.8
 */

import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyOrgApiKeyById, getAgentsForOrganization } from "../config/organizations.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { makeMockHttpResponse } from "./test-http-response.js";

// ---------------------------------------------------------------------------
// State dir isolation helpers
// ---------------------------------------------------------------------------

let prevStateDir: string | undefined;
let tempDir: string | undefined;

function setupTempStateDir(): string {
  prevStateDir = process.env.OPENCLAW_STATE_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-preservation-"));
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
// HTTP request/response helpers (shared with bug test)
// ---------------------------------------------------------------------------

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

async function callAuthEndpoint(params: {
  method: string;
  path: string;
  body?: unknown;
  authorization?: string;
}): Promise<{ status: number; body: unknown }> {
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

describe("Multi-Tenant Isolation Preservation Properties", () => {
  beforeEach(async () => {
    setupTempStateDir();
    // Use vi.resetModules() to get a fresh DB singleton per test.
    const { vi } = await import("vitest");
    vi.resetModules();
    // Seed a super_admin user.
    const { createUser } = await import("../infra/auth-db.js");
    await createUser(
      "superadmin@openclaw.test",
      "Password@123",
      "super_admin",
      "openclaw",
      "Super Admin",
    );
  });

  afterEach(async () => {
    teardownTempStateDir();
    const { vi } = await import("vitest");
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // Preservation Test P1 — Super_admin login response shape unchanged
  // -------------------------------------------------------------------------

  it("P1 — super_admin login returns full { user, role, orgId } payload with no apiKey field", async () => {
    /**
     * Observation: super_admin users have no per-org tenant API key.
     * The login handler only calls getOrCreateTenantApiKey for tenant_admin role.
     * For super_admin, apiKey is undefined and is NOT included in the response.
     *
     * Property: for any super_admin login, the response shape is
     *   { token, user: { id, email, role, orgId, displayName }, orgId, role }
     * with no apiKey field (or apiKey === undefined).
     *
     * Validates: Requirements 3.1
     */
    const { status, body } = await callAuthEndpoint({
      method: "POST",
      path: "/__auth/login",
      body: { email: "superadmin@openclaw.test", password: "Password@123" },
    });

    expect(status).toBe(200);
    const resp = body as Record<string, unknown>;

    // Full payload must be present.
    expect(resp).toHaveProperty("token");
    expect(resp).toHaveProperty("user");
    expect(resp).toHaveProperty("role");
    expect(resp).toHaveProperty("orgId");

    const user = resp["user"] as Record<string, unknown>;
    expect(user).toHaveProperty("id");
    expect(user).toHaveProperty("email");
    expect(user).toHaveProperty("role", "super_admin");
    expect(user).toHaveProperty("orgId");
    expect(user).toHaveProperty("displayName");

    // No per-org API key field — super_admin has no tenant key.
    // apiKey is either absent or undefined (not a raw string).
    expect(typeof resp["apiKey"]).not.toBe("string");
  });

  it("P1b — super_admin /me response shape unchanged: full user/role/orgId, no apiKey", async () => {
    /**
     * Validates: Requirements 3.1
     */
    const loginResult = await callAuthEndpoint({
      method: "POST",
      path: "/__auth/login",
      body: { email: "superadmin@openclaw.test", password: "Password@123" },
    });
    const token = (loginResult.body as Record<string, unknown>)["token"] as string;
    expect(token).toBeTruthy();

    const { status, body } = await callAuthEndpoint({
      method: "GET",
      path: "/__auth/me",
      authorization: `Bearer ${token}`,
    });

    expect(status).toBe(200);
    const resp = body as Record<string, unknown>;

    expect(resp).toHaveProperty("user");
    expect(resp).toHaveProperty("role", "super_admin");
    expect(resp).toHaveProperty("orgId");

    const user = resp["user"] as Record<string, unknown>;
    expect(user["role"]).toBe("super_admin");

    // No raw API key for super_admin.
    expect(typeof resp["apiKey"]).not.toBe("string");
  });

  // -------------------------------------------------------------------------
  // Preservation Test P2 — Single-user chat.send key resolution unchanged
  // -------------------------------------------------------------------------

  it("P2 — applyOrgApiKeyById with undefined orgId returns config unchanged (no crash)", () => {
    /**
     * Observation: applyOrgApiKeyById returns the original config object
     * unchanged (same reference) when orgId is undefined.
     *
     * Property: for any config, applyOrgApiKeyById(config, undefined) === config
     * (no mutation, no crash, no fallback to another org's key).
     *
     * Validates: Requirements 3.2, 3.7
     */
    const configs: OpenClawConfig[] = [
      // Empty config.
      {},
      // Config with organizations but no activeId.
      {
        organizations: {
          list: [
            {
              id: "org-a",
              name: "Org A",
              providerKeys: [{ id: "k-a", provider: "openai", key: "sk-org-a", enabled: true }],
            },
          ],
        },
      },
      // Config with activeId set.
      {
        organizations: {
          activeId: "org-a",
          list: [
            {
              id: "org-a",
              name: "Org A",
              providerKeys: [{ id: "k-a", provider: "openai", key: "sk-org-a", enabled: true }],
            },
          ],
        },
      },
      // Config with existing models.providers.
      {
        models: {
          providers: {
            openai: { baseUrl: "https://api.openai.com/v1", models: [], apiKey: "sk-global" },
          },
        },
      },
    ];

    for (const config of configs) {
      const result = applyOrgApiKeyById(config, undefined);
      // Must return the exact same reference — no copy, no mutation.
      expect(result).toBe(config);
    }
  });

  it("P2b — applyOrgApiKeyById with unknown orgId returns config unchanged (no crash)", () => {
    /**
     * Observation: when orgId is provided but not found in organizations.list,
     * applyOrgApiKeyById returns the original config unchanged.
     *
     * Property: for any config and any orgId not in config.organizations.list,
     * applyOrgApiKeyById(config, orgId) === config.
     *
     * Validates: Requirements 3.7
     */
    const config: OpenClawConfig = {
      organizations: {
        activeId: "org-a",
        list: [
          {
            id: "org-a",
            name: "Org A",
            providerKeys: [{ id: "k-a", provider: "openai", key: "sk-org-a", enabled: true }],
          },
        ],
      },
    };

    // orgId not in list — must return config unchanged.
    const unknownOrgIds = ["org-b", "org-c", "nonexistent", "", "   "];
    for (const orgId of unknownOrgIds) {
      if (!orgId) {
        // undefined/empty handled by P2 above
        continue;
      }
      const result = applyOrgApiKeyById(config, orgId);
      expect(result).toBe(config);
    }
  });

  it("P2c — applyOrgApiKeyById with orgId that has no providerKeys returns config unchanged", () => {
    /**
     * Observation: when the org exists but has no providerKeys (or all disabled),
     * applyOrgApiKeyById returns the original config unchanged.
     *
     * Validates: Requirements 3.7
     */
    const config: OpenClawConfig = {
      organizations: {
        activeId: "org-a",
        list: [
          {
            id: "org-a",
            name: "Org A",
            // No providerKeys at all.
          },
        ],
      },
    };

    const result = applyOrgApiKeyById(config, "org-a");
    expect(result).toBe(config);
  });

  // -------------------------------------------------------------------------
  // Preservation Test P3 — Global agents always visible
  // -------------------------------------------------------------------------

  it("P3 — getAgentsForOrganization always includes global agents (no organizationId)", () => {
    /**
     * Observation: getAgentsForOrganization filters agents by orgId but always
     * includes agents with no organizationId (global agents).
     *
     * Property: for any orgId value, global agents always appear in the result.
     *
     * Validates: Requirements 3.4
     */
    const config: OpenClawConfig = {
      agents: {
        list: [
          { id: "global-1", name: "Global Agent 1" },
          { id: "global-2", name: "Global Agent 2" },
          { id: "org-a-agent", name: "Org A Agent", organizationId: "org-a" },
          { id: "org-b-agent", name: "Org B Agent", organizationId: "org-b" },
        ],
      },
    };

    const orgIds: Array<string | undefined> = ["org-a", "org-b", "org-c", "nonexistent", undefined];

    for (const orgId of orgIds) {
      const result = getAgentsForOrganization(config, orgId);
      const ids = result.map((a) => a.id);

      // Global agents must always be present.
      expect(ids).toContain("global-1");
      expect(ids).toContain("global-2");
    }
  });

  it("P3b — getAgentsForOrganization excludes other-org agents when orgId is defined", () => {
    /**
     * Observation: when orgId is defined, agents from other orgs are excluded.
     *
     * Validates: Requirements 3.4
     */
    const config: OpenClawConfig = {
      agents: {
        list: [
          { id: "global-agent", name: "Global" },
          { id: "org-a-agent", name: "Org A", organizationId: "org-a" },
          { id: "org-b-agent", name: "Org B", organizationId: "org-b" },
        ],
      },
    };

    const resultA = getAgentsForOrganization(config, "org-a");
    expect(resultA.map((a) => a.id)).toContain("global-agent");
    expect(resultA.map((a) => a.id)).toContain("org-a-agent");
    expect(resultA.map((a) => a.id)).not.toContain("org-b-agent");

    const resultB = getAgentsForOrganization(config, "org-b");
    expect(resultB.map((a) => a.id)).toContain("global-agent");
    expect(resultB.map((a) => a.id)).toContain("org-b-agent");
    expect(resultB.map((a) => a.id)).not.toContain("org-a-agent");
  });

  it("P3c — getAgentsForOrganization with undefined orgId returns all agents (single-user mode)", () => {
    /**
     * Observation: when orgId is undefined (single-user / no-org mode),
     * all agents are returned so existing single-tenant configs work unchanged.
     *
     * Validates: Requirements 3.4
     */
    const config: OpenClawConfig = {
      agents: {
        list: [
          { id: "global-agent", name: "Global" },
          { id: "org-a-agent", name: "Org A", organizationId: "org-a" },
          { id: "org-b-agent", name: "Org B", organizationId: "org-b" },
        ],
      },
    };

    const result = getAgentsForOrganization(config, undefined);
    expect(result).toHaveLength(3);
    expect(result.map((a) => a.id)).toContain("global-agent");
    expect(result.map((a) => a.id)).toContain("org-a-agent");
    expect(result.map((a) => a.id)).toContain("org-b-agent");
  });

  // -------------------------------------------------------------------------
  // Preservation Test P4 — Non-tenant WS auth succeeds without orgId
  // -------------------------------------------------------------------------

  it("P4 — token/password WS auth modes do not require orgId on the client", async () => {
    /**
     * Observation: the gateway WS auth for token/password modes (authorizeGatewayConnect)
     * does not read or require orgId. It only checks the token/password credential.
     * client.orgId is not set by these auth paths.
     *
     * Property: for token/password auth modes, auth succeeds without orgId,
     * and the resolved auth result has no orgId field.
     *
     * Validates: Requirements 3.6
     */
    const { authorizeGatewayConnect } = await import("./auth.js");

    // Token mode — no orgId needed.
    const tokenResult = await authorizeGatewayConnect({
      auth: { mode: "token", token: "test-token-abc", allowTailscale: false },
      connectAuth: { token: "test-token-abc" },
    });
    expect(tokenResult.ok).toBe(true);
    expect(tokenResult.method).toBe("token");
    // No orgId on the auth result — token auth is org-agnostic.
    expect((tokenResult as Record<string, unknown>)["orgId"]).toBeUndefined();

    // Password mode — no orgId needed.
    const passwordResult = await authorizeGatewayConnect({
      auth: { mode: "password", password: "test-pass-xyz", allowTailscale: false }, // pragma: allowlist secret
      connectAuth: { password: "test-pass-xyz" }, // pragma: allowlist secret
    });
    expect(passwordResult.ok).toBe(true);
    expect(passwordResult.method).toBe("password");
    expect((passwordResult as Record<string, unknown>)["orgId"]).toBeUndefined();
  });

  it("P4b — token/password WS auth failure does not mention orgId", async () => {
    /**
     * Observation: when token/password auth fails, the reason is token_mismatch
     * or password_mismatch — never an orgId-related error.
     *
     * Validates: Requirements 3.6
     */
    const { authorizeGatewayConnect } = await import("./auth.js");

    const badTokenResult = await authorizeGatewayConnect({
      auth: { mode: "token", token: "correct-token", allowTailscale: false },
      connectAuth: { token: "wrong-token" },
    });
    expect(badTokenResult.ok).toBe(false);
    expect(badTokenResult.reason).toBe("token_mismatch");
    // Reason must not reference orgId.
    expect(badTokenResult.reason).not.toContain("org");
  });

  // -------------------------------------------------------------------------
  // Preservation Test P5 — applyOrgApiKeyById with unconfigured orgId
  // -------------------------------------------------------------------------

  it("P5 — applyOrgApiKeyById with orgId having no configured keys returns config unchanged", () => {
    /**
     * Observation: when an org exists but has no enabled providerKeys,
     * applyOrgApiKeyById returns the original config unchanged (same reference).
     * No crash, no fallback to another org's key.
     *
     * Property: for any config where org has no providerKeys,
     * applyOrgApiKeyById(config, orgId) === config.
     *
     * Validates: Requirements 3.7
     */
    const scenarios: Array<{ config: OpenClawConfig; orgId: string }> = [
      // Org with empty providerKeys array.
      {
        config: {
          organizations: {
            list: [{ id: "org-empty", name: "Empty Org", providerKeys: [] }],
          },
        },
        orgId: "org-empty",
      },
      // Org with all disabled keys.
      {
        config: {
          organizations: {
            list: [
              {
                id: "org-disabled",
                name: "Disabled Keys Org",
                providerKeys: [
                  { id: "k1", provider: "openai", key: "sk-disabled", enabled: false },
                ],
              },
            ],
          },
        },
        orgId: "org-disabled",
      },
      // Org with no providerKeys field at all.
      {
        config: {
          organizations: {
            list: [{ id: "org-none", name: "No Keys Org" }],
          },
        },
        orgId: "org-none",
      },
    ];

    for (const { config, orgId } of scenarios) {
      const result = applyOrgApiKeyById(config, orgId);
      // Must return the exact same reference — no mutation, no crash.
      expect(result).toBe(config);
    }
  });

  it("P5b — applyOrgApiKeyById does not fall back to another org's key", () => {
    /**
     * Observation: when org-a has no keys, applyOrgApiKeyById(config, "org-a")
     * returns config unchanged — it does NOT inject org-b's key.
     *
     * Validates: Requirements 3.7
     */
    const config: OpenClawConfig = {
      organizations: {
        activeId: "org-b",
        list: [
          {
            id: "org-a",
            name: "Org A",
            // No keys.
          },
          {
            id: "org-b",
            name: "Org B",
            providerKeys: [{ id: "k-b", provider: "openai", key: "sk-org-b", enabled: true }],
          },
        ],
      },
    };

    const result = applyOrgApiKeyById(config, "org-a");
    // Must be the same reference — no org-b key injected.
    expect(result).toBe(config);

    // Confirm org-b's key is NOT present in the result.
    const openaiKey = (result.models?.providers?.["openai"] as { apiKey?: string } | undefined)
      ?.apiKey;
    expect(openaiKey).toBeUndefined();
  });
});
