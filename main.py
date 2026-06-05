import asyncio
import json
import logging
import os
import time
from typing import Any, Optional
from urllib.parse import urlencode, urlparse, parse_qs

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
    "user-read-private user-read-playback-state user-modify-playback-state"
)

CONFIG_PATH = os.path.expanduser("~/.config/spotify-decky/config.json")
TOKEN_PATH = os.path.expanduser("~/.config/spotify-decky/tokens.json")

_playlist_cache: dict = {"data": [], "timestamp": 0}
CACHE_TTL = 300  # 5 minutes


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
    return load_json(TOKEN_PATH)


def save_tokens(tokens: dict) -> None:
    save_json(TOKEN_PATH, tokens)


async def refresh_access_token(refresh_token: str, client_id: str, client_secret: str) -> Optional[dict]:
    async with aiohttp.ClientSession() as session:
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        }
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
        client_secret = cfg.get("client_secret")
        refresh_token = tokens.get("refresh_token")
        if not all([client_id, client_secret, refresh_token]):
            return None
        refreshed = await refresh_access_token(refresh_token, client_id, client_secret)
        return refreshed["access_token"] if refreshed else None
    return tokens["access_token"]


async def spotify_request(method: str, path: str, **kwargs) -> tuple[int, Any]:
    token = await get_valid_token()
    if not token:
        return 401, {"error": "Not authenticated"}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"{SPOTIFY_API_BASE}{path}"
    async with aiohttp.ClientSession() as session:
        async with session.request(method, url, headers=headers, **kwargs) as resp:
            if resp.status == 204:
                return 204, {}
            try:
                body = await resp.json()
            except Exception:
                body = {"raw": await resp.text()}
            return resp.status, body


# ─── Auth endpoints ───────────────────────────────────────────────

async def auth_login(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        body = {}
    client_id = body.get("client_id", "")
    client_secret = body.get("client_secret", "")
    if not client_id or not client_secret:
        return web.json_response({"error": "client_id and client_secret are required"}, status=400)
    cfg = get_config()
    cfg["client_id"] = client_id
    cfg["client_secret"] = client_secret
    save_json(CONFIG_PATH, cfg)
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "show_dialog": "true",
    }
    url = f"{SPOTIFY_AUTH_URL}?{urlencode(params)}"
    return web.json_response({"auth_url": url})


async def auth_callback(request: web.Request) -> web.Response:
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
    client_secret = cfg.get("client_secret")
    if not client_id or not client_secret:
        return web.Response(
            text="<html><body><h2>App not configured</h2></body></html>",
            content_type="text/html",
            status=400,
        )
    async with aiohttp.ClientSession() as session:
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": client_id,
            "client_secret": client_secret,
        }
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
        text="<html><body><h2>✅ Spotify connected!</h2><p>You can close this window and return to Steam Deck.</p></body></html>",
        content_type="text/html",
    )


async def auth_status(request: web.Request) -> web.Response:
    tokens = get_tokens()
    logged_in = bool(tokens.get("access_token") and tokens.get("refresh_token"))
    cfg = get_config()
    return web.json_response({
        "logged_in": logged_in,
        "has_client_id": bool(cfg.get("client_id")),
        "has_client_secret": bool(cfg.get("client_secret")),
    })


async def auth_logout(request: web.Request) -> web.Response:
    save_tokens({})
    return web.json_response({"success": True})


# ─── Playlist endpoints ───────────────────────────────────────────

async def get_playlists(request: web.Request) -> web.Response:
    global _playlist_cache
    force_refresh = request.query.get("refresh") == "1"
    if not force_refresh and time.time() - _playlist_cache["timestamp"] < CACHE_TTL and _playlist_cache["data"]:
        return web.json_response({"playlists": _playlist_cache["data"]})
    playlists = []
    path = "/me/playlists?limit=50"
    while path:
        status, data = await spotify_request("GET", "" if path.startswith("http") else path)
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


# ─── Player endpoints ─────────────────────────────────────────────

async def player_current(request: web.Request) -> web.Response:
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
    try:
        body = await request.json()
    except Exception:
        body = {}
    json_body: dict = {}
    playlist_id = body.get("playlist_id")
    if playlist_id:
        json_body["context_uri"] = f"spotify:playlist:{playlist_id}"
    status, data = await spotify_request("PUT", "/me/player/play", json=json_body if json_body else None)
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status in (200, 204):
        return web.json_response({"success": True})
    # 404 means no active device — try D-Bus fallback
    if status == 404:
        dbus_ok = await _dbus_play()
        return web.json_response({"success": dbus_ok, "fallback": "dbus"})
    return web.json_response({"error": data}, status=status)


async def player_pause(request: web.Request) -> web.Response:
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
    try:
        body = await request.json()
    except Exception:
        body = {}
    volume = body.get("volume", 50)
    volume = max(0, min(100, int(volume)))
    status, data = await spotify_request("PUT", f"/me/player/volume?volume_percent={volume}")
    if status == 401:
        return web.json_response({"error": "Not authenticated"}, status=401)
    if status in (200, 204):
        return web.json_response({"success": True})
    return web.json_response({"error": data}, status=status)


# ─── D-Bus fallback helpers ───────────────────────────────────────

async def _dbus_cmd(cmd: str) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            "dbus-send", "--print-reply", "--dest=org.mpris.MediaPlayer2.spotify",
            "/org/mpris/MediaPlayer2", f"org.mpris.MediaPlayer2.Player.{cmd}",
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
        app = web.Application()
        app.router.add_post("/auth/login", auth_login)
        app.router.add_get("/auth/callback", auth_callback)
        app.router.add_get("/auth/status", auth_status)
        app.router.add_post("/auth/logout", auth_logout)
        app.router.add_get("/api/playlists", get_playlists)
        app.router.add_get("/api/player/current", player_current)
        app.router.add_post("/api/player/play", player_play)
        app.router.add_post("/api/player/pause", player_pause)
        app.router.add_post("/api/player/next", player_next)
        app.router.add_post("/api/player/previous", player_previous)
        app.router.add_get("/api/player/status", player_status)
        app.router.add_put("/api/player/volume", player_volume)

        # CORS for local requests
        async def add_cors(request, handler):
            resp = await handler(request)
            resp.headers["Access-Control-Allow-Origin"] = "*"
            return resp

        app.middlewares.append(add_cors)

        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", 8765)
        await site.start()
        logger.info("Spotify backend listening on http://127.0.0.1:8765")

    async def _unload(self):
        if self._runner:
            await self._runner.cleanup()
            logger.info("Spotify backend stopped")

    # Decky callable methods
    async def get_auth_url(self, client_id: str, client_secret: str) -> dict:
        mock_req = type("R", (), {"json": lambda self: asyncio.coroutine(lambda: {"client_id": client_id, "client_secret": client_secret})()})()
        cfg = get_config()
        cfg["client_id"] = client_id
        cfg["client_secret"] = client_secret
        save_json(CONFIG_PATH, cfg)
        params = {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": REDIRECT_URI,
            "scope": SCOPES,
            "show_dialog": "true",
        }
        return {"auth_url": f"{SPOTIFY_AUTH_URL}?{urlencode(params)}"}

    async def get_auth_status(self) -> dict:
        tokens = get_tokens()
        cfg = get_config()
        return {
            "logged_in": bool(tokens.get("access_token") and tokens.get("refresh_token")),
            "has_client_id": bool(cfg.get("client_id")),
            "has_client_secret": bool(cfg.get("client_secret")),
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
            "PUT", "/me/player/play", json={"context_uri": f"spotify:playlist:{playlist_id}"}
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
        status, _ = await spotify_request("PUT", f"/me/player/volume?volume_percent={volume}")
        return {"success": status in (200, 204)}
