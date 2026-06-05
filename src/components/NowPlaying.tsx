import { Track } from "../services/spotifyApi";

interface Props {
  track: Track | null;
  playing: boolean;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function NowPlaying({ track, playing }: Props) {
  if (!track) {
    return (
      <div className="now-playing empty">
        <div className="np-placeholder">🎵</div>
        <div className="np-status">Nic nehraje</div>
      </div>
    );
  }

  const progress = track.duration_ms > 0
    ? (track.progress_ms / track.duration_ms) * 100
    : 0;

  return (
    <div className="now-playing">
      <div className="np-art">
        {track.image ? (
          <img src={track.image} alt={track.name} className="np-image" />
        ) : (
          <div className="np-art-placeholder">♪</div>
        )}
        {playing && <div className="np-playing-indicator">▶</div>}
      </div>
      <div className="np-details">
        <div className="np-track-name">{track.name}</div>
        <div className="np-artist">{track.artist}</div>
        <div className="np-album">{track.album}</div>
        <div className="np-progress-row">
          <span className="np-time">{formatMs(track.progress_ms)}</span>
          <div className="np-progress-bar">
            <div
              className="np-progress-fill"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
          <span className="np-time">{formatMs(track.duration_ms)}</span>
        </div>
      </div>
    </div>
  );
}
