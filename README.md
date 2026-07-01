# actual-truelayer-sync

Self-hosted TrueLayer → Actual Budget setup UI.

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials.
2. On first run, build and start the container:
   ```bash
   docker compose up -d --build
   ```
3. Open `http://localhost:3099` (or your configured URL).
4. Connect your bank, map accounts, save.

## Environment Variables

| Variable | Description |
|---|---|
| `TRUELAYER_CLIENT_ID` | TrueLayer app client ID |
| `TRUELAYER_CLIENT_SECRET` | TrueLayer app client secret |
| `TRUELAYER_ENV` | `live` or `sandbox` |
| `REDIRECT_URI` | Must match your TrueLayer app redirect URI (e.g. `https://truelayer.yourdomain.com/callback`) |
| `ACTUAL_SERVER_URL` | URL of your Actual Budget server |
| `ACTUAL_SERVER_PASSWORD` | Actual Budget server password |

## Data

All state is persisted in `./truelayer-data/` (`config.json` and `state.json`).

## Deploy

Pushing to `main` triggers the self-hosted runner to sync the repo. If only `server.js` changed, nodemon picks it up automatically with no container restart. A full rebuild only happens when `package.json` or `Dockerfile` changes.
