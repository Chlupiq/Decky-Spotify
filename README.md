# Spotify Launcher Pro

Decky Loader plugin pro Steam Deck, který umožňuje ovládat Spotify přímo z Quick Access Menu.

## Funkce

- OAuth 2.0 přihlášení ke Spotify
- Procházení a spouštění playlistů
- Ovládání přehrávače (play, pause, skip)
- Zobrazení aktuálně hrajícího tracku s progress barem
- Ovládání hlasitosti
- D-Bus fallback pro lokální Spotify
- Cache playlistů (5 minut)

## Požadavky

- [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) nainstalovaný na Steam Decku
- Spotify Premium účet (pro playback control)
- Spotify Developer App (zdarma na [developer.spotify.com](https://developer.spotify.com/dashboard))
- Python 3.9+ (součástí SteamOS)
- Node.js + pnpm (pro build)

## Instalace

### 1. Vytvoř Spotify Developer App

1. Jdi na [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Klikni **Create App**
3. Vyplň název (např. "Decky Spotify")
4. Do **Redirect URIs** přidej: `http://localhost:8765/auth/callback`
5. Ulož a zkopíruj **Client ID** a **Client Secret**

### 2. Build pluginu

```bash
# Nainstaluj závislosti
pnpm install
pip install -e .

# Build frontend
pnpm build
```

### 3. Deploy na Steam Deck

```bash
# Zkopíruj plugin na Steam Deck (nahraď IP adresou Decku)
scp -r . deck@<STEAM_DECK_IP>:~/.local/share/decky/plugins/spotify-launcher/

# Restart Decky na Decku
ssh deck@<STEAM_DECK_IP> "sudo systemctl restart plugin_loader"
```

### 4. Přihlášení

1. Otevři Quick Access Menu (tlačítko `...` na Decku)
2. Jdi do pluginu **Spotify Launcher Pro**
3. Zadej **Client ID** a **Client Secret**
4. Klikni **Přihlásit se přes Spotify**
5. Otevři vygenerovaný odkaz v prohlížeči a přihlas se
6. Po přihlášení klikni **Ověřit přihlášení**

## Struktura projektu

```
spotify-launcher/
├── main.py                          # aiohttp backend server (port 8765)
├── plugin.json                      # Decky metadata
├── pyproject.toml                   # Python závislosti
├── package.json                     # Node.js závislosti
├── tsconfig.json                    # TypeScript konfigurace
├── vite.config.ts                   # Vite build konfigurace
└── src/
    ├── index.tsx                    # Decky plugin entry point
    ├── App.tsx                      # Hlavní komponenta + navigace
    ├── components/
    │   ├── LoginForm.tsx            # OAuth login formulář
    │   ├── PlaylistSelector.tsx     # Seznam playlistů
    │   ├── Player.tsx               # Přehrávač + ovládání
    │   └── NowPlaying.tsx           # Info o aktuální skladbě
    ├── services/
    │   └── spotifyApi.ts            # Spotify Web API wrapper
    └── styles/
        └── main.css                 # Spotify dark theme
```

## API Endpointy (backend)

| Method | Path | Popis |
|--------|------|-------|
| `POST` | `/auth/login` | Vrátí OAuth URL |
| `GET` | `/auth/callback` | OAuth callback |
| `GET` | `/auth/status` | Stav přihlášení |
| `POST` | `/auth/logout` | Odhlášení |
| `GET` | `/api/playlists` | Seznam playlistů |
| `GET` | `/api/player/current` | Aktuálně hrající track |
| `POST` | `/api/player/play` | Spustit / spustit playlist |
| `POST` | `/api/player/pause` | Pozastavit |
| `POST` | `/api/player/next` | Další skladba |
| `POST` | `/api/player/previous` | Předchozí skladba |
| `GET` | `/api/player/status` | Status přehrávače |
| `PUT` | `/api/player/volume` | Nastavit hlasitost |

## Vývoj

```bash
# Spusť backend lokálně
python main.py

# Spusť frontend dev server
pnpm dev

# Typecheck
pnpm typecheck
```

## Řešení problémů

**"Backend nedostupný"**
- Zkontroluj, zda Decky Loader běží: `sudo systemctl status plugin_loader`
- Restartuj: `sudo systemctl restart plugin_loader`

**"Nelze spustit playlist"**
- Spotify musí běžet na nějakém zařízení (telefon, PC, nebo Spotify pro Linux na Decku)
- Spotify Premium je vyžadováno pro Web API playback control

**"Příkaz selhal"**
- Zkontroluj, zda máš aktivní Spotify session (přehráváš na nějakém zařízení)
- Plugin použije D-Bus fallback pro lokální Spotify na SteamOS

## Licence

MIT
