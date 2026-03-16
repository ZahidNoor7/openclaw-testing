/**
 * Application-level auth database for multi-tenant user management.
 *
 * Stores users, sessions, and per-org tenant API keys in a SQLite DB at
 * ~/.openclaw/db/auth.db using the existing node:sqlite infrastructure.
 *
 * Separate from gateway WS auth (token/password) — this is for the web UI
 * login system that gates access to the dashboard.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { requireNodeSqlite } from "../memory/sqlite.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthUserRole = "super_admin" | "tenant_admin";
export type AuthUserStatus = "active" | "suspended";

export type AuthUser = {
  id: string;
  email: string;
  role: AuthUserRole;
  orgId: string;
  displayName: string;
  status: AuthUserStatus;
  createdAt: string;
};

export type AuthSession = {
  id: string;
  userId: string;
  orgId: string;
  role: AuthUserRole;
  expiresAt: string;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

type Database = InstanceType<ReturnType<typeof requireNodeSqlite>["DatabaseSync"]>;

let _db: Database | null = null;

function resolveAuthDbPath(): string {
  const dbDir = path.join(resolveStateDir(), "db");
  fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  return path.join(dbDir, "auth.db");
}

export function getAuthDb(): Database {
  if (_db) {
    return _db;
  }
  const { DatabaseSync } = requireNodeSqlite();
  const dbPath = resolveAuthDbPath();
  const db = new DatabaseSync(dbPath);

  // Enable WAL mode for better concurrent read performance.
  db.exec("PRAGMA journal_mode=WAL;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL,
      org_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS tenant_api_keys (
      id TEXT PRIMARY KEY,
      org_id TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Migration v1: add key_encrypted and key_hash columns for AES-256-GCM at-rest encryption.
  // key_encrypted: iv:authTag:ciphertext (hex), null for legacy rows.
  // key_hash: HMAC-SHA256 of plaintext key for constant-time lookup, null for legacy rows.
  const v =
    (db.prepare("PRAGMA user_version").get() as Record<string, number>)["user_version"] ?? 0;
  if (v < 1) {
    db.exec(`
      ALTER TABLE tenant_api_keys ADD COLUMN key_encrypted TEXT;
      ALTER TABLE tenant_api_keys ADD COLUMN key_hash TEXT;
      PRAGMA user_version = 1;
    `);
  }

  _db = db;
  return db;
}

// ---------------------------------------------------------------------------
// Password utilities (node:crypto scrypt, no external deps)
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(32).toString("hex");
    scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ hash: key.toString("hex"), salt });
    });
  });
}

export function verifyPassword(
  storedHash: string,
  storedSalt: string,
  password: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      storedSalt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, key) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          const stored = Buffer.from(storedHash, "hex");
          resolve(stored.length === key.length && timingSafeEqual(stored, key));
        } catch {
          resolve(false);
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

export async function createUser(
  email: string,
  password: string,
  role: AuthUserRole,
  orgId: string,
  displayName: string,
): Promise<AuthUser> {
  const db = getAuthDb();
  const { hash, salt } = await hashPassword(password);
  const id = randomBytes(16).toString("hex");
  const createdAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, password_salt, role, org_id, display_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)",
  ).run(id, email.trim().toLowerCase(), hash, salt, role, orgId, displayName.trim(), createdAt);
  return {
    id,
    email: email.trim().toLowerCase(),
    role,
    orgId,
    displayName: displayName.trim(),
    status: "active",
    createdAt,
  };
}

export function findUserByEmail(email: string): AuthUser | null {
  const db = getAuthDb();
  const row = db
    .prepare(
      "SELECT id, email, role, org_id, display_name, status, created_at FROM users WHERE email = ?",
    )
    .get(email.trim().toLowerCase()) as Record<string, string> | undefined;
  if (!row) {
    return null;
  }
  return {
    id: row["id"],
    email: row["email"],
    role: row["role"] as AuthUserRole,
    orgId: row["org_id"],
    displayName: row["display_name"],
    status: row["status"] as AuthUserStatus,
    createdAt: row["created_at"],
  };
}

export function findUserById(id: string): AuthUser | null {
  const db = getAuthDb();
  const row = db
    .prepare(
      "SELECT id, email, role, org_id, display_name, status, created_at FROM users WHERE id = ?",
    )
    .get(id) as Record<string, string> | undefined;
  if (!row) {
    return null;
  }
  return {
    id: row["id"],
    email: row["email"],
    role: row["role"] as AuthUserRole,
    orgId: row["org_id"],
    displayName: row["display_name"],
    status: row["status"] as AuthUserStatus,
    createdAt: row["created_at"],
  };
}

export function listUsersByOrg(orgId: string): AuthUser[] {
  const db = getAuthDb();
  const rows = db
    .prepare(
      "SELECT id, email, role, org_id, display_name, status, created_at FROM users WHERE org_id = ? ORDER BY created_at ASC",
    )
    .all(orgId) as Record<string, string>[];
  return rows.map((r) => ({
    id: r["id"],
    email: r["email"],
    role: r["role"] as AuthUserRole,
    orgId: r["org_id"],
    displayName: r["display_name"],
    status: r["status"] as AuthUserStatus,
    createdAt: r["created_at"],
  }));
}

export function listAllUsers(): AuthUser[] {
  const db = getAuthDb();
  const rows = db
    .prepare(
      "SELECT id, email, role, org_id, display_name, status, created_at FROM users ORDER BY created_at ASC",
    )
    .all() as Record<string, string>[];
  return rows.map((r) => ({
    id: r["id"],
    email: r["email"],
    role: r["role"] as AuthUserRole,
    orgId: r["org_id"],
    displayName: r["display_name"],
    status: r["status"] as AuthUserStatus,
    createdAt: r["created_at"],
  }));
}

export function getUserPasswordFields(email: string): { hash: string; salt: string } | null {
  const db = getAuthDb();
  const row = db
    .prepare("SELECT password_hash, password_salt FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as Record<string, string> | undefined;
  if (!row) {
    return null;
  }
  return { hash: row["password_hash"], salt: row["password_salt"] };
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createSession(userId: string, orgId: string, role: AuthUserRole): AuthSession {
  const db = getAuthDb();
  const id = randomBytes(32).toString("hex");
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO auth_sessions (id, user_id, org_id, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, userId, orgId, role, expiresAt, createdAt);
  return { id, userId, orgId, role, expiresAt, createdAt };
}

export function findSession(token: string): AuthSession | null {
  const db = getAuthDb();
  const row = db
    .prepare(
      "SELECT id, user_id, org_id, role, expires_at, created_at FROM auth_sessions WHERE id = ?",
    )
    .get(token) as Record<string, string> | undefined;
  if (!row) {
    return null;
  }
  // Check expiry
  if (new Date(row["expires_at"]) < new Date()) {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(token);
    return null;
  }
  return {
    id: row["id"],
    userId: row["user_id"],
    orgId: row["org_id"],
    role: row["role"] as AuthUserRole,
    expiresAt: row["expires_at"],
    createdAt: row["created_at"],
  };
}

export function deleteSession(token: string): void {
  const db = getAuthDb();
  db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(token);
}

/** Invalidate all sessions for users in a given org (e.g., on org suspension). */
export function deleteSessionsByOrgId(orgId: string): void {
  const db = getAuthDb();
  db.prepare("DELETE FROM auth_sessions WHERE org_id = ?").run(orgId);
}

// ---------------------------------------------------------------------------
// Tenant API key encryption (AES-256-GCM at rest)
// ---------------------------------------------------------------------------

/**
 * Derive a 32-byte encryption key from the gateway secret.
 * Falls back to a key derived from the state dir path if the env var is not set.
 */
function deriveEncryptionKey(): Buffer {
  const secret = process.env.OPENCLAW_GATEWAY_SECRET ?? resolveStateDir();
  // Use a fixed salt so the derived key is deterministic for the same secret.
  const salt = "openclaw-tenant-api-key-v1";
  // Synchronous PBKDF2-like derivation using scrypt with low cost (key derivation only, not password hashing).
  // We use createHmac as a simple KDF here to avoid async complexity.
  return Buffer.from(createHmac("sha256", salt).update(secret).digest());
}

/** Encrypt a plaintext API key. Returns `iv:authTag:ciphertext` (all hex). */
function encryptApiKey(plaintext: string): string {
  const key = deriveEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt a stored value. Returns plaintext, or null if decryption fails. */
function decryptApiKey(stored: string): string | null {
  // Legacy plaintext: no colons in a 64-char hex key, but encrypted format has exactly 2 colons.
  const parts = stored.split(":");
  if (parts.length !== 3) {
    // Legacy plaintext — return as-is for backward compatibility.
    return stored;
  }
  try {
    const key = deriveEncryptionKey();
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const ciphertext = Buffer.from(parts[2], "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
  } catch {
    return null;
  }
}

/** Compute HMAC-SHA256 of the plaintext key for constant-time DB lookup. */
function hashApiKey(plaintext: string): string {
  const key = deriveEncryptionKey();
  return createHmac("sha256", key).update(plaintext).digest("hex");
}

// ---------------------------------------------------------------------------
// Tenant API keys
// ---------------------------------------------------------------------------

export function getOrCreateTenantApiKey(orgId: string): string {
  const db = getAuthDb();
  const row = db
    .prepare("SELECT id, key_encrypted FROM tenant_api_keys WHERE org_id = ?")
    .get(orgId) as Record<string, string> | undefined;
  if (row) {
    // If key_encrypted is present, decrypt and return plaintext.
    if (row["key_encrypted"]) {
      const plaintext = decryptApiKey(row["key_encrypted"]);
      if (plaintext !== null) {
        return plaintext;
      }
    }
    // Legacy row: id IS the plaintext key.
    return row["id"];
  }
  const key = randomBytes(32).toString("hex");
  const encrypted = encryptApiKey(key);
  const keyHash = hashApiKey(key);
  const rowId = randomBytes(16).toString("hex");
  db.prepare(
    "INSERT INTO tenant_api_keys (id, org_id, key_encrypted, key_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(rowId, orgId, encrypted, keyHash, new Date().toISOString());
  return key;
}

export function regenerateTenantApiKey(orgId: string): string {
  const db = getAuthDb();
  const key = randomBytes(32).toString("hex");
  const encrypted = encryptApiKey(key);
  const keyHash = hashApiKey(key);
  const rowId = randomBytes(16).toString("hex");
  db.prepare(
    "INSERT OR REPLACE INTO tenant_api_keys (id, org_id, key_encrypted, key_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(rowId, orgId, encrypted, keyHash, new Date().toISOString());
  return key;
}

export function validateTenantApiKey(apiKey: string): { orgId: string } | null {
  const db = getAuthDb();
  const keyHash = hashApiKey(apiKey);
  // First try the new hash-based lookup (encrypted rows).
  const row = db.prepare("SELECT org_id FROM tenant_api_keys WHERE key_hash = ?").get(keyHash) as
    | Record<string, string>
    | undefined;
  if (row) {
    return { orgId: row["org_id"] };
  }
  // Fallback: legacy rows where id IS the plaintext key (backward compat).
  const legacyRow = db
    .prepare("SELECT org_id FROM tenant_api_keys WHERE id = ? AND key_encrypted IS NULL")
    .get(apiKey) as Record<string, string> | undefined;
  if (!legacyRow) {
    return null;
  }
  return { orgId: legacyRow["org_id"] };
}

// ---------------------------------------------------------------------------
// Credential updates (super admin managed)
// ---------------------------------------------------------------------------

/**
 * Update email and/or password for the tenant_admin of a given org.
 * Returns { ok: true } on success or { ok: false, error } on failure.
 */
export async function updateUserCredentials(
  orgId: string,
  updates: { email?: string; password?: string; displayName?: string },
): Promise<{ ok: boolean; error?: string }> {
  const db = getAuthDb();
  const row = db
    .prepare("SELECT id, email FROM users WHERE org_id = ? AND role = 'tenant_admin' LIMIT 1")
    .get(orgId) as { id: string; email: string } | undefined;
  if (!row) {
    return { ok: false, error: "user_not_found" };
  }
  if (updates.email) {
    const existing = findUserByEmail(updates.email);
    if (existing && existing.id !== row.id) {
      return { ok: false, error: "email_exists" };
    }
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(
      updates.email.trim().toLowerCase(),
      row.id,
    );
  }
  if (updates.password) {
    const { hash, salt } = await hashPassword(updates.password);
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").run(
      hash,
      salt,
      row.id,
    );
  }
  if (updates.displayName) {
    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(
      updates.displayName.trim(),
      row.id,
    );
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Super admin seeding
// ---------------------------------------------------------------------------

const SUPER_ADMIN_EMAIL = "zahid@viafone.com";
const SUPER_ADMIN_PASSWORD = "Password@123";
const SUPER_ADMIN_ORG_ID = "openclaw";

export async function seedSuperAdmin(): Promise<void> {
  try {
    const existing = findUserByEmail(SUPER_ADMIN_EMAIL);
    if (existing) {
      return; // Already seeded
    }
    await createUser(
      SUPER_ADMIN_EMAIL,
      SUPER_ADMIN_PASSWORD,
      "super_admin",
      SUPER_ADMIN_ORG_ID,
      "Super Admin",
    );
  } catch {
    // Never throw — seeding failures should not block gateway startup.
  }
}
