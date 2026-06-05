import { useCallback, useEffect, useRef, useState } from "react";
import { Device, spotifyApi } from "../services/spotifyApi";
import { NowPlaying } from "./NowPlaying";

type RepeatState = "off" | "context" | "track";

interface PollSnapshot {
  progress_ms: number;
  fetchedAt: number;
  is_playing: boolean;
}

function deviceIcon(type: string): string {
  const t = type.toLowerCase();
  if (t === "smartphone" || t === "phone") return "📱";
  if (t === "tablet") return "📱";
  if (t === "tv" || t === "tv_casting" || t === "cast_video") return "📺";
  if (t === "speaker" || t === "cast_audio") return "🔊";
  return "🖥";
}

function nextRepeat(current: RepeatState): RepeatState {
  if (current === "off") return "context";
  if (current === "context") return "track";
  return "off";
}

export function Player() {
  // ── track / playback state ──────────────────────────────────────────────
  const [playing, setPlaying] = useState(false);
  const [track, setTrack] = useState<import("../services/spotifyApi").Track | null>(null);
  const [displayProgressMs, setDisplayProgressMs] = useState(0);
  const [volume, setVolume] = useState(50);

  // ── extended player state ───────────────────────────────────────────────
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatState>("off");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceType, setDeviceType] = useState<string>("computer");

  // ── device selector ─────────────────────────────────────────────────────
  const [showDevices, setShowDevices] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const devicePanelRef = useRef<HTMLDivElement | null>(null);

  // ── UI state ────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  // ── refs for interpolation ──────────────────────────────────────────────
  const pollRef = useRef<PollSnapshot>({ progress_ms: 0, fetchedAt: Date.now(), is_playing: false });
  const fullPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const interpTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── fetch full player status (every 5 s) ────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const [current, status] = await Promise.all([
        spotifyApi.getCurrentTrack(),
        spotifyApi.getPlayerStatus(),
      ]);

      setPlaying(current.playing);
      setTrack(current.track);
      setOffline(false);

      if (current.track) {
        pollRef.current = {
          progress_ms: current.track.progress_ms,
          fetchedAt: Date.now(),
          is_playing: current.playing,
        };
        setDisplayProgressMs(current.track.progress_ms);
      }

      if (status.volume !== undefined) setVolume(status.volume);
      if (status.shuffle !== undefined) setShuffle(status.shuffle);
      if (status.repeat !== undefined) setRepeat(status.repeat as RepeatState);
      if (status.device) {
        setDeviceName(status.device);
      }
    } catch {
      setOffline(true);
    }
  }, []);

  // ── 500 ms interpolation tick ────────────────────────────────────────────
  const startInterpolation = useCallback(() => {
    if (interpTimerRef.current) clearInterval(interpTimerRef.current);
    interpTimerRef.current = setInterval(() => {
      const snap = pollRef.current;
      if (!snap.is_playing) return;
      const elapsed = Date.now() - snap.fetchedAt;
      const raw = snap.progress_ms + elapsed;
      setTrack((t) => {
        if (!t) return t;
        const capped = Math.min(raw, t.duration_ms);
        setDisplayProgressMs(capped);
        return t;
      });
    }, 500);
  }, []);

  useEffect(() => {
    fetchStatus();
    fullPollTimerRef.current = setInterval(fetchStatus, 5000);
    startInterpolation();
    return () => {
      if (fullPollTimerRef.current) clearInterval(fullPollTimerRef.current);
      if (interpTimerRef.current) clearInterval(interpTimerRef.current);
    };
  }, [fetchStatus, startInterpolation]);

  // ── close device panel on outside click ────────────────────────────────
  useEffect(() => {
    if (!showDevices) return;
    function handleClick(e: MouseEvent) {
      if (devicePanelRef.current && !devicePanelRef.current.contains(e.target as Node)) {
        setShowDevices(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDevices]);

  // ── command helper ──────────────────────────────────────────────────────
  async function cmd(action: () => Promise<{ success: boolean }>) {
    setLoading(true);
    setError(null);
    try {
      const result = await action();
      if (!result.success) {
        setError("Příkaz selhal. Je Spotify aktivní?");
      }
      await fetchStatus();
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

  async function handleShuffleToggle() {
    const next = !shuffle;
    setShuffle(next);
    try {
      await spotifyApi.setShuffle(next);
    } catch {
      setShuffle(!next); // revert on failure
    }
  }

  async function handleRepeatCycle() {
    const next = nextRepeat(repeat);
    setRepeat(next);
    try {
      await spotifyApi.setRepeat(next);
    } catch {
      setRepeat(repeat); // revert on failure
    }
  }

  async function handleDeviceBadgeClick() {
    if (showDevices) {
      setShowDevices(false);
      return;
    }
    setDevicesLoading(true);
    setShowDevices(true);
    try {
      const result = await spotifyApi.getDevices();
      setDevices(result.devices);
      // update our type hint from the active device
      const active = result.devices.find((d) => d.is_active);
      if (active) setDeviceType(active.type);
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }

  async function handleTransfer(deviceId: string) {
    setShowDevices(false);
    try {
      await spotifyApi.transferPlayback(deviceId);
      await fetchStatus();
    } catch {
      setError("Nelze přesunout přehrávání.");
    }
  }

  const isPlaying = playing;

  return (
    <div className="player">
      {offline && (
        <div className="offline-banner">⚠️ Offline – nelze se připojit ke Spotify</div>
      )}

      <NowPlaying track={track} playing={isPlaying} displayProgressMs={displayProgressMs} />

      {/* Controls row: shuffle | prev | play/pause | next | repeat */}
      <div className="player-controls">
        <button
          className={`ctrl-btn ctrl-btn--mode${shuffle ? " active-green" : " dim"}`}
          onClick={handleShuffleToggle}
          disabled={loading}
          title={shuffle ? "Náhodně: zapnuto" : "Náhodně: vypnuto"}
          style={{ color: shuffle ? "#1DB954" : "#555" }}
        >
          ⇌
        </button>

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
          onClick={() => cmd(() => (isPlaying ? spotifyApi.pause() : spotifyApi.resume()))}
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

        <button
          className={`ctrl-btn ctrl-btn--mode${repeat !== "off" ? " active-green" : " dim"}`}
          onClick={handleRepeatCycle}
          disabled={loading}
          title={`Opakovat: ${repeat}`}
          style={{ color: repeat !== "off" ? "#1DB954" : "#555", position: "relative" }}
        >
          ↻
          {repeat === "track" && (
            <sup style={{ fontSize: "0.55em", position: "absolute", top: "2px", right: "2px" }}>
              1
            </sup>
          )}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {/* Volume row */}
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

      {/* Status line */}
      <div className={`player-status ${isPlaying ? "status-playing" : "status-paused"}`}>
        {offline ? "⚫ Offline" : isPlaying ? "▶ Přehrávání" : "⏸ Pozastaveno"}
      </div>

      {/* Active device badge */}
      {deviceName && (
        <div style={{ position: "relative" }} ref={devicePanelRef}>
          <button
            className="device-badge"
            onClick={handleDeviceBadgeClick}
            title="Změnit zařízení"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: "#282828",
              border: "1px solid #333",
              borderRadius: "12px",
              padding: "3px 10px",
              color: "#ccc",
              fontSize: "0.75em",
              cursor: "pointer",
              margin: "6px auto 0",
            }}
          >
            <span>{deviceIcon(deviceType)}</span>
            <span>{deviceName}</span>
          </button>

          {showDevices && (
            <div
              className="device-dropdown"
              style={{
                position: "absolute",
                top: "100%",
                left: "50%",
                transform: "translateX(-50%)",
                background: "#181818",
                border: "1px solid #333",
                borderRadius: "8px",
                minWidth: "200px",
                zIndex: 100,
                boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
                marginTop: "4px",
              }}
            >
              {devicesLoading ? (
                <div style={{ padding: "10px", color: "#888", textAlign: "center", fontSize: "0.8em" }}>
                  Načítám zařízení…
                </div>
              ) : devices.length === 0 ? (
                <div style={{ padding: "10px", color: "#888", textAlign: "center", fontSize: "0.8em" }}>
                  Žádná zařízení
                </div>
              ) : (
                devices.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => handleTransfer(d.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "8px 12px",
                      background: d.is_active ? "#282828" : "transparent",
                      border: "none",
                      borderBottom: "1px solid #222",
                      color: d.is_active ? "#1DB954" : "#ccc",
                      cursor: "pointer",
                      fontSize: "0.8em",
                      textAlign: "left",
                    }}
                  >
                    <span>{deviceIcon(d.type)}</span>
                    <span style={{ flex: 1 }}>{d.name}</span>
                    {d.is_active && <span style={{ fontSize: "0.8em", color: "#1DB954" }}>●</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
