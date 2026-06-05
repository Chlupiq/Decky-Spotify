const BASE = "http://127.0.0.1:8765";

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<T>;
}

export interface AuthStatus {
  logged_in: boolean;
  has_client_id: boolean;
}

export interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  image: string | null;
  duration_ms: number;
  progress_ms: number;
}

export interface CurrentTrack {
  playing: boolean;
  track: Track | null;
}

export interface Playlist {
  id: string;
  name: string;
  track_count: number;
  image: string | null;
  uri: string;
}

export interface PlayerStatus {
  active: boolean;
  is_playing?: boolean;
  device?: string;
  volume?: number;
  shuffle?: boolean;
  repeat?: string;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number;
}

export interface RecentItem {
  track: Track;
  played_at: string;
}

export interface PlaylistTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
  uri: string;
}

export const spotifyApi = {
  async getAuthStatus(): Promise<AuthStatus> {
    return get<AuthStatus>("/auth/status");
  },

  async logout(): Promise<{ success: boolean }> {
    return post("/auth/logout");
  },

  async getPlaylists(refresh = false): Promise<{ playlists: Playlist[]; error?: string }> {
    return get(`/api/playlists${refresh ? "?refresh=1" : ""}`);
  },

  async getCurrentTrack(): Promise<CurrentTrack> {
    return get<CurrentTrack>("/api/player/current");
  },

  async playPlaylist(playlistId: string): Promise<{ success: boolean; error?: string }> {
    return post("/api/player/play", { playlist_id: playlistId });
  },

  async pause(): Promise<{ success: boolean }> {
    return post("/api/player/pause");
  },

  async resume(): Promise<{ success: boolean }> {
    return post("/api/player/play");
  },

  async nextTrack(): Promise<{ success: boolean }> {
    return post("/api/player/next");
  },

  async prevTrack(): Promise<{ success: boolean }> {
    return post("/api/player/previous");
  },

  async getPlayerStatus(): Promise<PlayerStatus> {
    return get<PlayerStatus>("/api/player/status");
  },

  async setVolume(volume: number): Promise<{ success: boolean }> {
    return put("/api/player/volume", { volume });
  },

  async getPlaylistTracks(
    playlistId: string,
    offset = 0
  ): Promise<{ tracks: PlaylistTrack[] }> {
    return get<{ tracks: PlaylistTrack[] }>(
      `/api/playlists/${encodeURIComponent(playlistId)}/tracks?offset=${offset}`
    );
  },

  async getRecentlyPlayed(): Promise<{ items: RecentItem[] }> {
    return get<{ items: RecentItem[] }>("/api/player/recently-played");
  },

  async setShuffle(state: boolean): Promise<{ success: boolean }> {
    return put("/api/player/shuffle", { state });
  },

  async setRepeat(state: "off" | "context" | "track"): Promise<{ success: boolean }> {
    return put("/api/player/repeat", { state });
  },

  async getDevices(): Promise<{ devices: Device[] }> {
    return get<{ devices: Device[] }>("/api/player/devices");
  },

  async transferPlayback(deviceId: string): Promise<{ success: boolean }> {
    return put("/api/player/transfer", { device_id: deviceId });
  },

  async playTrack(
    trackUri: string,
    contextUri?: string
  ): Promise<{ success: boolean }> {
    return post("/api/player/play", {
      track_uri: trackUri,
      ...(contextUri !== undefined ? { context_uri: contextUri } : {}),
    });
  },
};
