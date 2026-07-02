'use strict';

const fs   = require('fs');
const path = require('path');

module.exports = function createStore(options) {
  const DATA_DIR    = (options && options.DATA_DIR) || '/app/data';
  const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
  const STATE_PATH  = path.join(DATA_DIR, 'state.json');
  const TXN_DIR     = path.join(DATA_DIR, 'transactions');

  // ── Config ────────────────────────────────────────────────────────────────

  function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return { version: 2, connections: [] };
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
      if (!raw) return { version: 2, connections: [] };
      return JSON.parse(raw);
    } catch (e) {
      console.warn('config.json unreadable:', e.message);
      return { version: 2, connections: [] };
    }
  }

  function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  }

  // ── State ─────────────────────────────────────────────────────────────────

  function loadState() {
    if (!fs.existsSync(STATE_PATH)) return { connections: {} };
    try {
      const raw = fs.readFileSync(STATE_PATH, 'utf8').trim();
      if (!raw) return { connections: {} };
      return JSON.parse(raw);
    } catch (e) {
      console.warn('state.json unreadable:', e.message);
      return { connections: {} };
    }
  }

  function saveState(st) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
  }

  // ── Transaction store ─────────────────────────────────────────────────────

  function txnPath(connName, accountId) {
    const dir = path.join(TXN_DIR, connName.replace(/[^a-zA-Z0-9_-]/g, '_'));
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, accountId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
  }

  function loadStoredTxns(connName, accountId) {
    const p = txnPath(connName, accountId);
    if (!fs.existsSync(p)) return [];
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      console.warn('txn file unreadable:', p, e.message);
      return [];
    }
  }

  function mergeAndSaveTxns(connName, accountId, newTxns) {
    const existing = loadStoredTxns(connName, accountId);
    const byId = {};
    existing.forEach(function(t) {
      if (t.transaction_id) byId[t.transaction_id] = t;
    });
    let added = 0;
    newTxns.forEach(function(t) {
      if (!t.transaction_id || !byId[t.transaction_id]) {
        byId[t.transaction_id || ('_' + Math.random())] = t;
        added++;
      }
    });
    const merged = Object.values(byId);
    merged.sort(function(a, b) {
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    });
    fs.writeFileSync(txnPath(connName, accountId), JSON.stringify(merged, null, 2));
    return { total: merged.length, added: added };
  }

  function loadStoredTxnCount(connName, accountId) {
    return loadStoredTxns(connName, accountId).length;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function lastSyncedFor(connState) {
    if (!connState || !connState.accounts) return null;
    const dates = Object.values(connState.accounts)
      .map(function(a) { return a.lastSyncDate; })
      .filter(Boolean)
      .sort();
    return dates.length ? dates[dates.length - 1] : null;
  }

  function relativeTime(isoDate) {
    if (!isoDate) return null;
    const diffMs = Date.now() - new Date(isoDate).getTime();
    if (isNaN(diffMs)) return isoDate;
    const mins  = Math.floor(diffMs / 60000);
    const hours = Math.floor(mins / 60);
    const days  = Math.floor(hours / 24);
    if (mins  <  2) return 'just now';
    if (mins  < 60) return mins  + ' minute'  + (mins  !== 1 ? 's' : '') + ' ago';
    if (hours < 24) return hours + ' hour'    + (hours !== 1 ? 's' : '') + ' ago';
    if (days  < 30) return days  + ' day'     + (days  !== 1 ? 's' : '') + ' ago';
    return new Date(isoDate).toLocaleDateString();
  }

  function uniqueConnName(base, existingConnections) {
    const existing = new Set(existingConnections.map(function(c) { return c.name; }));
    if (!existing.has(base)) return base;
    let i = 2;
    while (existing.has(base + '-' + i)) i++;
    return base + '-' + i;
  }

  function buildRows(savedAccounts, liveAccounts) {
    if (liveAccounts) {
      const rows = liveAccounts.map(function(acc) {
        const saved = savedAccounts.find(function(a) { return a.trueLayerId === acc.account_id; });
        const defaultName = acc.display_name || acc.account_type || '';
        return {
          trueLayerId:  acc.account_id,
          displayName:  defaultName,
          actualId:     saved ? saved.actualId     : '',
          friendlyName: saved ? saved.friendlyName : defaultName,
          flip:         saved ? !!saved.flip        : false,
          stale:        false,
        };
      });
      savedAccounts.forEach(function(saved) {
        if (!liveAccounts.find(function(a) { return a.account_id === saved.trueLayerId; })) {
          rows.push({
            trueLayerId:  saved.trueLayerId,
            displayName:  saved.friendlyName || saved.trueLayerId,
            actualId:     saved.actualId,
            friendlyName: saved.friendlyName,
            flip:         !!saved.flip,
            stale:        true,
          });
        }
      });
      return rows;
    }
    if (savedAccounts.length === 0) return [];
    return savedAccounts.map(function(saved) {
      return {
        trueLayerId:  saved.trueLayerId,
        displayName:  saved.friendlyName || saved.trueLayerId,
        actualId:     saved.actualId,
        friendlyName: saved.friendlyName,
        flip:         !!saved.flip,
        stale:        false,
      };
    });
  }

  return {
    loadConfig,
    saveConfig,
    loadState,
    saveState,
    txnPath,
    loadStoredTxns,
    mergeAndSaveTxns,
    loadStoredTxnCount,
    lastSyncedFor,
    relativeTime,
    uniqueConnName,
    buildRows,
  };
};
