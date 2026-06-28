const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const PORT = process.env.PORT || 3099;
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const STATE_PATH  = path.join(DATA_DIR, 'state.json');

const REDIRECT_URI = process.env.REDIRECT_URI;
if (!REDIRECT_URI) {
  console.error('ERROR: REDIRECT_URI env var is not set.');
  console.error('e.g. REDIRECT_URI=http://192.168.1.10:3099/callback');
  process.exit(1);
}

const RAW_CLIENT_ID  = process.env.TRUELAYER_CLIENT_ID || '';
const CLIENT_SECRET  = process.env.TRUELAYER_CLIENT_SECRET || '';
const ACTUAL_URL     = process.env.ACTUAL_SERVER_URL || '';
const ACTUAL_PASS    = process.env.ACTUAL_SERVER_PASSWORD || '';
const SANDBOX = (process.env.TRUELAYER_ENV || '').toLowerCase() === 'sandbox';

// In sandbox mode TrueLayer requires the client_id prefixed with "sandbox-"
const CLIENT_ID = SANDBOX && RAW_CLIENT_ID && !RAW_CLIENT_ID.startsWith('sandbox-')
  ? `sandbox-${RAW_CLIENT_ID}`
  : RAW_CLIENT_ID;

const AUTH_URL  = SANDBOX ? 'https://auth.truelayer-sandbox.com' : 'https://auth.truelayer.com';
const API_URL   = SANDBOX ? 'https://api.truelayer-sandbox.com'  : 'https://api.truelayer.com';
const PROVIDERS = SANDBOX ? 'uk-cs-mock' : 'uk-ob-all uk-oauth-all';

console.log(`Mode:         ${SANDBOX ? 'SANDBOX' : 'LIVE'}`);
console.log(`Client ID:    ${CLIENT_ID || '(not set)'}`);
console.log(`Auth:         ${AUTH_URL}`);
console.log(`Redirect URI: ${REDIRECT_URI}`);

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskSecret(s) {
  if (!s) return '(not set)';
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '...' + s.slice(-4);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { version: 2, connections: [] };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
    if (!raw) return { version: 2, connections: [] };
    return JSON.parse(raw);
  } catch (e) {
    console.warn('config.json unreadable, using defaults:', e.message);
    return { version: 2, connections: [] };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { connections: {} };
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8').trim();
    if (!raw) return { connections: {} };
    return JSON.parse(raw);
  } catch (e) {
    console.warn('state.json unreadable, using defaults:', e.message);
    return { connections: {} };
  }
}
function saveState(st) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
}

/**
 * Return the most recent lastSyncDate across all accounts in a connection's
 * state entry, or null if never synced.
 */
function lastSyncedFor(connState) {
  if (!connState || !connState.accounts) return null;
  const dates = Object.values(connState.accounts)
    .map(a => a.lastSyncDate)
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** Format an ISO date string as a relative label, e.g. "2 hours ago" */
function relativeTime(isoDate) {
  if (!isoDate) return null;
  const diffMs = Date.now() - new Date(isoDate).getTime();
  if (isNaN(diffMs)) return isoDate;
  const mins  = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins  / 60);
  const days  = Math.floor(hours / 24);
  if (mins  <  2)  return 'just now';
  if (mins  < 60)  return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  if (hours < 24)  return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (days  < 30)  return `${days} day${days !== 1 ? 's' : ''} ago`;
  return new Date(isoDate).toLocaleDateString();
}

/**
 * Given a base name (e.g. "Monzo"), return a name that does not already exist
 * in config.connections.
 */
function uniqueConnName(base, existingConnections) {
  const existing = new Set(existingConnections.map(c => c.name));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/**
 * Build account mapping table rows.
 * savedAccounts — conn.accounts from config.json (always available)
 * liveAccounts  — results from TrueLayer API (null if not fetched yet)
 */
function buildRows(savedAccounts, liveAccounts) {
  if (liveAccounts) {
    const rows = liveAccounts.map(acc => {
      const saved = savedAccounts.find(a => a.trueLayerId === acc.account_id);
      const defaultName = acc.display_name || acc.account_type || '';
      return {
        trueLayerId: acc.account_id,
        displayName: defaultName,
        actualId: saved ? saved.actualId : '',
        friendlyName: saved ? saved.friendlyName : defaultName,
        flip: saved ? !!saved.flip : false,
        stale: false,
      };
    });
    savedAccounts.forEach(saved => {
      if (!liveAccounts.find(a => a.account_id === saved.trueLayerId)) {
        rows.push({
          trueLayerId: saved.trueLayerId,
          displayName: saved.friendlyName || saved.trueLayerId,
          actualId: saved.actualId,
          friendlyName: saved.friendlyName,
          flip: !!saved.flip,
          stale: true,
        });
      }
    });
    return rows;
  }
  if (savedAccounts.length === 0) return [];
  return savedAccounts.map(saved => ({
    trueLayerId: saved.trueLayerId,
    displayName: saved.friendlyName || saved.trueLayerId,
    actualId: saved.actualId,
    friendlyName: saved.friendlyName,
    flip: !!saved.flip,
    stale: false,
  }));
}

// Shared CSS / HTML shell used by every page
const SHARED_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 24px 20px 60px; background: #f5f5f5; color: #1a1a1a; }
  h1 { margin: 0 0 4px; font-size: 1.4em; }
  h2 { font-size: 1.1em; margin: 0 0 12px; }
  a { color: #0066cc; }
  code { background: #eee; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; font-family: monospace; }
  pre { background: #f0f0f0; padding: 12px; border-radius: 4px; font-size: 0.88em; overflow-x: auto; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px 20px; margin: 10px 0; }
  .tag { display: inline-block; padding: 2px 9px; border-radius: 12px; font-size: 0.78em; font-weight: 600;
         background: #e8f0fe; color: #1a73e8; margin-left: 6px; vertical-align: middle; }
  .notice { padding: 11px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 0.9em; line-height: 1.6; }
  .notice.success { background: #e6f4ea; border-left: 4px solid #137333; color: #137333; }
  .notice.error   { background: #fce8e6; border-left: 4px solid #c5221f; color: #9b1c1c; }
  .notice.info    { background: #fef7e0; border-left: 4px solid #f9ab00; color: #7a5c00; }
  .notice.warn    { background: #fff8e1; border-left: 4px solid #e65100; color: #7a3800; }
  .btn { display: inline-block; padding: 7px 16px; border-radius: 5px; font-size: 0.88em; font-weight: 600;
         text-decoration: none; cursor: pointer; border: none; margin-right: 6px; }
  .btn-primary { background: #0066cc; color: #fff; }
  .btn-primary:hover { background: #0052a3; }
  .btn-secondary { background: #555; color: #fff; }
  .btn-secondary:hover { background: #333; }
  .btn-danger { background: #c5221f; color: #fff; }
  .btn-danger:hover { background: #9b1c1c; }
  .btn-ghost { background: #eee; color: #333; }
  .btn-ghost:hover { background: #ddd; }
  .mode-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-weight: 700;
    font-size: 0.8em; margin-left: 8px; vertical-align: middle; }
  .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:100; align-items:center; justify-content:center; }
  .modal-overlay.open { display:flex; }
  .modal { background:#fff; border-radius:10px; padding:24px 28px; max-width:400px; width:90%; box-shadow:0 8px 32px rgba(0,0,0,0.18); }
  .modal h3 { margin:0 0 10px; }
  .modal p  { margin:0 0 20px; font-size:0.9em; color:#555; }
  .modal-actions { display:flex; gap:10px; justify-content:flex-end; }
  table.env-table { width:100%; border-collapse:collapse; font-size:0.88em; }
  table.env-table td { padding:5px 8px; }
  table.env-table td:first-child { font-weight:600; color:#555; width:140px; white-space:nowrap; }
  .security-banner { background:#fff3e0; border:1px solid #ff9800; border-radius:6px; padding:10px 14px;
    font-size:0.85em; color:#7a3800; margin-bottom:18px; line-height:1.6; }
  .security-banner strong { color:#e65100; }
  .last-synced { font-size:0.8em; color:#666; margin-top:4px; }
  .last-synced.overdue { color:#c5221f; font-weight:600; }
`;

function page(title, body) {
  return `<!DOCTYPE html><html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — TrueLayer Setup</title>
<style>${SHARED_CSS}</style>
</head><body>${body}</body></html>`;
}

function renderMappingPage(name, conn, rows, notice) {
  const allIds = rows.map(r => r.trueLayerId).join(',');

  const tableRows = rows.map(r => `<tr${r.stale ? ' style="opacity:0.55"' : ''}>
    <td>${r.displayName}${r.stale ? ' <span class="tag" style="background:#fce8e6;color:#c5221f">not in live list</span>' : ''}</td>
    <td><code style="font-size:0.78em">${r.trueLayerId}</code></td>
    <td><input style="width:100%;padding:5px;border:1px solid #ccc;border-radius:3px"
         name="actualId_${r.trueLayerId}" value="${r.actualId}" placeholder="Paste Actual account ID"></td>
    <td><input style="width:100%;padding:5px;border:1px solid #ccc;border-radius:3px"
         name="friendlyName_${r.trueLayerId}" value="${r.friendlyName}" placeholder="e.g. Main Current Account"></td>
    <td style="text-align:center"><input type="checkbox" name="flip_${r.trueLayerId}" ${r.flip ? 'checked' : ''}></td>
  </tr>`).join('');

  const emptyState = rows.length === 0
    ? `<tr><td colspan="5" style="text-align:center;padding:28px;color:#888">
        No accounts yet — click <strong>Sync from bank</strong> above to discover accounts from TrueLayer.
      </td></tr>`
    : '';

  const hasActualCreds = ACTUAL_URL && ACTUAL_PASS;

  return page(`Map Accounts — ${name}`, `
  <p style="margin:0 0 16px"><a href="/">← Home</a></p>
  <h1>📂 Map Accounts — ${name}</h1>

  ${notice ? `<div class="notice ${notice.type}">${notice.message}</div>` : ''}

  <div class="notice info" style="margin-bottom:16px">
    <strong>How to find your Actual Budget account ID</strong><br>
    ${hasActualCreds
      ? 'Click <strong>Browse Actual accounts</strong> below to see all your Actual Budget accounts and their IDs.'
      : 'Run the sync container once with <code>--dry-run</code> to list IDs:<br><code>docker compose run --rm truelayer-sync --dry-run</code><br>Or open Actual Budget → Settings → Advanced → copy the ID next to the account.'}
    <br><br>
    <strong>Friendly Name</strong> is shown in sync logs only.<br>
    <strong>Flip</strong> inverts transaction amounts — useful if your bank reports credits as negative.
  </div>

  <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    <a class="btn btn-secondary" href="/accounts/${encodeURIComponent(name)}/refresh">⟳ Sync from bank</a>
    ${hasActualCreds
      ? `<a class="btn btn-ghost" href="/actual-accounts" target="_blank">🔍 Browse Actual accounts</a>`
      : ''}
    <span style="font-size:0.82em;color:#888">Fetches the latest account list from TrueLayer.</span>
  </div>

  <form action="/save-mapping/${encodeURIComponent(name)}" method="POST" onsubmit="return validateForm(event)">
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f0f0f0;font-size:0.82em">
        <th style="padding:9px 10px;border:1px solid #ddd;text-align:left">Bank Account</th>
        <th style="padding:9px 10px;border:1px solid #ddd;text-align:left">TrueLayer ID</th>
        <th style="padding:9px 10px;border:1px solid #ddd;text-align:left">Actual Budget Account ID</th>
        <th style="padding:9px 10px;border:1px solid #ddd;text-align:left">Friendly Name</th>
        <th style="padding:9px 10px;border:1px solid #ddd;text-align:center">Flip</th>
      </tr></thead>
      <tbody id="tableBody">
      ${tableRows}
      ${emptyState}
      </tbody>
    </table>
    </div>
    <div style="background:#fff3cd;border:1px solid #ffc107;padding:10px 14px;border-radius:4px;margin-top:12px;font-size:0.88em;display:none" id="warn">
      ⚠️ No accounts have an Actual Budget ID filled in. At least one is required to save.
    </div>
    <input type="hidden" name="allIds" value="${allIds}">
    ${rows.length > 0 ? '<button class="btn btn-primary" type="submit" style="margin-top:14px">💾 Save Mappings</button>' : ''}
  </form>
  <script>
    function validateForm(e) {
      const ids = document.querySelectorAll('input[name^="actualId_"]');
      const any = Array.from(ids).some(i => i.value.trim());
      if (!any) { e.preventDefault(); document.getElementById('warn').style.display='block'; return false; }
      return true;
    }
  </script>`);
}

// ── Home ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const config = loadConfig();
  const state  = loadState();
  const missingCreds   = !RAW_CLIENT_ID || !CLIENT_SECRET;
  const sandboxPrefixed = SANDBOX && RAW_CLIENT_ID && !RAW_CLIENT_ID.startsWith('sandbox-');

  const connCards = config.connections.length === 0
    ? '<p style="color:#888;font-size:0.9em">No connections yet.</p>'
    : config.connections.map(c => {
        const connState   = state.connections[c.name];
        const hasToken    = !!connState;
        const lastSynced  = lastSyncedFor(connState);
        const rel         = relativeTime(lastSynced);
        // Flag as overdue if last sync was >6 hours ago (generous vs 4h schedule)
        const overdue     = lastSynced && (Date.now() - new Date(lastSynced).getTime()) > 6 * 60 * 60 * 1000;
        return `<div class="card">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div>
              <strong style="font-size:1.05em">${c.name}</strong>
              <span class="tag">${c.isCard ? 'Credit Card' : 'Bank Account'}</span>
              <span class="tag" style="background:${hasToken ? '#e6f4ea' : '#fce8e6'};color:${hasToken ? '#137333' : '#c5221f'}">
                ${hasToken ? '✅ Authorised' : '⚠️ No token'}
              </span>
              <span class="tag">${c.accounts.length} account${c.accounts.length !== 1 ? 's' : ''} mapped</span>
              ${rel
                ? `<div class="last-synced${overdue ? ' overdue' : ''}">Last synced: ${rel}${overdue ? ' — may be overdue' : ''}</div>`
                : '<div class="last-synced">Not yet synced</div>'}
            </div>
          </div>
          <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
            <a class="btn btn-secondary" href="/accounts/${encodeURIComponent(c.name)}">View / Map Accounts</a>
            ${!hasToken
              ? `<a class="btn btn-primary" href="/reauth/${encodeURIComponent(c.name)}">🔒 Re-authorise</a>`
              : ''}
            <button class="btn btn-danger" onclick="confirmDelete('${c.name.replace(/'/g, "\\'")}')">Remove</button>
          </div>
        </div>`;
      }).join('');

  res.send(page('Home', `
  <h1>🏦 TrueLayer → Actual Budget
    <span class="mode-badge" style="background:${SANDBOX ? '#f9ab00' : '#1a73e8'};color:#fff">${SANDBOX ? 'SANDBOX' : 'LIVE'}</span>
  </h1>

  <div class="security-banner">
    ⚠️ <strong>Security reminder:</strong> This setup UI exposes your TrueLayer credentials.
    Run it on demand only — tear it down when you're done:
    <code>docker compose --profile setup down truelayer-setup</code>
  </div>

  <div class="notice ${missingCreds ? 'error' : SANDBOX ? 'info' : 'success'}" style="margin-bottom:20px">
    <table class="env-table">
      <tr><td>Mode</td><td><strong>${SANDBOX ? '⚠️ Sandbox — mock data only' : '✅ Live'}</strong></td></tr>
      <tr><td>Client ID</td>
          <td><code>${CLIENT_ID || '(not set)'}</code>
          ${sandboxPrefixed ? '<span style="color:#888;font-size:0.85em"> (sandbox- prefix added automatically)</span>' : ''}</td></tr>
      <tr><td>Client Secret</td><td><code>${maskSecret(CLIENT_SECRET)}</code></td></tr>
      <tr><td>Redirect URI</td><td><code>${REDIRECT_URI}</code></td></tr>
      <tr><td>Auth endpoint</td><td><code>${AUTH_URL}</code></td></tr>
      <tr><td>API endpoint</td><td><code>${API_URL}</code></td></tr>
    </table>
    ${missingCreds ? '<br>⚠️ <strong>Missing credentials — check your .env file.</strong>' : ''}
  </div>

  <div class="card">
    <h2>Add Bank Connection</h2>
    <p style="font-size:0.9em;color:#555;margin:0 0 12px">You'll be redirected to TrueLayer to choose and authorise your bank.
    The connection name is set automatically from the bank's display name.</p>
    <form action="/start-auth" method="POST" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <select name="isCard" style="padding:7px 10px;border:1px solid #ccc;border-radius:5px;font-size:0.9em">
        <option value="false">Bank Account</option>
        <option value="true">Credit Card</option>
      </select>
      <button class="btn btn-primary" type="submit">Connect a Bank →</button>
    </form>
  </div>

  <h2 style="margin-top:24px">Connections</h2>
  ${connCards}

  <div class="modal-overlay" id="deleteModal">
    <div class="modal">
      <h3>Remove connection?</h3>
      <p>This will delete <strong id="deleteName"></strong> and its refresh token. Sync will stop for this bank until you re-add it.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <a class="btn btn-danger" id="deleteLink" href="#">Remove</a>
      </div>
    </div>
  </div>
  <script>
    function confirmDelete(name) {
      document.getElementById('deleteName').textContent = name;
      document.getElementById('deleteLink').href = '/delete/' + encodeURIComponent(name);
      document.getElementById('deleteModal').classList.add('open');
    }
    function closeModal() { document.getElementById('deleteModal').classList.remove('open'); }
    document.getElementById('deleteModal').addEventListener('click', e => { if (e.target === document.getElementById('deleteModal')) closeModal(); });
  </script>`));
});

// ── Status JSON ───────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  const config = loadConfig();
  const state  = loadState();
  res.json({
    mode: SANDBOX ? 'sandbox' : 'live',
    connections: config.connections.map(c => {
      const cs = state.connections[c.name];
      return {
        name: c.name,
        isCard: !!c.isCard,
        accountsMapped: c.accounts.length,
        hasToken: !!cs,
        lastSyncDate: lastSyncedFor(cs),
      };
    }),
  });
});

// ── Actual Budget account browser ────────────────────────────────────────────
app.get('/actual-accounts', async (req, res) => {
  if (!ACTUAL_URL || !ACTUAL_PASS) {
    return res.status(400).send(page('Actual Accounts',
      '<div class="notice error">ACTUAL_SERVER_URL or ACTUAL_SERVER_PASSWORD not set in environment. Cannot query Actual Budget.</div><p><a href="/">← Home</a></p>'));
  }

  try {
    // Authenticate
    const authRes  = await fetch(`${ACTUAL_URL}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginMethod: 'password', password: ACTUAL_PASS }),
    });
    const authData = await authRes.json();
    const token    = authData.data?.token;
    if (!token) throw new Error('Login failed: ' + JSON.stringify(authData));

    // List budgets
    const budgetsRes  = await fetch(`${ACTUAL_URL}/sync/list`, {
      headers: { 'x-actual-token': token },
    });
    const budgetsData = await budgetsRes.json();
    const budgets     = budgetsData.data || [];

    if (budgets.length === 0) {
      return res.send(page('Actual Accounts',
        '<p><a href="/">← Home</a></p><div class="notice info">No budgets found in your Actual instance.</div>'));
    }

    // For each budget, download and list accounts
    const sections = [];
    for (const budget of budgets) {
      try {
        const dlRes  = await fetch(`${ACTUAL_URL}/sync/download-user-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-actual-token': token },
          body: JSON.stringify({ fileId: budget.fileId }),
        });
        const dlData = await dlRes.json();
        const accounts = dlData.data?.accounts || dlData.accounts || [];
        const rows = accounts.map(a =>
          `<tr><td>${a.name || '(unnamed)'}</td>
               <td><code style="user-select:all">${a.id}</code></td>
               <td>${a.closed ? '<span class="tag" style="background:#fce8e6;color:#c5221f">Closed</span>' : '<span class="tag" style="background:#e6f4ea;color:#137333">Open</span>'}</td>
          </tr>`).join('');
        sections.push(`
          <div class="card">
            <h2>${budget.name || budget.fileId}</h2>
            ${accounts.length === 0
              ? '<p style="color:#888;font-size:0.9em">No accounts found.</p>'
              : `<table style="width:100%;border-collapse:collapse;font-size:0.88em">
                  <tr style="background:#f0f0f0">
                    <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Account Name</th>
                    <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Account ID (paste into mapping)</th>
                    <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Status</th>
                  </tr>
                  ${rows}
                </table>`}
          </div>`);
      } catch (err) {
        sections.push(`<div class="notice error">Could not load accounts for <strong>${budget.name || budget.fileId}</strong>: ${err.message}</div>`);
      }
    }

    res.send(page('Actual Accounts',
      `<p><a href="/">← Home</a></p>
       <h1>🔍 Actual Budget Accounts</h1>
       <p style="font-size:0.9em;color:#555;margin-bottom:20px">Click an Account ID to select it, then copy and paste it into the mapping form.</p>
       ${sections.join('')}` ));
  } catch (err) {
    console.error('Actual accounts error:', err);
    res.send(page('Actual Accounts',
      `<p><a href="/">← Home</a></p>
       <div class="notice error">⚠️ Could not connect to Actual Budget: ${err.message}<br>
       Make sure ACTUAL_SERVER_URL and ACTUAL_SERVER_PASSWORD are correct in your .env and the container can reach the Actual server.</div>`));
  }
});

// ── Start OAuth (new connection) ──────────────────────────────────────────────
app.post('/start-auth', (req, res) => {
  const { isCard } = req.body;
  if (!CLIENT_ID) return res.status(500).send('TRUELAYER_CLIENT_ID not set. <a href="/">Back</a>');

  const scope = isCard === 'true'
    ? 'cards balance transactions offline_access'
    : 'accounts balance transactions offline_access';

  const url = `${AUTH_URL}/?${new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
    providers: PROVIDERS,
    response_mode: 'query',
    state: JSON.stringify({ isCard: isCard === 'true' }),
  })}`;

  res.redirect(url);
});

// ── Re-authorise existing connection ─────────────────────────────────────────
app.get('/reauth/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!CLIENT_ID) return res.status(500).send('TRUELAYER_CLIENT_ID not set. <a href="/">Back</a>');

  const config = loadConfig();
  const conn = config.connections.find(c => c.name === name);
  if (!conn) return res.status(404).send('Connection not found. <a href="/">Back</a>');

  const scope = conn.isCard
    ? 'cards balance transactions offline_access'
    : 'accounts balance transactions offline_access';

  const url = `${AUTH_URL}/?${new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
    providers: PROVIDERS,
    response_mode: 'query',
    state: JSON.stringify({ isCard: conn.isCard, reauth: name }),
  })}`;

  res.redirect(url);
});

// ── OAuth Callback ────────────────────────────────────────────────────────────
app.get('/callback', async (req, res) => {
  const { code, state: stateParam } = req.query;
  if (!code) return res.status(400).send('Missing authorisation code. <a href="/">Try again</a>');

  let isCard = false;
  let reauthName = null;
  try {
    const parsed = JSON.parse(stateParam || '{}');
    isCard     = parsed.isCard  || false;
    reauthName = parsed.reauth  || null;
  } catch (_) {}

  try {
    const tokenRes = await fetch(`${AUTH_URL}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.refresh_token) throw new Error('No refresh token: ' + JSON.stringify(tokenData));

    // Re-auth: just refresh the token for an existing connection
    if (reauthName) {
      const state = loadState();
      const existing = state.connections[reauthName] || { accounts: {} };
      state.connections[reauthName] = { ...existing, refreshToken: tokenData.refresh_token };
      saveState(state);
      return res.send(page('Re-authorised', `
        <h1>✅ ${reauthName} re-authorised!</h1>
        <p>Fresh token saved. The sync will resume on its next scheduled run.</p>
        <p><a href="/">← Back to home</a></p>`));
    }

    // New connection: discover bank name from accounts API
    const endpoint    = isCard ? 'cards' : 'accounts';
    const accountsRes = await fetch(`${API_URL}/data/v1/${endpoint}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const accountsData = await accountsRes.json();
    const firstAccount = (accountsData.results || [])[0];
    const bankName  = firstAccount
      ? (firstAccount.provider ? firstAccount.provider.display_name : firstAccount.display_name)
      : 'Bank-' + Date.now();
    const baseName  = bankName.replace(/[^a-zA-Z0-9 _-]/g, '').trim();

    const config   = loadConfig();
    const connName = uniqueConnName(baseName, config.connections);

    const state = loadState();
    state.connections[connName] = { refreshToken: tokenData.refresh_token, accounts: {} };
    saveState(state);

    if (!config.connections.find(c => c.name === connName)) {
      config.connections.push({ name: connName, isCard, accounts: [] });
      saveConfig(config);
    }

    res.send(page('Connected', `
      <h1>✅ ${connName} connected!</h1>
      ${connName !== baseName ? `<p>ℹ️ You already had a connection called <strong>${baseName}</strong>, so this one was saved as <strong>${connName}</strong>.</p>` : ''}
      <p>Token saved. Now <a href="/accounts/${encodeURIComponent(connName)}/refresh">discover and map your accounts →</a></p>
      <p><a href="/">← Back to home</a></p>`));
  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).send(page('Error', `<h1>Error</h1><p>${err.message}</p><a href="/">← Back</a>`));
  }
});

// ── Delete connection ─────────────────────────────────────────────────────────
app.get('/delete/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  config.connections = config.connections.filter(c => c.name !== name);
  saveConfig(config);
  const state = loadState();
  delete state.connections[name];
  saveState(state);
  res.redirect('/');
});

// ── Account Mapping — show saved data immediately (no API call) ───────────────
app.get('/accounts/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn = config.connections.find(c => c.name === name);
  if (!conn) return res.status(404).send('Connection not found. <a href="/">Back</a>');

  const rows   = buildRows(conn.accounts, null);
  const notice = conn.accounts.length === 0
    ? { type: 'info', message: '🔗 No accounts mapped yet — click <strong>Sync from bank</strong> to fetch the account list from TrueLayer.' }
    : null;

  res.send(renderMappingPage(name, conn, rows, notice));
});

// ── Account Mapping — refresh from TrueLayer API ──────────────────────────────
app.get('/accounts/:name/refresh', async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn = config.connections.find(c => c.name === name);
  if (!conn) return res.status(404).send('Connection not found. <a href="/">Back</a>');

  const state     = loadState();
  const connState = state.connections[name];
  if (!connState) {
    return res.send(renderMappingPage(name, conn, buildRows(conn.accounts, null), {
      type: 'error',
      message: `⚠️ No token for this connection — <a href="/reauth/${encodeURIComponent(name)}">re-authorise</a> first.`,
    }));
  }

  try {
    const tokenRes = await fetch(`${AUTH_URL}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: connState.refreshToken,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(tokenData));

    // Persist the rotated refresh token — TrueLayer tokens are single-use
    if (tokenData.refresh_token) {
      connState.refreshToken = tokenData.refresh_token;
      saveState(state);
    }

    const endpoint = conn.isCard ? 'cards' : 'accounts';
    const apiRes   = await fetch(`${API_URL}/data/v1/${endpoint}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const apiData      = await apiRes.json();
    const liveAccounts = apiData.results || [];

    const rows     = buildRows(conn.accounts, liveAccounts);
    const newCount = liveAccounts.filter(a => !conn.accounts.find(s => s.trueLayerId === a.account_id)).length;
    const notice   = {
      type: 'success',
      message: `✅ Fetched ${liveAccounts.length} account${liveAccounts.length !== 1 ? 's' : ''} from TrueLayer.`
        + (newCount > 0 ? ` ${newCount} new account${newCount !== 1 ? 's' : ''} discovered.` : ' All accounts already mapped.'),
    };

    res.send(renderMappingPage(name, conn, rows, notice));
  } catch (err) {
    console.error('Refresh error:', err);
    res.send(renderMappingPage(name, conn, buildRows(conn.accounts, null), {
      type: 'error',
      message: `⚠️ Could not fetch accounts from TrueLayer: ${err.message}. Your saved mappings are shown below and can still be edited.`,
    }));
  }
});

// ── Save Mapping ──────────────────────────────────────────────────────────────
app.post('/save-mapping/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn = config.connections.find(c => c.name === name);
  if (!conn) return res.status(404).send('Connection not found');

  const ids    = (req.body.allIds || '').split(',').filter(Boolean);
  const mapped = ids
    .map(id => {
      const actualId     = (req.body[`actualId_${id}`]     || '').trim();
      const friendlyName = (req.body[`friendlyName_${id}`] || '').trim() || actualId;
      const flip         = req.body[`flip_${id}`] === 'on';
      return { trueLayerId: id, actualId, friendlyName, ...(flip ? { flip: true } : {}) };
    })
    .filter(a => a.actualId);

  if (mapped.length === 0) {
    return res.status(400).send(page('Nothing saved', `
      <h1>⚠️ Nothing saved</h1>
      <p>No accounts had an Actual Budget ID filled in. The sync container requires at least one.</p>
      <p><a href="/accounts/${encodeURIComponent(name)}">← Go back and fill in the IDs</a></p>`));
  }

  conn.accounts = mapped;
  saveConfig(config);

  res.send(page('Mappings saved', `
    <h1>✅ Mappings saved!</h1>
    <p>Saved ${conn.accounts.length} account mapping(s) for <strong>${name}</strong>.</p>
    <p><a href="/accounts/${encodeURIComponent(name)}">← Back to account list</a> &nbsp;|&nbsp; <a href="/">Home</a></p>
    <hr style="margin:20px 0">
    <p><strong>Next steps:</strong></p>
    <p>Start your scheduled sync:</p>
    <pre>docker compose up -d truelayer-sync</pre>
    <p>Then tear down this setup UI:</p>
    <pre>docker compose --profile setup down truelayer-setup</pre>`));
});

app.listen(PORT, () => {
  console.log(`Setup UI running on http://0.0.0.0:${PORT}`);
  console.log(`Mode:         ${SANDBOX ? 'SANDBOX' : 'LIVE'}`);
  console.log(`Client ID:    ${CLIENT_ID || '(not set)'}`);
  console.log(`Client Secret:${maskSecret(CLIENT_SECRET)}`);
  console.log(`Redirect URI: ${REDIRECT_URI}`);
});
