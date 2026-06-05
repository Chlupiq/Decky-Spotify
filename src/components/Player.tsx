import { useCallback, useEffect, useRef, useState } from "react";
import { CurrentTrack, spotifyApi } from "../services/spotifyApi";
import { NowPlaying } from "./NowPlaying";

export function Player() {
  const [current, setCurrent] = useState<CurrentTrack>({ playing: false, track: null });
  const [volume, setVolume] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCurrent = useCallback(async () => {
    try {
      const data = await spotifyApi.getCurrentTrack();
      setCurrent(data);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    fetchCurrent();
    pollRef.current = setInterval(fetchCurrent, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchCurrent]);

  async function cmd(action: () => Promise<{ success: boolean }>) {
    setLoading(true);
    setError(null);
    try {
      const result = await action();
      if (!result.success) {
        setError("Příkaz selhal. Je Spotify aktivní?");
      }
      await fetchCurrent();
    } catch {
      setError("Nelze se připojit k Spotify.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVolumeChange(val: number) {
    setVolume(val);
    try {
      await spotifyApi.setVolume(val);
    } catch {
      /* ignore volume errors */
    }
  }

  const isPlaying = current.playing;

  return (
    <div className="player">
      {offline && (
        <div className="offline-banner">⚠️ Offline – nelze se připojit ke Spotify</div>
      )}

      <NowPlaying track={current.track} playing={isPlaying} />

      <div className="player-controls">
        <button
          className="ctrl-btn"
          onClick={() => cmd(() => spotifyApi.prevTrack())}
          disabled={loading}
          title="Předchozí"
        >
          ⏮
        </button>

        <button
          className="ctrl-btn ctrl-btn--main"
          onClick={() =>
            cmd(() => (isPlaying ? spotifyApi.pause() : spotifyApi.resume()))
          }
          disabled={loading}
          title={isPlaying ? "Pauza" : "Přehrát"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <button
          className="ctrl-btn"
          onClick={() => cmd(() => spotifyApi.nextTrack())}
          disabled={loading}
          title="Další"
        >
          ⏭
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="volume-row">
        <span className="volume-icon">🔈</span>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
          className="volume-slider"
        />
        <span className="volume-icon">🔊</span>
        <span className="volume-value">{volume}%</span>
      </div>

      <div className={`player-status ${isPlaying ? "status-playing" : "status-paused"}`}>
        {offline ? "⚫ Offline" : isPlaying ? "▶ Přehrávání" : "⏸ Pozastaveno"}
      </div>
    </div>
  );
}
