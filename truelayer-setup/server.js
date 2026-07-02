const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const PORT = process.env.PORT || 3099;

const REDIRECT_URI = process.env.REDIRECT_URI;
if (!REDIRECT_URI) {
  console.error('ERROR: REDIRECT_URI env var is not set.');
  process.exit(1);
}

const RAW_CLIENT_ID  = process.env.TRUELAYER_CLIENT_ID || '';
const CLIENT_SECRET  = process.env.TRUELAYER_CLIENT_SECRET || '';
const ACTUAL_URL     = process.env.ACTUAL_SERVER_URL || '';
const ACTUAL_PASS    = process.env.ACTUAL_SERVER_PASSWORD || '';
const SANDBOX = (process.env.TRUELAYER_ENV || '').toLowerCase() === 'sandbox';

const CLIENT_ID = SANDBOX && RAW_CLIENT_ID && !RAW_CLIENT_ID.startsWith('sandbox-')
  ? 'sandbox-' + RAW_CLIENT_ID
  : RAW_CLIENT_ID;

const AUTH_URL  = SANDBOX ? 'https://auth.truelayer-sandbox.com' : 'https://auth.truelayer.com';
const API_URL   = SANDBOX ? 'https://api.truelayer-sandbox.com'  : 'https://api.truelayer.com';
const PROVIDERS = SANDBOX ? 'uk-cs-mock' : 'uk-ob-all uk-oauth-all';

console.log('Mode:         ' + (SANDBOX ? 'SANDBOX' : 'LIVE'));
console.log('Client ID:    ' + (CLIENT_ID || '(not set)'));
console.log('Auth:         ' + AUTH_URL);
console.log('Redirect URI: ' + REDIRECT_URI);

const createStore = require('./lib/store');
const store = createStore({ DATA_DIR });
const {
  loadConfig, saveConfig,
  loadState, saveState,
  loadStoredTxns, mergeAndSaveTxns, loadStoredTxnCount,
  lastSyncedFor, relativeTime, uniqueConnName, buildRows,
} = store;

app.use('/', require('./routes/analytics')(store, loadConfig));

function maskSecret(s) {
  if (!s) return '(not set)';
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '...' + s.slice(-4);
}

async function getAccessToken(connName, connState) {
  const tokenRes = await fetch(AUTH_URL + '/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET, refresh_token: connState.refreshToken,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(tokenData));
  if (tokenData.refresh_token) {
    connState.refreshToken = tokenData.refresh_token;
    const state = loadState();
    if (state.connections[connName]) {
      state.connections[connName].refreshToken = tokenData.refresh_token;
      saveState(state);
    }
  }
  return tokenData.access_token;
}

const SHARED_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 960px; margin: 0 auto; padding: 24px 20px 60px; background: #f5f5f5; color: #1a1a1a; }
  h1 { margin: 0 0 4px; font-size: 1.4em; }
  h2 { font-size: 1.1em; margin: 0 0 12px; }
  a { color: #0066cc; }
  code { background: #eee; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; font-family: monospace; }
  pre { background: #f0f0f0; padding: 12px; border-radius: 4px; font-size: 0.88em; overflow-x: auto; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px 20px; margin: 10px 0; }
  .tag { display: inline-block; padding: 2px 9px; border-radius: 12px; font-size: 0.78em; font-weight: 600; background: #e8f0fe; color: #1a73e8; margin-left: 6px; vertical-align: middle; }
  .notice { padding: 11px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 0.9em; line-height: 1.6; }
  .notice.success { background: #e6f4ea; border-left: 4px solid #137333; color: #137333; }
  .notice.error   { background: #fce8e6; border-left: 4px solid #c5221f; color: #9b1c1c; }
  .notice.info    { background: #fef7e0; border-left: 4px solid #f9ab00; color: #7a5c00; }
  .notice.warn    { background: #fff8e1; border-left: 4px solid #e65100; color: #7a3800; }
  .btn { display: inline-block; padding: 7px 16px; border-radius: 5px; font-size: 0.88em; font-weight: 600; text-decoration: none; cursor: pointer; border: none; margin-right: 6px; }
  .btn-primary   { background: #0066cc; color: #fff; } .btn-primary:hover   { background: #0052a3; }
  .btn-secondary { background: #555;    color: #fff; } .btn-secondary:hover { background: #333; }
  .btn-danger    { background: #c5221f; color: #fff; } .btn-danger:hover    { background: #9b1c1c; }
  .btn-ghost     { background: #eee;    color: #333; } .btn-ghost:hover     { background: #ddd; }
  .btn-green     { background: #137333; color: #fff; } .btn-green:hover     { background: #0a5227; }
  .btn-orange    { background: #e65100; color: #fff; } .btn-orange:hover    { background: #bf360c; }
  .mode-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.8em; margin-left: 8px; vertical-align: middle; }
  .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:100; align-items:center; justify-content:center; }
  .modal-overlay.open { display:flex; }
  .modal { background:#fff; border-radius:10px; padding:24px 28px; max-width:420px; width:90%; box-shadow:0 8px 32px rgba(0,0,0,0.18); }
  .modal h3 { margin:0 0 10px; } .modal p { margin:0 0 20px; font-size:0.9em; color:#555; }
  .modal-actions { display:flex; gap:10px; justify-content:flex-end; }
  table.env-table { width:100%; border-collapse:collapse; font-size:0.88em; }
  table.env-table td { padding:5px 8px; }
  table.env-table td:first-child { font-weight:600; color:#555; width:140px; white-space:nowrap; }
  .security-banner { background:#fff3e0; border:1px solid #ff9800; border-radius:6px; padding:10px 14px; font-size:0.85em; color:#7a3800; margin-bottom:18px; line-height:1.6; }
  .security-banner strong { color:#e65100; }
  .last-synced { font-size:0.8em; color:#666; margin-top:4px; }
  .last-synced.overdue { color:#c5221f; font-weight:600; }
  .balance-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; margin-bottom:28px; }
  .balance-card { background:#fff; border:1px solid #ddd; border-radius:8px; padding:14px 18px; }
  .balance-card .acc-name { font-weight:600; font-size:0.95em; margin-bottom:2px; }
  .balance-card .acc-id   { font-size:0.75em; color:#888; margin-bottom:10px; font-family:monospace; }
  .balance-card .bal-row  { display:flex; justify-content:space-between; align-items:baseline; font-size:0.88em; margin-top:4px; }
  .balance-card .bal-label { color:#666; }
  .balance-card .bal-amount { font-weight:700; font-size:1.05em; }
  .balance-card .bal-amount.positive { color:#137333; }
  .balance-card .bal-amount.negative { color:#c5221f; }
  .txn-table { width:100%; border-collapse:collapse; font-size:0.85em; }
  .txn-table th { background:#f0f0f0; padding:8px 10px; border:1px solid #ddd; text-align:left; white-space:nowrap; }
  .txn-table td { padding:7px 10px; border:1px solid #eee; vertical-align:top; }
  .txn-table tr:hover td { background:#fafafa; }
  .txn-table .amt-credit { color:#137333; font-weight:600; text-align:right; white-space:nowrap; }
  .txn-table .amt-debit  { color:#c5221f; font-weight:600; text-align:right; white-space:nowrap; }
  .txn-table .amt-zero   { color:#888; text-align:right; white-space:nowrap; }
  .txn-section { margin-bottom:32px; }
  .txn-section h3 { font-size:1em; margin:0 0 8px; }
  .pending-badge { display:inline-block; padding:1px 7px; border-radius:10px; font-size:0.75em; font-weight:600; background:#fff3e0; color:#e65100; margin-left:6px; }
  .spinner { display:inline-block; width:18px; height:18px; border:3px solid #ccc; border-top-color:#0066cc; border-radius:50%; animation:spin 0.7s linear infinite; vertical-align:middle; margin-right:6px; }
  @keyframes spin { to { transform:rotate(360deg); } }
`;

function page(title, body) {
  return '<!DOCTYPE html><html lang="en">\n'
    + '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + '<title>' + title + ' \u2014 TrueLayer Setup</title>\n'
    + '<style>' + SHARED_CSS + '</style>\n'
    + '</head><body>' + body + '</body></html>';
}

const BALANCES_SCRIPT = `...`;

function renderMappingPage(name, conn, rows, notice) { return ''; }

app.get('/', function(req, res) {
  const config = loadConfig();
  const state  = loadState();
  const missingCreds    = !RAW_CLIENT_ID || !CLIENT_SECRET;
  const sandboxPrefixed = SANDBOX && RAW_CLIENT_ID && !RAW_CLIENT_ID.startsWith('sandbox-');

  const connCards = config.connections.length === 0
    ? '<p style="color:#888;font-size:0.9em">No connections yet.</p>'
    : config.connections.map(function(c) {
        const connState  = state.connections[c.name];
        const hasToken   = !!connState;
        const lastSynced = lastSyncedFor(connState);
        const rel        = relativeTime(lastSynced);
        const overdue    = lastSynced && (Date.now() - new Date(lastSynced).getTime()) > 6 * 60 * 60 * 1000;
        const storedTotal = c.accounts.reduce(function(sum, a) {
          return sum + loadStoredTxnCount(c.name, a.trueLayerId);
        }, 0);
        return '<div class="card">'
          + '<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px"><div>'
          + '<strong style="font-size:1.05em">' + c.name + '</strong>'
          + '<span class="tag">' + (c.isCard ? 'Credit Card' : 'Bank Account') + '</span>'
          + '<span class="tag" style="background:' + (hasToken ? '#e6f4ea' : '#fce8e6') + ';color:' + (hasToken ? '#137333' : '#c5221f') + '">'
          + (hasToken ? '\u2705 Authorised' : '\u26a0\ufe0f No token') + '</span>'
          + '<span class="tag">' + c.accounts.length + ' account' + (c.accounts.length !== 1 ? 's' : '') + ' mapped</span>'
          + (storedTotal > 0 ? '<span class="tag" style="background:#e8f5e9;color:#2e7d32">' + storedTotal + ' txns stored</span>' : '')
          + (rel
              ? '<div class="last-synced' + (overdue ? ' overdue' : '') + '">Last synced: ' + rel + (overdue ? ' \u2014 may be overdue' : '') + '</div>'
              : '<div class="last-synced">Not yet synced</div>')
          + '</div></div>'
          + '<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">'
          + '<a class="btn btn-secondary" href="/accounts/' + encodeURIComponent(c.name) + '">View / Map Accounts</a>'
          + '<a class="btn btn-green" href="/analytics?conn=' + encodeURIComponent(c.name) + '">\ud83d\udcca Analytics</a>'
          + (hasToken
              ? '<a class="btn btn-green" href="/balances/' + encodeURIComponent(c.name) + '">\ud83d\udcb0 Balances &amp; Transactions</a>'
              : '<a class="btn btn-primary" href="/reauth/' + encodeURIComponent(c.name) + '">\ud83d\udd12 Re-authorise</a>')
          + '<button class="btn btn-danger" onclick="confirmDelete(\'' + c.name.replace(/'/g, "\\'") + '\')">Remove</button>'
          + '</div></div>';
      }).join('');

  res.send(page('Home','<h1>\ud83c\udfe6 TrueLayer \u2192 Actual Budget</h1>' + connCards));
});

app.listen(PORT, function() {
  console.log('Setup UI running on http://0.0.0.0:' + PORT);
  console.log('Mode:          ' + (SANDBOX ? 'SANDBOX' : 'LIVE'));
  console.log('Client ID:     ' + (CLIENT_ID || '(not set)'));
  console.log('Client Secret: ' + maskSecret(CLIENT_SECRET));
  console.log('Redirect URI:  ' + REDIRECT_URI);
});
