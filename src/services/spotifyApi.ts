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
  has_client_secret: boolean;
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

export const spotifyApi = {
  async getAuthStatus(): Promise<AuthStatus> {
    return get<AuthStatus>("/auth/status");
  },

  async login(clientId: string, clientSecret: string): Promise<{ auth_url?: string; error?: string }> {
    return post("/auth/login", { client_id: clientId, client_secret: clientSecret });
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
};
