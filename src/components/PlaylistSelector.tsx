import { useEffect, useState } from "react";
import { Playlist, spotifyApi } from "../services/spotifyApi";

interface Props {
  onPlay: (playlistId: string) => void;
  onSelectPlaylist: (playlistId: string) => void;
}

export function PlaylistSelector({ onPlay, onSelectPlaylist }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

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

      {error && <div className="error-msg">{error}</div>}

      {playlists.length === 0 ? (
        <div className="empty-state">Žádné playlisty nenalezeny.</div>
      ) : (
        <div className="playlist-list">
          {playlists.map((pl) => (
            <div key={pl.id} className="playlist-item">
              <div className="playlist-thumb">
                {pl.image ? (
                  <img src={pl.image} alt={pl.name} />
                ) : (
                  <div className="playlist-thumb-placeholder">♪</div>
                )}
              </div>
              <div className="playlist-info">
                <div className="playlist-name">{pl.name}</div>
                <div className="playlist-meta">{pl.track_count} skladeb</div>
              </div>
              <button
                className="btn-play"
                onClick={() => handlePlay(pl)}
                disabled={playing === pl.id}
              >
                {playing === pl.id ? "..." : "▶"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
