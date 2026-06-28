# actual-truelayer-sync

Syncs bank and credit card transactions from [TrueLayer](https://truelayer.com/) into [Actual Budget](https://actualbudget.org/). Runs as a scheduled Docker container.

**Supported banks:** Any UK bank supported by TrueLayer's Open Banking or OAuth connections (Monzo, Starling, Barclays, HSBC, Lloyds, NatWest, Santander, and many more).

---

## Prerequisites

- Docker and Docker Compose
- A self-hosted [Actual Budget](https://actualbudget.org/) instance
- A free [TrueLayer developer account](https://console.truelayer.com/)

---

## TrueLayer Setup

1. Sign up at the [TrueLayer Console](https://console.truelayer.com/).
2. Create a new project and switch it from **Sandbox** to **Live** mode to access real bank data.
3. Under **Redirect URIs**, add your redirect URI in this format:
   ```
   http://<your-server-ip>:3099/callback
   ```
   Replace `<your-server-ip>` with the IP or hostname where you'll run the setup UI.
4. Copy your **Client ID** and **Client Secret** — you'll need them shortly.

> **Testing with sandbox data?** Leave the project in Sandbox mode and set `TRUELAYER_ENV=sandbox` in your `.env`. The setup UI and sync container will both switch to TrueLayer's mock bank automatically.

---

## Docker Setup

Copy the example files and fill in your values:

```bash
cp compose.example.yml docker-compose.yml
cp example.env .env
```

Edit `.env` — see the comments in `example.env` for what each variable does.

The key values you need are:

| Variable | Description |
| --- | --- |
| `ACTUAL_SERVER_URL` | URL of your Actual Budget instance |
| `ACTUAL_SERVER_PASSWORD` | Your Actual Budget password |
| `ACTUAL_SYNC_ID` | Found under **Settings → Show advanced settings → ID** in Actual Budget |
| `TRUELAYER_CLIENT_ID` | From the TrueLayer Console |
| `TRUELAYER_CLIENT_SECRET` | From the TrueLayer Console |
| `REDIRECT_URI` | Must match what you registered in the TrueLayer Console, e.g. `http://<your-server-ip>:3099/callback` |
| `TRUELAYER_ENV` | Set to `sandbox` for test data, omit or leave blank for live |

---

## Adding Your First Bank Connection

The setup UI handles the full OAuth flow and writes `config.json` and `state.json` into your data directory.

**1. Start the setup UI:**

```bash
docker compose --profile setup up -d truelayer-setup
```

**2. Open the UI** in your browser:

```
http://<your-server-ip>:3099
```

**3. Connect a bank:**

- Click **Connect a Bank** and choose Bank Account or Credit Card
- You'll be redirected to TrueLayer to choose and authorise your bank
- After completing the bank's consent flow you'll be returned to the setup UI automatically

**4. Map accounts:**

- Click **View / Map Accounts** on the newly created connection
- Each bank account discovered from TrueLayer is listed with its TrueLayer ID
- Paste the corresponding **Actual Budget account ID** into each row
- To find your Actual Budget account IDs, run the sync container once with `--dry-run`:
  ```bash
  docker compose run --rm truelayer-sync --dry-run
  ```
  This logs all available IDs without importing anything.
- Click **Save Mappings**

**5. Repeat** for any additional banks.

**6. Tear down the setup UI** — it only needs to run on demand:

```bash
docker compose --profile setup down truelayer-setup
```

**7. Start the sync container:**

```bash
docker compose up -d truelayer-sync
```

---

## Re-authorising a Connection

TrueLayer tokens expire or can be revoked by your bank. If the setup UI shows **⚠️ No token** next to a connection:

1. Start the setup UI: `docker compose --profile setup up -d truelayer-setup`
2. Open the UI and click **🔒 Re-authorise** on the affected connection
3. Complete the bank consent flow — your account mappings are preserved
4. Tear down the setup UI

---

## Running

Start the sync container:

```bash
docker compose up -d truelayer-sync
```

By default the sync runs once on startup and exits. Set `CRON_SCHEDULE` in your `.env` to run on a schedule:

```
CRON_SCHEDULE=0 */4 * * *   # Every 4 hours
```

Set `TZ` to ensure the schedule fires at the expected local time:

```
TZ=Europe/London
```

View logs:

```bash
docker compose logs -f truelayer-sync
```

---

## Config Reference

Configuration is split across two files in your data directory (`./actual-truelayer-sync/data/` by default). Both are written by the setup UI — you should not need to edit them manually.

### `config.json`

Defines which accounts to sync and how. See `config.example.json` for a full example.

| Field | Required | Description |
| --- | --- | --- |
| `version` | Yes | Must be `2` |
| `includeCategoryInNotes` | No | Appends TrueLayer transaction category to the notes field (default: `false`) |
| `lookbackDays` | No | How many days back to fetch on first sync for an account (default: `14`). Note: TrueLayer currently appears to ignore the `from` date parameter and returns all available transactions regardless — this field is retained in case TrueLayer honours it in future |
| `connections` | Yes | Array of bank connections (see below) |

**Connection fields:**

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Unique label, used in logs and to match state |
| `isCard` | No | Set to `true` if this connection is a credit/charge card provider |
| `accounts` | Yes | Array of accounts to sync |

**Account fields:**

| Field | Required | Description |
| --- | --- | --- |
| `trueLayerId` | Yes | TrueLayer `account_id` for this account |
| `actualId` | Yes | Actual Budget account ID |
| `friendlyName` | Yes | Label used in logs |
| `flip` | No | Inverts transaction amounts. Credit card accounts have amounts flipped automatically; use `flip: false` to override |
| `isCard` | No | Overrides the connection-level `isCard` for this specific account |

### `state.json`

Stores refresh tokens and per-account last sync dates. Written by the app and the setup UI — you should not need to edit this manually.

See `state.example.json` for the expected structure.

> **Note:** Both files are excluded from Docker image builds. Mount them via the `./actual-truelayer-sync/data:/app/data` volume in your compose file.

---

## Sandbox / Test Mode

TrueLayer provides a sandbox environment with a mock bank and synthetic transactions — useful for testing your setup without connecting a real bank.

**To enable sandbox mode**, add this to your `.env`:

```
TRUELAYER_ENV=sandbox
```

Both the setup UI and the sync container read this variable automatically. In sandbox mode:

- The setup UI shows a **SANDBOX** badge and connects to `auth.truelayer-sandbox.com`
- The `sandbox-` prefix is added to your Client ID automatically if needed
- The mock bank provider (`uk-cs-mock`) is used instead of real UK banks
- The sync container hits `api.truelayer-sandbox.com`

Remove or comment out `TRUELAYER_ENV=sandbox` to switch back to live mode.

---

## Migrating from v1

If you have an existing `config.json` from before the config/state split, see [MIGRATION.md](MIGRATION.md).

---

## Use of AI

This project has made use of AI tooling throughout development:

- **Code review** — reviewing sync logic, error handling, and edge cases; catching bugs and suggesting improvements
- **Test writing** — generating unit tests for config loading, sync logic, and transaction mapping
- **The setup UI** — `truelayer-setup/server.js`, including the OAuth flow and account mapping, was written with AI assistance
- **Documentation** — this README was written with AI assistance

The intent is to be transparent about this. All AI-generated code has been reviewed and tested by the author.

---

## License

MIT
