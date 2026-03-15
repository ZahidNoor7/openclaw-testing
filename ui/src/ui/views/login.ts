import { html, nothing } from "lit";

export type LoginProps = {
  email: string;
  password: string;
  error: string | null;
  loading: boolean;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: () => void;
  onGoToOnboarding: () => void;
};

export function renderLogin(props: LoginProps) {
  const {
    email,
    password,
    error,
    loading,
    onEmailChange,
    onPasswordChange,
    onSubmit,
    onGoToOnboarding,
  } = props;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !loading) {
      onSubmit();
    }
  }

  return html`
    <style>
      .auth-screen {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg, #0a0a0a);
        padding: 24px;
      }

      .auth-card {
        background: var(--card, #141414);
        border: 1px solid var(--border, #262626);
        border-radius: 16px;
        padding: 40px;
        width: 100%;
        max-width: 400px;
        box-shadow: var(--shadow-xl, 0 8px 40px rgba(0, 0, 0, 0.4));
      }

      .auth-logo {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 28px;
      }

      .auth-logo-icon {
        width: 40px;
        height: 40px;
        flex-shrink: 0;
      }

      .auth-logo-name {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-strong, #fafafa);
      }

      .auth-title {
        font-size: 22px;
        font-weight: 600;
        color: var(--text-strong, #fafafa);
        margin: 0 0 6px;
      }

      .auth-subtitle {
        font-size: 14px;
        color: var(--muted-foreground, #888);
        margin: 0 0 28px;
      }

      .auth-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 16px;
      }

      .auth-label {
        font-size: 13px;
        font-weight: 500;
        color: var(--text, #e4e4e7);
      }

      .auth-input {
        background: var(--bg-elevated, #1a1a1a);
        border: 1px solid var(--border, #262626);
        border-radius: 8px;
        color: var(--text, #e4e4e7);
        font-size: 14px;
        padding: 10px 12px;
        width: 100%;
        box-sizing: border-box;
        transition: border-color 0.15s;
        outline: none;
      }

      .auth-input:focus {
        border-color: var(--accent, #ff5c5c);
        box-shadow: 0 0 0 2px var(--accent-subtle, rgba(255, 92, 92, 0.15));
      }

      .auth-btn {
        width: 100%;
        background: var(--accent, #ff5c5c);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        padding: 11px 16px;
        cursor: pointer;
        margin-top: 8px;
        transition: opacity 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .auth-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .auth-btn:hover:not(:disabled) {
        opacity: 0.9;
      }

      .auth-error {
        background: var(--danger-subtle, rgba(239, 68, 68, 0.12));
        border: 1px solid var(--danger-muted, rgba(239, 68, 68, 0.3));
        color: var(--destructive, #ef4444);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 13px;
        margin-bottom: 16px;
      }

      .auth-footer {
        margin-top: 20px;
        text-align: center;
        font-size: 13px;
        color: var(--muted-foreground, #888);
      }

      .auth-link {
        color: var(--accent, #ff5c5c);
        cursor: pointer;
        text-decoration: none;
        font-weight: 500;
      }

      .auth-link:hover { text-decoration: underline; }

      .auth-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: auth-spin 0.6s linear infinite;
      }

      @keyframes auth-spin {
        to { transform: rotate(360deg); }
      }
    </style>

    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-logo">
          <svg class="auth-logo-icon" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="login-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ff4d4d"/>
                <stop offset="100%" stop-color="#991b1b"/>
              </linearGradient>
            </defs>
            <path d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z" fill="url(#login-logo-grad)"/>
            <path d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z" fill="url(#login-logo-grad)"/>
            <path d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z" fill="url(#login-logo-grad)"/>
            <path d="M45 15 Q35 5 30 8" stroke="#ff4d4d" stroke-width="3" stroke-linecap="round"/>
            <path d="M75 15 Q85 5 90 8" stroke="#ff4d4d" stroke-width="3" stroke-linecap="round"/>
            <circle cx="45" cy="35" r="6" fill="#050810"/>
            <circle cx="75" cy="35" r="6" fill="#050810"/>
            <circle cx="46" cy="34" r="2.5" fill="#00e5cc"/>
            <circle cx="76" cy="34" r="2.5" fill="#00e5cc"/>
          </svg>
          <span class="auth-logo-name">OpenClaw</span>
        </div>

        <h1 class="auth-title">Welcome back</h1>
        <p class="auth-subtitle">Sign in to your account</p>

        ${error ? html`<div class="auth-error">${error}</div>` : nothing}

        <div class="auth-field">
          <label class="auth-label">Email</label>
          <input
            class="auth-input"
            type="email"
            placeholder="you@example.com"
            .value=${email}
            @input=${(e: Event) => onEmailChange((e.target as HTMLInputElement).value)}
            @keydown=${handleKeyDown}
            autocomplete="email"
          />
        </div>

        <div class="auth-field">
          <label class="auth-label">Password</label>
          <input
            class="auth-input"
            type="password"
            placeholder="••••••••"
            .value=${password}
            @input=${(e: Event) => onPasswordChange((e.target as HTMLInputElement).value)}
            @keydown=${handleKeyDown}
            autocomplete="current-password"
          />
        </div>

        <button
          class="auth-btn"
          ?disabled=${loading}
          @click=${() => !loading && onSubmit()}
        >
          ${
            loading
              ? html`
                  <span class="auth-spinner"></span>
                `
              : nothing
          }
          ${loading ? "Signing in…" : "Sign In"}
        </button>

        <div class="auth-footer">
          New organization?
          <a class="auth-link" @click=${(e: Event) => {
            e.preventDefault();
            onGoToOnboarding();
          }}>
            Create your account
          </a>
        </div>
      </div>
    </div>
  `;
}
