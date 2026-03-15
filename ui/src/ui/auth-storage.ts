/**
 * Application-level auth session storage.
 *
 * Stores the app auth session token in localStorage so it persists across
 * browser refreshes (unlike the gateway token which uses sessionStorage).
 *
 * Key: openclaw.app.session.v1
 */

const APP_AUTH_KEY = "openclaw.app.session.v1";

export type AppAuthSession = {
  token: string;
  email: string;
  role: "super_admin" | "tenant_admin";
  orgId: string;
  displayName: string;
  apiKey?: string;
};

export function loadAppAuth(): AppAuthSession | null {
  try {
    const raw = localStorage.getItem(APP_AUTH_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<AppAuthSession>;
    if (
      typeof parsed.token !== "string" ||
      !parsed.token ||
      typeof parsed.email !== "string" ||
      !parsed.email ||
      (parsed.role !== "super_admin" && parsed.role !== "tenant_admin") ||
      typeof parsed.orgId !== "string" ||
      !parsed.orgId
    ) {
      return null;
    }
    return {
      token: parsed.token,
      email: parsed.email,
      role: parsed.role,
      orgId: parsed.orgId,
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : parsed.email,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : undefined,
    };
  } catch {
    return null;
  }
}

export function saveAppAuth(session: AppAuthSession): void {
  try {
    localStorage.setItem(APP_AUTH_KEY, JSON.stringify(session));
  } catch {
    // best-effort
  }
}

export function clearAppAuth(): void {
  try {
    localStorage.removeItem(APP_AUTH_KEY);
  } catch {
    // best-effort
  }
}
