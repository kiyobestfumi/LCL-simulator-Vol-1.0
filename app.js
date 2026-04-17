// ── Supabase REST API（外部ライブラリ不要） ───────────────────
var SB_URL = 'https://rmrbdpurjlwgodrpphjp.supabase.co';
var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtcmJkcHVyamx3Z29kcnBwaGpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MzczMDQsImV4cCI6MjA5MTIxMzMwNH0.gk8nKhb_nZ-_kBcQ9Hm_pXCoLB3Kx7ydL_om1nI9eDc';

function sbHeaders() {
  return {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

async function sbGet(table, orderBy) {
  var url = SB_URL + '/rest/v1/' + table + '?select=*';
  if (orderBy) url += '&order=' + orderBy;
  try {
    var res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) return { data: [], error: { message: 'HTTP ' + res.status + ': ' + await res.text() } };
    var data = await res.json();
    return { data: data || [], error: null };
  } catch (e) {
    return { data: [], error: { message: e.message } };
  }
}

async function sbInsert(table, row) {
  var res = await fetch(SB_URL + '/rest/v1/' + table, {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify(row)
  });
  var data = null;
  try { data = await res.json(); } catch(e){}
  return { data: data, error: res.ok ? null : { message: String(data) } };
}

async function sbUpdate(table, id, row) {
  var res = await fetch(SB_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(row)
  });
  var data = null;
  try { data = await res.json(); } catch(e){}
  return { data: data, error: res.ok ? null : { message: String(data) } };
}

async function sbDelete(table, id) {
  var res = await fetch(SB_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE', headers: sbHeaders()
  });
  return { error: res.ok ? null : { message: 'HTTP ' + res.status } };
}

// ── State ─────────────────────────────────────────────────────
var customers = [], allCosts = [], tsRates = [], agentRates = [];
var carriers = [];
// 積み地別・コンテナ別コストマスター
var selT20 = null, selT40 = null;  // 東京用
var selK20 = null, selK40 = null;  // 神戸用
var selB20 = null, selB40 = null;  // パターンB用
// 後方互換用エイリアス（autoFillCntr等で参照）
var sel20 = null, sel40 = null;
var selAgent = null;
var rowSeq = 0;

// ── Helpers ───────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function nv(v) {
  if (v == null) return 0;
  return parseFloat(String(v).replace(/,/g, '')) || 0;
}

function fmt(v, dec) {
  dec = dec || 0;
  var n = parseFloat(String(v).replace(/,/g, ''));
  if (isNaN(n)) return '0';
  return n.toLocaleString('ja-JP', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtY(v) { return fmt(v) + '円'; }

window.fmtI = function(el) {
  var r = el.value.replace(/,/g, '');
  if (r === '' || r === '-') return;
  var n = parseFloat(r);
  if (!isNaN(n)) el.value = fmt(n, r.indexOf('.') >= 0 ? 2 : 0);
};

function toast(msg, type) {
  var t = $('toast');
  t.textContent = msg;
  t.className = type || 'ok';
  setTimeout(function() { t.className = ''; }, 2800);
}

function dr(label, val, cls) {
  var c = cls ? ' ' + cls : '';
  return '<div class="dr' + c + '"><span class="dl">' + label + '</span><span class="dv">' + val + '</span></div>';
}

function baseInfo(origin) {
  var o = (origin || '').toUpperCase();
  if (o.indexOf('TOKYO') >= 0 || o.indexOf('TYO') >= 0) return { label: '東京', tagCls: 't-tag', simBase: '東京' };
  if (o.indexOf('KOBE') >= 0 || o.indexOf('UKB') >= 0)  return { label: '神戸', tagCls: 'k-tag', simBase: '神戸' };
  return { label: origin || '-', tagCls: '', simBase: '東京' };
}

// ── Navigation ────────────────────────────────────────────────
window.showPage = function(id) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nb').forEach(function(b) { b.classList.remove('active'); });
  $('page-' + id).classList.add('active');
  var idx = { sim: 0, cust: 1, cost: 2 }[id];
  if (idx !== undefined) document.querySelectorAll('.nb')[idx].classList.add('active');
  if (id === 'cust') renderCustTable();
  if (id === 'cost') { renderCostTable(); renderAgentTable(); }
};

// ── Load ──────────────────────────────────────────────────────
async function loadAll() {
  $('dot').className = 'dot spin';
  $('conn-lbl').textContent = '接続中...';

  var tables = [
    { name: 'customers',   order: 'name' },
    { name: 'cost_master', order: 'carrier,container_type' },
    { name: 'ts_rates',    order: 'destination' },
    { name: 'agent_rates', order: 'agent_name,destination' }
  ];

  var results = {};
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    $('conn-lbl').textContent = '読込中: ' + t.name + '...';
    var r = await sbGet(t.name, t.order);
    if (r.error) {
      $('dot').className = 'dot err';
      $('conn-lbl').textContent = 'エラー [' + t.name + ']: ' + r.error.message;
      return;
    }
    results[t.name] = r.data;
  }

  customers  = results['customers'];
  allCosts   = results['cost_master'];
  tsRates    = results['ts_rates'];
  agentRates = results['agent_rates'];
  carriers   = [...new Set(allCosts.map(function(r) { return r.carrier; }))];
  var agentNames = [...new Set(agentRates.map(function(r) { return r.agent_name; }))];

  $('dot').className = 'dot ok';
  $('conn-lbl').textContent = '接続済 — 顧客' + customers.length + '件 / 船社' + carriers.length + '社 / AGENT ' + agentNames.length + '社 / 仕向地' + tsRates.length + '港';

  // 積み地別船社セレクト更新（東京・神戸・パターンB）
  var selIds = ['sim-carrier-t', 'sim-carrier-k', 'sim-carrier-b'];
  var selLabels = ['東京', '神戸', 'Pat.B'];
  selIds.forEach(function(selId, i) {
    var el = $(selId); if (!el) return;
    var prev = el.value;
    el.innerHTML = '<option value="">-- ' + selLabels[i] + ' 選択 --</option>';
    carriers.forEach(function(c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      el.appendChild(o);
    });
    if (prev && carriers.indexOf(prev) >= 0) el.value = prev;
    else if (carriers.length) el.value = carriers[0];
  });
  onCarrierChange();

  // AGENTセレクト
  var prevA = $('sim-agent').value;
  $('sim-agent').innerHTML = '<option value="">-- なし --</option>';
  agentNames.forEach(function(n) {
    var o = document.createElement('option');
    o.value = n; o.textContent = n;
    $('sim-agent').appendChild(o);
  });
  if (prevA && agentNames.indexOf(prevA) >= 0) { $('sim-agent').value = prevA; onAgentChange(); }
  else selAgent = null;

  // 既存行の顧客セレクト更新
  document.querySelectorAll('.row-cust-sel').forEach(function(sel) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">-- 選択 --</option>';
    customers.forEach(function(c) {
      var bi = baseInfo(c.origin);
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.name + '（' + bi.label + '）';
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  });

  calc();
}

// ── 船社変更（積み地別） ──────────────────────────────────────
window.onCarrierChange = function() {
  var cT = $('sim-carrier-t') ? $('sim-carrier-t').value : '';
  var cK = $('sim-carrier-k') ? $('sim-carrier-k').value : '';
  var cB = $('sim-carrier-b') ? $('sim-carrier-b').value : '';

  selT20 = null; selT40 = null;
  selK20 = null; selK40 = null;
  selB20 = null; selB40 = null;

  allCosts.forEach(function(r) {
    if (r.carrier === cT && r.container_type === '20FT') selT20 = r;
    if (r.carrier === cT && r.container_type === '40HC') selT40 = r;
    if (r.carrier === cK && r.container_type === '20FT') selK20 = r;
    if (r.carrier === cK && r.container_type === '40HC') selK40 = r;
    if (r.carrier === cB && r.container_type === '20FT') selB20 = r;
    if (r.carrier === cB && r.container_type === '40HC') selB40 = r;
  });

  // 後方互換エイリアス（autoFillCntr等で参照）
  sel20 = selT20 || selB20;
  sel40 = selT40 || selB40;

  // VANNING・ラッシング → 東京は東京船社、神戸は神戸船社から反映
  if (selT20) {
    $('van-tokyo').value = fmt(nv(selT20.vanning_tokyo_jpy) || 2800);
  }
  if (selK20) {
    $('van-kobe').value = fmt(nv(selK20.vanning_kobe_jpy) || 2600);
    $('lashing').value  = fmt(nv(selK20.lashing_jpy) || 6000);
  }

  // 各セレクトの情報バッジ更新
  function badgeInfo(c20, c40, elId) {
    var el = $(elId); if (!el) return;
    if (!c20 && !c40) { el.textContent = ''; return; }
    var parts = [];
    if (c20) parts.push('20FT: O/F $' + fmt(c20.ocean_freight) + (nv(c20.refund_per_rt) ? ' REF$' + fmt(c20.refund_per_rt) : ''));
    if (c40) parts.push('40HC: O/F $' + fmt(c40.ocean_freight) + (nv(c40.refund_per_rt) ? ' REF$' + fmt(c40.refund_per_rt) : ''));
    el.textContent = parts.join(' / ');
  }
  badgeInfo(selT20, selT40, 'carrier-info-t');
  badgeInfo(selK20, selK40, 'carrier-info-k');
  badgeInfo(selB20, selB40, 'carrier-info-b');

  calc();
};

// ── AGENT変更 ─────────────────────────────────────────────────
window.onAgentChange = function() {
  var name = $('sim-agent').value;
  if (!name) { selAgent = null; $('agent-info').innerHTML = ''; calc(); return; }
  var rates = agentRates.filter(function(r) { return r.agent_name === name; });
  selAgent = { name: name, rates: rates };
  var items = rates.map(function(r) {
    var dest = r.destination === 'ALL' ? '全仕向地' : r.destination;
    var parts = [];
    if (nv(r.ts_cost_usd))  parts.push('T/S $' + fmt(r.ts_cost_usd, 2) + '/m³');
    if (nv(r.fixed_usd))    parts.push('固定 $' + fmt(r.fixed_usd, 2) + '/BL');
    if (nv(r.handling_jpy)) parts.push('取扱 ¥' + fmt(r.handling_jpy));
    return '<span style="font-size:11px;background:var(--purple-bg);color:var(--purple);padding:2px 8px;border-radius:4px">' + dest + ': ' + (parts.join(' / ') || '費用なし') + '</span>';
  }).join(' ');
  $('agent-info').innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center"><b style="font-size:11px;color:var(--purple)">' + name + '</b> ' + items + '</div>';
  calc();
};

// ── OLT チェックボックス ──────────────────────────────────────
window.onOltChk = function() {
  [['olt-chk-4','olt-4-card'], ['olt-chk-10','olt-10-card'], ['olt-chk-10z','olt-10z-card']].forEach(function(pair) {
    var chk = $(pair[0]), card = $(pair[1]);
    if (!chk || !card) return;
    card.style.borderColor = chk.checked ? 'var(--blue)' : 'var(--brd)';
    card.style.background  = chk.checked ? 'var(--blue-bg)' : 'var(--sur)';
  });
  calc();
};

function calcOLT(kobeM3) {
  if (kobeM3 <= 0) return { truck: 0, desc: 'なし' };
  var chk4   = $('olt-chk-4')   && $('olt-chk-4').checked;
  var chk10  = $('olt-chk-10')  && $('olt-chk-10').checked;
  var chk10z = $('olt-chk-10z') && $('olt-chk-10z').checked;
  if (!chk4 && !chk10 && !chk10z) return { truck: 0, desc: '手配なし' };
  var truck = 0, lines = [];
  if (chk4)   { truck += nv($('olt-tr4').value);   lines.push('4t¥' + fmt(nv($('olt-tr4').value)));   }
  if (chk10)  { truck += nv($('olt-tr10').value);  lines.push('10t¥' + fmt(nv($('olt-tr10').value)));  }
  if (chk10z) { truck += nv($('olt-tr10z').value); lines.push('増t¥' + fmt(nv($('olt-tr10z').value))); }
  return { truck: truck, desc: lines.join(' + ') };
}

// ── コンテナコスト（本数指定版） ──────────────────────────────
function ctByUnits(units, m3, C, fx, eurRate, isKobe) {
  if (!C || units <= 0) return { total: 0, of: 0, fix: 0, van: 0, lash: 0, sur: 0 };
  var ofJPY   = (nv(C.ocean_freight) + nv(C.baf_ees_efs)) * fx;
  var fixJPY  = nv(C.thc_etc) + nv(C.doc_fee) + nv(C.seal_fee) + nv(C.cml_fee);
  var vanRate = isKobe ? nv($('van-kobe').value) : nv($('van-tokyo').value);
  var vanMin  = isKobe ? 10 : (C.container_type === '40HC' ? 26 : 13);
  var van     = Math.max(m3 / units, vanMin) * units * vanRate;
  var lash    = isKobe ? units * nv($('lashing').value) : 0;
  var surUSD  = nv(C.ens_usd) + nv(C.csl_usd) + nv(C.ecc_usd) + nv(C.stf_usd) + nv(C.efl_usd);
  var surEUR  = nv(C.ees_eur);
  var sur     = (surUSD * fx + surEUR * nv($('sim-eur').value)) * units;
  return { total: (ofJPY + fixJPY) * units + van + lash + sur, of: ofJPY * units, fix: fixJPY * units, van: van, lash: lash, sur: sur, units: units };
}

// ── T/Sコスト（ts_ratesベース） ───────────────────────────────
function rowTsCost(r, fx) {
  if (!r.tsApply || !r.tsRate) return 0;
  var tariff = nv(r.tsRate.ts_tariff);
  if (tariff === 0) return 0;
  var raw = r.vol * tariff;
  if (tariff > 0) return Math.max(raw, nv(r.tsRate.ts_min)) * fx;
  return raw * fx; // 割引
}

// ── REFUND（コンテナタイプ別・T/S物量を除外） ─────────────────
// m3: 対象物量, tsM3: T/S物量（比例按分で除外）, C: cost_master行, fx: 為替
function calcRefundForCntr(m3, tsM3Total, totalM3, C, fx) {
  if (!C || m3 <= 0) return 0;
  // T/S物量を全体比率で按分除外
  var tsExclude = totalM3 > 0 ? tsM3Total * (m3 / totalM3) : 0;
  var refM3 = Math.max(0, m3 - tsExclude);
  return refM3 * nv(C.refund_per_rt) * fx;
}

// ── 自動計算でパネルを埋める ──────────────────────────────────
window.autoFillCntr = function() {
  var rows = getRows();
  // 東京用cap・神戸用cap・パターンB用cap をそれぞれの船社から取得
  var capT20 = nv(selT20 ? selT20.cap_m3 : (sel20 ? sel20.cap_m3 : 0)) || 25;
  var capT40 = nv(selT40 ? selT40.cap_m3 : (sel40 ? sel40.cap_m3 : 0)) || 50;
  var capK20 = nv(selK20 ? selK20.cap_m3 : (sel20 ? sel20.cap_m3 : 0)) || 25;
  var capK40 = nv(selK40 ? selK40.cap_m3 : (sel40 ? sel40.cap_m3 : 0)) || 50;
  var capB20 = nv(selB20 ? selB20.cap_m3 : (sel20 ? sel20.cap_m3 : 0)) || 25;
  var capB40 = nv(selB40 ? selB40.cap_m3 : (sel40 ? sel40.cap_m3 : 0)) || 50;
  var tRows = rows.filter(function(r) { return r.base === '東京'; });
  var kRows = rows.filter(function(r) { return r.base === '神戸'; });
  var tT20 = tRows.filter(function(r) { return r.eCntr === '20FT'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var tT40 = tRows.filter(function(r) { return r.eCntr === '40HC'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var kT20 = kRows.filter(function(r) { return r.eCntr === '20FT'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var kT40 = kRows.filter(function(r) { return r.eCntr === '40HC'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var allM = rows.reduce(function(s, r) { return s + r.vol; }, 0);
  $('ca-t20').value = tT20 > 0 ? Math.ceil(tT20 / capT20) : 0;
  $('ca-t40').value = tT40 > 0 ? Math.ceil(tT40 / capT40) : 0;
  $('ca-k20').value = kT20 > 0 ? Math.ceil(kT20 / capK20) : 0;
  $('ca-k40').value = kT40 > 0 ? Math.ceil(kT40 / capK40) : 0;
  $('cb-20').value  = 0;
  $('cb-40').value  = allM > 0 ? Math.ceil(allM / capB40) : 0;
  calc();
};

// ── Row Management ────────────────────────────────────────────
window.addRow = function(d) {
  d = d || {};
  var id = ++rowSeq;
  var tr = document.createElement('tr');
  tr.id = 'row-' + id; tr.dataset.rid = id;

  var custOpts = '<option value="">-- 選択 --</option>';
  customers.forEach(function(c) {
    var bi = baseInfo(c.origin);
    custOpts += '<option value="' + c.id + '">' + c.name + '（' + bi.label + '）</option>';
  });

  var destOpts = '<option value="RTM">RTM</option>';
  tsRates.forEach(function(t) {
    var tariff = nv(t.ts_tariff);
    var label = t.destination;
    if (tariff > 0)      label += '(+$' + t.ts_tariff + '/m³)';
    else if (tariff < 0) label += '(割引$' + t.ts_tariff + ')';
    else                 label += '($0)';
    destOpts += '<option value="' + t.destination + '">' + label + '</option>';
  });

  var rv = function(k, fb) { fb = fb || 0; var n = nv(d[k] != null ? d[k] : fb); return fmt(n, n % 1 !== 0 ? 2 : 0); };

  tr.innerHTML =
    '<td><select class="ri ri-sel row-cust-sel" onchange="onRowCust(' + id + ',this)">' + custOpts + '</select></td>' +
    '<td><select class="ri ri-base" id="rb-base-' + id + '" onchange="calc()"><option value="東京">東京</option><option value="神戸">神戸</option></select></td>' +
    '<td><input class="ri ri-sm" id="rb-vol-' + id + '" type="text" value="' + rv('vol', 10) + '" oninput="fmtI(this);onVolChange(' + id + ')"></td>' +
    '<td><select class="ri ri-dest" id="rb-dest-' + id + '" onchange="onDestChange(' + id + ')">' + destOpts + '</select><div id="rb-ts-disp-' + id + '" style="font-size:9px;color:var(--purple);margin-top:1px"></div></td>' +
    '<td style="text-align:center;background:var(--purple-bg)"><select class="ri" id="rb-cntr-' + id + '" onchange="calc()" style="font-size:11px;font-family:var(--sans);min-width:65px;background:var(--purple-bg);border-color:var(--purple-brd);color:var(--purple);font-weight:600"><option value="auto">自動</option><option value="20FT">20FT</option><option value="40HC">40HC</option></select><div id="rb-cntr-auto-' + id + '" style="font-size:9px;color:var(--tx3);margin-top:1px"></div></td>' +
    '<td><input class="ri ri-sm" id="rb-of-' + id + '" type="text" value="' + rv('of_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-lss-' + id + '" type="text" value="' + rv('lss_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-pss-' + id + '" type="text" value="' + rv('pss_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-efs-' + id + '" type="text" value="' + rv('efs_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-ics-' + id + '" type="text" value="' + rv('ics_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-cfs-' + id + '" type="text" value="' + rv('cfs_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-thc-' + id + '" type="text" value="' + rv('thc_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-drs-' + id + '" type="text" value="' + rv('drs_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td style="border-left:1px solid var(--acc-brd)"><input class="ri ri-sm" id="rb-bl-' + id + '" type="text" value="' + rv('bl_fee_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-decl-' + id + '" type="text" value="' + rv('customs_declaration_jpy') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-chand-' + id + '" type="text" value="' + rv('customs_handling_jpy') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-ot-' + id + '" type="text" value="' + rv('other_fee') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-ds-' + id + '" type="text" value="' + rv('oversea_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-dc-' + id + '" type="text" value="' + rv('oversea_cost') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td><input class="ri ri-sm" id="rb-nstku-' + id + '" type="text" value="0" oninput="fmtI(this);calc()" placeholder="単価"></td>' +
    '<td><input class="ri ri-sm" id="rb-nstkq-' + id + '" type="text" value="0" oninput="fmtI(this);calc()" placeholder="個数" style="min-width:38px"></td>' +
    '<td><input class="ri ri-sm" id="rb-pltu-' + id + '" type="text" value="0" oninput="fmtI(this);calc()" placeholder="単価"></td>' +
    '<td><input class="ri ri-sm" id="rb-pltq-' + id + '" type="text" value="0" oninput="fmtI(this);calc()" placeholder="個数" style="min-width:38px"></td>' +
    '<td><input class="ri ri-sm" id="rb-ts-' + id + '" type="text" value="' + rv('ts_sell') + '" oninput="this.classList.add(\'edited\');calc()"></td>' +
    '<td style="text-align:center"><input type="checkbox" id="rb-tschk-' + id + '" onchange="onTsChk(' + id + ')" style="width:15px;height:15px;accent-color:var(--purple)"><div id="rb-tsauto-' + id + '" style="font-size:9px;color:var(--purple)"></div></td>' +
    '<td><button class="del-row" onclick="delRow(' + id + ')">✕</button></td>';

  $('row-body').appendChild(tr);
  if (d.simBase) $('rb-base-' + id).value = d.simBase;
};

window.delRow = function(id) {
  var t = $('row-' + id);
  if (t) t.remove();
  calc();
};

window.onTsChk = function(id) {
  var chk = $('rb-tschk-' + id);
  $('row-' + id).classList.toggle('ts-row', chk.checked);
  calc();
};

window.onDestChange = function(id) {
  var dest = $('rb-dest-' + id) ? $('rb-dest-' + id).value : 'RTM';
  var chk  = $('rb-tschk-' + id);
  var disp = $('rb-ts-disp-' + id);
  var auto = $('rb-tsauto-' + id);
  if (dest === 'RTM') {
    if (chk) chk.checked = false;
    $('row-' + id).classList.remove('ts-row');
    if (disp) disp.textContent = '';
    if (auto) auto.textContent = '';
  } else {
    var rate = null;
    tsRates.forEach(function(t) { if (t.destination === dest) rate = t; });
    if (chk) chk.checked = true;
    $('row-' + id).classList.add('ts-row');
    if (auto) auto.textContent = '自動ON';
    if (rate && disp) {
      var tariff = nv(rate.ts_tariff);
      if (tariff > 0)      disp.textContent = 'コスト +$' + rate.ts_tariff + '/m³' + (rate.ts_min ? ' min$' + rate.ts_min : '');
      else if (tariff < 0) disp.textContent = '割引 $' + rate.ts_tariff + '/m³';
      else                 disp.textContent = '$0';
    }
  }
  calc();
};

window.onVolChange = function(id) {
  fmtI($('rb-vol-' + id));
  var vol = nv($('rb-vol-' + id) ? $('rb-vol-' + id).value : 0);
  var cntrSel = $('rb-cntr-' + id);
  var autoLbl = $('rb-cntr-auto-' + id);
  if (cntrSel && cntrSel.value === 'auto' && autoLbl) {
    autoLbl.textContent = vol > 25 ? '→40HC' : '→20FT';
  }
  calc();
};

window.onRowCust = function(id, sel) {
  var c = null;
  customers.forEach(function(x) { if (x.id === sel.value) c = x; });
  if (!c) return;
  function s(f, v) {
    var el = $('rb-' + f + '-' + id);
    if (!el) return;
    var n = nv(v); el.value = fmt(n, n % 1 !== 0 ? 2 : 0);
    el.classList.remove('edited');
  }
  s('of', c.of_sell); s('lss', c.lss_sell); s('pss', c.pss_sell);
  s('efs', c.efs_sell); s('ics', c.ics_sell);
  s('cfs', c.cfs_sell); s('thc', c.thc_sell); s('drs', c.drs_sell);
  s('bl', c.bl_fee_sell); s('decl', c.customs_declaration_jpy);
  s('chand', c.customs_handling_jpy); s('ot', c.other_fee);
  s('ds', c.oversea_sell); s('dc', c.oversea_cost); s('ts', c.ts_sell);
  var bi = baseInfo(c.origin);
  $('rb-base-' + id).value = bi.simBase;
  var destSel = $('rb-dest-' + id);
  if (destSel) { destSel.value = c.destination || 'RTM'; onDestChange(id); return; }
  calc();
};

function getRows() {
  var rows = [];
  document.querySelectorAll('#row-body tr').forEach(function(tr) {
    var id = tr.dataset.rid;
    var g = function(f) { var el = $('rb-' + f + '-' + id); return el ? nv(el.value) : 0; };
    var custId = '';
    var custSel = tr.querySelector('.row-cust-sel');
    if (custSel) custId = custSel.value;
    var custName = '（未選択）';
    if (custId) {
      customers.forEach(function(c) { if (c.id === custId) custName = c.name; });
    }
    var vol = g('vol');
    var cntrEl = $('rb-cntr-' + id);
    var cntrOv = cntrEl ? cntrEl.value : 'auto';
    var eCntr  = cntrOv === 'auto' ? (vol > 25 ? '40HC' : '20FT') : cntrOv;
    var dest   = $('rb-dest-' + id) ? $('rb-dest-' + id).value : 'RTM';
    var tsRate = null;
    if (dest !== 'RTM') tsRates.forEach(function(t) { if (t.destination === dest) tsRate = t; });
    var tsApply = $('rb-tschk-' + id) ? $('rb-tschk-' + id).checked : false;
    rows.push({
      id: id, custName: custName,
      base: $('rb-base-' + id) ? $('rb-base-' + id).value : '東京',
      vol: vol, eCntr: eCntr,
      of: g('of'), lss: g('lss'), pss: g('pss'), efs: g('efs'), ics: g('ics'),
      cfs: g('cfs'), thc: g('thc'), drs: g('drs'),
      bl: g('bl'), decl: g('decl'), chand: g('chand'), ot: g('ot'),
      ds: g('ds'), dc: g('dc'),
      nstkCost: g('nstku') * g('nstkq'), pltCost: g('pltu') * g('pltq'),
      ts: g('ts'), tsApply: tsApply, dest: dest, tsRate: tsRate
    });
  });
  return rows;
}

function rowRev(r, fx) {
  return (r.of + r.lss + r.pss + r.efs + r.ics) * r.vol * fx
       + (r.tsApply ? r.ts * r.vol * fx : 0)
       + (r.cfs + r.thc + r.drs) * r.vol
       + r.bl + r.decl + r.chand + r.ot
       + r.ds * fx;
}

// ── Main Calc ─────────────────────────────────────────────────
window.calc = function() {
  var rows = getRows();
  var fx  = nv($('sim-fx').value);
  var eur = nv($('sim-eur').value);

  var tRows = rows.filter(function(r) { return r.base === '東京'; });
  var kRows = rows.filter(function(r) { return r.base === '神戸'; });
  var tM = tRows.reduce(function(s, r) { return s + r.vol; }, 0);
  var kM = kRows.reduce(function(s, r) { return s + r.vol; }, 0);
  var allM = tM + kM;
  var tsM  = rows.filter(function(r) { return r.tsApply; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var refM = Math.max(0, allM - tsM);

  // コンテナ自動判定ラベル
  rows.forEach(function(r) {
    var lbl = $('rb-cntr-auto-' + r.id);
    var sel = $('rb-cntr-' + r.id);
    if (lbl && sel && sel.value === 'auto') lbl.textContent = r.vol > 25 ? '→40HC' : '→20FT';
  });

  // OLT
  var olt = calcOLT(kM);
  var oltDisp   = $('olt-total-disp');
  var oltDetail = $('olt-detail-disp');
  if (oltDisp)   oltDisp.textContent   = kM > 0 ? fmt(olt.truck) + '円' : '¥0（神戸貨物なし）';
  if (oltDetail) oltDetail.textContent = kM > 0 && olt.truck > 0 ? olt.desc : (kM > 0 ? '手配なし' : '');

  // 東京・神戸・パターンB それぞれ最低1つ選択されているかチェック
  var hasT = selT20 || selT40;
  var hasK = selK20 || selK40;
  var hasB = selB20 || selB40;
  if ((!hasT && !hasK) || !hasB || !rows.length) {
    $('result-card').style.display = 'none';
    $('sum-bar').style.display = 'none';
    return;
  }

  var totalRev  = rows.reduce(function(s, r) { return s + rowRev(r, fx); }, 0);
  var totalDel  = rows.reduce(function(s, r) { return s + r.dc * fx; }, 0);
  var totalMisc = rows.reduce(function(s, r) { return s + r.nstkCost + r.pltCost; }, 0);
  var totalTs   = rows.reduce(function(s, r) { return s + rowTsCost(r, fx); }, 0);

  // AGENTコスト
  var agentCost = 0;
  if (selAgent) {
    rows.forEach(function(r) {
      var rate = null;
      selAgent.rates.forEach(function(a) { if (a.destination === r.dest) rate = a; });
      if (!rate) selAgent.rates.forEach(function(a) { if (a.destination === 'ALL') rate = a; });
      if (!rate) return;
      agentCost += (nv(rate.ts_cost_usd) * r.vol + nv(rate.fixed_usd)) * fx + nv(rate.handling_jpy);
    });
  }

  // パネル本数
  var caT20 = Math.max(0, parseInt($('ca-t20').value) || 0);
  var caT40 = Math.max(0, parseInt($('ca-t40').value) || 0);
  var caK20 = Math.max(0, parseInt($('ca-k20').value) || 0);
  var caK40 = Math.max(0, parseInt($('ca-k40').value) || 0);
  var cbN20 = Math.max(0, parseInt($('cb-20').value)  || 0);
  var cbN40 = Math.max(0, parseInt($('cb-40').value)  || 0);

  // パターンA：東京は東京船社、神戸は神戸船社を使用
  var cAT20 = ctByUnits(caT20, tM, selT20, fx, eur, false);
  var cAT40 = ctByUnits(caT40, tM, selT40, fx, eur, false);
  var cAK20 = ctByUnits(caK20, kM, selK20, fx, eur, true);
  var cAK40 = ctByUnits(caK40, kM, selK40, fx, eur, true);

  // パターンAの物量按分（コンテナタイプ別にREFUNDを計算）
  // 東京: 20FT/40HC キャパシティで按分、神戸も同様
  var cap20 = nv(selT20 ? selT20.cap_m3 : (selK20 ? selK20.cap_m3 : 0)) || 25;
  var cap40 = nv(selT40 ? selT40.cap_m3 : (selK40 ? selK40.cap_m3 : 0)) || 50;
  var tM20 = caT20 > 0 && (caT20 + caT40 > 0) ? tM * caT20*cap20 / (caT20*cap20 + caT40*cap40 || 1) : (caT40 === 0 ? tM : 0);
  var tM40 = caT40 > 0 && (caT20 + caT40 > 0) ? tM * caT40*cap40 / (caT20*cap20 + caT40*cap40 || 1) : (caT20 === 0 ? tM : 0);
  var kM20 = caK20 > 0 && (caK20 + caK40 > 0) ? kM * caK20*cap20 / (caK20*cap20 + caK40*cap40 || 1) : (caK40 === 0 ? kM : 0);
  var kM40 = caK40 > 0 && (caK20 + caK40 > 0) ? kM * caK40*cap40 / (caK20*cap20 + caK40*cap40 || 1) : (caK20 === 0 ? kM : 0);

  var refAT20 = calcRefundForCntr(tM20, tsM, allM, selT20, fx);
  var refAT40 = calcRefundForCntr(tM40, tsM, allM, selT40, fx);
  var refAK20 = calcRefundForCntr(kM20, tsM, allM, selK20, fx);
  var refAK40 = calcRefundForCntr(kM40, tsM, allM, selK40, fx);
  var refA = refAT20 + refAT40 + refAK20 + refAK40;

  var costA = cAT20.total + cAT40.total + cAK20.total + cAK40.total + totalTs + agentCost + totalDel + totalMisc;
  var profA = totalRev - costA + refA;

  // パターンB：パターンB専用船社を使用
  var cap20B = nv(selB20 ? selB20.cap_m3 : 0) || 25;
  var cap40B = nv(selB40 ? selB40.cap_m3 : 0) || 50;
  var cBT20 = ctByUnits(cbN20, allM, selB20, fx, eur, false);
  var cBT40 = ctByUnits(cbN40, allM, selB40, fx, eur, false);

  // パターンBの物量按分（パターンB船社のcapで計算）
  var bM20 = cbN20 > 0 && (cbN20 + cbN40 > 0) ? allM * cbN20*cap20B / (cbN20*cap20B + cbN40*cap40B || 1) : (cbN40 === 0 ? allM : 0);
  var bM40 = cbN40 > 0 && (cbN20 + cbN40 > 0) ? allM * cbN40*cap40B / (cbN20*cap20B + cbN40*cap40B || 1) : (cbN20 === 0 ? allM : 0);

  var refBT20 = calcRefundForCntr(bM20, tsM, allM, selB20, fx);
  var refBT40 = calcRefundForCntr(bM40, tsM, allM, selB40, fx);
  var refB = refBT20 + refBT40;

  var costB = cBT20.total + cBT40.total + olt.truck + totalTs + agentCost + totalDel + totalMisc;
  var profB = totalRev - costB + refB;

  // パターンA表示用cap（東京船社基準）
  var cap20 = nv(selT20 ? selT20.cap_m3 : selK20 ? selK20.cap_m3 : 0) || 25;
  var cap40 = nv(selT40 ? selT40.cap_m3 : selK40 ? selK40.cap_m3 : 0) || 50;

  // パネルメモ
  var tCarrier = ($('sim-carrier-t') ? $('sim-carrier-t').value : '') || '?';
  var kCarrier = ($('sim-carrier-k') ? $('sim-carrier-k').value : '') || '?';
  var bCarrier = ($('sim-carrier-b') ? $('sim-carrier-b').value : '') || '?';
  if ($('ca-note')) $('ca-note').textContent = '東京(' + tCarrier + '):20FT×' + caT20 + ' / 40HC×' + caT40 + '　神戸(' + kCarrier + '):20FT×' + caK20 + ' / 40HC×' + caK40 + '　総物量' + fmt(allM,1) + 'm³';
  if ($('cb-note')) $('cb-note').textContent = bCarrier + ': 20FT×' + cbN20 + '(max' + fmt(cbN20*cap20B) + 'm³) + 40HC×' + cbN40 + '(max' + fmt(cbN40*cap40B) + 'm³) / 総物量' + fmt(allM,1) + 'm³';

  // サマリー
  $('sv-t').textContent   = fmt(tM,1) + 'm³';
  $('sv-k').textContent   = fmt(kM,1) + 'm³';
  $('sv-all').textContent = fmt(allM,1) + 'm³';
  $('sv-ts').textContent  = fmt(tsM,1) + 'm³';
  $('sv-rv').textContent  = fmt(refM,1) + 'm³';
  $('sv-rev').textContent = fmtY(totalRev);
  $('sv-ref').textContent = fmtY(Math.max(refA, refB));
  if (agentCost !== 0) { $('sv-ag-wrap').style.display=''; $('sv-ag').textContent=fmtY(agentCost); }
  else                 { $('sv-ag-wrap').style.display='none'; }
  var spa = $('sv-pa'); spa.textContent = fmtY(profA); spa.className = 'sv ' + (profA >= 0 ? 'pos' : 'neg');
  var spb = $('sv-pb'); spb.textContent = fmtY(profB); spb.className = 'sv ' + (profB >= 0 ? 'pos' : 'neg');
  $('sum-bar').style.display = 'flex';

  // ── 詳細A：コンテナ別コスト内訳 ──────────────────────────────
  var dA = [];

  // コンテナ別内訳ヘルパー
  function cntrBlock(label, units, ct, refund, refRate, bgColor, m3ForRefund, tsExcluded) {
    if (units <= 0) return '';
    var lines = [];
    lines.push('<div style="margin-bottom:.5rem;background:' + bgColor + ';border-radius:6px;padding:.55rem .8rem">');
    lines.push('<div style="font-size:10px;font-weight:700;color:var(--tx2);margin-bottom:.3rem;text-transform:uppercase">' + label + '</div>');
    lines.push(dr('O/F+BAF', fmtY(ct.of)));
    lines.push(dr('固定費（THC/DOC/SEAL/CML）', fmtY(ct.fix)));
    lines.push(dr('VANNING', fmtY(ct.van)));
    if (ct.lash > 0) lines.push(dr('ラッシング', fmtY(ct.lash)));
    if (ct.sur > 0)  lines.push(dr('追加サーチャージ', fmtY(ct.sur)));
    lines.push('<div class="divider"></div>');
    lines.push(dr('<b>コンテナコスト計</b>', '<b>' + fmtY(ct.total) + '</b>'));
    if (refund > 0) {
      var refM3Actual = Math.max(0, m3ForRefund - tsExcluded);
      var refLabel = 'REFUND ($' + fmt(refRate,2) + '/RT × ' + fmt(refM3Actual,1) + 'm³' + (tsExcluded > 0 ? '  ※T/S除外' : '') + ')';
      lines.push(dr(refLabel, fmtY(refund), 'ref'));
    }
    lines.push('</div>');
    return lines.join('');
  }

  // T/S按分除外量（各物量に対応）
  var tsAT20 = allM > 0 ? tsM * (tM20 / allM) : 0;
  var tsAT40 = allM > 0 ? tsM * (tM40 / allM) : 0;
  var tsAK20 = allM > 0 ? tsM * (kM20 / allM) : 0;
  var tsAK40 = allM > 0 ? tsM * (kM40 / allM) : 0;
  var tsBT20 = allM > 0 ? tsM * (bM20 / allM) : 0;
  var tsBT40 = allM > 0 ? tsM * (bM40 / allM) : 0;

  dA.push(cntrBlock('東京 20FT × ' + caT20 + '本 [' + tCarrier + ']', caT20, cAT20, refAT20, nv(selT20 ? selT20.refund_per_rt : 0), '#F0F5FF', tM20, tsAT20));
  dA.push(cntrBlock('東京 40HC × ' + caT40 + '本 [' + tCarrier + ']', caT40, cAT40, refAT40, nv(selT40 ? selT40.refund_per_rt : 0), '#EAF5FF', tM40, tsAT40));
  dA.push(cntrBlock('神戸 20FT × ' + caK20 + '本 [' + kCarrier + ']', caK20, cAK20, refAK20, nv(selK20 ? selK20.refund_per_rt : 0), '#FFF0F0', kM20, tsAK20));
  dA.push(cntrBlock('神戸 40HC × ' + caK40 + '本 [' + kCarrier + ']', caK40, cAK40, refAK40, nv(selK40 ? selK40.refund_per_rt : 0), '#FFE8E8', kM40, tsAK40));

  var surA = cAT20.sur + cAT40.sur + cAK20.sur + cAK40.sur;
  if (totalTs > 0)    dA.push(dr('T/Sコスト（仕向地別）', fmtY(totalTs), 'tsc'));
  if (totalTs < 0)    dA.push(dr('T/S割引', fmtY(totalTs), 'ref'));
  if (agentCost !== 0) dA.push(dr('AGENTコスト（' + (selAgent ? selAgent.name : '') + '）', fmtY(agentCost), 'tsc'));
  if (totalMisc > 0)  dA.push(dr('段積不可/パレタイズ', fmtY(totalMisc)));
  dA.push(dr('現地Delivery合計', fmtY(totalDel)));

  // パターンA 損益サマリー
  dA.push('<div style="margin-top:.6rem;background:var(--sur2);border-radius:8px;padding:.65rem .9rem">');
  dA.push('<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">');
  dA.push('<div><div style="font-size:10px;color:var(--tx2)">総売上</div><div style="font-family:var(--mono);font-weight:600">' + fmtY(totalRev) + '</div></div>');
  dA.push('<div><div style="font-size:10px;color:var(--tx2)">総コスト</div><div style="font-family:var(--mono);font-weight:600">' + fmtY(costA) + '</div></div>');
  dA.push('<div><div style="font-size:10px;color:var(--tx2)">REFUND合計</div><div style="font-family:var(--mono);font-weight:600;color:var(--amber)">' + fmtY(refA) + '</div></div>');
  dA.push('</div>');
  dA.push('<div style="margin-top:.4rem;padding-top:.4rem;border-top:1px solid var(--brd);font-size:10px;color:var(--tx3)">');
  var r20T = nv(selT20 ? selT20.refund_per_rt : 0);
  var r40T = nv(selT40 ? selT40.refund_per_rt : 0);
  var r20K = nv(selK20 ? selK20.refund_per_rt : 0);
  var r40K = nv(selK40 ? selK40.refund_per_rt : 0);
  dA.push('20FT REFUND: 東京$' + fmt(r20T,2) + '×' + fmt(tM20,1) + 'm³ + 神戸$' + fmt(r20K,2) + '×' + fmt(kM20,1) + 'm³　40HC REFUND: 東京$' + fmt(r40T,2) + '×' + fmt(tM40,1) + 'm³ + 神戸$' + fmt(r40K,2) + '×' + fmt(kM40,1) + 'm³（T/S除外後）');
  dA.push('</div></div>');
  $('det-a').innerHTML = dA.join('');

  // ── 詳細B：コンテナ別コスト内訳 ──────────────────────────────
  var dB = [];
  dB.push(cntrBlock('20FT × ' + cbN20 + '本 [' + bCarrier + ']（東京合算）', cbN20, cBT20, refBT20, nv(selB20 ? selB20.refund_per_rt : 0), '#F0F5FF', bM20, tsBT20));
  dB.push(cntrBlock('40HC × ' + cbN40 + '本 [' + bCarrier + ']（東京合算）', cbN40, cBT40, refBT40, nv(selB40 ? selB40.refund_per_rt : 0), '#EAF5FF', bM40, tsBT40));

  if (totalTs > 0)    dB.push(dr('T/Sコスト（仕向地別）', fmtY(totalTs), 'tsc'));
  if (totalTs < 0)    dB.push(dr('T/S割引', fmtY(totalTs), 'ref'));
  if (agentCost !== 0) dB.push(dr('AGENTコスト（' + (selAgent ? selAgent.name : '') + '）', fmtY(agentCost), 'tsc'));
  dB.push('<div class="divider"></div>');
  dB.push(kM > 0 ? (olt.truck > 0 ? dr('OLT トラック（' + olt.desc + '）', fmtY(olt.truck), 'olt') : dr('OLT', '手配なし', 'olt')) : dr('OLT', 'なし', 'olt'));
  if (totalMisc > 0) dB.push(dr('段積不可/パレタイズ', fmtY(totalMisc)));
  dB.push(dr('現地Delivery合計', fmtY(totalDel)));

  // パターンB 損益サマリー
  dB.push('<div style="margin-top:.6rem;background:var(--sur2);border-radius:8px;padding:.65rem .9rem">');
  dB.push('<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">');
  dB.push('<div><div style="font-size:10px;color:var(--tx2)">総売上</div><div style="font-family:var(--mono);font-weight:600">' + fmtY(totalRev) + '</div></div>');
  dB.push('<div><div style="font-size:10px;color:var(--tx2)">総コスト</div><div style="font-family:var(--mono);font-weight:600">' + fmtY(costB) + '</div></div>');
  dB.push('<div><div style="font-size:10px;color:var(--tx2)">REFUND合計</div><div style="font-family:var(--mono);font-weight:600;color:var(--amber)">' + fmtY(refB) + '</div></div>');
  dB.push('</div>');
  dB.push('<div style="margin-top:.4rem;padding-top:.4rem;border-top:1px solid var(--brd);font-size:10px;color:var(--tx3)">');
  var r20B = nv(selB20 ? selB20.refund_per_rt : 0);
  var r40B = nv(selB40 ? selB40.refund_per_rt : 0);
  dB.push('REFUND: 20FT $' + fmt(r20B,2) + '×' + fmt(bM20,1) + 'm³ + 40HC $' + fmt(r40B,2) + '×' + fmt(bM40,1) + 'm³（T/S除外後）[' + bCarrier + ']');
  dB.push('</div></div>');
  $('det-b').innerHTML = dB.join('');

  // 顧客内訳
  var cbHtml = rows.map(function(r) {
    var rev = rowRev(r, fx);
    var tsCost = rowTsCost(r, fx);
    var bi = baseInfo(r.base === '東京' ? 'TOKYO' : 'KOBE');
    var tsTag  = r.tsApply ? '<span style="font-size:9px;background:var(--purple-bg);color:var(--purple);padding:1px 5px;border-radius:3px">' + r.dest + '</span>' : '';
    var cTag   = '<span style="font-size:9px;background:var(--purple-bg);color:var(--purple);padding:1px 4px;border-radius:3px">' + r.eCntr + '</span>';
    var tsNote = tsCost !== 0 ? '<br><span style="color:var(--purple);font-size:10px">T/S ' + fmtY(tsCost) + '</span>' : '';
    return '<div class="cb-row"><span class="cb-name">' + r.custName + ' ' + tsTag + ' ' + cTag + '</span><span class="cb-tag ' + bi.tagCls + '">' + bi.label + '</span><span class="cb-vol">' + fmt(r.vol,1) + 'm³</span><span class="cb-sell">' + fmtY(rev) + tsNote + '</span></div>';
  }).join('');
  $('cb-a').innerHTML = cbHtml;
  $('cb-b').innerHTML = cbHtml;

  // rsub
  if ($('rsub-a')) $('rsub-a').textContent = '東京: 20FT×' + caT20 + ' / 40HC×' + caT40 + '　神戸: 20FT×' + caK20 + ' / 40HC×' + caK40;
  if ($('rsub-b')) $('rsub-b').textContent = '20FT×' + cbN20 + ' / 40HC×' + cbN40 + '（OLT込み）';

  ['a','b'].forEach(function(p) {
    var prof = p === 'a' ? profA : profB;
    var cost = p === 'a' ? costA : costB;
    $('rv-' + p).textContent = fmtY(totalRev);
    $('co-' + p).textContent = fmtY(cost);
    var ep = $('pr-' + p); ep.textContent = fmtY(prof); ep.className = 'mv ' + (prof >= 0 ? 'pos' : 'neg');
    $('badge-' + p).innerHTML = '';
    $('rc-' + p).classList.remove('winner');
  });

  var diff = Math.abs(profA - profB);
  var html = '';
  if (profA > profB) {
    $('badge-a').innerHTML = '<span class="wbadge">推奨</span>'; $('rc-a').classList.add('winner');
    html = '<div class="cbox ok"><p>✅ <strong>パターンA が有利</strong>（差額：' + fmtY(diff) + '）<br>REFUND ' + fmtY(refA) + (totalTs !== 0 ? ' / T/S ' + fmtY(totalTs) : '') + '</p></div>';
  } else if (profB > profA) {
    $('badge-b').innerHTML = '<span class="wbadge">推奨</span>'; $('rc-b').classList.add('winner');
    html = '<div class="cbox ok"><p>✅ <strong>パターンB が有利</strong>（差額：' + fmtY(diff) + '）<br>REFUND ' + fmtY(refB) + (totalTs !== 0 ? ' / T/S ' + fmtY(totalTs) : '') + '</p></div>';
  } else {
    html = '<div class="cbox ok"><p>⚖️ パターンA・Bは同等の利益です。</p></div>';
  }
  $('concl').innerHTML = html;
  $('result-card').style.display = 'block';
};

// ── 顧客マスター CRUD ─────────────────────────────────────────
function renderCustTable() {
  var tb = $('ctb');
  if (!customers.length) { tb.innerHTML = '<tr><td colspan="19" class="loading">顧客が登録されていません</td></tr>'; return; }
  tb.innerHTML = customers.map(function(c) {
    var bi = baseInfo(c.origin);
    var dest = c.destination || 'RTM';
    var tsRate = null; tsRates.forEach(function(t) { if (t.destination === dest) tsRate = t; });
    var destBadge = dest === 'RTM'
      ? '<span style="font-size:10px;background:var(--sur2);color:var(--tx2);padding:1px 6px;border-radius:3px">RTM</span>'
      : '<span style="font-size:10px;background:var(--purple-bg);color:var(--purple);padding:1px 6px;border-radius:3px">' + dest + (tsRate ? ' $' + tsRate.ts_tariff + '/m³' : '') + '</span>';
    return '<tr><td><strong>' + c.name + '</strong></td><td><span class="tag ' + bi.tagCls + '">' + bi.label + '</span></td><td>' + destBadge + '</td>' +
      '<td>' + fmt(c.of_sell,2) + '</td><td>' + fmt(c.lss_sell,2) + '</td><td>' + fmt(c.pss_sell,2) + '</td><td>' + fmt(c.efs_sell,2) + '</td><td>' + fmt(c.ts_sell,2) + '</td><td>' + fmt(c.ics_sell,2) + '</td>' +
      '<td>' + fmt(c.cfs_sell) + '</td><td>' + fmt(c.thc_sell) + '</td><td>' + fmt(c.drs_sell) + '</td>' +
      '<td>' + fmt(c.bl_fee_sell) + '</td><td>' + fmt(c.customs_declaration_jpy) + '</td><td>' + fmt(c.customs_handling_jpy) + '</td><td>' + fmt(c.other_fee) + '</td>' +
      '<td>$' + fmt(c.oversea_sell,2) + '</td><td>$' + fmt(c.oversea_cost,2) + '</td>' +
      '<td style="white-space:nowrap"><button class="btn btn-sm" style="margin-right:4px" onclick="editCust(\'' + c.id + '\')">編集</button><button class="delbtn" onclick="delCust(\'' + c.id + '\')">削除</button></td></tr>';
  }).join('');
}

window.openCM = function(c) {
  c = c || null;
  $('cm-title').textContent = c ? '顧客を編集' : '顧客を追加';
  $('cm-id').value = c ? c.id : '';
  $('cm-name').value = c ? c.name : '';
  $('cm-base').value = c ? (c.origin || 'TOKYO') : 'TOKYO';
  var dsel = $('cm-dest');
  dsel.innerHTML = '<option value="RTM">RTM（T/Sなし）</option>';
  tsRates.forEach(function(t) {
    var tariff = nv(t.ts_tariff);
    var label = t.destination + (tariff > 0 ? ' (+$' + t.ts_tariff + '/m²)' : tariff < 0 ? ' (割引$' + t.ts_tariff + ')' : ' ($0)');
    dsel.innerHTML += '<option value="' + t.destination + '">' + label + '</option>';
  });
  dsel.value = c ? (c.destination || 'RTM') : 'RTM';
  dsel.onchange = function() {
    var r = null; tsRates.forEach(function(t) { if (t.destination === dsel.value) r = t; });
    var tariff = r ? nv(r.ts_tariff) : 0;
    var info = '';
    if (r && tariff > 0)      info = 'T/S +$' + r.ts_tariff + '/m³' + (r.ts_min ? ' min$' + r.ts_min : '') + '（T/S自動適用）';
    else if (r && tariff < 0) info = 'T/S割引 $' + r.ts_tariff + '/m³';
    else if (r)                info = 'T/S追加コストなし';
    $('cm-dest-info').textContent = info;
  };
  dsel.dispatchEvent(new Event('change'));
  var fields = [['cm-of', c && c.of_sell], ['cm-lss', c && c.lss_sell], ['cm-pss', c && c.pss_sell],
    ['cm-efs', c && c.efs_sell], ['cm-ts', c && c.ts_sell], ['cm-ics', c && c.ics_sell],
    ['cm-cfs', c && c.cfs_sell], ['cm-thc', c && c.thc_sell], ['cm-drs', c && c.drs_sell],
    ['cm-bl', c && c.bl_fee_sell], ['cm-decl', c && c.customs_declaration_jpy],
    ['cm-chand', c && c.customs_handling_jpy], ['cm-other', c && c.other_fee],
    ['cm-del-sell', c && c.oversea_sell], ['cm-del-cost', c && c.oversea_cost]];
  fields.forEach(function(f) { var el = $(f[0]); if (!el) return; var n = nv(f[1]); el.value = fmt(n, n % 1 !== 0 ? 2 : 0); });
  $('cm-modal').style.display = 'block';
};
window.closeCM = function() { $('cm-modal').style.display = 'none'; };
window.editCust = function(id) { customers.forEach(function(c) { if (c.id === id) openCM(c); }); };
window.saveCust = async function() {
  var name = $('cm-name').value.trim();
  if (!name) { toast('顧客名を入力してください', 'err'); return; }
  var g = function(id) { return nv($(id).value); };
  var row = { name: name, origin: $('cm-base').value, destination: $('cm-dest').value,
    of_sell: g('cm-of'), lss_sell: g('cm-lss'), pss_sell: g('cm-pss'),
    efs_sell: g('cm-efs'), ts_sell: g('cm-ts'), ics_sell: g('cm-ics'),
    cfs_sell: g('cm-cfs'), thc_sell: g('cm-thc'), drs_sell: g('cm-drs'),
    bl_fee_sell: g('cm-bl'), customs_declaration_jpy: g('cm-decl'), customs_handling_jpy: g('cm-chand'),
    other_fee: g('cm-other'), oversea_sell: g('cm-del-sell'), oversea_cost: g('cm-del-cost'),
    updated_at: new Date().toISOString() };
  var id = $('cm-id').value;
  var r = id ? await sbUpdate('customers', id, row) : await sbInsert('customers', row);
  if (r.error) { toast('保存失敗: ' + r.error.message, 'err'); return; }
  toast('保存しました'); closeCM(); await loadAll(); renderCustTable();
};
window.delCust = async function(id) {
  if (!confirm('削除しますか？')) return;
  var r = await sbDelete('customers', id);
  if (r.error) { toast('削除失敗: ' + r.error.message, 'err'); return; }
  toast('削除しました'); await loadAll(); renderCustTable();
};

// ── コストマスター CRUD ───────────────────────────────────────
function renderCostTable() {
  var tb = $('ktb');
  if (!allCosts.length) { tb.innerHTML = '<tr><td colspan="25" class="loading">データがありません</td></tr>'; return; }
  tb.innerHTML = allCosts.map(function(c) {
    var nz = function(v, pre) { return nv(v) ? (pre || '') + fmt(v, 2) : '-'; };
    return '<tr>' +
      '<td><strong>' + c.carrier + '</strong></td><td>' + c.container_type + '</td>' +
      '<td>$' + fmt(c.ocean_freight) + '</td><td>' + nz(c.baf_ees_efs,'$') + '</td>' +
      '<td>¥' + fmt(c.thc_etc) + '</td><td>¥' + fmt(c.doc_fee) + '</td>' +
      '<td>¥' + fmt(c.seal_fee) + '</td><td>' + nz(c.cml_fee,'¥') + '</td>' +
      '<td>' + fmt(c.cap_m3) + '</td>' +
      '<td style="color:var(--purple)">' + nz(c.ts_cost_usd,'$') + '</td>' +
      '<td style="color:var(--blue)">' + nz(c.ens_usd,'$') + '</td><td style="color:var(--blue)">' + nz(c.ecc_usd,'$') + '</td><td style="color:var(--blue)">' + nz(c.csl_usd,'$') + '</td>' +
      '<td style="color:var(--blue)">' + nz(c.stf_usd,'$') + '</td><td style="color:var(--blue)">' + nz(c.ees_eur,'€') + '</td><td style="color:var(--blue)">' + nz(c.efl_usd,'$') + '</td>' +
      '<td style="color:var(--amber);font-weight:600">' + nz(c.refund_per_rt,'$') + '</td>' +
      '<td>¥' + fmt(c.vanning_tokyo_jpy) + '</td><td>' + (c.container_type === '40HC' ? 26 : 13) + '</td>' +
      '<td>¥' + fmt(c.vanning_kobe_jpy) + '</td><td>10</td><td>¥' + fmt(c.lashing_jpy) + '</td>' +
      '<td>' + nz(c.no_stack_jpy,'¥') + '</td><td>' + nz(c.palletize_jpy,'¥') + '</td>' +
      '<td style="white-space:nowrap"><button class="btn btn-sm" style="margin-right:4px" onclick="editCost(\'' + c.id + '\')">編集</button><button class="delbtn" onclick="delCostRow(\'' + c.id + '\')">削除</button></td></tr>';
  }).join('');
}

window.openKM = function(c) {
  c = c || null;
  $('km-title').textContent = c ? 'コストマスターを編集' : 'コストマスターを追加';
  $('km-id').value = c ? c.id : '';
  var def = {
    'km-carrier': c ? c.carrier : '', 'km-cap': c ? c.cap_m3 : 25,
    'km-of': c ? c.ocean_freight : 0, 'km-baf': c ? c.baf_ees_efs : 0,
    'km-thc': c ? c.thc_etc : 0, 'km-doc': c ? c.doc_fee : 0,
    'km-seal': c ? c.seal_fee : 0, 'km-cml': c ? c.cml_fee : 0,
    'km-van-tokyo': c ? c.vanning_tokyo_jpy : 2800, 'km-olt-rt': c ? c.olt_per_rt_jpy : 800,
    'km-van-kobe': c ? c.vanning_kobe_jpy : 2600, 'km-van-kobe-min': c ? c.vanning_min_kobe : 10,
    'km-lashing': c ? c.lashing_jpy : 6000,
    'km-ts-cost': c ? c.ts_cost_usd : 0,
    'km-ens': c ? c.ens_usd : 0, 'km-ecc': c ? c.ecc_usd : 0, 'km-csl': c ? c.csl_usd : 0,
    'km-stf': c ? c.stf_usd : 0, 'km-ees': c ? c.ees_eur : 0, 'km-efl': c ? c.efl_usd : 0,
    'km-refund': c ? c.refund_per_rt : 0,
    'km-nostack': c ? c.no_stack_jpy : 0, 'km-palletize': c ? c.palletize_jpy : 0
  };
  Object.keys(def).forEach(function(id) {
    var el = $(id); if (!el) return;
    var v = def[id];
    el.value = typeof v === 'string' ? v : fmt(nv(v), nv(v) % 1 !== 0 ? 2 : 0);
  });
  if (c) $('km-type').value = c.container_type;
  $('km-modal').style.display = 'block';
};
window.closeKM = function() { $('km-modal').style.display = 'none'; };
window.editCost = function(id) { allCosts.forEach(function(c) { if (c.id === id) openKM(c); }); };
window.saveCost = async function() {
  var carrier = $('km-carrier').value.trim();
  if (!carrier) { toast('船社名を入力してください', 'err'); return; }
  var g = function(id) { return nv($(id).value); };
  var row = {
    carrier: carrier, container_type: $('km-type').value, cap_m3: g('km-cap'),
    ocean_freight: g('km-of'), baf_ees_efs: g('km-baf'),
    thc_etc: g('km-thc'), doc_fee: g('km-doc'), seal_fee: g('km-seal'), cml_fee: g('km-cml'),
    vanning_tokyo_jpy: g('km-van-tokyo'), olt_per_rt_jpy: g('km-olt-rt'),
    vanning_kobe_jpy: g('km-van-kobe'), vanning_min_kobe: g('km-van-kobe-min'), lashing_jpy: g('km-lashing'),
    ts_cost_usd: g('km-ts-cost'),
    ens_usd: g('km-ens'), ecc_usd: g('km-ecc'), csl_usd: g('km-csl'),
    stf_usd: g('km-stf'), ees_eur: g('km-ees'), efl_usd: g('km-efl'),
    refund_per_rt: g('km-refund'),
    no_stack_jpy: g('km-nostack'), palletize_jpy: g('km-palletize')
  };
  var id = $('km-id').value;
  var r = id ? await sbUpdate('cost_master', id, row) : await sbInsert('cost_master', row);
  if (r.error) { toast('保存失敗: ' + r.error.message, 'err'); return; }
  toast('保存しました'); closeKM(); await loadAll(); renderCostTable();
};
window.delCostRow = async function(id) {
  if (!confirm('削除しますか？')) return;
  var r = await sbDelete('cost_master', id);
  if (r.error) { toast('削除失敗: ' + r.error.message, 'err'); return; }
  toast('削除しました'); await loadAll(); renderCostTable();
};

// ── AGENT CRUD ────────────────────────────────────────────────
function renderAgentTable() {
  var tb = $('atb');
  if (!agentRates.length) { tb.innerHTML = '<tr><td colspan="7" class="loading">AGENTが登録されていません</td></tr>'; return; }
  tb.innerHTML = agentRates.map(function(a) {
    var destBadge = a.destination === 'ALL'
      ? '<span style="font-size:10px;background:var(--sur2);color:var(--tx2);padding:1px 6px;border-radius:3px">ALL</span>'
      : '<span style="font-size:10px;background:var(--purple-bg);color:var(--purple);padding:1px 6px;border-radius:3px">' + a.destination + '</span>';
    var nz = function(v, pre) { return nv(v) ? (pre || '') + fmt(v, 2) : '-'; };
    return '<tr>' +
      '<td><strong style="color:var(--purple)">' + a.agent_name + '</strong></td>' +
      '<td>' + destBadge + '</td>' +
      '<td style="color:var(--purple)">' + nz(a.ts_cost_usd, '$') + '</td>' +
      '<td style="color:var(--amber)">' + nz(a.fixed_usd, '$') + '</td>' +
      '<td style="color:var(--green)">' + nz(a.handling_jpy, '¥') + '</td>' +
      '<td style="font-size:11px;color:var(--tx3)">' + (a.memo || '-') + '</td>' +
      '<td style="white-space:nowrap"><button class="btn btn-sm" style="margin-right:4px" onclick="editAgent(\'' + a.id + '\')">編集</button><button class="delbtn" onclick="delAgent(\'' + a.id + '\')">削除</button></td></tr>';
  }).join('');
}

window.openAM = function(a) {
  a = a || null;
  $('am-title').textContent = a ? 'AGENTを編集' : 'AGENTを追加';
  $('am-id').value = a ? a.id : '';
  $('am-name').value = a ? a.agent_name : '';
  var dsel = $('am-dest');
  dsel.innerHTML = '<option value="ALL">ALL（全仕向地共通）</option>';
  tsRates.forEach(function(t) { dsel.innerHTML += '<option value="' + t.destination + '">' + t.destination + '</option>'; });
  dsel.value = a ? (a.destination || 'ALL') : 'ALL';
  var fields = [['am-ts-cost', a && a.ts_cost_usd], ['am-fixed', a && a.fixed_usd], ['am-handling', a && a.handling_jpy]];
  fields.forEach(function(f) { var el = $(f[0]); if (!el) return; var n = nv(f[1]); el.value = fmt(n, n % 1 !== 0 ? 2 : 0); });
  $('am-memo').value = a ? (a.memo || '') : '';
  $('am-modal').style.display = 'block';
};
window.closeAM = function() { $('am-modal').style.display = 'none'; };
window.editAgent = function(id) { agentRates.forEach(function(a) { if (a.id === id) openAM(a); }); };
window.saveAgent = async function() {
  var name = $('am-name').value.trim();
  if (!name) { toast('AGENT名を入力してください', 'err'); return; }
  var g = function(id) { return nv($(id).value); };
  var row = { agent_name: name, destination: $('am-dest').value,
    ts_cost_usd: g('am-ts-cost'), fixed_usd: g('am-fixed'), handling_jpy: g('am-handling'),
    memo: $('am-memo').value, updated_at: new Date().toISOString() };
  var id = $('am-id').value;
  var r = id ? await sbUpdate('agent_rates', id, row) : await sbInsert('agent_rates', row);
  if (r.error) { toast('保存失敗: ' + r.error.message, 'err'); return; }
  toast('保存しました'); closeAM(); await loadAll(); renderAgentTable();
};
window.delAgent = async function(id) {
  if (!confirm('削除しますか？')) return;
  var r = await sbDelete('agent_rates', id);
  if (r.error) { toast('削除失敗: ' + r.error.message, 'err'); return; }
  toast('削除しました'); await loadAll(); renderAgentTable();
};

// ── event listeners ───────────────────────────────────────────
['olt-tr4','olt-tr10','olt-tr10z','van-tokyo','van-kobe','lashing'].forEach(function(id) {
  var el = $(id); if (el) el.addEventListener('input', function() { fmtI(el); calc(); });
});

// ── Init ──────────────────────────────────────────────────────
(async function() {
  await loadAll();
  addRow();
})();
