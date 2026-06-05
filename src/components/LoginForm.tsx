import { useState } from "react";
import { spotifyApi } from "../services/spotifyApi";

interface Props {
  onLoggedIn: () => void;
}

export function LoginForm({ onLoggedIn }: Props) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  function validateCredentials(): boolean {
    if (!/^[a-f0-9]{32}$/i.test(clientId.trim())) {
      setError("Client ID musí mít 32 hex znaků.");
      return false;
    }
    if (!/^[a-f0-9]{32}$/i.test(clientSecret.trim())) {
      setError("Client Secret musí mít 32 hex znaků.");
      return false;
    }
    return true;
  }

  async function handleLogin() {
    setError(null);
    if (!validateCredentials()) return;
    setLoading(true);
    try {
      const result = await spotifyApi.login(clientId.trim(), clientSecret.trim());
      if (result.error) {
        setError(result.error);
      } else if (result.auth_url) {
        setAuthUrl(result.auth_url);
      }
    } catch {
      setError("Nelze se připojit k backendu. Je plugin spuštěn?");
    } finally {
      setLoading(false);
    }
  }

  async function checkAuth() {
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

  if (authUrl) {
    return (
      <div className="login-form">
        <div className="section-title">Krok 2: Otevři odkaz</div>
        <p className="info-text">
          Otevři následující URL v prohlížeči a přihlas se ke Spotify:
        </p>
        <div className="auth-url-box">{authUrl}</div>
        <p className="info-text small">
          Po přihlášení se stránka automaticky zavře. Pak klikni na "Ověřit přihlášení" níže.
        </p>
        {error && <div className="error-msg">{error}</div>}
        <div className="btn-row">
          <button className="btn-primary" onClick={checkAuth}>
            ✅ Ověřit přihlášení
          </button>
          <button className="btn-secondary" onClick={() => setAuthUrl(null)}>
            Zpět
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-form">
      <div className="section-title">Připojit Spotify</div>

      <div className="info-box">
        <p>
          Vytvoř aplikaci na{" "}
          <strong>developer.spotify.com/dashboard</strong> a nastav Redirect URI
          na:
        </p>
        <code>http://localhost:8765/auth/callback</code>
      </div>

      <label className="field-label">Client ID</label>
      <input
        className="text-input"
        type="text"
        placeholder="32 hex znaků"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        maxLength={40}
      />

      <label className="field-label">Client Secret</label>
      <input
        className="text-input"
        type="password"
        placeholder="32 hex znaků"
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        maxLength={40}
      />

      {error && <div className="error-msg">{error}</div>}

      <button
        className="btn-primary"
        onClick={handleLogin}
        disabled={loading || !clientId || !clientSecret}
      >
        {loading ? "Načítám..." : "🎵 Přihlásit se přes Spotify"}
      </button>
    </div>
  );
}
