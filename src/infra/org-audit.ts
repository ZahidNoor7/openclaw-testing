/**
 * Append-only audit log for organization-level actions.
 *
 * Writes one JSONL record per call to `~/.openclaw/logs/org-audit.jsonl`
 * (or the path derived from OPENCLAW_STATE_DIR), using the same pattern as
 * the config-write audit in `config/io.ts`.
 *
 * Records are written fire-and-forget; errors are silently swallowed so that
 * logging failures never block the operation being audited.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type OrgAuditEvent =
  | "org.create"
  | "org.switch"
  | "org.delete"
  | "org.key-applied"
  | "org.rate-limited";

export interface OrgAuditEntry {
  ts: string;
  source: "org-audit";
  event: OrgAuditEvent;
  orgId: string;
  agentId?: string;
  sessionKey?: string;
  /** Any additional event-specific data. */
  details?: Record<string, unknown>;
}

function resolveOrgAuditLogPath(): string {
  return path.join(resolveStateDir(), "logs", "org-audit.jsonl");
}

/**
 * Append a single audit record to the org audit log.  Never throws.
 */
export async function appendOrgAuditEntry(
  entry: Omit<OrgAuditEntry, "ts" | "source">,
): Promise<void> {
  try {
    const record: OrgAuditEntry = {
      ts: new Date().toISOString(),
      source: "org-audit",
      ...entry,
    };
    const logPath = resolveOrgAuditLogPath();
    await fs.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
    await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch {
    // Audit log failures must never surface to the caller.
  }
}
