import { useEffect, useRef, useState } from "react";
import { Playlist, spotifyApi } from "../services/spotifyApi";

interface Props {
  onPlay: (playlistId: string) => void;
  onSelectPlaylist: (playlistId: string) => void;
  onBrowseTracks: (playlistId: string, playlistName: string) => void;
}

export function PlaylistSelector({ onPlay, onSelectPlaylist, onBrowseTracks }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focusedIdx, setFocusedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  async function loadPlaylists(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const result = await spotifyApi.getPlaylists(refresh);
      if (result.error) {
        setError(result.error);
      } else {
        setPlaylists(result.playlists);
      }
    } catch {
      setError("Nelze načíst playlisty. Zkontroluj připojení.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlaylists();
  }, []);

  // reset focused index when query changes
  useEffect(() => {
    setFocusedIdx(0);
  }, [query]);

  const filtered = playlists.filter((pl) =>
    pl.name.toLowerCase().includes(query.toLowerCase())
  );

  async function handlePlay(playlist: Playlist) {
    setPlaying(playlist.id);
    try {
      await spotifyApi.playPlaylist(playlist.id);
      onPlay(playlist.id);
      onSelectPlaylist(playlist.id);
    } catch {
      setError("Nelze spustit playlist. Je Spotify spuštěno?");
    } finally {
      setPlaying(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[focusedIdx]) {
        handlePlay(filtered[focusedIdx]);
      }
    }
  }

  if (loading) {
    return (
      <div className="playlist-selector">
        <div className="skeleton-list">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton-item" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="playlist-selector">
      {/* Header */}
      <div className="list-header">
        <span className="section-title">Playlisty ({playlists.length})</span>
        <button
          className="btn-icon"
          onClick={() => loadPlaylists(true)}
          title="Obnovit"
        >
          🔄
        </button>
      </div>

      {/* Search bar */}
      <div
        className="search-bar"
        style={{
          display: "flex",
          alignItems: "center",
          background: "#282828",
          border: "1px solid #333",
          borderRadius: "6px",
          padding: "4px 8px",
          marginBottom: "8px",
          gap: "6px",
        }}
      >
        <span style={{ color: "#888", fontSize: "0.9em" }}>🔍</span>
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hledat playlist…"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#fff",
            fontSize: "0.85em",
          }}
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: "0.9em",
              padding: "0 2px",
            }}
            title="Vymazat"
          >
            ✕
          </button>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      {filtered.length === 0 && !error ? (
        <div className="empty-state">
          {query ? "Žádné výsledky pro hledaný výraz." : "Žádné playlisty nenalezeny."}
        </div>
      ) : (
        <div
          className="playlist-list"
          ref={containerRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          style={{ outline: "none" }}
        >
          {filtered.map((pl, idx) => {
            const isFocused = idx === focusedIdx;
            return (
              <div
                key={pl.id}
                className={`playlist-item${isFocused ? " focused" : ""}`}
                style={{
                  background: isFocused ? "#282828" : "transparent",
                  borderLeft: isFocused ? "2px solid #1DB954" : "2px solid transparent",
                  paddingLeft: isFocused ? "6px" : "8px",
                  transition: "background 0.1s, border-color 0.1s",
                  cursor: "pointer",
                }}
                onMouseEnter={() => setFocusedIdx(idx)}
              >
                <div className="playlist-thumb">
                  {pl.image ? (
                    <img src={pl.image} alt={pl.name} />
                  ) : (
                    <div className="playlist-thumb-placeholder">♪</div>
                  )}
                </div>

                {/* Clicking name → browse tracks */}
                <div
                  className="playlist-info"
                  onClick={() => onBrowseTracks(pl.id, pl.name)}
                  title="Procházet skladby"
                  style={{ flex: 1, cursor: "pointer" }}
                >
                  <div className="playlist-name">{pl.name}</div>
                  <div className="playlist-meta">{pl.track_count} skladeb</div>
                </div>

                {/* Play button */}
                <button
                  className="btn-play"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlay(pl);
                  }}
                  disabled={playing === pl.id}
                  title="Přehrát"
                >
                  {playing === pl.id ? "..." : "▶"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
