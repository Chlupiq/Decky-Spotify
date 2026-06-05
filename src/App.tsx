import { useEffect, useState } from "react";
import { LoginForm } from "./components/LoginForm";
import { PlaylistSelector } from "./components/PlaylistSelector";
import { Player } from "./components/Player";
import { spotifyApi } from "./services/spotifyApi";
import "./styles/main.css";

type Tab = "playlists" | "player" | "settings";

export function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("playlists");
  const [checking, setChecking] = useState(true);
  const [backendDown, setBackendDown] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    setChecking(true);
    try {
      const status = await spotifyApi.getAuthStatus();
      setLoggedIn(status.logged_in);
      setBackendDown(false);
    } catch {
      setBackendDown(true);
    } finally {
      setChecking(false);
    }
  }

  async function handleLogout() {
    try {
      await spotifyApi.logout();
    } catch { /* ignore */ }
    setLoggedIn(false);
    setActiveTab("playlists");
  }

  if (checking) {
    return (
      <div className="app loading">
        <div className="spinner">🎵</div>
        <div>Načítám…</div>
      </div>
    );
  }

  if (backendDown) {
    return (
      <div className="app error-screen">
        <div className="error-icon">⚠️</div>
        <div className="error-title">Backend nedostupný</div>
        <div className="error-desc">Spotify plugin není spuštěn. Restartuj Decky Loader.</div>
        <button className="btn-primary" onClick={checkAuth}>
          🔄 Zkusit znovu
        </button>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <div className="app">
        <div className="app-header">
          <span className="app-logo">🎵</span>
          <span className="app-title">Spotify Launcher Pro</span>
        </div>
        <LoginForm onLoggedIn={() => setLoggedIn(true)} />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-header">
        <span className="app-logo">🎵</span>
        <span className="app-title">Spotify Launcher Pro</span>
        <span className="connected-dot" title="Připojeno">●</span>
      </div>

      <div className="tab-bar">
        {(["playlists", "player", "settings"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? "tab-btn--active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "playlists" && "📋 Playlisty"}
            {tab === "player" && "🎶 Přehrávač"}
            {tab === "settings" && "⚙️ Nastavení"}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeTab === "playlists" && (
          <PlaylistSelector
            onPlay={() => setActiveTab("player")}
            onSelectPlaylist={() => {}}
          />
        )}
        {activeTab === "player" && <Player />}
        {activeTab === "settings" && (
          <div className="settings-screen">
            <div className="section-title">Nastavení</div>
            <div className="settings-row">
              <span>Stav připojení</span>
              <span className="status-badge status-ok">Připojeno ✅</span>
            </div>
            <div className="settings-info">
              Pro změnu přihlašovacích údajů se odhlaste a přihlaste znovu.
            </div>
            <button className="btn-danger" onClick={handleLogout}>
              🚪 Odhlásit se
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
