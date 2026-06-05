import { useCallback, useEffect, useRef, useState } from "react";
import { LoginForm } from "./components/LoginForm";
import { MiniPlayer } from "./components/MiniPlayer";
import { Player } from "./components/Player";
import { PlaylistSelector } from "./components/PlaylistSelector";
import { ToastContainer, useToast } from "./components/Toast";
import { TrackList } from "./components/TrackList";
import { Track, spotifyApi } from "./services/spotifyApi";
import "./styles/main.css";

type Tab = "playlists" | "player" | "settings";

interface TrackBrowse {
  playlistId: string;
  playlistName: string;
}

export function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("playlists");
  const [checking, setChecking] = useState(true);
  const [backendDown, setBackendDown] = useState(false);

  // App-level track state — drives MiniPlayer & toast detection
  const [miniTrack, setMiniTrack] = useState<Track | null>(null);
  const [miniPlaying, setMiniPlaying] = useState(false);
  const prevTrackIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  // Playlist track browser
  const [browsing, setBrowsing] = useState<TrackBrowse | null>(null);

  // Toasts
  const { toasts, showToast, dismiss } = useToast();

  // ── Auth check ──────────────────────────────────────────────────────────
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

  // ── App-level polling for MiniPlayer + track-change toasts ─────────────
  const pollCurrentTrack = useCallback(async () => {
    try {
      const current = await spotifyApi.getCurrentTrack();
      setMiniTrack(current.track);
      setMiniPlaying(current.playing);

      if (current.track) {
        if (
          initializedRef.current &&
          current.track.id !== prevTrackIdRef.current
        ) {
          showToast(current.track.name, current.track.artist);
        }
        prevTrackIdRef.current = current.track.id;
        initializedRef.current = true;
      }
    } catch {
      /* offline — MiniPlayer just keeps last known state */
    }
  }, [showToast]);

  useEffect(() => {
    if (!loggedIn) return;
    pollCurrentTrack();
    const timer = setInterval(pollCurrentTrack, 5000);
    return () => clearInterval(timer);
  }, [loggedIn, pollCurrentTrack]);

  // ── MiniPlayer controls ─────────────────────────────────────────────────
  async function handleMiniPlayPause() {
    try {
      if (miniPlaying) {
        await spotifyApi.pause();
        setMiniPlaying(false);
      } else {
        await spotifyApi.resume();
        setMiniPlaying(true);
      }
    } catch { /* ignore */ }
  }

  async function handleMiniNext() {
    try { await spotifyApi.nextTrack(); } catch { /* ignore */ }
    setTimeout(pollCurrentTrack, 800);
  }

  async function handleMiniPrev() {
    try { await spotifyApi.prevTrack(); } catch { /* ignore */ }
    setTimeout(pollCurrentTrack, 800);
  }

  // ── TrackList play handler ──────────────────────────────────────────────
  async function handlePlayTrack(trackUri: string, playlistId: string) {
    try {
      await spotifyApi.playTrack(trackUri, `spotify:playlist:${playlistId}`);
    } catch { /* ignore */ }
    setBrowsing(null);
    setActiveTab("player");
  }

  // ── Logout ──────────────────────────────────────────────────────────────
  async function handleLogout() {
    try { await spotifyApi.logout(); } catch { /* ignore */ }
    setLoggedIn(false);
    setMiniTrack(null);
    setMiniPlaying(false);
    initializedRef.current = false;
    prevTrackIdRef.current = null;
    setActiveTab("playlists");
    setBrowsing(null);
  }

  // MiniPlayer is shown on non-player tabs when a track is loaded
  const showMiniPlayer = loggedIn && miniTrack !== null && activeTab !== "player";

  // ── Render: loading ──────────────────────────────────────────────────────
  if (checking) {
    return (
      <div className="app loading">
        <div className="spinner">🎵</div>
        <div>Načítám…</div>
      </div>
    );
  }

  // ── Render: backend down ─────────────────────────────────────────────────
  if (backendDown) {
    return (
      <div className="app error-screen">
        <div className="error-icon">⚠️</div>
        <div className="error-title">Backend nedostupný</div>
        <div className="error-desc">
          Spotify plugin není spuštěn. Restartuj Decky Loader.
        </div>
        <button className="btn-primary" onClick={checkAuth}>
          🔄 Zkusit znovu
        </button>
      </div>
    );
  }

  // ── Render: not logged in ────────────────────────────────────────────────
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

  // ── Render: main UI ──────────────────────────────────────────────────────
  return (
    <div className="app" style={{ position: "relative" }}>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

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
            onClick={() => {
              setActiveTab(tab);
              if (tab !== "playlists") setBrowsing(null);
            }}
          >
            {tab === "playlists" && "📋 Playlisty"}
            {tab === "player" && "🎶 Přehrávač"}
            {tab === "settings" && "⚙️ Nastavení"}
          </button>
        ))}
      </div>

      {/* Extra bottom padding so MiniPlayer doesn't overlap content */}
      <div
        className="tab-content"
        style={{ paddingBottom: showMiniPlayer ? 42 : 0 }}
      >
        {activeTab === "playlists" && !browsing && (
          <PlaylistSelector
            onPlay={() => setActiveTab("player")}
            onSelectPlaylist={() => {}}
            onBrowseTracks={(id, name) => setBrowsing({ playlistId: id, playlistName: name })}
          />
        )}

        {activeTab === "playlists" && browsing && (
          <TrackList
            playlistId={browsing.playlistId}
            playlistName={browsing.playlistName}
            onBack={() => setBrowsing(null)}
            onPlayTrack={handlePlayTrack}
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
            <div className="settings-row">
              <span>Auth</span>
              <span style={{ color: "#b3b3b3", fontSize: "11px" }}>PKCE (bez Client Secret)</span>
            </div>
            <div className="settings-row">
              <span>Backend</span>
              <span style={{ color: "#b3b3b3", fontSize: "11px" }}>localhost:8765</span>
            </div>
            <div className="settings-row">
              <span>Verze</span>
              <span style={{ color: "#b3b3b3", fontSize: "11px" }}>1.0.0</span>
            </div>
            <div className="settings-info">
              Pro změnu Client ID se odhlaste a přihlaste znovu.
            </div>
            <button className="btn-danger" onClick={handleLogout}>
              🚪 Odhlásit se
            </button>
          </div>
        )}
      </div>

      {showMiniPlayer && (
        <MiniPlayer
          track={miniTrack}
          playing={miniPlaying}
          onPlayPause={handleMiniPlayPause}
          onNext={handleMiniNext}
          onPrev={handleMiniPrev}
        />
      )}
    </div>
  );
}
