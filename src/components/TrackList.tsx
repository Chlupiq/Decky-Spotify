import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlaylistTrack, spotifyApi } from "../services/spotifyApi";

interface Props {
  playlistId: string;
  playlistName: string;
  onBack(): void;
  onPlayTrack(trackUri: string, playlistId: string): void;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

const s = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    background: "#121212",
    height: "100%",
    outline: "none",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 8px",
    borderBottom: "1px solid #1e1e1e",
    flexShrink: 0,
  },
  backBtn: {
    background: "transparent",
    border: "none",
    color: "#1DB954",
    fontSize: 11,
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: 3,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 4,
    outline: "none",
  },
  playlistTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#ffffff",
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
    flex: 1,
  },
  list: {
    flex: 1,
    overflowY: "auto" as const,
  },
  skeletonItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 8px",
    borderBottom: "1px solid #1a1a1a",
  },
  skeletonNum: {
    width: 14,
    height: 8,
    background: "#282828",
    borderRadius: 2,
    flexShrink: 0,
    animation: "pulse 1.4s ease-in-out infinite",
  },
  skeletonBody: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
  skeletonLine: (w: string) => ({
    height: 8,
    width: w,
    background: "#282828",
    borderRadius: 2,
    animation: "pulse 1.4s ease-in-out infinite",
  }),
  skeletonDur: {
    width: 28,
    height: 8,
    background: "#282828",
    borderRadius: 2,
    flexShrink: 0,
    animation: "pulse 1.4s ease-in-out infinite",
  },
  row: (focused: boolean) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    borderBottom: "1px solid #1a1a1a",
    borderLeft: focused ? "2px solid #1DB954" : "2px solid transparent",
    background: focused ? "#282828" : "transparent",
    cursor: "pointer",
    boxSizing: "border-box" as const,
    transition: "background 0.1s",
  }),
  num: {
    width: 14,
    fontSize: 9,
    color: "#535353",
    textAlign: "right" as const,
    flexShrink: 0,
  },
  body: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column" as const,
  },
  trackName: {
    fontSize: 10,
    fontWeight: 700,
    color: "#ffffff",
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    lineHeight: "13px",
  },
  artist: {
    fontSize: 9,
    color: "#1DB954",
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    lineHeight: "12px",
    marginTop: 1,
  },
  duration: {
    fontSize: 9,
    color: "#535353",
    flexShrink: 0,
    marginLeft: 4,
  },
  errorMsg: {
    color: "#e74c3c",
    fontSize: 10,
    padding: "8px 10px",
  },
  emptyMsg: {
    color: "#535353",
    fontSize: 10,
    padding: "16px 10px",
    textAlign: "center" as const,
  },
};

function SkeletonRows() {
  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={s.skeletonItem}>
          <div style={s.skeletonNum} />
          <div style={s.skeletonBody}>
            <div style={s.skeletonLine(i % 2 === 0 ? "70%" : "55%")} />
            <div style={s.skeletonLine("40%")} />
          </div>
          <div style={s.skeletonDur} />
        </div>
      ))}
    </>
  );
}

export function TrackList({ playlistId, playlistName, onBack, onPlayTrack }: Props) {
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    spotifyApi
      .getPlaylistTracks(playlistId)
      .then((res) => {
        if (!cancelled) {
          setTracks(res.tracks);
          setFocusedIdx(0);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load tracks. Check your connection.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  // Focus the container so keyboard events fire immediately
  useEffect(() => {
    containerRef.current?.focus();
  }, [loading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (tracks.length === 0) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIdx((idx) => Math.min(idx + 1, tracks.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIdx((idx) => Math.max(idx - 1, 0));
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          onPlayTrack(tracks[focusedIdx].uri, playlistId);
          break;
      }
    },
    [tracks, focusedIdx, onPlayTrack, playlistId]
  );

  return (
    <div
      ref={containerRef}
      style={s.root}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Header / Back button */}
      <div style={s.header}>
        <button style={s.backBtn} onClick={onBack} aria-label="Back">
          ← <span style={s.playlistTitle}>{playlistName}</span>
        </button>
      </div>

      {/* Track list body */}
      <div style={s.list}>
        {loading && <SkeletonRows />}
        {!loading && error && <div style={s.errorMsg}>{error}</div>}
        {!loading && !error && tracks.length === 0 && (
          <div style={s.emptyMsg}>No tracks found.</div>
        )}
        {!loading &&
          !error &&
          tracks.map((track, idx) => (
            <div
              key={track.id || idx}
              style={s.row(idx === focusedIdx)}
              onClick={() => {
                setFocusedIdx(idx);
                onPlayTrack(track.uri, playlistId);
              }}
              onMouseEnter={() => setFocusedIdx(idx)}
              role="button"
              aria-label={`Play ${track.name} by ${track.artist}`}
            >
              <div style={s.num}>{idx + 1}</div>
              <div style={s.body}>
                <div style={s.trackName}>{track.name}</div>
                <div style={s.artist}>{track.artist}</div>
              </div>
              <div style={s.duration}>{formatMs(track.duration_ms)}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
