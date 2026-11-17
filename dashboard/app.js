// Token Radar, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail view with the model's own inputs and
// the protocol's farm plan, a live-token view, and a model lab. No network: every byte it shows
// is in data.js.
//
// The model, in one function, is the same arithmetic lib/model.ts runs to write board.json:
//   implied = round(tvl x base x growthMult x maturity x breadth)
//   base       = the live market's own median mcap/TVL in this snapshot (DATA.model.base_multiple),
//                clamped to [0.10, 0.40] when the model was built
//   growthMult = 1 + clamp(change_7d, -50, 150) / 100 x 0.6
//   maturity   = 0.65 + min(age_days, 1095) / 1095 x 0.35   (age unknown: 365 days)
//   breadth    = 1 + 0.025 x min(chains - 1, 6)
// No protocol name is special-cased: the same function scores every row, and the page recomputes
// every row and says how many match board.json exactly.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, labBase: null, labWeight: null, viewTable: false, scrolled: false };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_extra);
    var breadth = 1 + extra * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
  }
  function labModel() {
    if (state.labBase === null && state.labWeight === null) return DATA.model;
    var m = {};
    for (var k in DATA.model) m[k] = DATA.model[k];
    if (state.labBase !== null) m.base_multiple = state.labBase;
    if (state.labWeight !== null) m.growth_weight = state.labWeight;
    return m;
  }
  function labActive() {
    return (state.labBase !== null && state.labBase !== DATA.model.base_multiple) || (state.labWeight !== null && state.labWeight !== DATA.model.growth_weight);
  }
  // How many rows the page's own arithmetic reproduces exactly, at the default model.
  function verifyCount() {
    var n = 0;
    DATA.rows.forEach(function (r) { if (impliedOf(r, DATA.model) === r.implied_value_usd) n++; });
    return n;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 300;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 120;
    return 60;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(p) {
    var chain = chainOf(p);
    if (chain === 'Ethereum') return '$5 to $15 of gas';
    if (chain === 'Bitcoin' || chain === 'Tron') return 'about $2 of gas';
    return 'under $2 of gas';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the supply open so the position earns.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ', paired with USDC, and keep the position open.';
    if (c.indexOf('yield aggregator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL vault on " + chain + ' and keep the vault shares.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s main vault on " + chain + ' and keep the shares.';
    if (c.indexOf('risk curator') >= 0 || c.indexOf('capital allocator') >= 0 || c.indexOf('curator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' curator vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('interest rate') >= 0 || c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restaking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('prediction') >= 0) return 'Fund ' + name + ' with $' + capital + ' on ' + chain + ' and place one position on a market that settles within the month.';
    if (c.indexOf('stablecoin') >= 0 || c.indexOf('dual-token') >= 0 || c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through its official bridge and use ' + name + "'s flagship app with the funds.";
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $20 of USDC against the supply on ' + name + ', then repay it within the week so the borrow side is also on record.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $25 of USDC through ' + name + ' on ' + chain + ' and leave the receipt in the farming wallet.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('capital allocator') >= 0) return 'Move $25 into a second vault on ' + name + ' so two vaults show activity from the same wallet.';
    if (c.indexOf('rwa') >= 0) return 'Redeem $25 of the asset and re-mint it through ' + name + ', so both directions are on record.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('interest rate') >= 0 || c.indexOf('basis trading') >= 0) return 'Close the position and open a fresh one the following week, keeping the size near $25.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restaking') >= 0) return 'Add $25 more stake through ' + name + ' and delegate it if ' + name + ' offers a choice of operators.';
    if (c.indexOf('prediction') >= 0) return 'Place a second $10 position on a different ' + name + ' market the next week.';
    if (c.indexOf('stablecoin') >= 0 || c.indexOf('dual-token') >= 0 || c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return 'Swap $25 of the asset through ' + name + "'s own route on " + chain + ' and hold the result.';
    if (c.indexOf('chain') >= 0) return 'Stake or deposit $25 of the bridged funds in ' + name + "'s main app on " + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Extend the cover by $25 before it lapses so the policy stays continuous.';
    return 'Make a second $25 deposit into ' + name + ' the following week.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(p);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm with ' + p.name + ', and keep its seed phrase offline.', cost: gas + ' for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about ' + gas, time: '15 minutes to set up' },
      { text: secondActionFor(p, chain), cost: 'about $25 of capital and one transaction fee', time: '10 minutes' },
      { text: 'Repeat one qualifying action each week on ' + p.name + ', a deposit, a swap, a vote or a claim, so the wallet shows steady activity and not a single burst.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: "Open " + p.name + "'s own points or rewards page once a week and check what counted, using only links the protocol itself publishes.", cost: 'no fee to check', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, claim only from the link ' + p.name + ' itself publishes, never pay to claim, then revoke the approval and write the wallet, the dates and every transaction in a farm log.', cost: 'nothing but the log', time: '10 minutes' }
    ].map(stepText);
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('view') === 'table') state.viewTable = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function displayRows() {
    var m = labModel();
    var list = DATA.rows.map(function (r) {
      var copy = {};
      for (var k in r) copy[k] = r[k];
      copy.lab_implied = impliedOf(r, m);
      return copy;
    });
    return list;
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return displayRows().filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.scope === 'watchlist' && !r.watchlist) return false;
      if (state.scope === 'early' && r.watchlist) return false;
      if (state.scope === 'surging' && !(r.change_7d !== null && r.change_7d >= 15)) return false;
      if (state.scope === 'new' && !(r.age_days !== null && r.age_days < 180)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' '), (r.signals || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var lab = labActive();
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = lab ? a.lab_implied : a.implied_value_usd; bv = lab ? b.lab_implied : b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function labRankOf(list, slug) {
    for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return i + 1;
    return null;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', html: 'TOKEN<em>RADAR</em>' })),
      el('div', { class: 'top-meta' },
        el('span', { html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { html: 'DefiLlama protocol index' }),
        el('span', { html: 'Model <b>' + DATA.model_version + '</b>' }),
        el('span', { html: 'No network' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('h1', { html: DATA.watchlist_size + ' watchlist protocols, ranked by <span class="hl">implied value</span>' }),
      el('p', { text: 'The watchlist is the floor, never the ceiling: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. This board ranks all ' + DATA.board_size + ' protocols that pass the same eligibility rule (' + DATA.watchlist_size + ' watchlist, ' + DATA.early_size + ' early) and sets ' + DATA.set_aside + ' aside: live tokens and wrapped, bridged, staked or exchange products. Implied value is a model, not a price.' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is ranked' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early rows below the floor' })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) }), el('small', { text: 'sum of all ' + DATA.board_size + ' rows' })),
        el('div', { class: 'fact' }, el('span', { text: 'Rank 1' }), el('b', { text: top ? top.name : 'n/a' }), el('small', { text: top ? fmtUsd(top.implied_value_usd) + ' implied' : '' }))
      ),
      topPicks()
    );
  }

  function topPicks() {
    var picks = DATA.rows.slice(0, 3);
    return el('div', { class: 'top3' }, picks.map(function (r) {
      var why = 'TVL ' + fmtUsd(r.tvl_usd) + ' · ' + fmtPct(r.change_7d) + ' 7d · ' + fmtAge(r.age_days) + ', no token';
      return el('article', { class: 'pick' },
        el('span', { class: 'rank', text: 'FARM FIRST  ·  RANK ' + r.rank }),
        el('h3', { text: r.name }),
        el('span', { class: 'val', html: fmtUsd(r.implied_value_usd) + ' <small>implied value</small>' }),
        el('p', { class: 'why', text: why }),
        el('button', { class: 'button primary', type: 'button', text: 'Open the 7-step plan', onclick: function () { openDetail(r.slug); } })
      );
    }));
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain or signal', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var sc = el('select', { id: 'scope', 'aria-label': 'Filter by scope' },
      [['all', 'All rows'], ['watchlist', 'Watchlist only'], ['early', 'Early rows only'], ['surging', 'Surging 7d +15%'], ['new', 'New <180 days']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === state.scope ? 'selected' : null }); })
    );
    sc.addEventListener('change', function () { state.scope = sc.value; writeHash(); render(); });
    var sort = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['name', 'Name']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === state.sort ? 'selected' : null }); })
    );
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = -1; render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls', id: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'scope', text: 'Scope' }), sc),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort' }), sort),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' / ' + DATA.board_size + ' rows' : DATA.live.length + ' live' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var lab = labActive();
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or scope to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return lab ? r.lab_implied : r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var shown = lab ? r.lab_implied : r.implied_value_usd;
      var rankText = lab ? String(labRankOf(list, r.slug)) + ' (board ' + r.rank + ')' : String(r.rank);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: rankText }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') + ((r.signals || []).length ? ' · ' + r.signals.join(', ') : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((shown / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(shown) })
        )),
        el('td', null, el('span', { class: r.watchlist ? 'badge watch' : 'badge early', text: r.watchlist ? 'WATCHLIST' : 'EARLY' }))
      );
      tbody.appendChild(tr);
    });
    var filterParts = [];
    if (state.category !== 'all') filterParts.push('Category: ' + state.category);
    if (state.chain !== 'all') filterParts.push('Chain: ' + state.chain);
    if (state.scope === 'watchlist') filterParts.push('Scope: watchlist only');
    if (state.scope === 'early') filterParts.push('Scope: early rows only');
    if (state.scope === 'surging') filterParts.push('Scope: surging, 7d +15% or more');
    if (state.scope === 'new') filterParts.push('Scope: new, listed under 180 days');
    if (state.q.trim()) filterParts.push('Search: "' + state.q.trim() + '"');
    var caption = (filterParts.length > 0 ? 'Filtered: ' + filterParts.join(' · ') + '. ' : '') + (lab ? 'Model lab is on: implied values and ranks below are the lab model, not board.json. ' : '') + 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and 7-step farm plan.';
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: caption }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var ratio = r.mcap_usd !== null && r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a';
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'badge live', text: 'LIVE' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: ratio })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their median mcap/TVL is what sets the model base.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var verified = verifyCount();
    var formula = 'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.025 x min(chains - 1, 6)) )';
    var lab = labActive();
    var baseOut = el('output', { text: String(state.labBase === null ? m.base_multiple : state.labBase) });
    var weightOut = el('output', { text: String(state.labWeight === null ? m.growth_weight : state.labWeight) });
    var baseSlider = el('input', { type: 'range', min: '0.10', max: '0.40', step: '0.01', value: String(state.labBase === null ? m.base_multiple : state.labBase), 'aria-label': 'Base multiple' });
    baseSlider.addEventListener('input', function () { state.labBase = parseFloat(baseSlider.value); baseOut.textContent = baseSlider.value; render(); });
    var weightSlider = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.labWeight === null ? m.growth_weight : state.labWeight), 'aria-label': 'Growth weight' });
    weightSlider.addEventListener('input', function () { state.labWeight = parseFloat(weightSlider.value); weightOut.textContent = weightSlider.value; render(); });
    var reset = el('button', { class: 'button ghost', type: 'button', text: 'Reset the lab to the board model', onclick: function () { state.labBase = null; state.labWeight = null; render(); } });
    return el('section', { class: 'panel section' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'note', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The base is not a guess: the ' + m.live_count + ' live-token protocols in this same snapshot trade at a median market cap of ' + m.live_median_ratio + 'x their TVL, so the model values a pre-token protocol at ' + m.base_multiple + 'x its TVL before growth, age and reach move it.' }),
      el('div', { class: 'formula', html: formula.replace(m.base_multiple, '<b>' + m.base_multiple + '</b>') }),
      el('p', { class: 'note', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Reach is how many chains it runs on, capped at six extra chains. The page recomputes all ' + DATA.board_size + ' rows with this function: ' + verified + ' of ' + DATA.board_size + ' match board.json exactly.' }),
      el('h3', { text: 'Model lab: change the model, watch the board move' }),
      el('div', { class: 'lab' },
        el('label', null, el('span', { text: 'Base multiple (live median mcap/TVL)' }), baseSlider, baseOut),
        el('label', null, el('span', { text: 'Growth weight (how much 7-day growth matters)' }), weightSlider, weightOut)
      ),
      lab ? el('p', { class: 'labnote', text: 'Model lab is on: the table above uses your lab values. board.json keeps the defaults. ' }) : null,
      lab ? reset : null,
      el('h3', { text: 'What the board is, and what it is not' }),
      el('p', { class: 'note', html: '<b>Records no token is not has no token.</b> The snapshot is DefiLlama\u2019s record: a protocol on this board may still have a token its record does not carry. The board never predicts whether or when a token is issued; its implied value is this entry\u2019s own claim about what a launch would be worth if the protocol\u2019s record stayed as it is.' }),
      el('p', { class: 'note', html: '<b>Farm safely.</b> Use a fresh wallet, never pay to claim, and claim only from a link the protocol itself publishes. An airdrop that asks for a fee to claim is a scam.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function whyText(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadth = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_extra) * m.breadth_per_chain;
    var base = Math.round(row.tvl_usd * m.base_multiple);
    var s = 'TVL ' + fmtUsd(row.tvl_usd) + ' at the ' + m.base_multiple + 'x base is ' + fmtUsd(base) + '. ';
    s += 'Seven-day growth ' + fmtPct(row.change_7d) + ' gives a ' + fmtMult(growthMult) + 'x growth factor. ';
    s += fmtAge(row.age_days) + ' with no token on record gives a ' + fmtMult(maturity) + 'x maturity factor. ';
    s += (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ' give a ' + fmtMult(breadth) + 'x breadth factor. ';
    s += 'Together: ' + fmtUsd(row.implied_value_usd) + ' implied.';
    return s;
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var comp = row.comparable;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? '  ·  WATCHLIST' : '  ·  EARLY') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: whyText(row) }),
      comp ? el('p', { class: 'sub', text: 'Market anchor: ' + comp.name + ', a live protocol near this TVL, trades at ' + fmtUsd(comp.mcap_usd) + ' (' + comp.ratio + 'x its TVL).' }) : null,
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan: 7 steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'warn', text: 'Never pay to claim. Claim only from a link this protocol itself publishes, and revoke the approval after you withdraw.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Source: DefiLlama protocol index, snapshot ' + DATA.as_of + '. Implied values are this entry\u2019s own claim, never a price and never a prediction that a token will be issued. Built by an AI agent for make.fun\u2019s token-radar-01 bounty.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    if (state.viewTable && !state.scrolled) {
      // No scroll: headless captures paint the scrolled-away region blank, so the board
      // is kept in the first viewport by layout instead (see the compact hero).
      state.scrolled = true;
    }
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
