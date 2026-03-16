/**
 * HTTP auth endpoints for multi-tenant application authentication.
 *
 * Routes:
 *   POST /__auth/login        — email/password → session token
 *   POST /__auth/register     — create org + tenant admin
 *   POST /__auth/logout       — invalidate session
 *   GET  /__auth/me           — get current user from token
 *   GET  /__auth/users        — list users (super_admin only)
 *   PATCH /__auth/orgs/:orgId/status  — activate/suspend org (super_admin only)
 *   POST /__auth/api-keys/regenerate  — regenerate tenant API key
 *   GET  /__auth/api-key/status       — check key status (masked only, never raw)
 *
 * These endpoints do NOT require the gateway WS auth token. They operate
 * before WebSocket connection is established.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, writeConfigFile } from "../config/config.js";
import { findOrganization } from "../config/organizations.js";
import type { OrganizationConfig } from "../config/organizations.js";
import {
  createSession,
  createUser,
  deleteSession,
  deleteSessionsByOrgId,
  findSession,
  findUserByEmail,
  findUserById,
  getOrCreateTenantApiKey,
  getUserPasswordFields,
  listAllUsers,
  listUsersByOrg,
  regenerateTenantApiKey,
  updateUserCredentials,
  verifyPassword,
} from "../infra/auth-db.js";
import type { AuthUserRole } from "../infra/auth-db.js";
import { readJsonBody } from "./hooks.js";
import { sendJson, setDefaultSecurityHeaders } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";

const MAX_AUTH_BODY_BYTES = 64 * 1024; // 64 KB — credentials are small
const AUTH_PATH_PREFIX = "/__auth/";

// ---------------------------------------------------------------------------
// Key masking
// ---------------------------------------------------------------------------

/**
 * Returns a masked representation of an API key showing only the last 4 chars.
 * e.g. "sk-abc123ab3f" → "sk-...ab3f"
 * Returns undefined if no key is provided.
 */
function maskKey(key: string | undefined | null): string | undefined {
  if (!key) {
    return undefined;
  }
  const suffix = key.slice(-4);
  return `sk-...${suffix}`;
}

/**
 * Converts a raw API key into the safe response shape.
 * Never includes the raw key value.
 */
function maskApiKey(key: string | undefined): { configured: boolean; masked?: string } {
  return { configured: !!key, masked: maskKey(key) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function requireSuperAdmin(
  req: IncomingMessage,
  res: ServerResponse,
): { orgId: string; role: AuthUserRole; userId: string } | null {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  const session = findSession(token);
  if (!session) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  if (session.role !== "super_admin") {
    sendJson(res, 403, { error: "forbidden" });
    return null;
  }
  return { orgId: session.orgId, role: session.role, userId: session.userId };
}

function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
): { orgId: string; role: AuthUserRole; userId: string } | null {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  const session = findSession(token);
  if (!session) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  return { orgId: session.orgId, role: session.role, userId: session.userId };
}

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

/** Ensure a string is non-empty and safe. */
function validateString(value: unknown, maxLen = 255): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) {
    return null;
  }
  return trimmed;
}

/** Validate email format. */
function validateEmail(value: unknown): string | null {
  const str = validateString(value, 254);
  if (!str) {
    return null;
  }
  if (!str.includes("@") || str.includes(" ")) {
    return null;
  }
  return str.toLowerCase();
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const body = await readJsonBody(req, MAX_AUTH_BODY_BYTES);
  if (!body.ok) {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  const payload = body.value as Record<string, unknown>;
  const email = validateEmail(payload["email"]);
  const password = validateString(payload["password"], 1024);

  if (!email || !password) {
    sendJson(res, 400, { error: "email_and_password_required" });
    return;
  }

  const user = findUserByEmail(email);
  if (!user) {
    sendJson(res, 401, { error: "invalid_credentials" });
    return;
  }

  if (user.status === "suspended") {
    sendJson(res, 403, { error: "account_suspended" });
    return;
  }

  const pwFields = getUserPasswordFields(email);
  if (!pwFields) {
    sendJson(res, 401, { error: "invalid_credentials" });
    return;
  }

  const valid = await verifyPassword(pwFields.hash, pwFields.salt, password);
  if (!valid) {
    sendJson(res, 401, { error: "invalid_credentials" });
    return;
  }

  // Check if the user's org is suspended (for tenant_admin).
  if (user.role === "tenant_admin") {
    const config = loadConfig();
    const org = findOrganization(config, user.orgId);
    if (org && (org as OrganizationConfig & { status?: string }).status === "suspended") {
      sendJson(res, 403, { error: "org_suspended" });
      return;
    }
  }

  const session = createSession(user.id, user.orgId, user.role);
  const rawApiKey = user.role === "tenant_admin" ? getOrCreateTenantApiKey(user.orgId) : undefined;

  sendJson(res, 200, {
    token: session.id,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      displayName: user.displayName,
    },
    orgId: user.orgId,
    role: user.role,
    // Only include apiKey field for tenant_admin; super_admin has no per-org key.
    ...(user.role === "tenant_admin" ? { apiKey: maskApiKey(rawApiKey) } : {}),
  });
}

async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const body = await readJsonBody(req, MAX_AUTH_BODY_BYTES);
  if (!body.ok) {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  const payload = body.value as Record<string, unknown>;
  const orgName = validateString(payload["orgName"], 100);
  const adminName = validateString(payload["adminName"], 100);
  const email = validateEmail(payload["email"]);
  const password = validateString(payload["password"], 1024);

  if (!orgName || !adminName || !email || !password) {
    sendJson(res, 400, { error: "all_fields_required" });
    return;
  }

  if (password.length < 8) {
    sendJson(res, 400, { error: "password_too_short" });
    return;
  }

  // Check for existing email.
  const existing = findUserByEmail(email);
  if (existing) {
    sendJson(res, 409, { error: "email_exists" });
    return;
  }

  // Create org in the config file.
  const config = loadConfig();
  const orgId = slugifyOrgName(orgName);

  // Check for duplicate org.
  const existingOrg = findOrganization(config, orgId);
  if (existingOrg) {
    // Try a uniquified ID.
    const uniqueId = `${orgId}_${Date.now().toString(36)}`;
    const orgEntry: OrganizationConfig & { status?: string } = {
      id: uniqueId,
      name: orgName,
      createdAt: new Date().toISOString(),
      status: "active",
    };
    const nextConfig = {
      ...config,
      organizations: {
        ...config.organizations,
        list: [...(config.organizations?.list ?? []), orgEntry],
      },
    };
    await writeConfigFile(nextConfig);

    const user = await createUser(email, password, "tenant_admin", uniqueId, adminName);
    const session = createSession(user.id, uniqueId, "tenant_admin");
    const rawApiKey = getOrCreateTenantApiKey(uniqueId);
    sendJson(res, 201, {
      token: session.id,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        orgId: uniqueId,
        displayName: user.displayName,
      },
      orgId: uniqueId,
      apiKey: maskApiKey(rawApiKey),
    });
    return;
  }

  const orgEntry: OrganizationConfig & { status?: string } = {
    id: orgId,
    name: orgName,
    createdAt: new Date().toISOString(),
    status: "active",
  };

  const nextConfig = {
    ...config,
    organizations: {
      ...config.organizations,
      list: [...(config.organizations?.list ?? []), orgEntry],
    },
  };
  await writeConfigFile(nextConfig);

  const user = await createUser(email, password, "tenant_admin", orgId, adminName);
  const session = createSession(user.id, orgId, "tenant_admin");
  const rawApiKey = getOrCreateTenantApiKey(orgId);

  sendJson(res, 201, {
    token: session.id,
    user: { id: user.id, email: user.email, role: user.role, orgId, displayName: user.displayName },
    orgId,
    apiKey: maskApiKey(rawApiKey),
  });
}

function handleLogout(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const token = getBearerToken(req);
  if (token) {
    deleteSession(token);
  }
  sendJson(res, 200, { ok: true });
}

function handleMe(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const session = findSession(token);
  if (!session) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const user = findUserById(session.userId);
  if (!user) {
    deleteSession(token);
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (user.status === "suspended") {
    sendJson(res, 403, { error: "account_suspended" });
    return;
  }
  const rawApiKey = user.role === "tenant_admin" ? getOrCreateTenantApiKey(user.orgId) : undefined;
  sendJson(res, 200, {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      displayName: user.displayName,
    },
    orgId: user.orgId,
    role: user.role,
    // Only include apiKey field for tenant_admin; super_admin has no per-org key.
    ...(user.role === "tenant_admin" ? { apiKey: maskApiKey(rawApiKey) } : {}),
  });
}

function handleUsers(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const caller = requireSuperAdmin(req, res);
  if (!caller) {
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const orgId = url.searchParams.get("orgId");

  let users;
  if (orgId) {
    users = listUsersByOrg(orgId);
  } else {
    users = listAllUsers();
  }

  sendJson(res, 200, {
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      orgId: u.orgId,
      displayName: u.displayName,
      status: u.status,
    })),
  });
}

async function handleOrgStatus(
  req: IncomingMessage,
  res: ServerResponse,
  orgId: string,
): Promise<void> {
  if (req.method !== "PATCH") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const caller = requireSuperAdmin(req, res);
  if (!caller) {
    return;
  }

  const body = await readJsonBody(req, MAX_AUTH_BODY_BYTES);
  if (!body.ok) {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }
  const payload = body.value as Record<string, unknown>;
  const status = payload["status"];
  if (status !== "active" && status !== "suspended") {
    sendJson(res, 400, { error: "status_must_be_active_or_suspended" });
    return;
  }

  // Update in config file.
  const config = loadConfig();
  const orgList = config.organizations?.list ?? [];
  const orgIndex = orgList.findIndex((o) => o.id === orgId);
  if (orgIndex === -1) {
    sendJson(res, 404, { error: "org_not_found" });
    return;
  }

  const updatedList: OrganizationConfig[] = orgList.map((o, i) =>
    i === orgIndex ? { ...o, status: status } : o,
  );

  await writeConfigFile({
    ...config,
    organizations: { ...config.organizations, list: updatedList },
  });

  // If suspending, invalidate all active sessions for that org.
  if (status === "suspended") {
    deleteSessionsByOrgId(orgId);
  }

  sendJson(res, 200, { ok: true });
}

/** POST /__auth/admin/orgs — super admin creates org + tenant admin user. */
async function handleAdminCreateOrg(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const caller = requireSuperAdmin(req, res);
  if (!caller) {
    return;
  }

  const body = await readJsonBody(req, MAX_AUTH_BODY_BYTES);
  if (!body.ok) {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  const payload = body.value as Record<string, unknown>;
  const orgName = validateString(payload["orgName"], 100);
  const adminName = validateString(payload["adminName"], 100);
  const email = validateEmail(payload["email"]);
  const password = validateString(payload["password"], 1024);
  const orgIdRaw = typeof payload["orgId"] === "string" ? payload["orgId"].trim() : null;
  const description =
    typeof payload["description"] === "string" ? payload["description"].trim() : null;

  if (!orgName || !adminName || !email || !password) {
    sendJson(res, 400, { error: "all_fields_required" });
    return;
  }

  if (password.length < 8) {
    sendJson(res, 400, { error: "password_too_short" });
    return;
  }

  if (findUserByEmail(email)) {
    sendJson(res, 409, { error: "email_exists" });
    return;
  }

  const config = loadConfig();
  const baseId = orgIdRaw || slugifyOrgName(orgName);
  const existingOrg = findOrganization(config, baseId);
  const finalOrgId = existingOrg ? `${baseId}_${Date.now().toString(36)}` : baseId;

  const orgEntry: OrganizationConfig = {
    id: finalOrgId,
    name: orgName,
    ...(description ? { description } : {}),
    createdAt: new Date().toISOString(),
    status: "active",
  };

  await writeConfigFile({
    ...config,
    organizations: {
      ...config.organizations,
      list: [...(config.organizations?.list ?? []), orgEntry],
    },
  });

  await createUser(email, password, "tenant_admin", finalOrgId, adminName);

  sendJson(res, 201, { ok: true, orgId: finalOrgId });
}

/** PATCH /__auth/admin/orgs/:orgId/credentials — super admin updates tenant admin email/password. */
async function handleAdminUpdateCredentials(
  req: IncomingMessage,
  res: ServerResponse,
  orgId: string,
): Promise<void> {
  if (req.method !== "PATCH") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const caller = requireSuperAdmin(req, res);
  if (!caller) {
    return;
  }

  const body = await readJsonBody(req, MAX_AUTH_BODY_BYTES);
  if (!body.ok) {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  const payload = body.value as Record<string, unknown>;
  const email = typeof payload["email"] === "string" ? validateEmail(payload["email"]) : null;
  const password =
    typeof payload["password"] === "string" ? validateString(payload["password"], 1024) : null;
  const displayName =
    typeof payload["displayName"] === "string" ? validateString(payload["displayName"], 100) : null;

  if (!email && !password && !displayName) {
    sendJson(res, 400, { error: "no_fields_to_update" });
    return;
  }

  if (password !== null && password.length < 8) {
    sendJson(res, 400, { error: "password_too_short" });
    return;
  }

  const result = await updateUserCredentials(orgId, {
    ...(email ? { email } : {}),
    ...(password ? { password } : {}),
    ...(displayName ? { displayName } : {}),
  });

  if (!result.ok) {
    const code = result.error;
    if (code === "user_not_found") {
      sendJson(res, 404, { error: "user_not_found" });
    } else if (code === "email_exists") {
      sendJson(res, 409, { error: "email_exists" });
    } else {
      sendJson(res, 500, { error: "update_failed" });
    }
    return;
  }

  sendJson(res, 200, { ok: true });
}

function handleRegenerateApiKey(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const caller = requireAuth(req, res);
  if (!caller) {
    return;
  }
  const rawApiKey = regenerateTenantApiKey(caller.orgId);
  sendJson(res, 200, { apiKey: maskApiKey(rawApiKey) });
}

/** GET /__auth/api-key/status — returns only masked key status, never the raw key. */
function handleApiKeyStatus(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const caller = requireAuth(req, res);
  if (!caller) {
    return;
  }
  const rawApiKey = getOrCreateTenantApiKey(caller.orgId);
  sendJson(res, 200, maskApiKey(rawApiKey));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle /__auth/* HTTP requests.
 * Returns true if the request was handled (path matched), false to pass through.
 */
export async function handleAuthHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (!pathname.startsWith(AUTH_PATH_PREFIX) && pathname !== "/__auth") {
    return false;
  }

  setDefaultSecurityHeaders(res);
  addCorsHeaders(res);

  // Handle CORS preflight.
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  const subPath = pathname.slice(AUTH_PATH_PREFIX.length).replace(/\/+$/, "");

  if (subPath === "login") {
    await handleLogin(req, res);
    return true;
  }

  if (subPath === "register") {
    await handleRegister(req, res);
    return true;
  }

  if (subPath === "logout") {
    handleLogout(req, res);
    return true;
  }

  if (subPath === "me") {
    handleMe(req, res);
    return true;
  }

  if (subPath === "users") {
    handleUsers(req, res);
    return true;
  }

  // PATCH /__auth/orgs/:orgId/status
  const orgStatusMatch = subPath.match(/^orgs\/([^/]+)\/status$/);
  if (orgStatusMatch) {
    const orgId = decodeURIComponent(orgStatusMatch[1] ?? "");
    await handleOrgStatus(req, res, orgId);
    return true;
  }

  if (subPath === "admin/orgs") {
    await handleAdminCreateOrg(req, res);
    return true;
  }

  // PATCH /__auth/admin/orgs/:orgId/credentials
  const credentialsMatch = subPath.match(/^admin\/orgs\/([^/]+)\/credentials$/);
  if (credentialsMatch) {
    const targetOrgId = decodeURIComponent(credentialsMatch[1] ?? "");
    await handleAdminUpdateCredentials(req, res, targetOrgId);
    return true;
  }

  if (subPath === "api-keys/regenerate") {
    handleRegenerateApiKey(req, res);
    return true;
  }

  if (subPath === "api-key/status") {
    handleApiKeyStatus(req, res);
    return true;
  }

  sendJson(res, 404, { error: "not_found" });
  return true;
}
