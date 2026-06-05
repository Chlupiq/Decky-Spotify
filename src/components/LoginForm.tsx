import { useState } from "react";
import { spotifyApi } from "../services/spotifyApi";

interface Props {
  onLoggedIn: () => void;
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = Array.from(
    crypto.getRandomValues(new Uint8Array(48)),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");

  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );

  const challenge = btoa(String.fromCharCode(...new Uint8Array(hashBuf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { verifier, challenge };
}

export function LoginForm({ onLoggedIn }: Props) {
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  function validateClientId(): boolean {
    if (!/^[a-f0-9]{32}$/i.test(clientId.trim())) {
      setError("Client ID musí mít přesně 32 hex znaků (0–9, a–f).");
      return false;
    }
    return true;
  }

  async function handleLogin() {
    setError(null);
    if (!validateClientId()) return;
    setLoading(true);
    try {
      const { verifier, challenge } = await generatePKCE();

      const result = await fetch("http://127.0.0.1:8765/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId.trim(),
          code_verifier: verifier,
          code_challenge: challenge,
        }),
      }).then((r) => r.json() as Promise<{ auth_url?: string; error?: string }>);

      if (result.error) {
        setError(result.error);
      } else if (result.auth_url) {
        setAuthUrl(result.auth_url);
      } else {
        setError("Neočekávaná odpověď ze serveru.");
      }
    } catch {
      setError("Nelze se připojit k backendu. Je plugin spuštěn?");
    } finally {
      setLoading(false);
    }
  }

  async function checkAuth() {
    setError(null);
    try {
      const status = await spotifyApi.getAuthStatus();
      if (status.logged_in) {
        onLoggedIn();
      } else {
        setError("Přihlášení ještě neproběhlo. Dokonči ho v prohlížeči.");
      }
    } catch {
      setError("Chyba při kontrole přihlášení.");
    }
  }

  // ── Step 2: show auth URL and verify ────────────────────────────────────
  if (authUrl) {
    return (
      <div className="login-form">
        <div className="section-title">Krok 2: Otevři odkaz</div>
        <p className="info-text">
          Otevři následující URL v prohlížeči a přihlas se ke Spotify:
        </p>
        <div className="auth-url-box">{authUrl}</div>
        <p className="info-text small">
          Po přihlášení se stránka automaticky zavře. Pak klikni na "Ověřit
          přihlášení" níže.
        </p>
        {error && <div className="error-msg">{error}</div>}
        <div className="btn-row">
          <button className="btn-primary" onClick={checkAuth}>
            ✅ Ověřit přihlášení
          </button>
          <button className="btn-secondary" onClick={() => { setAuthUrl(null); setError(null); }}>
            Zpět
          </button>
        </div>
      </div>
    );
  }

  // ── Step 1: enter Client ID ──────────────────────────────────────────────
  return (
    <div className="login-form">
      <div className="section-title">Připojit Spotify</div>

      <div className="info-box">
        <p>
          Vytvoř aplikaci na{" "}
          <strong>developer.spotify.com/dashboard</strong>. Redirect URI:
        </p>
        <code>http://localhost:8765/auth/callback</code>
        <p style={{ marginTop: "6px", color: "#aaa", fontSize: "0.85em" }}>
          <strong>Client Secret není potřeba.</strong>
        </p>
      </div>

      <label className="field-label">Client ID</label>
      <input
        className="text-input"
        type="text"
        placeholder="32 hex znaků (např. a1b2c3d4…)"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        maxLength={40}
        autoComplete="off"
        spellCheck={false}
      />

      {error && <div className="error-msg">{error}</div>}

      <button
        className="btn-primary"
        onClick={handleLogin}
        disabled={loading || clientId.trim().length === 0}
      >
        {loading ? "Načítám..." : "🎵 Přihlásit se přes Spotify"}
      </button>
    </div>
  );
}
