import asyncio
import base64
import hashlib
import json
import logging
import os
import secrets
import socket
import time
from typing import Any, Optional
from urllib.parse import urlencode, urlparse

import aiohttp
from aiohttp import web

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spotify-plugin")

SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_API_BASE = "https://api.spotify.com/v1"
REDIRECT_URI = "http://localhost:8765/auth/callback"
SCOPES = (
    "playlist-read-private playlist-read-collaborative streaming "
    "user-read-private user-read-playback-state user-modify-playback-state "
    "user-read-recently-played"
)

CONFIG_PATH = os.path.expanduser("~/.config/spotify-decky/config.json")
TOKEN_PATH = os.path.expanduser("~/.config/spotify-decky/tokens.json")

_playlist_cache: dict = {"data": [], "timestamp": 0}
CACHE_TTL = 300  # 5 minutes

# Module-level PKCE verifier (set during /auth/login, consumed at /auth/callback)
_pkce_verifier: Optional[str] = None


# ─── Token obfuscation ────────────────────────────────────────────

def _machine_key() -> bytes:
    """Derive a machine-specific obfuscation key from hostname + config path."""
    raw = (socket.gethostname() + CONFIG_PATH).encode()
    return hashlib.sha256(raw).digest()


def _obfuscate(s: str) -> str:
    """XOR-obfuscate a string with the machine key and return as base64."""
    key = _machine_key()
    data = s.encode()
    xored = bytes(b ^ key[i % len(key)] for i, b in enumerate(data))
    return base64.b64encode(xored).decode()


def _deobfuscate(s: str) -> str:
    """Reverse of _obfuscate: base64-decode then XOR with machine key."""
    key = _machine_key()
    xored = base64.b64decode(s.encode())
    data = bytes(b ^ key[i % len(key)] for i, b in enumerate(xored))
    return data.decode()


# ─── PKCE helpers ────────────────────────────────────────────────

def _generate_pkce() -> tuple[str, str]:
    """Return (verifier, challenge) for a PKCE auth flow."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


# ─── JSON persistence ─────────────────────────────────────────────

def load_json(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_json(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def get_config() -> dict:
    return load_json(CONFIG_PATH)


def get_tokens() -> dict:
    """Load tokens from disk, deobfuscating sensitive fields."""
    raw = load_json(TOKEN_PATH)
    result: dict = {}
    for key, value in raw.items():
        if key in ("access_token", "refresh_token") and value:
            try:
                result[key] = _deobfuscate(value)
            except Exception:
                # If deobfuscation fails (e.g. legacy plain-text), return as-is
                result[key] = value
        else:
            result[key] = value
    return result


def save_tokens(tokens: dict) -> None:
    """Obfuscate sensitive fields before writing tokens to disk."""
    obfuscated: dict = {}
    for key, value in tokens.items():
        if key in ("access_token", "refresh_token") and value:
            obfuscated[key] = _obfuscate(value)
        else:
            obfuscated[key] = value
    save_json(TOKEN_PATH, obfuscated)


# ─── Token refresh ────────────────────────────────────────────────

async def refresh_access_token(
    refresh_token: str, client_id: str, client_secret: Optional[str] = None
) -> Optional[dict]:
    async with aiohttp.ClientSession() as session:
        data: dict = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
        }
        if client_secret:
            data["client_secret"] = client_secret
        async with session.post(SPOTIFY_TOKEN_URL, data=data) as resp:
            if resp.status != 200:
                logger.error("Token refresh failed: %s", await resp.text())
                return None
            result = await resp.json()
            tokens = get_tokens()
            tokens["access_token"] = result["access_token"]
            tokens["expires_at"] = time.time() + result["expires_in"]
            if "refresh_token" in result:
                tokens["refresh_token"] = result["refresh_token"]
            save_tokens(tokens)
            return tokens


async def get_valid_token() -> Optional[str]:
    tokens = get_tokens()
    if not tokens.get("access_token"):
        return None
    if time.time() >= tokens.get("expires_at", 0) - 60:
        cfg = get_config()
        client_id = cfg.get("client_id")
        client_secret = cfg.get("client_secret")  # may be None for PKCE mode
        refresh_token = tokens.get("refresh_token")
        if not client_id or not refresh_token:
            return None
        refreshed = await refresh_access_token(refresh_token, client_id, client_secret)
        return refreshed["access_token"] if refreshed else None
    return tokens["access_token"]


# ─── Spotify API request with retry / backoff ─────────────────────

async def spotify_request(method: str, path: str, **kwargs) -> tuple[int, Any]:
    """
    Make an authenticated Spotify API request.

    Retries up to 3 times on:
      - HTTP 429: respects Retry-After header
      - HTTP 5xx: exponential backoff (2^attempt seconds)
      - aiohttp.ClientError: same backoff
    """
    token = await get_valid_token()
    if not token:
        return 401, {"error": "Not authenticated"}

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"{SPOTIFY_API_BASE}{path}"
    max_attempts = 4  # 1 initial + 3 retries

    for attempt in range(max_attempts):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.request(method, url, headers=headers, **kwargs) as resp:
                    if resp.status == 204:
                        return 204, {}

                    if resp.status == 429 and attempt < max_attempts - 1:
                        retry_after = int(resp.headers.get("Retry-After", "1"))
                        logger.warning("Rate limited; retrying after %ds", retry_after)
                        await asyncio.sleep(retry_after)
                        continue

                    if resp.status >= 500 and attempt < max_attempts - 1:
                        backoff = 2 ** attempt
                        logger.warning("Spotify 5xx (%d); retrying in %ds", resp.status, backoff)
                        await asyncio.sleep(backoff)
                        continue

                    try:
                        body = await resp.json()
                    except Exception:
                        body = {"raw": await resp.text()}
                    return resp.status, body

        except aiohttp.ClientError as exc:
            if attempt < max_attempts - 1:
                backoff = 2 ** attempt
                logger.warning("ClientError %s; retrying in %ds", exc, backoff)
                await asyncio.sleep(backoff)
            else:
                logger.error("ClientError after %d attempts: %s", max_attempts, exc)
                return 503, {"error": str(exc)}

    # Should not reach here, but satisfy type checker
    return 503, {"error": "Max retries exceeded"}


# ─── CORS middleware ──────────────────────────────────────────────

@web.middleware
async def cors_mw(request: web.Request, handler) -> web.Response:
    if request.method == "OPTIONS":
        resp = web.Response()
    else:
        resp = await handler(request)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return resp


# ─── Auth endpoints ───────────────────────────────────────────────

async def auth_login(request: web.Request) -> web.Response:
    """
    POST /auth/login

    PKCE mode (preferred):
      Body: {client_id, code_verifier, code_challenge}
      Stores verifier; builds auth URL with code_challenge_method=S256.

    Legacy mode (backward compat):
      Body: {client_id, client_secret}
      Falls back to client_secret flow if client_secret is present.
    """
    global _pkce_verifier
    try:
        body = await request.json()
    except Exception:
        body = {}

    client_id = body.get("client_id", "").strip()
    if not client_id:
        return web.json_response({"error": "client_id is required"}, status=400)

    client_secret = body.get("client_secret", "").strip()
    code_verifier = body.get("code_verifier", "").strip()
    code_challenge = body.get("code_challenge", "").strip()

    # If neither PKCE params nor client_secret supplied, generate PKCE pair server-side
    if not code_verifier or not code_challenge:
        if not client_secret:
            code_verifier, code_challenge = _generate_pkce()

    cfg = get_config()
    cfg["client_id"] = client_id
    if client_secret:
        cfg["client_secret"] = client_secret
    save_json(CONFIG_PATH, cfg)

    if code_verifier:
        _pkce_verifier = code_verifier

    params: dict = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "show_dialog": "true",
    }
    if code_challenge:
        params["code_challenge_method"] = "S256"
        params["code_challenge"] = code_challenge

    url = f"{SPOTIFY_AUTH_URL}?{urlencode(params)}"
    return web.json_response({"auth_url": url})


async def auth_callback(request: web.Request) -> web.Response:
    """GET /auth/callback — Spotify redirects here after user consent."""
    global _pkce_verifier
    code = request.query.get("code")
    error = request.query.get("error")

    if error:
        return web.Response(
            text=f"<html><body><h2>Auth failed: {error}</h2><p>Close this window.</p></body></html>",
            content_type="text/html",
        )
    if not code:
        return web.Response(
            text="<html><body><h2>No code received</h2></body></html>",
            content_type="text/html",
            status=400,
        )

    cfg = get_config()
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")  # present only in legacy mode

    if not client_id:
        return web.Response(
            text="<html><body><h2>App not configured — missing client_id</h2></body></html>",
            content_type="text/html",
            status=400,
        )

    data: dict = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": client_id,
    }

    if _pkce_verifier:
        data["code_verifier"] = _pkce_verifier
        _pkce_verifier = None  # consume
    elif client_secret:
        data["client_secret"] = client_secret
    else:
        return web.Response(
            text="<html><body><h2>No code_verifier or client_secret available</h2></body></html>",
            content_type="text/html",
            status=400,
        )

    async with aiohttp.ClientSession() as session:
        async with session.post(SPOTIFY_TOKEN_URL, data=data) as resp:
            if resp.status != 200:
                text = await resp.text()
                logger.error("Token exchange failed: %s", text)
                return web.Response(
                    text=f"<html><body><h2>Token exchange failed</h2><pre>{text}</pre></body></html>",
                    content_type="text/html",
                    status=500,
                )
            result = await resp.json()

    tokens = {
        "access_token": result["access_token"],
        "refresh_token": result.get("refresh_token", ""),
        "expires_at": time.time() + result["expires_in"],
    }
    save_tokens(tokens)
    return web.Response(
        text=(
            "<html><body>"
            "<h2>Spotify connected!</h2>"
            "<p>You can close this window and return to Steam Deck.</p>"
            "</body></html>"
        ),
        content_type="text/html",
    )


async def auth_status(request: web.Request) -> web.Response:
    """GET /auth/status"""
    tokens = get_tokens()
    cfg = get_config()
    logged_in = bool(tokens.get("access_token") and tokens.get("refresh_token"))
    return web.json_response({
        "logged_in": logged_in,
        "has_client_id": bool(cfg.get("client_id")),
        "has_client_secret": bool(cfg.get("client_secret")),
        "client_id_configured": bool(cfg.get("client_id")),
    })


async def auth_logout(request: web.Request) -> web.Response:
    """POST /auth/logout"""
    save_tokens({})
    return web.json_response({"success": True})


# ─── Playlist endpoints ───────────────────────────────────────────

async def get_playlists(request: web.Request) -> web.Response:
    """GET /api/playlists — paginated, cached."""
    global _playlist_cache
    force_refresh = request.query.get("refresh") == "1"
    if (
        not force_refresh
        and time.time() - _playlist_cache["timestamp"] < CACHE_TTL
        and _playlist_cache["data"]
    ):
        return web.json_response({"playlists": _playlist_cache["data"]})

    playlists = []
    path = "/me/playlists?limit=50"
    while path:
        status, data = await spotify_request("GET", path)
        if status == 401:
            return web.json_response({"error": "Not authenticated"}, status=401)
        if status != 200:
            return web.json_response({"error": data}, status=status)
        for item in data.get("items", []):
            if item:
                images = item.get("images") or []
                playlists.append({
                    "id": item["id"],
                    "name": item["name"],
                    "track_count": item.get("tracks", {}).get("total", 0),
                    "image": images[0]["url"] if images else None,
                    "uri": item.get("uri", ""),
                })
        next_url = data.get("next")
        if next_url:
            parsed = urlparse(next_url)
            path = parsed.path + "?" + parsed.query
        else:
            path = None

    _playlist_cache = {"data": playlists, "timestamp": time.time()}
    return web.json_response({"playlists": playlists})


async def get_playlist_tracks(request: web.Request) -> web.Response:
    """GET /api/playlists/{playlist_id}/tracks?offset=0&limit=50"""
    playlist_id = request.match_info["playlist_id"]
    offset = request.query.get("offset", "0")
    limit = request.query.get("limit", "50")
    path = f"/playlists/{playlist_id}/tracks?offset={offset}&limit={limit}"
    status, data = await spotify_request("GET", path)
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status != 200:
        return web.json_response({"error": data}, status=status)

    tracks = []
    for item in data.get("items", []):
        if not item:
            continue
        track = item.get("track")
        if not track:
            continue
        images = track.get("album", {}).get("images") or []
        tracks.append({
            "id": track.get("id"),
            "name": track.get("name"),
            "artist": ", ".join(a["name"] for a in track.get("artists", [])),
            "album": track.get("album", {}).get("name", ""),
            "duration_ms": track.get("duration_ms", 0),
            "uri": track.get("uri", ""),
            "image": images[0]["url"] if images else None,
        })
    return web.json_response({"tracks": tracks})


# ─── Player endpoints ─────────────────────────────────────────────

async def player_current(request: web.Request) -> web.Response:
    """GET /api/player/current"""
    status, data = await spotify_request("GET", "/me/player/currently-playing")
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status == 204 or not data:
        return web.json_response({"playing": False, "track": None})
    item = data.get("item")
    if not item:
        return web.json_response({"playing": False, "track": None})
    images = item.get("album", {}).get("images") or []
    return web.json_response({
        "playing": data.get("is_playing", False),
        "track": {
            "id": item["id"],
            "name": item["name"],
            "artist": ", ".join(a["name"] for a in item.get("artists", [])),
            "album": item.get("album", {}).get("name", ""),
            "image": images[0]["url"] if images else None,
            "duration_ms": item.get("duration_ms", 0),
            "progress_ms": data.get("progress_ms", 0),
        },
    })


async def player_play(request: web.Request) -> web.Response:
    """
    POST /api/player/play

    Optional body fields:
      - playlist_id: play a specific playlist context
      - track_uri: play a single track (adds uris + offset if context_uri also present)
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    json_body: dict = {}
    playlist_id = body.get("playlist_id")
    track_uri = body.get("track_uri")

    if playlist_id:
        json_body["context_uri"] = f"spotify:playlist:{playlist_id}"
    if track_uri:
        if "context_uri" in json_body:
            json_body["offset"] = {"uri": track_uri}
        else:
            json_body["uris"] = [track_uri]

    status, data = await spotify_request(
        "PUT", "/me/player/play", json=json_body if json_body else None
    )
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status in (200, 204):
        return web.json_response({"success": True})
    if status == 404:
        dbus_ok = await _dbus_play()
        return web.json_response({"success": dbus_ok, "fallback": "dbus"})
    return web.json_response({"error": data}, status=status)


async def player_pause(request: web.Request) -> web.Response:
    """POST /api/player/pause"""
    status, data = await spotify_request("PUT", "/me/player/pause")
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status in (200, 204):
        return web.json_response({"success": True})
    if status == 404:
        dbus_ok = await _dbus_pause()
        return web.json_response({"success": dbus_ok, "fallback": "dbus"})
    return web.json_response({"error": data}, status=status)


async def player_next(request: web.Request) -> web.Response:
    """POST /api/player/next"""
    status, data = await spotify_request("POST", "/me/player/next")
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status in (200, 204):
        return web.json_response({"success": True})
    if status == 404:
        dbus_ok = await _dbus_next()
        return web.json_response({"success": dbus_ok, "fallback": "dbus"})
    return web.json_response({"error": data}, status=status)


async def player_previous(request: web.Request) -> web.Response:
    """POST /api/player/previous"""
    status, data = await spotify_request("POST", "/me/player/previous")
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status in (200, 204):
        return web.json_response({"success": True})
    if status == 404:
        dbus_ok = await _dbus_previous()
        return web.json_response({"success": dbus_ok, "fallback": "dbus"})
    return web.json_response({"error": data}, status=status)


async def player_status(request: web.Request) -> web.Response:
    """GET /api/player/status"""
    status, data = await spotify_request("GET", "/me/player")
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status == 204 or not data:
        return web.json_response({"active": False})
    return web.json_response({
        "active": True,
        "is_playing": data.get("is_playing", False),
        "device": data.get("device", {}).get("name", "Unknown"),
        "volume": data.get("device", {}).get("volume_percent", 0),
        "shuffle": data.get("shuffle_state", False),
        "repeat": data.get("repeat_state", "off"),
    })


async def player_volume(request: web.Request) -> web.Response:
    """PUT /api/player/volume — body: {volume: 0-100}"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    volume = max(0, min(100, int(body.get("volume", 50))))
    status, data = await spotify_request(
        "PUT", f"/me/player/volume?volume_percent={volume}"
    )
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status in (200, 204):
        return web.json_response({"success": True})
    return web.json_response({"error": data}, status=status)


async def player_recent(request: web.Request) -> web.Response:
    """GET /api/player/recent — recently played tracks."""
    status, data = await spotify_request("GET", "/me/player/recently-played?limit=10")
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status != 200:
        return web.json_response({"error": data}, status=status)

    items = []
    for entry in data.get("items", []):
        track = entry.get("track", {})
        images = track.get("album", {}).get("images") or []
        items.append({
            "track": {
                "id": track.get("id"),
                "name": track.get("name"),
                "artist": ", ".join(a["name"] for a in track.get("artists", [])),
                "image": images[0]["url"] if images else None,
            },
            "played_at": entry.get("played_at"),
        })
    return web.json_response({"items": items})


async def player_shuffle(request: web.Request) -> web.Response:
    """PUT /api/player/shuffle — body: {state: bool}"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    state = str(body.get("state", False)).lower()
    status, data = await spotify_request("PUT", f"/me/player/shuffle?state={state}")
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status in (200, 204):
        return web.json_response({"success": True})
    return web.json_response({"error": data}, status=status)


async def player_repeat(request: web.Request) -> web.Response:
    """PUT /api/player/repeat — body: {state: "off"|"context"|"track"}"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    state = body.get("state", "off")
    if state not in ("off", "context", "track"):
        return web.json_response(
            {"error": "state must be one of: off, context, track"}, status=400
        )
    status, data = await spotify_request("PUT", f"/me/player/repeat?state={state}")
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status in (200, 204):
        return web.json_response({"success": True})
    return web.json_response({"error": data}, status=status)


async def player_devices(request: web.Request) -> web.Response:
    """GET /api/player/devices"""
    status, data = await spotify_request("GET", "/me/player/devices")
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status != 200:
        return web.json_response({"error": data}, status=status)
    devices = [
        {
            "id": d.get("id"),
            "name": d.get("name"),
            "type": d.get("type"),
            "is_active": d.get("is_active", False),
            "volume_percent": d.get("volume_percent"),
        }
        for d in data.get("devices", [])
    ]
    return web.json_response({"devices": devices})


async def player_transfer(request: web.Request) -> web.Response:
    """POST /api/player/transfer — body: {device_id}"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    device_id = body.get("device_id", "").strip()
    if not device_id:
        return web.json_response({"error": "device_id is required"}, status=400)
    status, data = await spotify_request(
        "PUT", "/me/player", json={"device_ids": [device_id], "play": True}
    )
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status in (200, 204):
        return web.json_response({"success": True})
    return web.json_response({"error": data}, status=status)


# ─── D-Bus fallback helpers ───────────────────────────────────────

async def _dbus_cmd(cmd: str) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            "dbus-send",
            "--print-reply",
            "--dest=org.mpris.MediaPlayer2.spotify",
            "/org/mpris/MediaPlayer2",
            f"org.mpris.MediaPlayer2.Player.{cmd}",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
        return proc.returncode == 0
    except Exception as e:
        logger.warning("D-Bus %s failed: %s", cmd, e)
        return False


async def _dbus_play() -> bool:
    return await _dbus_cmd("Play")


async def _dbus_pause() -> bool:
    return await _dbus_cmd("Pause")


async def _dbus_next() -> bool:
    return await _dbus_cmd("Next")


async def _dbus_previous() -> bool:
    return await _dbus_cmd("Previous")


# ─── Plugin class (Decky integration) ────────────────────────────

class Plugin:
    _runner: Optional[web.AppRunner] = None

    async def _main(self):
        app = web.Application(middlewares=[cors_mw])

        # Auth
        app.router.add_post("/auth/login", auth_login)
        app.router.add_get("/auth/callback", auth_callback)
        app.router.add_get("/auth/status", auth_status)
        app.router.add_post("/auth/logout", auth_logout)

        # Playlists
        app.router.add_get("/api/playlists", get_playlists)
        app.router.add_get("/api/playlists/{playlist_id}/tracks", get_playlist_tracks)

        # Player
        app.router.add_get("/api/player/current", player_current)
        app.router.add_post("/api/player/play", player_play)
        app.router.add_post("/api/player/pause", player_pause)
        app.router.add_post("/api/player/next", player_next)
        app.router.add_post("/api/player/previous", player_previous)
        app.router.add_get("/api/player/status", player_status)
        app.router.add_put("/api/player/volume", player_volume)
        app.router.add_get("/api/player/recent", player_recent)
        app.router.add_put("/api/player/shuffle", player_shuffle)
        app.router.add_put("/api/player/repeat", player_repeat)
        app.router.add_get("/api/player/devices", player_devices)
        app.router.add_post("/api/player/transfer", player_transfer)

        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", 8765)
        await site.start()
        logger.info("Spotify backend listening on http://127.0.0.1:8765")

    async def _unload(self):
        if self._runner:
            await self._runner.cleanup()
            logger.info("Spotify backend stopped")

    # ── Decky callable methods ──────────────────────────────────────

    async def get_auth_url(self, client_id: str, client_secret: str = "") -> dict:
        """Build and return a Spotify auth URL; persist credentials to config."""
        global _pkce_verifier
        cfg = get_config()
        cfg["client_id"] = client_id
        if client_secret:
            cfg["client_secret"] = client_secret
        save_json(CONFIG_PATH, cfg)

        params: dict = {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": REDIRECT_URI,
            "scope": SCOPES,
            "show_dialog": "true",
        }

        if not client_secret:
            verifier, challenge = _generate_pkce()
            _pkce_verifier = verifier
            params["code_challenge_method"] = "S256"
            params["code_challenge"] = challenge

        return {"auth_url": f"{SPOTIFY_AUTH_URL}?{urlencode(params)}"}

    async def get_auth_status(self) -> dict:
        tokens = get_tokens()
        cfg = get_config()
        return {
            "logged_in": bool(tokens.get("access_token") and tokens.get("refresh_token")),
            "has_client_id": bool(cfg.get("client_id")),
            "has_client_secret": bool(cfg.get("client_secret")),
            "client_id_configured": bool(cfg.get("client_id")),
        }

    async def logout(self) -> dict:
        save_tokens({})
        return {"success": True}

    async def fetch_playlists(self) -> dict:
        playlists = []
        path = "/me/playlists?limit=50"
        while path:
            status, data = await spotify_request("GET", path)
            if status != 200:
                return {"error": str(data), "playlists": []}
            for item in data.get("items", []):
                if item:
                    images = item.get("images") or []
                    playlists.append({
                        "id": item["id"],
                        "name": item["name"],
                        "track_count": item.get("tracks", {}).get("total", 0),
                        "image": images[0]["url"] if images else None,
                        "uri": item.get("uri", ""),
                    })
            next_url = data.get("next")
            if next_url:
                parsed = urlparse(next_url)
                path = parsed.path + "?" + parsed.query
            else:
                path = None
        return {"playlists": playlists}

    async def play_playlist(self, playlist_id: str) -> dict:
        status, data = await spotify_request(
            "PUT",
            "/me/player/play",
            json={"context_uri": f"spotify:playlist:{playlist_id}"},
        )
        if status in (200, 204):
            return {"success": True}
        return {"success": False, "error": str(data)}

    async def pause(self) -> dict:
        status, _ = await spotify_request("PUT", "/me/player/pause")
        return {"success": status in (200, 204)}

    async def resume(self) -> dict:
        status, _ = await spotify_request("PUT", "/me/player/play")
        return {"success": status in (200, 204)}

    async def next_track(self) -> dict:
        status, _ = await spotify_request("POST", "/me/player/next")
        return {"success": status in (200, 204)}

    async def prev_track(self) -> dict:
        status, _ = await spotify_request("POST", "/me/player/previous")
        return {"success": status in (200, 204)}

    async def get_current_track(self) -> dict:
        status, data = await spotify_request("GET", "/me/player/currently-playing")
        if status == 204 or not data:
            return {"playing": False, "track": None}
        item = data.get("item")
        if not item:
            return {"playing": False, "track": None}
        images = item.get("album", {}).get("images") or []
        return {
            "playing": data.get("is_playing", False),
            "track": {
                "id": item["id"],
                "name": item["name"],
                "artist": ", ".join(a["name"] for a in item.get("artists", [])),
                "album": item.get("album", {}).get("name", ""),
                "image": images[0]["url"] if images else None,
                "duration_ms": item.get("duration_ms", 0),
                "progress_ms": data.get("progress_ms", 0),
            },
        }

    async def set_volume(self, volume: int) -> dict:
        volume = max(0, min(100, volume))
        status, _ = await spotify_request(
            "PUT", f"/me/player/volume?volume_percent={volume}"
        )
        return {"success": status in (200, 204)}

    async def set_shuffle(self, state: bool) -> dict:
        status, _ = await spotify_request(
            "PUT", f"/me/player/shuffle?state={str(state).lower()}"
        )
        return {"success": status in (200, 204)}

    async def set_repeat(self, state: str) -> dict:
        if state not in ("off", "context", "track"):
            return {"success": False, "error": "state must be off, context, or track"}
        status, _ = await spotify_request("PUT", f"/me/player/repeat?state={state}")
        return {"success": status in (200, 204)}

    async def get_devices(self) -> dict:
        status, data = await spotify_request("GET", "/me/player/devices")
        if status != 200:
            return {"devices": [], "error": str(data)}
        devices = [
            {
                "id": d.get("id"),
                "name": d.get("name"),
                "type": d.get("type"),
                "is_active": d.get("is_active", False),
                "volume_percent": d.get("volume_percent"),
            }
            for d in data.get("devices", [])
        ]
        return {"devices": devices}
