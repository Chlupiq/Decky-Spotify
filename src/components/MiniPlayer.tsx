import { Track } from "../services/spotifyApi";

interface Props {
  track: Track | null;
  playing: boolean;
  onPlayPause(): void;
  onNext(): void;
  onPrev(): void;
}

const s = {
  bar: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 36,
    background: "#0f0f16",
    borderTop: "1px solid #1e1e1e",
    display: "flex",
    alignItems: "center",
    padding: "0 6px",
    gap: 6,
    boxSizing: "border-box" as const,
    zIndex: 100,
  },
  art: {
    width: 24,
    height: 24,
    borderRadius: 3,
    flexShrink: 0,
    overflow: "hidden" as const,
    background: "#282828",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  artImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    display: "block",
  },
  artPlaceholder: {
    fontSize: 12,
    color: "#535353",
  },
  info: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "center",
  },
  trackName: {
    fontSize: 9,
    fontWeight: 700,
    color: "#ffffff",
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    lineHeight: "12px",
  },
  artist: {
    fontSize: 8,
    color: "#1DB954",
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    lineHeight: "11px",
    marginTop: 1,
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  btnBase: {
    width: 26,
    height: 26,
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    padding: 0,
    outline: "none",
    flexShrink: 0,
  },
  btnNormal: {
    background: "transparent",
    color: "#b3b3b3",
  },
  btnPlay: {
    background: "#1DB954",
    color: "#000000",
    fontWeight: 700,
  },
};

export function MiniPlayer({ track, playing, onPlayPause, onNext, onPrev }: Props) {
  if (!track) return null;

  return (
    <div style={s.bar}>
      {/* Album art */}
      <div style={s.art}>
        {track.image ? (
          <img src={track.image} alt={track.name} style={s.artImg} />
        ) : (
          <span style={s.artPlaceholder}>♪</span>
        )}
      </div>

      {/* Track info */}
      <div style={s.info}>
        <div style={s.trackName}>{track.name}</div>
        <div style={s.artist}>{track.artist}</div>
      </div>

      {/* Controls */}
      <div style={s.controls}>
        <button
          style={{ ...s.btnBase, ...s.btnNormal }}
          onClick={onPrev}
          title="Previous"
          aria-label="Previous track"
        >
          ⏮
        </button>
        <button
          style={{ ...s.btnBase, ...s.btnPlay }}
          onClick={onPlayPause}
          title={playing ? "Pause" : "Play"}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          style={{ ...s.btnBase, ...s.btnNormal }}
          onClick={onNext}
          title="Next"
          aria-label="Next track"
        >
          ⏭
        </button>
      </div>
    </div>
  );
}
