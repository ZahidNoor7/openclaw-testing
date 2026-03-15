import { describe, expect, it } from "vitest";
import {
  applyActiveOrgApiKey,
  applyOrgApiKeyById,
  getAgentsForOrganization,
} from "./organizations.js";
import type { OpenClawConfig } from "./types.openclaw.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return { ...overrides };
}

function resolvedOpenAiKey(cfg: OpenClawConfig): string | undefined {
  return (cfg.models?.providers?.["openai"] as { apiKey?: string } | undefined)?.apiKey;
}

function resolvedProviderKey(cfg: OpenClawConfig, provider: string): string | undefined {
  return (cfg.models?.providers?.[provider] as { apiKey?: string } | undefined)?.apiKey;
}

function resolvedProviderAuth(cfg: OpenClawConfig, provider: string): string | undefined {
  return (cfg.models?.providers?.[provider] as { auth?: string } | undefined)?.auth;
}

// ---------------------------------------------------------------------------
// applyActiveOrgApiKey
// ---------------------------------------------------------------------------

describe("applyActiveOrgApiKey", () => {
  it("returns config unchanged when no active org", () => {
    const cfg = makeConfig({ organizations: { list: [{ id: "org1", name: "Org1" }] } });
    expect(applyActiveOrgApiKey(cfg)).toBe(cfg);
  });

  it("returns config unchanged when active org has no keys", () => {
    const cfg = makeConfig({
      organizations: { list: [{ id: "org1", name: "Org1" }], activeId: "org1" },
    });
    expect(applyActiveOrgApiKey(cfg)).toBe(cfg);
  });

  // ------ Legacy openaiApiKey field ----------------------------------------

  it("injects legacy openaiApiKey into models.providers.openai.apiKey", () => {
    const cfg = makeConfig({
      organizations: {
        list: [{ id: "org1", name: "Org1", openaiApiKey: "sk-legacy-key" }],
        activeId: "org1",
      },
    });
    const result = applyActiveOrgApiKey(cfg);
    expect(resolvedOpenAiKey(result)).toBe("sk-legacy-key");
    expect(resolvedProviderAuth(result, "openai")).toBe("api-key");
  });

  // ------ providerKeys array -----------------------------------------------

  it("injects enabled providerKeys entry into the correct provider", () => {
    const cfg = makeConfig({
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            providerKeys: [{ id: "k1", provider: "openai", key: "sk-new-key", enabled: true }],
          },
        ],
        activeId: "org1",
      },
    });
    const result = applyActiveOrgApiKey(cfg);
    expect(resolvedOpenAiKey(result)).toBe("sk-new-key");
    expect(resolvedProviderAuth(result, "openai")).toBe("api-key");
  });

  it("skips disabled providerKeys entries", () => {
    const cfg = makeConfig({
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            providerKeys: [{ id: "k1", provider: "openai", key: "sk-disabled", enabled: false }],
          },
        ],
        activeId: "org1",
      },
    });
    const result = applyActiveOrgApiKey(cfg);
    expect(resolvedOpenAiKey(result)).toBeUndefined();
  });

  it("injects keys for multiple providers", () => {
    const cfg = makeConfig({
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            providerKeys: [
              { id: "k1", provider: "openai", key: "sk-openai", enabled: true },
              { id: "k2", provider: "anthropic", key: "sk-ant-anthropic", enabled: true },
              { id: "k3", provider: "gemini", key: "AIza-gemini", enabled: true },
            ],
          },
        ],
        activeId: "org1",
      },
    });
    const result = applyActiveOrgApiKey(cfg);
    expect(resolvedProviderKey(result, "openai")).toBe("sk-openai");
    expect(resolvedProviderKey(result, "anthropic")).toBe("sk-ant-anthropic");
    expect(resolvedProviderKey(result, "gemini")).toBe("AIza-gemini");
  });

  it("providerKeys overrides legacy apiKeys for same provider", () => {
    const cfg = makeConfig({
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            apiKeys: [{ id: "k1", provider: "openai", key: "sk-legacy-apikey", enabled: true }],
            providerKeys: [{ id: "k2", provider: "openai", key: "sk-provider-key", enabled: true }],
          },
        ],
        activeId: "org1",
      },
    });
    const result = applyActiveOrgApiKey(cfg);
    expect(resolvedOpenAiKey(result)).toBe("sk-provider-key");
  });

  it("falls back to legacy openaiApiKey when no openai entry in providerKeys", () => {
    const cfg = makeConfig({
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            openaiApiKey: "sk-fallback",
            providerKeys: [{ id: "k1", provider: "anthropic", key: "sk-ant-only", enabled: true }],
          },
        ],
        activeId: "org1",
      },
    });
    const result = applyActiveOrgApiKey(cfg);
    expect(resolvedOpenAiKey(result)).toBe("sk-fallback");
    expect(resolvedProviderKey(result, "anthropic")).toBe("sk-ant-only");
  });

  it("does not override legacy openaiApiKey when providerKeys has an openai entry", () => {
    const cfg = makeConfig({
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            openaiApiKey: "sk-legacy",
            providerKeys: [{ id: "k1", provider: "openai", key: "sk-new", enabled: true }],
          },
        ],
        activeId: "org1",
      },
    });
    const result = applyActiveOrgApiKey(cfg);
    // providerKeys wins
    expect(resolvedOpenAiKey(result)).toBe("sk-new");
  });

  it("preserves existing provider config and merges apiKey", () => {
    const cfg = makeConfig({
      models: {
        providers: {
          openai: { baseUrl: "https://my-proxy/openai", models: [], apiKey: "sk-global" },
        },
      },
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            providerKeys: [{ id: "k1", provider: "openai", key: "sk-org", enabled: true }],
          },
        ],
        activeId: "org1",
      },
    });
    const result = applyActiveOrgApiKey(cfg);
    const openAiEntry = result.models?.providers?.["openai"] as {
      baseUrl?: string;
      apiKey?: string;
      auth?: string;
    };
    // Base URL from existing entry is preserved
    expect(openAiEntry?.baseUrl).toBe("https://my-proxy/openai");
    // Org key overrides global key
    expect(openAiEntry?.apiKey).toBe("sk-org");
    expect(openAiEntry?.auth).toBe("api-key");
  });

  it("does not modify config when org has only disabled keys", () => {
    const cfg = makeConfig({
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            providerKeys: [
              { id: "k1", provider: "openai", key: "sk-disabled", enabled: false },
              { id: "k2", provider: "anthropic", key: "sk-also-disabled", enabled: false },
            ],
          },
        ],
        activeId: "org1",
      },
    });
    const result = applyActiveOrgApiKey(cfg);
    expect(result).toBe(cfg);
  });
});

// ---------------------------------------------------------------------------
// applyOrgApiKeyById
// ---------------------------------------------------------------------------

describe("applyOrgApiKeyById", () => {
  it("returns config unchanged when orgId is undefined", () => {
    const cfg = makeConfig({
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            providerKeys: [{ id: "k1", provider: "openai", key: "sk-key", enabled: true }],
          },
        ],
      },
    });
    expect(applyOrgApiKeyById(cfg, undefined)).toBe(cfg);
  });

  it("returns config unchanged when orgId is not found", () => {
    const cfg = makeConfig({
      organizations: {
        list: [{ id: "org1", name: "Org1", openaiApiKey: "sk-key" }],
      },
    });
    expect(applyOrgApiKeyById(cfg, "nonexistent")).toBe(cfg);
  });

  it("injects providerKeys for the specified org", () => {
    const cfg = makeConfig({
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            providerKeys: [
              { id: "k1", provider: "openai", key: "sk-org1", enabled: true },
              { id: "k2", provider: "anthropic", key: "sk-ant-org1", enabled: true },
            ],
          },
          {
            id: "org2",
            name: "Org2",
            providerKeys: [{ id: "k3", provider: "openai", key: "sk-org2", enabled: true }],
          },
        ],
      },
    });
    const result = applyOrgApiKeyById(cfg, "org1");
    expect(resolvedOpenAiKey(result)).toBe("sk-org1");
    expect(resolvedProviderKey(result, "anthropic")).toBe("sk-ant-org1");
    // org2 key should NOT be injected
    const openAiKey = resolvedOpenAiKey(result);
    expect(openAiKey).not.toBe("sk-org2");
  });

  it("sets auth: api-key on injected provider entries to bypass stored auth profiles", () => {
    const cfg = makeConfig({
      organizations: {
        list: [
          {
            id: "org1",
            name: "Org1",
            providerKeys: [{ id: "k1", provider: "openai", key: "sk-key", enabled: true }],
          },
        ],
      },
    });
    const result = applyOrgApiKeyById(cfg, "org1");
    expect(resolvedProviderAuth(result, "openai")).toBe("api-key");
  });
});

// ---------------------------------------------------------------------------
// getAgentsForOrganization
// ---------------------------------------------------------------------------

describe("getAgentsForOrganization", () => {
  const agents = [
    { id: "global-agent" },
    { id: "org1-agent", organizationId: "org1" },
    { id: "org2-agent", organizationId: "org2" },
  ] as NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>;

  const cfg = makeConfig({ agents: { list: agents } });

  it("returns all agents when no orgId (single-user mode)", () => {
    expect(getAgentsForOrganization(cfg, undefined)).toHaveLength(3);
  });

  it("returns global + org-specific agents for a given orgId", () => {
    const result = getAgentsForOrganization(cfg, "org1");
    expect(result.map((a) => a.id)).toEqual(["global-agent", "org1-agent"]);
  });

  it("does not return other orgs' agents", () => {
    const result = getAgentsForOrganization(cfg, "org1");
    expect(result.find((a) => a.id === "org2-agent")).toBeUndefined();
  });
});
