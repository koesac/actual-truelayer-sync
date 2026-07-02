'use strict';

const express  = require('express');
const router   = express.Router();
const analytics = require('../lib/analytics');

// ── Route factory: inject store and config ────────────────────────────────────
// Called from server.js as: app.use('/', require('./routes/analytics')(store, loadConfig))

module.exports = function analyticsRoutes(store, loadConfig) {
  const {
    loadStoredTxns,
    loadCategoryRules, saveCategoryRules,
    loadCategoryOverrides, saveCategoryOverrides,
  } = store;

  // ── Helper: gather and annotate all stored transactions for a connection ───
  function gatherTxns(connName, conn, from, to, categories, direction) {
    let all = [];
    for (const acc of conn.accounts) {
      const raw = loadStoredTxns(connName, acc.trueLayerId);
      all = all.concat(raw);
    }
    const customRules = loadCategoryRules();
    const overrides   = loadCategoryOverrides();
    let txns = analytics.annotate(all, customRules, overrides);
    if (from || to)       txns = analytics.filterByDateRange(txns, from, to);
    if (categories)       txns = analytics.filterByCategory(txns, categories);
    if (direction)        txns = analytics.filterByDirection(txns, direction);
    txns.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    return txns;
  }

  // ── GET /analytics — full analytics dashboard page ────────────────────────
  router.get('/analytics', function(req, res) {
    const config = loadConfig();
    if (!config.connections.length) {
      return res.send(analyticsPage('No connections',
        '<div class="an-empty"><p>No bank connections yet. <a href="/">Add one first.</a></p></div>'));
    }
    // Render shell; data loads via /api/analytics
    const connOptions = config.connections
      .map(c => '<option value="' + encodeURIComponent(c.name) + '">' + c.name + '</option>')
      .join('');

    const body = `
<div class="an-toolbar">
  <div class="an-toolbar-left">
    <select id="connSelect">${connOptions}</select>
    <select id="rangeSelect">
      <option value="30">Last 30 days</option>
      <option value="90" selected>Last 90 days</option>
      <option value="180">Last 6 months</option>
      <option value="365">Last year</option>
      <option value="all">All time</option>
    </select>
    <select id="dirSelect">
      <option value="">All transactions</option>
      <option value="out">Spending only</option>
      <option value="in">Income only</option>
    </select>
  </div>
  <div class="an-toolbar-right">
    <button class="an-btn" id="loadBtn" onclick="loadAnalytics()">&#x27f3; Refresh</button>
  </div>
</div>

<div id="an-summary" class="an-summary-grid"></div>
<div id="an-cats"    class="an-section"></div>
<div id="an-months"  class="an-section"></div>
<div id="an-merchants" class="an-section"></div>
<div id="an-txns"    class="an-section"></div>

<script>
var CONN_SELECT  = document.getElementById('connSelect');
var RANGE_SELECT = document.getElementById('rangeSelect');
var DIR_SELECT   = document.getElementById('dirSelect');

function loadAnalytics() {
  var conn  = CONN_SELECT.value;
  var range = RANGE_SELECT.value;
  var dir   = DIR_SELECT.value;
  var url   = '/api/analytics/' + conn + '?range=' + range + (dir ? '&dir=' + dir : '');
  document.getElementById('an-summary').innerHTML   = skeleton(4);
  document.getElementById('an-cats').innerHTML      = '<div class="an-loading"><span class="spinner"></span> Loading\u2026</div>';
  document.getElementById('an-months').innerHTML    = '';
  document.getElementById('an-merchants').innerHTML = '';
  document.getElementById('an-txns').innerHTML      = '';
  fetch(url).then(r => r.json()).then(render).catch(err => {
    document.getElementById('an-cats').innerHTML = '<div class="an-error">\u26a0\ufe0f ' + err.message + '</div>';
  });
}

function skeleton(n) {
  var h = '';
  for (var i = 0; i < n; i++) h += '<div class="an-kpi an-skel"><div class="skel-line"></div><div class="skel-line skel-sm"></div></div>';
  return h;
}

function fmt(v, currency) {
  if (v == null) return '\u2014';
  var s = {'GBP':'\u00a3','EUR':'\u20ac','USD':'$'};
  var sym = (currency && s[currency]) ? s[currency] : '\u00a3';
  return sym + Math.abs(v).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function render(data) {
  renderSummary(data);
  renderCategories(data);
  renderMonths(data);
  renderMerchants(data);
  renderTxns(data);
}

function renderSummary(d) {
  var html =
    kpi('Total In',  fmt(d.totalIn),  '#137333') +
    kpi('Total Out', fmt(d.totalOut), '#c5221f') +
    kpi('Net',       (d.net >= 0 ? '+' : '') + fmt(d.net), d.net >= 0 ? '#137333' : '#c5221f') +
    kpi('Transactions', d.count, '#0066cc');
  document.getElementById('an-summary').innerHTML = html;
}

function kpi(label, value, color) {
  return '<div class="an-kpi"><div class="an-kpi-value" style="color:' + color + '">' + value + '</div><div class="an-kpi-label">' + label + '</div></div>';
}

function renderCategories(d) {
  var cats = Object.entries(d.byCategory || {}).sort((a,b) => b[1].out - a[1].out);
  if (!cats.length) { document.getElementById('an-cats').innerHTML = ''; return; }
  var maxOut = cats[0][1].out || 1;
  var rows = cats.map(function(entry) {
    var cat = entry[0]; var c = entry[1];
    var pct = Math.round((c.out / maxOut) * 100);
    return '<tr>'
      + '<td class="an-cat-name">' + cat + '</td>'
      + '<td class="an-bar-cell"><div class="an-bar" style="width:' + pct + '%"></div></td>'
      + '<td class="an-amt an-out">' + fmt(c.out) + '</td>'
      + '<td class="an-amt an-in">' + (c.in > 0 ? '+' + fmt(c.in) : '') + '</td>'
      + '<td class="an-count">' + c.count + '</td>'
      + '</tr>';
  }).join('');
  document.getElementById('an-cats').innerHTML =
    '<h2>Spending by Category</h2>'
    + '<div class="an-table-wrap"><table class="an-table">'
    + '<thead><tr><th>Category</th><th></th><th>Out</th><th>In</th><th>#</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

function renderMonths(d) {
  var months = (d.byMonth || []).slice().reverse();
  if (!months.length) { document.getElementById('an-months').innerHTML = ''; return; }
  var rows = months.map(function(m) {
    var netColor = m.net >= 0 ? '#137333' : '#c5221f';
    return '<tr>'
      + '<td>' + m.month + '</td>'
      + '<td class="an-amt an-in">+' + fmt(m.income) + '</td>'
      + '<td class="an-amt an-out">' + fmt(m.expenses) + '</td>'
      + '<td class="an-amt" style="color:' + netColor + ';font-weight:600">' + (m.net >= 0 ? '+' : '') + fmt(m.net) + '</td>'
      + '</tr>';
  }).join('');
  document.getElementById('an-months').innerHTML =
    '<h2>Monthly Breakdown</h2>'
    + '<div class="an-table-wrap"><table class="an-table">'
    + '<thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>Net</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

function renderMerchants(d) {
  var merchants = d.topMerchants || [];
  if (!merchants.length) { document.getElementById('an-merchants').innerHTML = ''; return; }
  var rows = merchants.map(function(m) {
    return '<tr><td>' + m.name + '</td><td class="an-cat-name">' + (m.category||'') + '</td>'
      + '<td class="an-amt an-out">' + fmt(m.total) + '</td>'
      + '<td class="an-count">' + m.count + '</td></tr>';
  }).join('');
  document.getElementById('an-merchants').innerHTML =
    '<h2>Top Merchants</h2>'
    + '<div class="an-table-wrap"><table class="an-table">'
    + '<thead><tr><th>Merchant</th><th>Category</th><th>Total Spent</th><th>#</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

function renderTxns(d) {
  var txns = d.transactions || [];
  if (!txns.length) { document.getElementById('an-txns').innerHTML = ''; return; }
  var rows = txns.slice(0, 200).map(function(t) {
    var date = (t.timestamp || t.date || '').slice(0,10);
    var desc = t.description || t.merchant_name || '\u2014';
    var amt  = t.amount != null ? ((t.amount >= 0 ? '+' : '') + fmt(t.amount)) : '\u2014';
    var cls  = t.amount >= 0 ? 'an-in' : 'an-out';
    return '<tr><td>' + date + '</td><td>' + desc + '</td>'
      + '<td class="an-cat-name">' + (t._category||'') + '</td>'
      + '<td class="an-amt ' + cls + '">' + amt + '</td></tr>';
  }).join('');
  document.getElementById('an-txns').innerHTML =
    '<h2>Transactions <span style="font-size:0.8em;color:#888;font-weight:400">(latest 200)</span></h2>'
    + '<div class="an-table-wrap"><table class="an-table">'
    + '<thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

CONN_SELECT.addEventListener('change', loadAnalytics);
RANGE_SELECT.addEventListener('change', loadAnalytics);
DIR_SELECT.addEventListener('change', loadAnalytics);
loadAnalytics();
</script>`;

    res.send(analyticsPage('Analytics', body));
  });

  // ── GET /api/analytics/:conn — JSON data ───────────────────────────────────
  router.get('/api/analytics/:conn', function(req, res) {
    const connName = decodeURIComponent(req.params.conn);
    const config   = loadConfig();
    const conn     = config.connections.find(c => c.name === connName);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });

    const range  = req.query.range || '90';
    const dir    = req.query.dir   || '';
    const cats   = req.query.cats  ? req.query.cats.split(',') : null;

    let from = null, to = new Date().toISOString().slice(0, 10);
    if (range !== 'all') {
      const days = parseInt(range, 10) || 90;
      from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    const txns   = gatherTxns(connName, conn, from, to, cats, dir);
    const totals = analytics.categoryTotals(txns);
    const months = analytics.monthlySummary(txns);
    const merchants = analytics.topMerchants(txns, 15);

    let totalIn = 0, totalOut = 0;
    for (const t of txns) {
      if (t.amount >= 0) totalIn  += t.amount;
      else               totalOut += Math.abs(t.amount);
    }

    res.json({
      connection: connName,
      from, to, range,
      count:      txns.length,
      totalIn:    Math.round(totalIn  * 100) / 100,
      totalOut:   Math.round(totalOut * 100) / 100,
      net:        Math.round((totalIn - totalOut) * 100) / 100,
      byCategory: totals,
      byMonth:    months,
      topMerchants: merchants,
      transactions: txns,
    });
  });

  // ── POST /api/category-rule — add a custom keyword rule ───────────────────
  // Body: { match: string, category: string }
  router.post('/api/category-rule', function(req, res) {
    const { match, category } = req.body;
    if (!match || !category) return res.status(400).json({ error: 'match and category required' });
    const rules = loadCategoryRules();
    rules.unshift({ match, category }); // prepend so user rules win
    saveCategoryRules(rules);
    res.json({ ok: true, rules });
  });

  // ── DELETE /api/category-rule — remove a rule by index ────────────────────
  router.delete('/api/category-rule/:index', function(req, res) {
    const idx   = parseInt(req.params.index, 10);
    const rules = loadCategoryRules();
    if (isNaN(idx) || idx < 0 || idx >= rules.length) return res.status(404).json({ error: 'Rule not found' });
    rules.splice(idx, 1);
    saveCategoryRules(rules);
    res.json({ ok: true, rules });
  });

  // ── POST /api/category-override — set category for a specific transaction ─
  // Body: { transaction_id: string, category: string }
  router.post('/api/category-override', function(req, res) {
    const { transaction_id, category } = req.body;
    if (!transaction_id || !category) return res.status(400).json({ error: 'transaction_id and category required' });
    const overrides = loadCategoryOverrides();
    overrides[transaction_id] = category;
    saveCategoryOverrides(overrides);
    res.json({ ok: true, transaction_id, category });
  });

  return router;
};

// ── Analytics page shell ──────────────────────────────────────────────────────
const AN_CSS = `
  .an-toolbar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:20px; }
  .an-toolbar-left  { display:flex; gap:10px; flex-wrap:wrap; }
  .an-toolbar select { padding:7px 10px; border:1px solid #ccc; border-radius:5px; font-size:0.88em; background:#fff; }
  .an-btn { padding:7px 16px; border-radius:5px; font-size:0.88em; font-weight:600; background:#0066cc; color:#fff; border:none; cursor:pointer; }
  .an-btn:hover { background:#0052a3; }
  .an-summary-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; margin-bottom:24px; }
  .an-kpi { background:#fff; border:1px solid #ddd; border-radius:8px; padding:14px 18px; }
  .an-kpi-value { font-size:1.5em; font-weight:700; margin-bottom:2px; }
  .an-kpi-label { font-size:0.8em; color:#666; }
  .an-skel { opacity:0.6; }
  .skel-line { height:1.4em; background:#eee; border-radius:4px; margin-bottom:6px; }
  .skel-sm   { width:60%; height:0.9em; }
  @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
  .an-skel .skel-line { background:linear-gradient(90deg,#eee 25%,#f7f7f7 50%,#eee 75%); background-size:200% 100%; animation:shimmer 1.4s ease-in-out infinite; }
  .an-section { margin-bottom:28px; }
  .an-section h2 { font-size:1em; margin:0 0 10px; }
  .an-loading { padding:24px; text-align:center; color:#666; }
  .an-error   { padding:12px 14px; background:#fce8e6; border-left:4px solid #c5221f; color:#9b1c1c; border-radius:4px; font-size:0.9em; }
  .an-empty   { padding:40px; text-align:center; color:#888; }
  .an-table-wrap { overflow-x:auto; }
  .an-table { width:100%; border-collapse:collapse; font-size:0.85em; }
  .an-table th { background:#f0f0f0; padding:8px 10px; border:1px solid #ddd; text-align:left; white-space:nowrap; }
  .an-table td { padding:7px 10px; border:1px solid #eee; vertical-align:middle; }
  .an-table tr:hover td { background:#fafafa; }
  .an-cat-name { color:#555; font-size:0.9em; }
  .an-bar-cell { width:180px; padding:7px 10px 7px 0; }
  .an-bar { height:12px; background:#0066cc22; border-radius:3px; min-width:2px; }
  .an-amt  { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .an-in   { color:#137333; font-weight:600; }
  .an-out  { color:#c5221f; font-weight:600; }
  .an-count { text-align:right; color:#888; }
`;

function analyticsPage(title, body) {
  const SHARED_CSS = `
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 0 auto; padding: 24px 20px 60px; background: #f5f5f5; color: #1a1a1a; }
    h1 { margin: 0 0 20px; font-size: 1.4em; }
    h2 { font-size: 1.1em; margin: 0 0 12px; }
    a  { color: #0066cc; }
    .spinner { display:inline-block; width:16px; height:16px; border:3px solid #ccc; border-top-color:#0066cc; border-radius:50%; animation:spin 0.7s linear infinite; vertical-align:middle; margin-right:6px; }
    @keyframes spin { to { transform:rotate(360deg); } }
  `;
  return '<!DOCTYPE html><html lang="en">\n'
    + '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + '<title>' + title + ' \u2014 TrueLayer Analytics</title>\n'
    + '<style>' + SHARED_CSS + AN_CSS + '</style>\n'
    + '</head><body>'
    + '<p style="margin:0 0 16px"><a href="/">\u2190 Home</a></p>'
    + '<h1>\ud83d\udcca Analytics</h1>'
    + body
    + '</body></html>';
}
