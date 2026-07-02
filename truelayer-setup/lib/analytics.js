'use strict';

// ── Default category rules ────────────────────────────────────────────────────
// Each rule: { match: string|RegExp (applied to description/merchant_name, case-insensitive),
//             category: string }
// Rules are checked in order; first match wins.
// Users can add custom rules via categories.json and per-transaction overrides.

const DEFAULT_RULES = [
  // Income
  { match: /salary|payroll|wage|bacs credit/i,       category: 'Income' },
  { match: /interest paid|interest credit/i,         category: 'Income' },
  { match: /dividend/i,                              category: 'Income' },

  // Housing
  { match: /mortgage|rent |landlord/i,               category: 'Housing' },
  { match: /council tax|rates/i,                     category: 'Housing' },
  { match: /water|anglian|thames water|severn/i,     category: 'Housing' },
  { match: /gas|electricity|british gas|eon |edf|ovo energy|bulb/i, category: 'Utilities' },
  { match: /broadband|internet|virgin media|bt |sky |talktalk/i,    category: 'Utilities' },
  { match: /insurance/i,                             category: 'Insurance' },

  // Food & Drink
  { match: /tesco|sainsbury|asda|morrisons|waitrose|marks.*spencer|aldi|lidl|co-op|coop|ocado|iceland/i, category: 'Groceries' },
  { match: /mcdonald|burger king|kfc |subway |greggs|nando|pizza|domino|deliveroo|just.*eat|uber.*eat/i, category: 'Eating Out' },
  { match: /starbucks|costa coffee|caffe nero|pret /i, category: 'Coffee' },
  { match: /pub |bar |brewery|beer|wine|spirits|wetherspoon/i, category: 'Alcohol' },

  // Transport
  { match: /tfl |transport for london|london underground|oyster|national rail|trainline|avanti|gwr |tpe |lner /i, category: 'Public Transport' },
  { match: /uber |lyft |bolt |addison lee|black cab|taxi/i, category: 'Taxi' },
  { match: /petrol|fuel|bp |shell |esso |texaco/i,   category: 'Fuel' },
  { match: /parking|car park|ncp /i,                 category: 'Parking' },
  { match: /ryanair|easyjet|british airways|ba\.|heathrow|gatwick|stansted|luton airport|flight/i, category: 'Flights' },
  { match: /airbnb|hotel|travelodge|premier inn|hilton|marriott|booking\.com/i, category: 'Accommodation' },

  // Health
  { match: /pharmacy|chemist|boots |superdrug|lloyds pharmacy/i, category: 'Pharmacy' },
  { match: /dentist|dental/i,                        category: 'Dental' },
  { match: /doctor|gp |nhs |hospital|optician/i,    category: 'Healthcare' },
  { match: /gym|fitness|anytime fitness|pure gym|david lloyd|leisure centre/i, category: 'Fitness' },

  // Entertainment & Subscriptions
  { match: /netflix|disney\+|amazon prime|spotify|apple.*music|deezer|tidal/i, category: 'Subscriptions' },
  { match: /amazon|ebay|etsy|asos|next |h&m|primark|zara |john lewis|argos|currys/i, category: 'Shopping' },
  { match: /cinema|odeon|vue |cineworld|theatre|concert|eventbrite/i, category: 'Entertainment' },
  { match: /steam|playstation|xbox|nintendo|gaming/i, category: 'Gaming' },

  // Finance
  { match: /transfer to|transfer from|faster payment|standing order|direct debit/i, category: 'Transfers' },
  { match: /atm|cash withdrawal|cashpoint/i,         category: 'Cash' },
  { match: /paypal/i,                                category: 'PayPal' },
  { match: /credit card|card payment/i,             category: 'Credit Card' },
  { match: /monzo|starling|revolut|wise/i,           category: 'Transfers' },
];

const DEFAULT_CATEGORY = 'Uncategorised';

// ── Categorise a single transaction ──────────────────────────────────────────
function categorise(txn, customRules, overrides) {
  // 1. Per-transaction override wins
  if (overrides && overrides[txn.transaction_id]) {
    return overrides[txn.transaction_id];
  }

  const text = [
    txn.description || '',
    txn.merchant_name || '',
    txn.transaction_category || '',
  ].join(' ').toLowerCase();

  // 2. User custom rules (prefix match before defaults)
  if (customRules && customRules.length) {
    for (const rule of customRules) {
      const pattern = rule.match instanceof RegExp ? rule.match : new RegExp(rule.match, 'i');
      if (pattern.test(text)) return rule.category;
    }
  }

  // 3. Default rules
  for (const rule of DEFAULT_RULES) {
    if (rule.match.test(text)) return rule.category;
  }

  // 4. Fall back to TrueLayer's own category if set
  if (txn.transaction_category && txn.transaction_category !== 'GENERAL') {
    return txn.transaction_category
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  return DEFAULT_CATEGORY;
}

// ── Annotate a list of transactions with a `_category` field ─────────────────
function annotate(txns, customRules, overrides) {
  return txns.map(function(t) {
    return Object.assign({}, t, { _category: categorise(t, customRules, overrides) });
  });
}

// ── Monthly summary ───────────────────────────────────────────────────────────
// Returns array of { month: 'YYYY-MM', income: 0, expenses: 0, net: 0,
//                    byCategory: { Cat: { in: 0, out: 0, count: 0 } } }
function monthlySummary(txns) {
  const months = {};
  for (const t of txns) {
    const date = (t.timestamp || t.date || '').slice(0, 7);
    if (!date) continue;
    if (!months[date]) months[date] = { month: date, income: 0, expenses: 0, net: 0, byCategory: {} };
    const m = months[date];
    const cat = t._category || DEFAULT_CATEGORY;
    if (!m.byCategory[cat]) m.byCategory[cat] = { in: 0, out: 0, count: 0 };
    const c = m.byCategory[cat];
    if (t.amount >= 0) {
      m.income += t.amount;
      c.in     += t.amount;
    } else {
      m.expenses += Math.abs(t.amount);
      c.out      += Math.abs(t.amount);
    }
    c.count++;
    m.net += t.amount;
  }
  return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
}

// ── Category totals across a date range ──────────────────────────────────────
// Returns { Cat: { in: 0, out: 0, count: 0, net: 0 } }
function categoryTotals(txns) {
  const totals = {};
  for (const t of txns) {
    const cat = t._category || DEFAULT_CATEGORY;
    if (!totals[cat]) totals[cat] = { in: 0, out: 0, count: 0, net: 0 };
    const c = totals[cat];
    if (t.amount >= 0) c.in  += t.amount;
    else               c.out += Math.abs(t.amount);
    c.count++;
    c.net += t.amount;
  }
  return totals;
}

// ── Top merchants ─────────────────────────────────────────────────────────────
function topMerchants(txns, limit) {
  limit = limit || 10;
  const map = {};
  for (const t of txns) {
    if (t.amount >= 0) continue; // spending only
    const name = t.merchant_name || t.description || 'Unknown';
    if (!map[name]) map[name] = { name: name, total: 0, count: 0, category: t._category };
    map[name].total += Math.abs(t.amount);
    map[name].count++;
  }
  return Object.values(map)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

// ── Filter helpers ────────────────────────────────────────────────────────────
function filterByDateRange(txns, from, to) {
  return txns.filter(function(t) {
    const d = (t.timestamp || t.date || '').slice(0, 10);
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });
}

function filterByCategory(txns, categories) {
  if (!categories || !categories.length) return txns;
  const set = new Set(Array.isArray(categories) ? categories : [categories]);
  return txns.filter(function(t) { return set.has(t._category); });
}

function filterByDirection(txns, direction) {
  if (direction === 'in')  return txns.filter(t => t.amount >= 0);
  if (direction === 'out') return txns.filter(t => t.amount < 0);
  return txns;
}

module.exports = {
  categorise,
  annotate,
  monthlySummary,
  categoryTotals,
  topMerchants,
  filterByDateRange,
  filterByCategory,
  filterByDirection,
  DEFAULT_RULES,
  DEFAULT_CATEGORY,
};
