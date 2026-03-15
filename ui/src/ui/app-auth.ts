/**
 * App-level auth action handlers.
 *
 * These functions perform HTTP fetch calls to /__auth/* endpoints and
 * update the app state accordingly. Called from OpenClawApp methods.
 */

import type { AppAuthSession } from "./auth-storage.ts";
import { clearAppAuth, loadAppAuth, saveAppAuth } from "./auth-storage.ts";

// Minimal state shape needed by auth handlers (subset of OpenClawApp).
type AuthStateHost = {
  settings: { gatewayUrl: string };
  appAuth: AppAuthSession | null;
  appAuthChecked: boolean;
  loginEmail: string;
  loginPassword: string;
  loginError: string | null;
  loginLoading: boolean;
  onboardingOrgName: string;
  onboardingAdminName: string;
  onboardingEmail: string;
  onboardingPassword: string;
  onboardingError: string | null;
  onboardingLoading: boolean;
  tab: string;
  setTab: (tab: string) => void;
  connect: () => void;
};

/**
 * Convert a WebSocket gateway URL (ws:// or wss://) to an HTTP base URL.
 */
function gatewayHttpBase(gatewayUrl: string): string {
  const trimmed = (gatewayUrl ?? "").trim();
  if (!trimmed) {
    return "";
  }
  try {
    const u = new URL(trimmed);
    const protocol = u.protocol === "wss:" ? "https:" : "http:";
    // Strip trailing slashes from pathname WITHOUT re-assigning to u.pathname,
    // since the URL API normalises "" back to "/", which would cause a double
    // slash when we later prepend "/__auth/".
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${protocol}//${u.host}${pathname}`;
  } catch {
    // Fallback: use relative URLs (works when UI is served from the gateway).
    return "";
  }
}

function authUrl(state: AuthStateHost, path: string): string {
  const base = gatewayHttpBase(state.settings.gatewayUrl);
  return `${base}/__auth/${path}`;
}

// ---------------------------------------------------------------------------
// checkAuthOnMount — called by app-lifecycle on component mount
// ---------------------------------------------------------------------------

export async function checkAuthOnMount(state: AuthStateHost): Promise<void> {
  const stored = loadAppAuth();
  if (!stored) {
    state.appAuth = null;
    state.appAuthChecked = true;
    // Check if URL is /onboarding.
    if (typeof window !== "undefined" && window.location.pathname.includes("/onboarding")) {
      state.setTab("onboarding");
    }
    return;
  }

  // Validate token with the server.
  try {
    const base = gatewayHttpBase(state.settings.gatewayUrl);
    const res = await fetch(`${base}/__auth/me`, {
      headers: { Authorization: `Bearer ${stored.token}` },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        user: { email: string; role: string; orgId: string; displayName: string };
        role: string;
        orgId: string;
        apiKey?: string;
      };
      const session: AppAuthSession = {
        token: stored.token,
        email: data.user.email,
        role: data.user.role as AppAuthSession["role"],
        orgId: data.orgId,
        displayName: data.user.displayName,
        apiKey: data.apiKey,
      };
      saveAppAuth(session);
      state.appAuth = session;
      state.appAuthChecked = true;
      // Connect to the gateway after successful auth.
      state.connect();
    } else {
      clearAppAuth();
      state.appAuth = null;
      state.appAuthChecked = true;
    }
  } catch {
    // Network error — still mark as checked so we don't loop.
    clearAppAuth();
    state.appAuth = null;
    state.appAuthChecked = true;
  }
}

// ---------------------------------------------------------------------------
// handleLogin
// ---------------------------------------------------------------------------

export async function handleLogin(state: AuthStateHost): Promise<void> {
  if (state.loginLoading) {
    return;
  }
  const email = state.loginEmail.trim().toLowerCase();
  const password = state.loginPassword;

  if (!email || !password) {
    state.loginError = "Email and password are required.";
    return;
  }

  state.loginLoading = true;
  state.loginError = null;

  try {
    const res = await fetch(authUrl(state, "login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      const errorCode = data["error"] as string | undefined;
      if (errorCode === "account_suspended" || errorCode === "org_suspended") {
        state.loginError = "This account has been suspended.";
      } else {
        state.loginError = "Invalid email or password.";
      }
      return;
    }

    const session: AppAuthSession = {
      token: data["token"] as string,
      email: (data["user"] as Record<string, string>)["email"],
      role: (data["user"] as Record<string, string>)["role"] as AppAuthSession["role"],
      orgId: data["orgId"] as string,
      displayName: (data["user"] as Record<string, string>)["displayName"] ?? email,
      apiKey: data["apiKey"] as string | undefined,
    };

    saveAppAuth(session);
    state.appAuth = session;
    state.loginPassword = ""; // Clear password from memory
    // Connect to gateway and navigate to chat.
    state.connect();
    state.setTab("chat");
  } catch {
    state.loginError = "Connection error. Please try again.";
  } finally {
    state.loginLoading = false;
  }
}

// ---------------------------------------------------------------------------
// handleLogout
// ---------------------------------------------------------------------------

export async function handleLogout(state: AuthStateHost): Promise<void> {
  const auth = loadAppAuth();
  if (auth) {
    try {
      const base = gatewayHttpBase(state.settings.gatewayUrl);
      await fetch(`${base}/__auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    } catch {
      // Ignore logout network errors — clear locally regardless.
    }
  }
  clearAppAuth();
  state.appAuth = null;
  state.setTab("chat");
}

// ---------------------------------------------------------------------------
// handleRegister
// ---------------------------------------------------------------------------

export async function handleRegister(state: AuthStateHost): Promise<void> {
  if (state.onboardingLoading) {
    return;
  }
  const orgName = state.onboardingOrgName.trim();
  const adminName = state.onboardingAdminName.trim();
  const email = state.onboardingEmail.trim().toLowerCase();
  const password = state.onboardingPassword;

  if (!orgName || !adminName || !email || !password) {
    state.onboardingError = "All fields are required.";
    return;
  }

  if (password.length < 8) {
    state.onboardingError = "Password must be at least 8 characters.";
    return;
  }

  state.onboardingLoading = true;
  state.onboardingError = null;

  try {
    const res = await fetch(authUrl(state, "register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName, adminName, email, password }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      const errorCode = data["error"] as string | undefined;
      if (errorCode === "email_exists") {
        state.onboardingError = "An account with this email already exists.";
      } else if (errorCode === "password_too_short") {
        state.onboardingError = "Password must be at least 8 characters.";
      } else {
        state.onboardingError = "Registration failed. Please try again.";
      }
      return;
    }

    const session: AppAuthSession = {
      token: data["token"] as string,
      email: (data["user"] as Record<string, string>)["email"],
      role: "tenant_admin",
      orgId: data["orgId"] as string,
      displayName: adminName,
      apiKey: data["apiKey"] as string | undefined,
    };

    saveAppAuth(session);
    state.appAuth = session;
    state.onboardingPassword = ""; // Clear password from memory
    // Connect to gateway and navigate to chat.
    state.connect();
    state.setTab("chat");
  } catch {
    state.onboardingError = "Connection error. Please try again.";
  } finally {
    state.onboardingLoading = false;
  }
}
