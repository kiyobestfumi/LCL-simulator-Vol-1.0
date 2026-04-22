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
var customers = [], allCosts = [], tsRates = [], agentRates = [], coloadRates = [];
var carriers = [];
// スロット別コストマスター参照
// スロット1（TK/KB/COLOAD/OLT対応）
var selT20 = null, selT40 = null;   // TK東京 / KB用も兼用
var selK20 = null, selK40 = null;   // TK神戸 / KB/COLOAD神戸
var selCL20 = null, selCL40 = null; // CO-LOAD船社（スロット1）
var selBT20 = null, selBT40 = null; // OLT東京（スロット1/2）
var selBK20 = null, selBK40 = null; // OLT神戸
// スロット2用（スロット2がTK/KBを使う場合）
var sel2T20 = null, sel2T40 = null;
var sel2K20 = null, sel2K40 = null;
var sel2CL20 = null, sel2CL40 = null;
var sel2BT20 = null, sel2BT40 = null;
var sel2BK20 = null, sel2BK40 = null;
// 後方互換
var selB20 = null, selB40 = null;
var sel20 = null, sel40 = null;
var selAgent = null;
var rowSeq = 0;

// ── パターン定義 ──────────────────────────────────────────────
var PATTERN_LABELS = { TK:'東京・神戸独立', KB:'神戸のみ', COLOAD:'CO-LOAD', OLT:'OLT混載' };
function getSlotType(slot) {
  var name = 'slot' + slot + 'type';
  var checked = document.querySelector('input[name="' + name + '"]:checked');
  return checked ? checked.value : (slot === 1 ? 'TK' : 'COLOAD');
}

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
  var idx = { sim: 0, wizard: 1, cust: 2, cost: 3 }[id];
  if (idx !== undefined) document.querySelectorAll('.nb')[idx].classList.add('active');
  if (id === 'cust') renderCustTable();
  if (id === 'cost') { renderCostTable(); renderColoadTable(); renderAgentTable(); }
  if (id === 'wizard') wizInitPage();
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

  // coload_ratesは別途取得（テーブル未作成でも止まらない）
  try {
    var clRes = await sbGet('coload_rates', 'name');
    coloadRates = (!clRes.error && clRes.data) ? clRes.data : [];
  } catch(e) {
    coloadRates = [];
  }

  customers  = results['customers'];
  allCosts   = results['cost_master'];
  tsRates    = results['ts_rates'];
  agentRates = results['agent_rates'];
  // coloadRatesは上記try/catchで設定済み
  carriers   = [...new Set(allCosts.map(function(r) { return r.carrier; }))];
  var agentNames = [...new Set(agentRates.map(function(r) { return r.agent_name; }))];

  $('dot').className = 'dot ok';
  $('conn-lbl').textContent = '接続済 — 顧客' + customers.length + '件 / 船社' + carriers.length + '社 / CO-LOAD' + coloadRates.length + '社 / AGENT ' + agentNames.length + '社 / 仕向地' + tsRates.length + '港';

  // パターン選択UIの初期描画（船社リスト確定後に実行）
  onPatternChange();

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

// ── CO-LOAD業者変更 ───────────────────────────────────────────
window.onColoadChange = function() {
  [1, 2].forEach(function(s) {
    var sel = $('s' + s + '-c-cl');
    var badge = $('ci-s' + s + '-c-cl');
    if (!sel || !badge) return;
    var id = sel.value;
    var rate = coloadRates.find(function(r) { return r.id === id; }) || null;
    if (rate) {
      badge.textContent = 'O/F $' + fmt(rate.of_usd,0) + ' + EFS $' + fmt(rate.efs_usd,0) + '/RT　ICS2 $' + fmt(rate.ics2_usd,0) + '/BL　CFS ¥' + fmt(rate.cfs_jpy) + ' THC ¥' + fmt(rate.thc_jpy) + ' DRS ¥' + fmt(rate.drs_jpy) + '/RT';
    } else {
      badge.textContent = '';
    }
  });
  calc();
};

// ── パターン変更ハンドラ ──────────────────────────────────────
window.onPatternChange = function() {
  [1, 2].forEach(function(s) {
    var type = getSlotType(s);
    // ボタンのactive切り替え
    ['TK','KB','COLOAD','OLT'].forEach(function(t) {
      var btn = $('slot' + s + '-btn-' + t);
      if (btn) btn.classList.toggle('pt-active', t === type);
    });
    // スロットカードの枠色
    var colors = { TK:'var(--blue-brd)', KB:'var(--red-brd)', COLOAD:'var(--amber-brd)', OLT:'var(--acc-brd)' };
    var bgColors = { TK:'var(--blue-bg)', KB:'var(--red-bg)', COLOAD:'var(--amber-bg)', OLT:'var(--acc-bg)' };
    var card = $('slot' + s + '-card');
    if (card) { card.style.borderColor = colors[type]; card.style.background = bgColors[type]; }
    // CO-LOADレート表示切り替え
    var clRate = $('slot' + s + '-coload-rate');
    if (clRate) clRate.style.display = type === 'COLOAD' ? '' : 'none';
    // 船社選択UI再描画
    renderSlotCarriers(s, type);
    // BKGリストのスロットヘッダー更新
    updateSlotHeaders();
  });
  // コンテナパネルタイトル更新
  var ct1 = $('cntr-slot1-title'), ct2 = $('cntr-slot2-title');
  var vs1 = $('vol-sum-a-title'),  vs2 = $('vol-sum-b-title');
  if (ct1) ct1.textContent = 'スロット1 — ' + PATTERN_LABELS[getSlotType(1)];
  if (ct2) ct2.textContent = 'スロット2 — ' + PATTERN_LABELS[getSlotType(2)];
  if (vs1) vs1.textContent = 'スロット1 — ' + PATTERN_LABELS[getSlotType(1)];
  if (vs2) vs2.textContent = 'スロット2 — ' + PATTERN_LABELS[getSlotType(2)];
  // 利益・内訳ラベル更新
  var l1 = PATTERN_LABELS[getSlotType(1)], l2 = PATTERN_LABELS[getSlotType(2)];
  if ($('sv-pa-label'))  $('sv-pa-label').textContent  = 'スロット1（' + l1 + '）利益';
  if ($('sv-pb-label'))  $('sv-pb-label').textContent  = 'スロット2（' + l2 + '）利益';
  if ($('cb-a-title'))   $('cb-a-title').textContent   = 'スロット1 — ' + l1 + ' 荷主内訳';
  if ($('cb-b-title'))   $('cb-b-title').textContent   = 'スロット2 — ' + l2 + ' 荷主内訳';
  if ($('det-a-title'))  $('det-a-title').textContent  = 'スロット1 — ' + l1 + ' コスト明細';
  if ($('det-b-title'))  $('det-b-title').textContent  = 'スロット2 — ' + l2 + ' コスト明細';
  // CO-LOAD物量欄の表示制御（スロット2がCO-LOADの時に表示）
  var cbColoadWrap = $('cb-coload-wrap');
  if (cbColoadWrap) cbColoadWrap.style.display = (t2 === 'COLOAD') ? '' : 'none';
  var t1 = getSlotType(1), t2 = getSlotType(2);
  var needsVanning = (t1 !== 'COLOAD' || t2 !== 'COLOAD');
  var vanCard = document.querySelector('.card .ct');
  // VANNINGカード（2番目のcard）の表示制御
  var cards = document.querySelectorAll('#page-sim .card');
  if (cards[1]) cards[1].style.display = needsVanning ? '' : 'none';
  // OLTカードはOLT/TKパターンが含まれる時のみ表示
  var needsOlt = (t1 === 'TK' || t1 === 'OLT' || t2 === 'TK' || t2 === 'OLT');
  if (cards[2]) cards[2].style.display = needsOlt ? '' : 'none';
  onCarrierChange();
};

function updateSlotHeaders() {
  var t1 = getSlotType(1), t2 = getSlotType(2);
  var h1 = $('th-slot1-hdr'), h2 = $('th-slot2-hdr');
  if (h1) h1.textContent = 'スロット1 拠点（' + PATTERN_LABELS[t1] + '）';
  if (h2) h2.textContent = 'スロット2 拠点（' + PATTERN_LABELS[t2] + '）';
}

function carrierSelectHtml(id, label, color, bg, brd) {
  return '<div style="margin-bottom:.5rem">' +
    '<div style="font-size:10px;font-weight:700;color:' + color + ';margin-bottom:.25rem">' + label + '</div>' +
    '<select id="' + id + '" onchange="onCarrierChange()" style="padding:5px 8px;width:100%;border:1px solid ' + brd + ';border-radius:var(--r);background:' + bg + ';font-size:12px;font-family:var(--mono)">' +
      '<option value="">-- 選択 --</option>' +
    '</select>' +
    '<div id="ci-' + id + '" style="font-size:10px;color:' + color + ';margin-top:.2rem"></div>' +
  '</div>';
}

function renderSlotCarriers(slot, type) {
  var el = $('slot' + slot + '-carriers');
  if (!el) return;
  var html = '';
  if (type === 'TK') {
    html += carrierSelectHtml('s' + slot + '-c-t', '東京 船社', 'var(--blue)', 'var(--sur)', 'var(--blue-brd)');
    html += carrierSelectHtml('s' + slot + '-c-k', '神戸 船社', 'var(--red)', 'var(--sur)', 'var(--red-brd)');
  } else if (type === 'KB') {
    html += carrierSelectHtml('s' + slot + '-c-k', '神戸 船社', 'var(--red)', 'var(--sur)', 'var(--red-brd)');
  } else if (type === 'COLOAD') {
    // CO-LOAD業者セレクト（coload_ratesテーブルから）
    html += '<div style="margin-bottom:.5rem">';
    html += '<div style="font-size:10px;font-weight:700;color:var(--amber);margin-bottom:.25rem">CO-LOAD 業者</div>';
    html += '<select id="s' + slot + '-c-cl" onchange="onColoadChange()" style="padding:5px 8px;width:100%;border:1px solid var(--amber-brd);border-radius:var(--r);background:var(--sur);font-size:12px;font-family:var(--sans)">';
    html += '<option value="">-- 選択 --</option>';
    coloadRates.forEach(function(c) {
      html += '<option value="' + c.id + '">' + c.name + '</option>';
    });
    html += '</select>';
    html += '<div id="ci-s' + slot + '-c-cl" style="font-size:10px;color:var(--amber);margin-top:.2rem"></div>';
    html += '</div>';
  } else if (type === 'OLT') {
    html += carrierSelectHtml('s' + slot + '-c-bt', '東京 船社（OLT後）', 'var(--acc)', 'var(--sur)', 'var(--acc-brd)');
    html += carrierSelectHtml('s' + slot + '-c-bk', '神戸 船社（OLT前）', 'var(--green)', 'var(--sur)', 'var(--green-brd)');
  }
  el.innerHTML = html;
  // 船社オプションを追加
  ['s' + slot + '-c-t', 's' + slot + '-c-k', 's' + slot + '-c-cl', 's' + slot + '-c-bt', 's' + slot + '-c-bk'].forEach(function(selId) {
    var sel = $(selId); if (!sel) return;
    carriers.forEach(function(c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
  });
}

// ── 船社変更（パターン対応） ──────────────────────────────────
window.onCarrierChange = function() {
  function getSelPair(selId20, selId40) {
    var s20 = null, s40 = null;
    allCosts.forEach(function(r) {
      var carrier = $(selId20) ? $(selId20).value : '';
      if (!carrier) return;
      if (r.carrier === carrier && r.container_type === '20FT') s20 = r;
      if (r.carrier === carrier && r.container_type === '40HC') s40 = r;
    });
    return [s20, s40];
  }
  function getSelByCarrier(carrierId) {
    var s20 = null, s40 = null;
    var carrier = $(carrierId) ? $(carrierId).value : '';
    if (!carrier) return [s20, s40];
    allCosts.forEach(function(r) {
      if (r.carrier === carrier && r.container_type === '20FT') s20 = r;
      if (r.carrier === carrier && r.container_type === '40HC') s40 = r;
    });
    return [s20, s40];
  }

  // スロット1
  var t1 = getSlotType(1);
  var p = getSelByCarrier('s1-c-t');  selT20  = p[0]; selT40  = p[1];
  var q = getSelByCarrier('s1-c-k');  selK20  = q[0]; selK40  = q[1];
  var r = getSelByCarrier('s1-c-cl'); selCL20 = r[0]; selCL40 = r[1];
  var u = getSelByCarrier('s1-c-bt'); selBT20 = u[0]; selBT40 = u[1];
  var v = getSelByCarrier('s1-c-bk'); selBK20 = v[0]; selBK40 = v[1];

  // スロット2
  var t2 = getSlotType(2);
  var p2 = getSelByCarrier('s2-c-t');  sel2T20  = p2[0]; sel2T40  = p2[1];
  var q2 = getSelByCarrier('s2-c-k');  sel2K20  = q2[0]; sel2K40  = q2[1];
  var r2 = getSelByCarrier('s2-c-cl'); sel2CL20 = r2[0]; sel2CL40 = r2[1];
  var u2 = getSelByCarrier('s2-c-bt'); sel2BT20 = u2[0]; sel2BT40 = u2[1];
  var v2 = getSelByCarrier('s2-c-bk'); sel2BK20 = v2[0]; sel2BK40 = v2[1];

  // 後方互換
  selB20 = selBT20 || sel2BT20;
  selB40 = selBT40 || sel2BT40;
  sel20  = selT20 || selK20;
  sel40  = selT40 || selK40;

  // VANNING/ラッシング自動反映（スロット1 TKの東京/神戸船社から）
  var tkT = t1 === 'TK' ? selT20 : (t2 === 'TK' ? sel2T20 : null);
  var tkK = t1 === 'TK' ? selK20 : (t2 === 'TK' ? sel2K20 : null);
  if (tkT && $('van-tokyo')) $('van-tokyo').value = fmt(nv(tkT.vanning_tokyo_jpy) || 2800);
  if (tkK && $('van-kobe'))  $('van-kobe').value  = fmt(nv(tkK.vanning_kobe_jpy)  || 2600);
  if (tkK && $('lashing'))   $('lashing').value   = fmt(nv(tkK.lashing_jpy)       || 6000);
  // 入出庫料
  var oltSrc = selBT20 || sel2BT20 || selT20 || null;
  if (oltSrc && nv(oltSrc.olt_handling_jpy) && $('olt-handling'))
    $('olt-handling').value = fmt(nv(oltSrc.olt_handling_jpy));

  // 情報バッジ更新
  function badgeInfo(c20, c40, elId) {
    var el = $(elId); if (!el) return;
    if (!c20 && !c40) { el.textContent = ''; return; }
    var parts = [];
    if (c20) parts.push('20FT: $' + fmt(c20.ocean_freight) + (nv(c20.refund_per_rt) ? ' REF$' + fmt(c20.refund_per_rt) : ''));
    if (c40) parts.push('40HC: $' + fmt(c40.ocean_freight) + (nv(c40.refund_per_rt) ? ' REF$' + fmt(c40.refund_per_rt) : ''));
    el.textContent = parts.join(' / ');
  }
  badgeInfo(selT20,  selT40,  'ci-s1-c-t');
  badgeInfo(selK20,  selK40,  'ci-s1-c-k');
  badgeInfo(selCL20, selCL40, 'ci-s1-c-cl');
  badgeInfo(selBT20, selBT40, 'ci-s1-c-bt');
  badgeInfo(selBK20, selBK40, 'ci-s1-c-bk');
  badgeInfo(sel2T20,  sel2T40,  'ci-s2-c-t');
  badgeInfo(sel2K20,  sel2K40,  'ci-s2-c-k');
  badgeInfo(sel2CL20, sel2CL40, 'ci-s2-c-cl');
  badgeInfo(sel2BT20, sel2BT40, 'ci-s2-c-bt');
  badgeInfo(sel2BK20, sel2BK40, 'ci-s2-c-bk');

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
  if (kobeM3 <= 0) return { truck: 0, handling: 0, total: 0, desc: 'なし' };
  var chk4   = $('olt-chk-4')   && $('olt-chk-4').checked;
  var chk10  = $('olt-chk-10')  && $('olt-chk-10').checked;
  var chk10z = $('olt-chk-10z') && $('olt-chk-10z').checked;
  var handlingRate = nv($('olt-handling') ? $('olt-handling').value : 1800);
  var handling = kobeM3 * handlingRate;
  if (!chk4 && !chk10 && !chk10z) return { truck: 0, handling: handling, total: handling, desc: '手配なし' };
  var truck = 0, lines = [];
  if (chk4)   { truck += nv($('olt-tr4').value);   lines.push('4t¥' + fmt(nv($('olt-tr4').value)));   }
  if (chk10)  { truck += nv($('olt-tr10').value);  lines.push('10t¥' + fmt(nv($('olt-tr10').value)));  }
  if (chk10z) { truck += nv($('olt-tr10z').value); lines.push('増t¥' + fmt(nv($('olt-tr10z').value))); }
  return { truck: truck, handling: handling, total: truck + handling, desc: lines.join(' + ') };
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
  var capBT20 = nv(selBT20 ? selBT20.cap_m3 : (sel20 ? sel20.cap_m3 : 0)) || 25;
  var capBT40 = nv(selBT40 ? selBT40.cap_m3 : (sel40 ? sel40.cap_m3 : 0)) || 50;
  var capBK20 = nv(selBK20 ? selBK20.cap_m3 : (sel20 ? sel20.cap_m3 : 0)) || 25;
  var capBK40 = nv(selBK40 ? selBK40.cap_m3 : (sel40 ? sel40.cap_m3 : 0)) || 50;
  // サマリーバー（sum-bar）- baseAベース
  var tRows = rows.filter(function(r) { return r.baseA === '東京'; });
  var kRows = rows.filter(function(r) { return r.baseA === '神戸'; });
  var tT20 = tRows.filter(function(r) { return r.eCntr === '20FT'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var tT40 = tRows.filter(function(r) { return r.eCntr === '40HC'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var kT20 = kRows.filter(function(r) { return r.eCntr === '20FT'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var kT40 = kRows.filter(function(r) { return r.eCntr === '40HC'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var allM = rows.reduce(function(s, r) { return s + r.vol; }, 0);
  $('ca-t20').value = tT20 > 0 ? Math.ceil(tT20 / capT20) : 0;
  $('ca-t40').value = tT40 > 0 ? Math.ceil(tT40 / capT40) : 0;
  $('ca-k20').value = kT20 > 0 ? Math.ceil(kT20 / capK20) : 0;
  $('ca-k40').value = kT40 > 0 ? Math.ceil(kT40 / capK40) : 0;
  $('cb-t20').value = 0;
  $('cb-t40').value = tT40 > 0 ? Math.ceil(tT40 / capBT40) : 0;
  $('cb-k20').value = 0;
  $('cb-k40').value = kT40 > 0 ? Math.ceil(kT40 / capBK40) : 0;
  // CO-LOAD m³：スロット2がCO-LOADの場合、スロット2対象荷主の合計物量を自動セット
  var t2 = getSlotType(2);
  if (t2 === 'COLOAD' && $('cb-cl-m3')) {
    var clM3 = rowsB.reduce(function(s, r) { return s + r.vol; }, 0);
    $('cb-cl-m3').value = Math.round(clM3 * 10) / 10;
  }
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
    '<td><input class="ri ri-sm" id="rb-vol-' + id + '" type="text" value="' + rv('vol', 10) + '" oninput="fmtI(this);onVolChange(' + id + ')"></td>' +
    '<td><select class="ri ri-dest" id="rb-dest-' + id + '" onchange="onDestChange(' + id + ')">' + destOpts + '</select><div id="rb-ts-disp-' + id + '" style="font-size:9px;color:var(--purple);margin-top:1px"></div></td>' +
    // スロット1列：チェック＋拠点
    '<td style="background:#E8F0FF;padding:3px 5px;min-width:90px">' +
      '<label style="display:flex;align-items:center;gap:3px;font-size:10px;font-weight:700;color:var(--blue);cursor:pointer;margin-bottom:3px">' +
        '<input type="checkbox" id="rb-use-a-' + id + '" checked onchange="calc()" style="width:12px;height:12px;accent-color:var(--blue)"> スロット1' +
      '</label>' +
      '<select class="ri" id="rb-base-a-' + id + '" onchange="calc()" style="font-size:11px;font-family:var(--sans);background:#E8F0FF;border-color:var(--blue-brd);color:var(--blue);padding:2px 4px;width:100%">' +
        '<option value="東京">東京</option><option value="神戸">神戸</option>' +
      '</select>' +
    '</td>' +
    // スロット2列：チェック＋拠点
    '<td style="background:#E8F5EE;padding:3px 5px;min-width:90px">' +
      '<label style="display:flex;align-items:center;gap:3px;font-size:10px;font-weight:700;color:var(--acc);cursor:pointer;margin-bottom:3px">' +
        '<input type="checkbox" id="rb-use-b-' + id + '" checked onchange="calc()" style="width:12px;height:12px;accent-color:var(--acc)"> スロット2' +
      '</label>' +
      '<select class="ri" id="rb-base-b-' + id + '" onchange="calc()" style="font-size:11px;font-family:var(--sans);background:#E8F5EE;border-color:var(--acc-brd);color:var(--acc);padding:2px 4px;width:100%">' +
        '<option value="東京">東京</option><option value="神戸">神戸</option>' +
      '</select>' +
    '</td>' +
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
  // 初期拠点設定（A・B共通で顧客マスターの拠点を反映）
  if (d.simBase) {
    var baseAEl = $('rb-base-a-' + id);
    var baseBEl = $('rb-base-b-' + id);
    if (baseAEl) baseAEl.value = d.simBase;
    if (baseBEl) baseBEl.value = d.simBase;
  }
  if (d.baseB) { var bEl = $('rb-base-b-' + id); if (bEl) bEl.value = d.baseB; }
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
  var baseAEl = $('rb-base-a-' + id);
  var baseBEl = $('rb-base-b-' + id);
  if (baseAEl) baseAEl.value = bi.simBase;
  if (baseBEl) baseBEl.value = bi.simBase;
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
    var eCntr  = vol > 25 ? '40HC' : '20FT';
    var dest   = $('rb-dest-' + id) ? $('rb-dest-' + id).value : 'RTM';
    var tsRate = null;
    if (dest !== 'RTM') tsRates.forEach(function(t) { if (t.destination === dest) tsRate = t; });
    var tsApply = $('rb-tschk-' + id) ? $('rb-tschk-' + id).checked : false;
    var useA    = $('rb-use-a-' + id) ? $('rb-use-a-' + id).checked : true;
    var useB    = $('rb-use-b-' + id) ? $('rb-use-b-' + id).checked : true;
    var baseA   = $('rb-base-a-' + id) ? $('rb-base-a-' + id).value : '東京';
    var baseB   = $('rb-base-b-' + id) ? $('rb-base-b-' + id).value : '東京';
    rows.push({
      id: id, custName: custName,
      base: baseA,   // 後方互換（パターンA拠点を代表値として使用）
      baseA: baseA, baseB: baseB,
      vol: vol, eCntr: eCntr,
      of: g('of'), lss: g('lss'), pss: g('pss'), efs: g('efs'), ics: g('ics'),
      cfs: g('cfs'), thc: g('thc'), drs: g('drs'),
      bl: g('bl'), decl: g('decl'), chand: g('chand'), ot: g('ot'),
      ds: g('ds'), dc: g('dc'),
      nstkCost: g('nstku') * g('nstkq'), pltCost: g('pltu') * g('pltq'),
      ts: g('ts'), tsApply: tsApply, dest: dest, tsRate: tsRate,
      useA: useA, useB: useB
    });
  });
  return rows;
}

function rowRev(r, fx) {
  return (r.of + r.lss + r.pss + r.efs) * r.vol * fx   // USD/RT項目
       + r.ics * fx                                       // ICS2 USD/BL（件固定）
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

  // パターン別に行を絞り込み
  var rowsA = rows.filter(function(r) { return r.useA; });
  var rowsB = rows.filter(function(r) { return r.useB; });

  // パターンA用物量（baseAを使用）
  var tRowsA = rowsA.filter(function(r) { return r.baseA === '東京'; });
  var kRowsA = rowsA.filter(function(r) { return r.baseA === '神戸'; });
  var tMA = tRowsA.reduce(function(s, r) { return s + r.vol; }, 0);
  var kMA = kRowsA.reduce(function(s, r) { return s + r.vol; }, 0);
  var allMA = tMA + kMA;
  var tsMA  = rowsA.filter(function(r) { return r.tsApply; }).reduce(function(s, r) { return s + r.vol; }, 0);

  // パターンB用物量（baseBを使用）
  var tRowsB = rowsB.filter(function(r) { return r.baseB === '東京'; });
  var kRowsB = rowsB.filter(function(r) { return r.baseB === '神戸'; });
  var tMB_vol = tRowsB.reduce(function(s, r) { return s + r.vol; }, 0);
  var kMB_vol = kRowsB.reduce(function(s, r) { return s + r.vol; }, 0);
  var allMB = rowsB.reduce(function(s, r) { return s + r.vol; }, 0);
  var tsMB  = rowsB.filter(function(r) { return r.tsApply; }).reduce(function(s, r) { return s + r.vol; }, 0);

  var tM = rows.filter(function(r) { return r.baseA === '東京'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var kM = rows.filter(function(r) { return r.baseA === '神戸'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var allM = rows.reduce(function(s, r) { return s + r.vol; }, 0);
  var tsM  = rows.filter(function(r) { return r.tsApply; }).reduce(function(s, r) { return s + r.vol; }, 0);
  var refM = Math.max(0, allM - tsM);

  // ── 物量サマリー表示 ──────────────────────────────────────────
  var volSumEl = $('vol-summary');
  var volSumA  = $('vol-sum-a');
  var volSumB  = $('vol-sum-b');
  if (rows.length > 0 && volSumEl) {
    volSumEl.style.display = '';
    if (volSumA) {
      var linesA = [];
      linesA.push('<span style="color:var(--blue)">東京: <strong>' + fmt(tMA,1) + ' m³</strong></span>');
      linesA.push('<span style="color:var(--red)">神戸: <strong>' + fmt(kMA,1) + ' m³</strong></span>');
      linesA.push('<span style="color:var(--tx2)">合計: <strong>' + fmt(allMA,1) + ' m³</strong></span>');
      // 目安本数
      var capT20 = nv(selT20 ? selT20.cap_m3 : 0)||25, capT40 = nv(selT40 ? selT40.cap_m3 : 0)||50;
      var capK20 = nv(selK20 ? selK20.cap_m3 : 0)||25, capK40 = nv(selK40 ? selK40.cap_m3 : 0)||50;
      if (tMA > 0) linesA.push('<span style="font-size:11px;color:var(--tx3)">東京目安: 20FT×' + Math.ceil(tMA/capT20) + ' or 40HC×' + Math.ceil(tMA/capT40) + '</span>');
      if (kMA > 0) linesA.push('<span style="font-size:11px;color:var(--tx3)">神戸目安: 20FT×' + Math.ceil(kMA/capK20) + ' or 40HC×' + Math.ceil(kMA/capK40) + '</span>');
      volSumA.innerHTML = linesA.join('<br>');
    }
    if (volSumB) {
      var linesB = [];
      linesB.push('<span style="color:var(--blue)">東京: <strong>' + fmt(tMB_vol,1) + ' m³</strong></span>');
      linesB.push('<span style="color:var(--red)">神戸: <strong>' + fmt(kMB_vol,1) + ' m³</strong></span>');
      linesB.push('<span style="color:var(--tx2)">合計: <strong>' + fmt(allMB,1) + ' m³</strong></span>');
      var capBT20 = nv(selBT20 ? selBT20.cap_m3 : 0)||25, capBT40 = nv(selBT40 ? selBT40.cap_m3 : 0)||50;
      var capBK20 = nv(selBK20 ? selBK20.cap_m3 : 0)||25, capBK40 = nv(selBK40 ? selBK40.cap_m3 : 0)||50;
      if (tMB_vol > 0) linesB.push('<span style="font-size:11px;color:var(--tx3)">B東京目安: 20FT×' + Math.ceil(tMB_vol/capBT20) + ' or 40HC×' + Math.ceil(tMB_vol/capBT40) + '</span>');
      if (kMB_vol > 0) linesB.push('<span style="font-size:11px;color:var(--tx3)">B神戸目安: 20FT×' + Math.ceil(kMB_vol/capBK20) + ' or 40HC×' + Math.ceil(kMB_vol/capBK40) + '</span>');
      volSumB.innerHTML = linesB.join('<br>');
    }
  } else if (volSumEl) {
    volSumEl.style.display = 'none';
  }

  // コンテナ自動判定ラベル更新（削除済みのため空処理）

  // OLT（パターンA：Aの神戸荷主分、パターンB：Bの神戸荷主分）
  var kMA_olt = kRowsA.reduce(function(s, r) { return s + r.vol; }, 0);
  var kMB_olt = kRowsB.reduce(function(s, r) { return s + r.vol; }, 0);
  var oltA = calcOLT(kMA_olt);
  var oltB = calcOLT(kMB_olt);
  // OLT合計表示（パターンA・B両方の神戸分を表示）
  var oltDisp   = $('olt-total-disp');
  var oltDetail = $('olt-detail-disp');
  var kMdisp = Math.max(kMA_olt, kMB_olt);
  var oltAll = calcOLT(kMdisp);
  if (oltDisp)   oltDisp.textContent   = kMdisp > 0 ? fmt(oltAll.truck) + '円' : '¥0（神戸貨物なし）';
  if (oltDetail) oltDetail.textContent = kMdisp > 0 && oltAll.truck > 0 ? oltAll.desc : (kMdisp > 0 ? '手配なし' : '');

  // パターン別OLT適用フラグ
  var oltApplyA = $('olt-apply-a') ? $('olt-apply-a').checked : false;
  var oltApplyB = $('olt-apply-b') ? $('olt-apply-b').checked : true;

  // スロット判定
  var t1 = getSlotType(1), t2 = getSlotType(2);

  // スロット別コスト計算ヘルパー
  // 戻り値: { cost, prof, rev, ref, cntrDetail, oltForSlot, totalTs, agentCost, totalDel, totalMisc }
  function calcSlot(slotRows, baseKey, type, cT20, cT40, cK20, cK40, sBT20, sBT40, sBK20, sBK40, sCL20, sCL40,
                    panelT20, panelT40, panelK20, panelK40, oltApply, slotNum) {
    var tR = slotRows.filter(function(r){return r[baseKey]==='東京';});
    var kR = slotRows.filter(function(r){return r[baseKey]==='神戸';});
    var tM = tR.reduce(function(s,r){return s+r.vol;},0);
    var kM = kR.reduce(function(s,r){return s+r.vol;},0);
    var allM = slotRows.reduce(function(s,r){return s+r.vol;},0);
    var tsM  = slotRows.filter(function(r){return r.tsApply;}).reduce(function(s,r){return s+r.vol;},0);

    var totalRev  = slotRows.reduce(function(s,r){return s+rowRev(r,fx);},0);
    var totalDel  = slotRows.reduce(function(s,r){return s+r.dc*fx;},0);
    var totalMisc = slotRows.reduce(function(s,r){return s+r.nstkCost+r.pltCost;},0);
    var totalTs   = slotRows.reduce(function(s,r){return s+rowTsCost(r,fx);},0);
    var agentCost = calcAgentCost(slotRows);

    var cntrCost = 0, ref = 0, cntrDetail = [];
    var oltKobeM3 = kM;
    var oltForSlot = 0;

    if (type === 'TK') {
      // 東京：cT20/cT40、神戸：cK20/cK40
      var dT20 = ctByUnits(panelT20, tM, cT20, fx, eur, false);
      var dT40 = ctByUnits(panelT40, tM, cT40, fx, eur, false);
      var dK20 = ctByUnits(panelK20, kM, cK20, fx, eur, true);
      var dK40 = ctByUnits(panelK40, kM, cK40, fx, eur, true);
      cntrCost = dT20.total + dT40.total + dK20.total + dK40.total;
      // REFUND
      var cap20 = nv(cT20?cT20.cap_m3:cK20?cK20.cap_m3:0)||25;
      var cap40 = nv(cT40?cT40.cap_m3:cK40?cK40.cap_m3:0)||50;
      var tM20 = panelT20>0&&(panelT20+panelT40>0)?tM*panelT20*cap20/(panelT20*cap20+panelT40*cap40||1):(panelT40===0?tM:0);
      var tM40 = panelT40>0&&(panelT20+panelT40>0)?tM*panelT40*cap40/(panelT20*cap20+panelT40*cap40||1):(panelT20===0?tM:0);
      var kM20 = panelK20>0&&(panelK20+panelK40>0)?kM*panelK20*cap20/(panelK20*cap20+panelK40*cap40||1):(panelK40===0?kM:0);
      var kM40 = panelK40>0&&(panelK20+panelK40>0)?kM*panelK40*cap40/(panelK20*cap20+panelK40*cap40||1):(panelK20===0?kM:0);
      ref = calcRefundForCntr(tM20,tsM,allM,cT20,fx)+calcRefundForCntr(tM40,tsM,allM,cT40,fx)
           +calcRefundForCntr(kM20,tsM,allM,cK20,fx)+calcRefundForCntr(kM40,tsM,allM,cK40,fx);
      cntrDetail = [{lbl:'東京 20FT×'+panelT20,ct:dT20,clr:'#F0F5FF'},{lbl:'東京 40HC×'+panelT40,ct:dT40,clr:'#EAF5FF'},
                    {lbl:'神戸 20FT×'+panelK20,ct:dK20,clr:'#FFF0F0'},{lbl:'神戸 40HC×'+panelK40,ct:dK40,clr:'#FFE8E8'}];
      // OLT（神戸分のみ）
      if (oltApply) {
        var olt = calcOLT(kM);
        oltForSlot = olt.total;
      }

    } else if (type === 'KB') {
      // 神戸荷主のみ（東京荷主はコンテナコストなし）
      var dK20 = ctByUnits(panelK20, kM, cK20, fx, eur, true);
      var dK40 = ctByUnits(panelK40, kM, cK40, fx, eur, true);
      cntrCost = dK20.total + dK40.total;
      var cap20 = nv(cK20?cK20.cap_m3:0)||25, cap40 = nv(cK40?cK40.cap_m3:0)||50;
      var kM20 = panelK20>0&&(panelK20+panelK40>0)?kM*panelK20*cap20/(panelK20*cap20+panelK40*cap40||1):(panelK40===0?kM:0);
      var kM40 = panelK40>0&&(panelK20+panelK40>0)?kM*panelK40*cap40/(panelK20*cap20+panelK40*cap40||1):(panelK20===0?kM:0);
      ref = calcRefundForCntr(kM20,tsM,allM,cK20,fx)+calcRefundForCntr(kM40,tsM,allM,cK40,fx);
      cntrDetail = [{lbl:'神戸 20FT×'+panelK20,ct:dK20,clr:'#FFF0F0'},{lbl:'神戸 40HC×'+panelK40,ct:dK40,clr:'#FFE8E8'}];

    } else if (type === 'COLOAD') {
      // CO-LOAD：coload_ratesマスターからレート取得
      var clSelEl = $('s' + slotNum + '-c-cl');
      var clId = clSelEl ? clSelEl.value : '';
      var clRate = coloadRates.find(function(r) { return r.id === clId; }) || null;
      var ofUsd   = clRate ? nv(clRate.of_usd)  : 70;
      var efsUsd  = clRate ? nv(clRate.efs_usd) : 15;
      var ics2Usd = clRate ? nv(clRate.ics2_usd): 25;
      var cfsJpy  = clRate ? nv(clRate.cfs_jpy) : 4000;
      var thcJpy  = clRate ? nv(clRate.thc_jpy) : 1000;
      var drsJpy  = clRate ? nv(clRate.drs_jpy) : 300;
      var blCount = slotRows.length;
      var coloadCostPerRt = (ofUsd + efsUsd) * fx + (cfsJpy + thcJpy + drsJpy);
      var coloadCostPerBl = ics2Usd * fx;
      cntrCost = allM * coloadCostPerRt + blCount * coloadCostPerBl;
      var clName = clRate ? clRate.name : '未選択';
      cntrDetail = [{
        lbl: 'CO-LOAD [' + clName + ']（' + fmt(allM,1) + 'm³ × ¥' + fmt(coloadCostPerRt) + '/RT + ' + blCount + 'BL × ¥' + fmt(coloadCostPerBl) + '）',
        ct: { total: cntrCost, of: 0, fix: 0, van: 0, lash: 0, sur: 0 }, clr: '#FEF7E6'
      }];

    } else if (type === 'OLT') {
      // OLT：東京はsBT、神戸はsBK
      var dBT20 = ctByUnits(panelT20, tM, sBT20, fx, eur, false);
      var dBT40 = ctByUnits(panelT40, tM, sBT40, fx, eur, false);
      var dBK20 = ctByUnits(panelK20, kM, sBK20, fx, eur, true);
      var dBK40 = ctByUnits(panelK40, kM, sBK40, fx, eur, true);
      cntrCost = dBT20.total + dBT40.total + dBK20.total + dBK40.total;
      var cap20BT = nv(sBT20?sBT20.cap_m3:0)||25, cap40BT = nv(sBT40?sBT40.cap_m3:0)||50;
      var cap20BK = nv(sBK20?sBK20.cap_m3:0)||25, cap40BK = nv(sBK40?sBK40.cap_m3:0)||50;
      var btM20 = panelT20>0&&(panelT20+panelT40>0)?tM*panelT20*cap20BT/(panelT20*cap20BT+panelT40*cap40BT||1):(panelT40===0?tM:0);
      var btM40 = panelT40>0&&(panelT20+panelT40>0)?tM*panelT40*cap40BT/(panelT20*cap20BT+panelT40*cap40BT||1):(panelT20===0?tM:0);
      var bkM20 = panelK20>0&&(panelK20+panelK40>0)?kM*panelK20*cap20BK/(panelK20*cap20BK+panelK40*cap40BK||1):(panelK40===0?kM:0);
      var bkM40 = panelK40>0&&(panelK20+panelK40>0)?kM*panelK40*cap40BK/(panelK20*cap20BK+panelK40*cap40BK||1):(panelK20===0?kM:0);
      ref = calcRefundForCntr(btM20,tsM,allM,sBT20,fx)+calcRefundForCntr(btM40,tsM,allM,sBT40,fx)
           +calcRefundForCntr(bkM20,tsM,allM,sBK20,fx)+calcRefundForCntr(bkM40,tsM,allM,sBK40,fx);
      cntrDetail = [{lbl:'東京 20FT×'+panelT20,ct:dBT20,clr:'#F0F5FF'},{lbl:'東京 40HC×'+panelT40,ct:dBT40,clr:'#EAF5FF'},
                    {lbl:'神戸 20FT×'+panelK20,ct:dBK20,clr:'#F0FFF4'},{lbl:'神戸 40HC×'+panelK40,ct:dBK40,clr:'#E6FFEE'}];
      if (oltApply) {
        var olt = calcOLT(kM);
        oltForSlot = olt.total;
      }
    }

    var cost = cntrCost + oltForSlot + totalTs + agentCost + totalDel + totalMisc;
    var prof = totalRev - cost + ref;
    return { cost:cost, prof:prof, rev:totalRev, ref:ref, cntrDetail:cntrDetail,
             oltForSlot:oltForSlot, totalTs:totalTs, agentCost:agentCost,
             totalDel:totalDel, totalMisc:totalMisc, cntrCost:cntrCost,
             tM:tM, kM:kM, allM:allM };
  }

  // パネル本数
  var caT20 = Math.max(0, parseInt($('ca-t20').value)||0);
  var caT40 = Math.max(0, parseInt($('ca-t40').value)||0);
  var caK20 = Math.max(0, parseInt($('ca-k20').value)||0);
  var caK40 = Math.max(0, parseInt($('ca-k40').value)||0);
  var cbT20 = Math.max(0, parseInt($('cb-t20').value)||0);
  var cbT40 = Math.max(0, parseInt($('cb-t40').value)||0);
  var cbK20 = Math.max(0, parseInt($('cb-k20').value)||0);
  var cbK40 = Math.max(0, parseInt($('cb-k40').value)||0);

  // スロット1の船社（パターンタイプに応じて選択）
  var s1T20 = t1==='TK'?selT20:null,  s1T40 = t1==='TK'?selT40:null;
  var s1K20 = (t1==='TK'||t1==='KB')?selK20:null, s1K40 = (t1==='TK'||t1==='KB')?selK40:null;
  var s2T20 = t2==='TK'?sel2T20:null, s2T40 = t2==='TK'?sel2T40:null;
  var s2K20 = (t2==='TK'||t2==='KB')?sel2K20:null, s2K40 = (t2==='TK'||t2==='KB')?sel2K40:null;

  // 船社チェック（CO-LOADはcoload_ratesから選ぶため別扱い）
  function slotHasCarrier(type, sT20, sT40, sK20, sK40, sBT20, sBT40, sBK20, sBK40, slotN) {
    if (type === 'COLOAD') {
      var clSel = $('s' + slotN + '-c-cl');
      return !!(clSel && clSel.value);
    }
    if (type === 'TK') return !!(sT20||sT40||sK20||sK40);
    if (type === 'KB') return !!(sK20||sK40);
    if (type === 'OLT') return !!(sBT20||sBT40||sBK20||sBK40);
    return false;
  }
  var hasS1 = slotHasCarrier(t1, s1T20, s1T40, s1K20, s1K40, selBT20, selBT40, selBK20, selBK40, 1);
  var hasS2 = slotHasCarrier(t2, s2T20, s2T40, s2K20, s2K40, sel2BT20, sel2BT40, sel2BK20, sel2BK40, 2);
  if ((!hasS1 && !hasS2) || !rows.length) {
    $('result-card').style.display = 'none';
    $('sum-bar').style.display = 'none';
    if ($('save-card')) $('save-card').style.display = 'none';
    return;
  }

  // パターン別売上・コスト集計
  var totalRevA = rowsA.reduce(function(s, r) { return s + rowRev(r, fx); }, 0);
  var totalRevB = rowsB.reduce(function(s, r) { return s + rowRev(r, fx); }, 0);
  var totalRev  = rows.reduce(function(s, r) { return s + rowRev(r, fx); }, 0);
  var totalDelA  = rowsA.reduce(function(s, r) { return s + r.dc * fx; }, 0);
  var totalDelB  = rowsB.reduce(function(s, r) { return s + r.dc * fx; }, 0);
  var totalMiscA = rowsA.reduce(function(s, r) { return s + r.nstkCost + r.pltCost; }, 0);
  var totalMiscB = rowsB.reduce(function(s, r) { return s + r.nstkCost + r.pltCost; }, 0);
  var totalTsA   = rowsA.reduce(function(s, r) { return s + rowTsCost(r, fx); }, 0);
  var totalTsB   = rowsB.reduce(function(s, r) { return s + rowTsCost(r, fx); }, 0);

  function calcAgentCost(targetRows) {
    var cost = 0;
    if (!selAgent) return cost;
    targetRows.forEach(function(r) {
      var rate = null;
      selAgent.rates.forEach(function(a) { if (a.destination === r.dest) rate = a; });
      if (!rate) selAgent.rates.forEach(function(a) { if (a.destination === 'ALL') rate = a; });
      if (!rate) return;
      cost += (nv(rate.ts_cost_usd) * r.vol + nv(rate.fixed_usd)) * fx + nv(rate.handling_jpy);
    });
    return cost;
  }

  // スロット1計算
  var r1 = calcSlot(rowsA, 'baseA', t1,
    s1T20, s1T40, s1K20, s1K40, selBT20, selBT40, selBK20, selBK40, selCL20, selCL40,
    caT20, caT40, caK20, caK40, t1==='TK'?oltApplyA:(t1==='OLT'?oltApplyB:false), 1);
  // スロット2計算
  var r2 = calcSlot(rowsB, 'baseB', t2,
    s2T20, s2T40, s2K20, s2K40, sel2BT20, sel2BT40, sel2BK20, sel2BK40, sel2CL20, sel2CL40,
    cbT20, cbT40, cbK20, cbK40, t2==='TK'?oltApplyA:(t2==='OLT'?oltApplyB:false), 2);

  // 後方互換変数（比較テーブル・det-a/b等で使用）
  var costA = r1.cost, profA = r1.prof, totalRevA = r1.rev, refA = r1.ref;
  var costB = r2.cost, profB = r2.prof, totalRevB = r2.rev, refB = r2.ref;
  var agentCostA = r1.agentCost, agentCostB = r2.agentCost;
  var oltForA = r1.oltForSlot, oltForB = r2.oltForSlot;
  totalTsA = r1.totalTs; totalTsB = r2.totalTs;
  totalDelA = r1.totalDel; totalDelB = r2.totalDel;
  totalMiscA = r1.totalMisc; totalMiscB = r2.totalMisc;

  // REFUND按分（det-a/b表示用の旧変数を引き継ぎ）
  var tMA = r1.tM, kMA = r1.kM, allMA = r1.allM;
  var tsMB = rowsB.filter(function(r){return r.tsApply;}).reduce(function(s,r){return s+r.vol;},0);
  var allMB = r2.allM;
  var tMB_vol = r2.tM, kMB_vol = r2.kM;
  var tsMA = rowsA.filter(function(r){return r.tsApply;}).reduce(function(s,r){return s+r.vol;},0);

  // det-a/det-b：cntrDetailから生成
  function buildDetHtml(slotResult, type, slotRows) {
    var dLines = [];
    slotResult.cntrDetail.forEach(function(d) {
      if (!d.ct || d.ct.total === 0) return;
      dLines.push('<div style="margin-bottom:.5rem;background:' + d.clr + ';border-radius:6px;padding:.55rem .8rem">');
      dLines.push('<div style="font-size:10px;font-weight:700;color:var(--tx2);margin-bottom:.3rem">' + d.lbl + '</div>');
      if (d.ct.of)  dLines.push(dr('O/F+BAF', fmtY(d.ct.of)));
      if (d.ct.fix) dLines.push(dr('固定費', fmtY(d.ct.fix)));
      if (d.ct.van) dLines.push(dr('VANNING', fmtY(d.ct.van)));
      if (d.ct.lash>0) dLines.push(dr('ラッシング', fmtY(d.ct.lash)));
      if (d.ct.sur>0)  dLines.push(dr('追加サーチャージ', fmtY(d.ct.sur)));
      dLines.push(dr('<b>コスト計</b>', '<b>'+fmtY(d.ct.total)+'</b>'));
      dLines.push('</div>');
    });
    if (slotResult.totalTs!==0) dLines.push(dr('T/Sコスト', fmtY(slotResult.totalTs), 'tsc'));
    if (slotResult.agentCost!==0) dLines.push(dr('AGENTコスト', fmtY(slotResult.agentCost), 'tsc'));
    if (slotResult.oltForSlot>0) {
      var kM3 = slotResult.kM;
      var handRate = nv($('olt-handling')?$('olt-handling').value:1800);
      var olt = calcOLT(kM3);
      dLines.push('<div class="divider"></div>');
      if (olt.truck>0) dLines.push(dr('OLTトラック', fmtY(olt.truck), 'olt'));
      dLines.push(dr('入出庫料（¥'+fmt(handRate)+'/RT × '+fmt(kM3,1)+'m³）', fmtY(olt.handling), 'olt'));
    }
    if (slotResult.totalMisc>0) dLines.push(dr('段積不可/パレタイズ', fmtY(slotResult.totalMisc)));
    dLines.push(dr('現地Delivery', fmtY(slotResult.totalDel)));
    return dLines.join('');
  }
  if ($('det-a')) $('det-a').innerHTML = buildDetHtml(r1, t1, rowsA);
  if ($('det-b')) $('det-b').innerHTML = buildDetHtml(r2, t2, rowsB);

  // パネルメモ（スロット別）
  if ($('ca-note')) $('ca-note').textContent = PATTERN_LABELS[t1] + '　東京:20FT×' + caT20 + '/40HC×' + caT40 + '　神戸:20FT×' + caK20 + '/40HC×' + caK40;
  if ($('cb-note')) $('cb-note').textContent = PATTERN_LABELS[t2] + '　東京:20FT×' + cbT20 + '/40HC×' + cbT40 + '　神戸:20FT×' + cbK20 + '/40HC×' + cbK40;

  // サマリー
  $('sv-t').textContent   = fmt(tM,1) + 'm³';
  $('sv-k').textContent   = fmt(kM,1) + 'm³';
  $('sv-all').textContent = fmt(allM,1) + 'm³';
  $('sv-ts').textContent  = fmt(tsM,1) + 'm³';
  $('sv-rv').textContent  = fmt(refM,1) + 'm³';
  $('sv-rev').textContent = fmtY(totalRev);
  $('sv-ref').textContent = fmtY(Math.max(refA, refB));
  var agentCostMax = Math.max(agentCostA, agentCostB);
  if (agentCostMax !== 0) { $('sv-ag-wrap').style.display=''; $('sv-ag').textContent=fmtY(agentCostMax); }
  else                    { $('sv-ag-wrap').style.display='none'; }
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
  // パターンB T/S按分
  var tsBT20 = allMB > 0 ? tsMB * (btM20 / allMB) : 0;
  var tsBT40 = allMB > 0 ? tsMB * (btM40 / allMB) : 0;
  var tsBK20 = allMB > 0 ? tsMB * (bkM20 / allMB) : 0;
  var tsBK40 = allMB > 0 ? tsMB * (bkM40 / allMB) : 0;

  dA.push(cntrBlock('東京 20FT × ' + caT20 + '本 [' + tCarrier + ']', caT20, cAT20, refAT20, nv(selT20 ? selT20.refund_per_rt : 0), '#F0F5FF', tM20, tsAT20));
  dA.push(cntrBlock('東京 40HC × ' + caT40 + '本 [' + tCarrier + ']', caT40, cAT40, refAT40, nv(selT40 ? selT40.refund_per_rt : 0), '#EAF5FF', tM40, tsAT40));
  dA.push(cntrBlock('神戸 20FT × ' + caK20 + '本 [' + kCarrier + ']', caK20, cAK20, refAK20, nv(selK20 ? selK20.refund_per_rt : 0), '#FFF0F0', kM20, tsAK20));
  dA.push(cntrBlock('神戸 40HC × ' + caK40 + '本 [' + kCarrier + ']', caK40, cAK40, refAK40, nv(selK40 ? selK40.refund_per_rt : 0), '#FFE8E8', kM40, tsAK40));

  var surA = cAT20.sur + cAT40.sur + cAK20.sur + cAK40.sur;
  if (totalTsA > 0)    dA.push(dr('T/Sコスト（仕向地別）', fmtY(totalTsA), 'tsc'));
  if (totalTsA < 0)    dA.push(dr('T/S割引', fmtY(totalTsA), 'ref'));
  if (agentCostA !== 0) dA.push(dr('AGENTコスト（' + (selAgent ? selAgent.name : '') + '）', fmtY(agentCostA), 'tsc'));
  if (oltApplyA && kMA > 0) {
    dA.push(oltA.truck > 0 ? dr('OLT トラック（' + oltA.desc + '）', fmtY(oltA.truck), 'olt') : dr('OLT', '手配なし（トラック未選択）', 'olt'));
    var handlingRateA = nv($('olt-handling') ? $('olt-handling').value : 1800);
    dA.push(dr('入出庫料（¥' + fmt(handlingRateA) + '/RT × ' + fmt(kMA_olt,1) + 'm³）', fmtY(oltA.handling), 'olt'));
  } else if (kMA > 0) {
    dA.push(dr('OLT', '適用なし', 'olt'));
  }
  if (totalMiscA > 0)  dA.push(dr('段積不可/パレタイズ', fmtY(totalMiscA)));
  dA.push(dr('現地Delivery合計', fmtY(totalDelA)));

  // パターンA 損益サマリー
  dA.push('<div style="margin-top:.6rem;background:var(--sur2);border-radius:8px;padding:.65rem .9rem">');
  dA.push('<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">');
  dA.push('<div><div style="font-size:10px;color:var(--tx2)">総売上</div><div style="font-family:var(--mono);font-weight:600">' + fmtY(totalRevA) + '</div></div>');
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
  dB.push(cntrBlock('東京 20FT × ' + cbT20 + '本 [' + btCarrier + ']', cbT20, cBT20, refBT20, nv(selBT20 ? selBT20.refund_per_rt : 0), '#F0F5FF', btM20, tsBT20));
  dB.push(cntrBlock('東京 40HC × ' + cbT40 + '本 [' + btCarrier + ']', cbT40, cBT40, refBT40, nv(selBT40 ? selBT40.refund_per_rt : 0), '#EAF5FF', btM40, tsBT40));
  dB.push(cntrBlock('神戸 20FT × ' + cbK20 + '本 [' + bkCarrier + ']', cbK20, cBK20, refBK20, nv(selBK20 ? selBK20.refund_per_rt : 0), '#F0FFF4', bkM20, tsBK20));
  dB.push(cntrBlock('神戸 40HC × ' + cbK40 + '本 [' + bkCarrier + ']', cbK40, cBK40, refBK40, nv(selBK40 ? selBK40.refund_per_rt : 0), '#E6FFEE', bkM40, tsBK40));

  if (totalTsB > 0)     dB.push(dr('T/Sコスト（仕向地別）', fmtY(totalTsB), 'tsc'));
  if (totalTsB < 0)     dB.push(dr('T/S割引', fmtY(totalTsB), 'ref'));
  if (agentCostB !== 0) dB.push(dr('AGENTコスト（' + (selAgent ? selAgent.name : '') + '）', fmtY(agentCostB), 'tsc'));
  dB.push('<div class="divider"></div>');
  var kMB_olt = rowsB.filter(function(r) { return r.baseB === '神戸'; }).reduce(function(s, r) { return s + r.vol; }, 0);
  dB.push(kMB_olt > 0
    ? (oltApplyB
        ? (oltB.truck > 0
            ? dr('OLT トラック（' + oltB.desc + '）', fmtY(oltB.truck), 'olt')
            : dr('OLT', '手配なし（トラック未選択）', 'olt'))
        : dr('OLT', '適用なし', 'olt'))
    : dr('OLT', 'なし（神戸貨物なし）', 'olt'));
  if (kMB_olt > 0 && oltApplyB) {
    var handlingRate = nv($('olt-handling') ? $('olt-handling').value : 1800);
    dB.push(dr('入出庫料（¥' + fmt(handlingRate) + '/RT × ' + fmt(kMB_olt,1) + 'm³）', fmtY(oltB.handling), 'olt'));
  }
  if (totalMiscB > 0) dB.push(dr('段積不可/パレタイズ', fmtY(totalMiscB)));
  dB.push(dr('現地Delivery合計', fmtY(totalDelB)));

  // パターンB 損益サマリー
  dB.push('<div style="margin-top:.6rem;background:var(--sur2);border-radius:8px;padding:.65rem .9rem">');
  dB.push('<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">');
  dB.push('<div><div style="font-size:10px;color:var(--tx2)">総売上</div><div style="font-family:var(--mono);font-weight:600">' + fmtY(totalRevB) + '</div></div>');
  dB.push('<div><div style="font-size:10px;color:var(--tx2)">総コスト</div><div style="font-family:var(--mono);font-weight:600">' + fmtY(costB) + '</div></div>');
  dB.push('<div><div style="font-size:10px;color:var(--tx2)">REFUND合計</div><div style="font-family:var(--mono);font-weight:600;color:var(--amber)">' + fmtY(refB) + '</div></div>');
  dB.push('</div>');
  dB.push('<div style="margin-top:.4rem;padding-top:.4rem;border-top:1px solid var(--brd);font-size:10px;color:var(--tx3)">');
  var r20BT = nv(selBT20 ? selBT20.refund_per_rt : 0);
  var r40BT = nv(selBT40 ? selBT40.refund_per_rt : 0);
  var r20BK = nv(selBK20 ? selBK20.refund_per_rt : 0);
  var r40BK = nv(selBK40 ? selBK40.refund_per_rt : 0);
  dB.push('20FT REFUND: 東京$' + fmt(r20BT,2) + '×' + fmt(btM20,1) + 'm³ + 神戸$' + fmt(r20BK,2) + '×' + fmt(bkM20,1) + 'm³　40HC REFUND: 東京$' + fmt(r40BT,2) + '×' + fmt(btM40,1) + 'm³ + 神戸$' + fmt(r40BK,2) + '×' + fmt(bkM40,1) + 'm³（T/S除外後）');
  dB.push('</div></div>');
  $('det-b').innerHTML = dB.join('');

  // 顧客内訳（パターン別に適用行を区別して表示）
  function buildCbHtml(targetRows, useBaseKey) {
    return targetRows.map(function(r) {
      var base = useBaseKey === 'B' ? r.baseB : r.baseA;
      var rev = rowRev(r, fx);
      var tsCost = rowTsCost(r, fx);
      var bi = baseInfo(base === '東京' ? 'TOKYO' : 'KOBE');
      var tsTag  = r.tsApply ? '<span style="font-size:9px;background:var(--purple-bg);color:var(--purple);padding:1px 5px;border-radius:3px">' + r.dest + '</span>' : '';
      var tsNote = tsCost !== 0 ? '<br><span style="color:var(--purple);font-size:10px">T/S ' + fmtY(tsCost) + '</span>' : '';
      return '<div class="cb-row"><span class="cb-name">' + r.custName + ' ' + tsTag + '</span><span class="cb-tag ' + bi.tagCls + '">' + bi.label + '</span><span class="cb-vol">' + fmt(r.vol,1) + 'm³</span><span class="cb-sell">' + fmtY(rev) + tsNote + '</span></div>';
    }).join('') || '<div style="font-size:11px;color:var(--tx3);padding:4px 0">（対象なし）</div>';
  }
  $('cb-a').innerHTML = buildCbHtml(rowsA, 'A');
  $('cb-b').innerHTML = buildCbHtml(rowsB, 'B');

  // rsub（適用顧客数を表示）
  if ($('rsub-a')) $('rsub-a').textContent = '東京: 20FT×' + caT20 + ' / 40HC×' + caT40 + '　神戸: 20FT×' + caK20 + ' / 40HC×' + caK40 + '　（' + rowsA.length + '顧客）';
  if ($('rsub-b')) $('rsub-b').textContent = 'B東京: 20FT×' + cbT20 + '/40HC×' + cbT40 + '　B神戸: 20FT×' + cbK20 + '/40HC×' + cbK40 + '　（' + rowsB.length + '顧客）';

  // ── 比較テーブル生成 ──────────────────────────────────────────
  var winner = profA > profB ? 'A' : profB > profA ? 'B' : '-';

  // ヘッダーのrsub更新
  if ($('rsub-a')) $('rsub-a').textContent = '東京: 20FT×' + caT20 + '/40HC×' + caT40 + '　神戸: 20FT×' + caK20 + '/40HC×' + caK40;
  if ($('rsub-b')) $('rsub-b').textContent = '東京: 20FT×' + cbT20 + '/40HC×' + cbT40 + '　神戸: 20FT×' + cbK20 + '/40HC×' + cbK40;

  // テーブルヘッダー：パターン名を反映
  var thA = $('th-a'), thB = $('th-b');
  var label1 = PATTERN_LABELS[t1] || 'スロット1';
  var label2 = PATTERN_LABELS[t2] || 'スロット2';
  if (thA) { thA.childNodes[0].textContent = label1 + ' '; thA.style.color = winner === 'A' ? 'var(--acc)' : 'var(--tx)'; thA.style.background = winner === 'A' ? 'var(--acc-bg)' : ''; }
  if (thB) { thB.childNodes[0].textContent = label2 + ' '; thB.style.color = winner === 'B' ? 'var(--acc)' : 'var(--tx)'; thB.style.background = winner === 'B' ? 'var(--acc-bg)' : ''; }

  // ヘルパー
  function cmpRow(label, vA, vB, cls, indent) {
    var dv = vA - vB;
    var diffCls = Math.abs(dv) < 1 ? 'neu' : (dv > 0 ? 'adv' : 'dis');
    var diffTxt = Math.abs(dv) < 1 ? '─' : (dv > 0 ? '+' : '') + fmt(dv);
    var indentStyle = indent ? 'padding-left:20px;color:var(--tx2)' : '';
    return '<tr>' +
      '<td style="' + indentStyle + '">' + label + '</td>' +
      '<td class="cv ' + (cls||'') + '">' + (vA === null ? '─' : fmtY(vA)) + '</td>' +
      '<td class="cv ' + (cls||'') + '">' + (vB === null ? '─' : fmtY(vB)) + '</td>' +
      '<td class="diff ' + diffCls + '">' + diffTxt + '</td>' +
    '</tr>';
  }
  function secRow(label) {
    return '<tr class="cmp-section"><td colspan="4">' + label + '</td></tr>';
  }
  function nullIfZero(v) { return v === 0 ? null : v; }

  var rows_html = [];

  // ── コンテナコスト ──
  rows_html.push(secRow('コンテナコスト'));
  // 東京
  if (caT20 > 0 || cbT20 > 0)
    rows_html.push(cmpRow('東京 20FT　A:×' + caT20 + '本 / B:×' + cbT20 + '本',
      caT20 > 0 ? cAT20.total : null, cbT20 > 0 ? cBT20.total : null, '', true));
  if (caT40 > 0 || cbT40 > 0)
    rows_html.push(cmpRow('東京 40HC　A:×' + caT40 + '本 / B:×' + cbT40 + '本',
      caT40 > 0 ? cAT40.total : null, cbT40 > 0 ? cBT40.total : null, '', true));
  // 神戸
  if (caK20 > 0 || cbK20 > 0)
    rows_html.push(cmpRow('神戸 20FT　A:×' + caK20 + '本 / B:×' + cbK20 + '本',
      caK20 > 0 ? cAK20.total : null, cbK20 > 0 ? cBK20.total : null, '', true));
  if (caK40 > 0 || cbK40 > 0)
    rows_html.push(cmpRow('神戸 40HC　A:×' + caK40 + '本 / B:×' + cbK40 + '本',
      caK40 > 0 ? cAK40.total : null, cbK40 > 0 ? cBK40.total : null, '', true));

  var cntrA = cAT20.total + cAT40.total + cAK20.total + cAK40.total;
  var cntrB = cBT20.total + cBT40.total + cBK20.total + cBK40.total;
  rows_html.push(cmpRow('　コンテナコスト 計', cntrA, cntrB, ''));

  // ── OLT費用 ──
  var kRowsAol = rowsA.filter(function(r){return r.baseA==='神戸';});
  var kMAol = kRowsAol.reduce(function(s,r){return s+r.vol;},0);
  var kMBol = rowsB.filter(function(r){return r.baseB==='神戸';}).reduce(function(s,r){return s+r.vol;},0);
  var hasOltSection = (oltApplyA && kMAol > 0) || (oltApplyB && kMBol > 0);
  if (hasOltSection) {
    rows_html.push(secRow('OLT費用（神戸→東京）'));
    var truckA = oltApplyA && kMAol > 0 ? oltA.truck : null;
    var truckB = oltApplyB && kMBol > 0 ? oltB.truck : null;
    if (truckA !== null || truckB !== null)
      rows_html.push(cmpRow('トラック費用', truckA, truckB, 'olt', true));
    var handA = oltApplyA && kMAol > 0 ? oltA.handling : null;
    var handB = oltApplyB && kMBol > 0 ? oltB.handling : null;
    if (handA !== null || handB !== null)
      rows_html.push(cmpRow('入出庫料（¥' + fmt(nv($('olt-handling').value)) + '/RT）', handA, handB, 'olt', true));
    rows_html.push(cmpRow('　OLT合計', oltApplyA&&kMAol>0?oltForA:null, oltApplyB&&kMBol>0?oltForB:null, 'olt'));
  }

  // ── T/S・AGENT ──
  if (totalTsA !== 0 || totalTsB !== 0) {
    rows_html.push(secRow('T/S・AGENT'));
    if (totalTsA !== 0 || totalTsB !== 0)
      rows_html.push(cmpRow('T/Sコスト', nullIfZero(totalTsA), nullIfZero(totalTsB), 'tsc', true));
    if (agentCostA !== 0 || agentCostB !== 0)
      rows_html.push(cmpRow('AGENTコスト', nullIfZero(agentCostA), nullIfZero(agentCostB), 'tsc', true));
  }

  // ── その他コスト ──
  rows_html.push(secRow('その他コスト'));
  rows_html.push(cmpRow('現地Delivery', totalDelA, totalDelB, '', true));
  if (totalMiscA > 0 || totalMiscB > 0)
    rows_html.push(cmpRow('段積不可/パレタイズ', totalMiscA, totalMiscB, '', true));

  // ── 総コスト ──
  rows_html.push('<tr class="cmp-total">' +
    '<td><strong>総コスト</strong></td>' +
    '<td class="cv"><strong>' + fmtY(costA) + '</strong></td>' +
    '<td class="cv"><strong>' + fmtY(costB) + '</strong></td>' +
    '<td class="diff ' + (costA-costB < -1 ? 'adv' : costA-costB > 1 ? 'dis' : 'neu') + '">' + (Math.abs(costA-costB)<1?'─':(costA-costB>0?'+':'')+fmt(costA-costB)) + '</td>' +
  '</tr>');

  // ── 売上・REFUND ──
  rows_html.push(secRow('売上・REFUND'));
  rows_html.push(cmpRow('総売上', totalRevA, totalRevB, ''));
  if (refA > 0 || refB > 0)
    rows_html.push(cmpRow('REFUND', refA, refB, 'ref'));

  // ── 利益（REFUND込み） ──
  var profDiff = profA - profB;
  rows_html.push('<tr class="cmp-profit">' +
    '<td><strong>利益（REFUND込）</strong></td>' +
    (winner === 'A'
      ? '<td style="text-align:right;vertical-align:middle"><div style="display:inline-block;background:var(--acc);color:#fff;border-radius:8px;padding:6px 14px;font-family:var(--mono);font-size:16px;font-weight:900;box-shadow:0 2px 8px rgba(26,92,58,.35)">' + fmtY(profA) + ' 🏆</div></td>'
      : '<td class="cv ' + (profA >= 0 ? 'pos' : 'neg') + '" style="font-size:14px;font-weight:700">' + fmtY(profA) + '</td>') +
    (winner === 'B'
      ? '<td style="text-align:right;vertical-align:middle"><div style="display:inline-block;background:var(--acc);color:#fff;border-radius:8px;padding:6px 14px;font-family:var(--mono);font-size:16px;font-weight:900;box-shadow:0 2px 8px rgba(26,92,58,.35)">' + fmtY(profB) + ' 🏆</div></td>'
      : '<td class="cv ' + (profB >= 0 ? 'pos' : 'neg') + '" style="font-size:14px;font-weight:700">' + fmtY(profB) + '</td>') +
    '<td class="diff ' + (Math.abs(profDiff)<1?'neu':profDiff>0?'adv':'dis') + '" style="font-size:12px;font-weight:700">' +
      (Math.abs(profDiff)<1 ? '同等' : (profDiff>0?'+':'')+fmt(profDiff)) +
    '</td>' +
  '</tr>');

  $('cmp-body').innerHTML = rows_html.join('');

  // ── badge・rc（後方互換） ──
  ['a','b'].forEach(function(p) {
    $('badge-' + p).innerHTML = '';
    var rc = $('rc-' + p); if (rc) rc.classList.remove('winner');
  });
  if (winner === 'A') { $('badge-a').innerHTML = '<span class="wbadge">推奨</span>'; if($('rc-a')) $('rc-a').classList.add('winner'); }
  if (winner === 'B') { $('badge-b').innerHTML = '<span class="wbadge">推奨</span>'; if($('rc-b')) $('rc-b').classList.add('winner'); }

  // ── 旧id更新（後方互換：rv/co/pr） ──
  if ($('rv-a')) $('rv-a').textContent = fmtY(totalRevA);
  if ($('rv-b')) $('rv-b').textContent = fmtY(totalRevB);
  if ($('co-a')) $('co-a').textContent = fmtY(costA);
  if ($('co-b')) $('co-b').textContent = fmtY(costB);
  var epa = $('pr-a'); if (epa) { epa.textContent = fmtY(profA); epa.className = 'mv '+(profA>=0?'pos':'neg'); }
  var epb = $('pr-b'); if (epb) { epb.textContent = fmtY(profB); epb.className = 'mv '+(profB>=0?'pos':'neg'); }

  // ── 結論バナー ──
  var diff = Math.abs(profA - profB);
  var html = '';
  if (profA > profB) {
    html = '<div class="cbox ok"><p>✅ <strong>パターンA が有利</strong>（差額：' + fmtY(diff) + '）' +
      (refA>0?' REFUND '+fmtY(refA):'') + (totalTsA!==0?' / T/S '+fmtY(totalTsA):'') +
      '<br><span style="font-size:11px">OLT費用なし or コンテナ効率が上回る</span></p></div>';
  } else if (profB > profA) {
    html = '<div class="cbox ok"><p>✅ <strong>パターンB が有利</strong>（差額：' + fmtY(diff) + '）' +
      (refB>0?' REFUND '+fmtY(refB):'') + (totalTsB!==0?' / T/S '+fmtY(totalTsB):'') +
      '<br><span style="font-size:11px">OLT費用（' + fmtY(oltForB) + '）を含めても合算効果が上回る</span></p></div>';
  } else {
    html = '<div class="cbox ok"><p>⚖️ パターンA・Bは同等の利益です。</p></div>';
  }
  $('concl').innerHTML = html;
  $('result-card').style.display = 'block';
  if ($('save-card')) $('save-card').style.display = '';
};

// ── 荷主内訳アコーディオン ────────────────────────────────────
window.toggleCbDetail = function() {
  var d = $('cb-detail');
  var btn = $('cb-toggle-btn');
  if (!d) return;
  var open = d.style.display !== 'none';
  d.style.display = open ? 'none' : '';
  btn.textContent = open ? '▶ 荷主内訳を表示' : '▼ 荷主内訳を閉じる';
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
  if (!allCosts.length) { tb.innerHTML = '<tr><td colspan="26" class="loading">データがありません</td></tr>'; return; }
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
      '<td>' + nz(c.olt_handling_jpy,'¥') + '</td>' +
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
    'km-handling': c ? c.olt_handling_jpy : 1800,
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
    olt_handling_jpy: g('km-handling'),
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

// ── CO-LOAD CRUD ─────────────────────────────────────────────
function renderColoadTable() {
  var tb = $('cltb');
  if (!tb) return;
  if (!coloadRates.length) { tb.innerHTML = '<tr><td colspan="9" class="loading">CO-LOAD業者が登録されていません</td></tr>'; return; }
  var nz = function(v, pre) { return nv(v) ? (pre || '') + fmt(v, nv(v)%1!==0?2:0) : '-'; };
  tb.innerHTML = coloadRates.map(function(c) {
    return '<tr>' +
      '<td><strong style="color:var(--amber)">' + c.name + '</strong></td>' +
      '<td style="color:var(--amber)">$' + fmt(c.of_usd,0) + '</td>' +
      '<td style="color:var(--amber)">$' + fmt(c.efs_usd,0) + '</td>' +
      '<td style="color:var(--amber)">$' + fmt(c.ics2_usd,0) + '/BL</td>' +
      '<td>¥' + fmt(c.cfs_jpy) + '</td>' +
      '<td>¥' + fmt(c.thc_jpy) + '</td>' +
      '<td>¥' + fmt(c.drs_jpy) + '</td>' +
      '<td style="font-size:11px;color:var(--tx3)">' + (c.memo || '-') + '</td>' +
      '<td style="white-space:nowrap"><button class="btn btn-sm" style="margin-right:4px" onclick="editCoload(\'' + c.id + '\')">編集</button><button class="delbtn" onclick="delCoload(\'' + c.id + '\')">削除</button></td></tr>';
  }).join('');
}

window.openCLM = function(c) {
  c = c || null;
  $('clm-title').textContent = c ? 'CO-LOADコストを編集' : 'CO-LOADコストを追加';
  $('clm-id').value = c ? c.id : '';
  $('clm-name').value = c ? c.name : '';
  $('clm-memo').value = c ? (c.memo || '') : '';
  var def = {
    'clm-of':  c ? c.of_usd  : 70,
    'clm-efs': c ? c.efs_usd : 15,
    'clm-ics2':c ? c.ics2_usd: 25,
    'clm-cfs': c ? c.cfs_jpy : 4000,
    'clm-thc': c ? c.thc_jpy : 1000,
    'clm-drs': c ? c.drs_jpy : 300
  };
  Object.keys(def).forEach(function(id) {
    var el = $(id); if (!el) return;
    el.value = fmt(nv(def[id]));
  });
  $('clm-modal').style.display = 'block';
};
window.closeCLM = function() { $('clm-modal').style.display = 'none'; };
window.editCoload = function(id) { coloadRates.forEach(function(c) { if (c.id === id) openCLM(c); }); };
window.saveCoload = async function() {
  var name = $('clm-name').value.trim();
  if (!name) { toast('業者名を入力してください', 'err'); return; }
  var g = function(id) { return nv($(id).value); };
  var row = {
    name: name,
    of_usd:   g('clm-of'),
    efs_usd:  g('clm-efs'),
    ics2_usd: g('clm-ics2'),
    cfs_jpy:  g('clm-cfs'),
    thc_jpy:  g('clm-thc'),
    drs_jpy:  g('clm-drs'),
    memo: $('clm-memo').value,
    updated_at: new Date().toISOString()
  };
  var id = $('clm-id').value;
  var r = id ? await sbUpdate('coload_rates', id, row) : await sbInsert('coload_rates', row);
  if (r.error) { toast('保存失敗: ' + r.error.message, 'err'); return; }
  toast('保存しました'); closeCLM(); await loadAll(); renderColoadTable();
};
window.delCoload = async function(id) {
  if (!confirm('削除しますか？')) return;
  var r = await sbDelete('coload_rates', id);
  if (r.error) { toast('削除失敗: ' + r.error.message, 'err'); return; }
  toast('削除しました'); await loadAll(); renderColoadTable();
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
['olt-tr4','olt-tr10','olt-tr10z','olt-handling','van-tokyo','van-kobe','lashing'].forEach(function(id) {
  var el = $(id); if (el) el.addEventListener('input', function() { fmtI(el); calc(); });
});

// ── 共有コード生成 ─────────────────────────────────────────────
function genShareCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── シミュレーションデータを収集 ──────────────────────────────
function collectSimData() {
  var rows = [];
  document.querySelectorAll('#row-body tr').forEach(function(tr) {
    var id = tr.dataset.rid;
    var g = function(f) { var el = document.getElementById('rb-' + f + '-' + id); return el ? el.value : ''; };
    var custSel = tr.querySelector('.row-cust-sel');
    var gs = function(f) { var el = document.getElementById('rb-' + f + '-' + id); return el ? el.value : ''; };
    var row = {
      custId:   custSel ? custSel.value : '',
      baseA:    gs('base-a') || '東京',
      baseB:    gs('base-b') || '東京',
      vol:      gs('vol'),
      dest:     document.getElementById('rb-dest-' + id) ? document.getElementById('rb-dest-' + id).value : 'RTM',
      tsApply:  document.getElementById('rb-tschk-' + id) ? document.getElementById('rb-tschk-' + id).checked : false,
      useA:     document.getElementById('rb-use-a-' + id) ? document.getElementById('rb-use-a-' + id).checked : true,
      useB:     document.getElementById('rb-use-b-' + id) ? document.getElementById('rb-use-b-' + id).checked : true,
      of:g('of'),lss:g('lss'),pss:g('pss'),efs:g('efs'),ics:g('ics'),
      cfs:g('cfs'),thc:g('thc'),drs:g('drs'),
      bl:g('bl'),decl:g('decl'),chand:g('chand'),ot:g('ot'),
      ds:g('ds'),dc:g('dc'),
      nstku:g('nstku'),nstkq:g('nstkq'),pltu:g('pltu'),pltq:g('pltq'),
      ts:g('ts')
    };
    rows.push(row);
  });

  return {
    v: 1,
    title: ($('sim-title') ? $('sim-title').value : '') || '',
    fx:   $('sim-fx')    ? $('sim-fx').value    : '155',
    eur:  $('sim-eur')   ? $('sim-eur').value   : '165',
    slot1Type: getSlotType(1),
    slot2Type: getSlotType(2),
    s1ct:  $('s1-c-t')  ? $('s1-c-t').value  : '',
    s1ck:  $('s1-c-k')  ? $('s1-c-k').value  : '',
    s1ccl: $('s1-c-cl') ? $('s1-c-cl').value : '',
    s1cbt: $('s1-c-bt') ? $('s1-c-bt').value : '',
    s1cbk: $('s1-c-bk') ? $('s1-c-bk').value : '',
    s2ct:  $('s2-c-t')  ? $('s2-c-t').value  : '',
    s2ck:  $('s2-c-k')  ? $('s2-c-k').value  : '',
    s2ccl: $('s2-c-cl') ? $('s2-c-cl').value : '',
    s2cbt: $('s2-c-bt') ? $('s2-c-bt').value : '',
    s2cbk: $('s2-c-bk') ? $('s2-c-bk').value : '',
    agent:    $('sim-agent')     ? $('sim-agent').value     : '',
    vanTokyo: $('van-tokyo') ? $('van-tokyo').value : '',
    vanKobe:  $('van-kobe')  ? $('van-kobe').value  : '',
    lashing:  $('lashing')   ? $('lashing').value   : '',
    oltHandling: $('olt-handling') ? $('olt-handling').value : '',
    oltTr4:   $('olt-tr4')   ? $('olt-tr4').value   : '',
    oltTr10:  $('olt-tr10')  ? $('olt-tr10').value  : '',
    oltTr10z: $('olt-tr10z') ? $('olt-tr10z').value : '',
    oltChk4:   $('olt-chk-4')   ? $('olt-chk-4').checked   : false,
    oltChk10:  $('olt-chk-10')  ? $('olt-chk-10').checked  : false,
    oltChk10z: $('olt-chk-10z') ? $('olt-chk-10z').checked : false,
    oltApplyA: $('olt-apply-a') ? $('olt-apply-a').checked  : false,
    oltApplyB: $('olt-apply-b') ? $('olt-apply-b').checked  : true,
    caT20: $('ca-t20') ? $('ca-t20').value : '0',
    caT40: $('ca-t40') ? $('ca-t40').value : '0',
    caK20: $('ca-k20') ? $('ca-k20').value : '0',
    caK40: $('ca-k40') ? $('ca-k40').value : '0',
    cbT20: $('cb-t20') ? $('cb-t20').value : '0',
    cbT40: $('cb-t40') ? $('cb-t40').value : '0',
    cbK20: $('cb-k20') ? $('cb-k20').value : '0',
    cbK40: $('cb-k40') ? $('cb-k40').value : '0',
    rows:  rows
  };
}

// ── シミュレーションデータを復元 ──────────────────────────────
async function restoreSimData(data) {
  if (!data || data.v !== 1) return;

  // 基本設定
  if ($('sim-fx')    && data.fx)   $('sim-fx').value    = data.fx;
  if ($('sim-eur')   && data.eur)  $('sim-eur').value   = data.eur;
  if ($('van-tokyo') && data.vanTokyo) $('van-tokyo').value = data.vanTokyo;
  if ($('van-kobe')  && data.vanKobe)  $('van-kobe').value  = data.vanKobe;
  if ($('lashing')   && data.lashing)  $('lashing').value   = data.lashing;
  if ($('olt-handling') && data.oltHandling) $('olt-handling').value = data.oltHandling;
  if ($('olt-tr4')   && data.oltTr4)   $('olt-tr4').value   = data.oltTr4;
  if ($('olt-tr10')  && data.oltTr10)  $('olt-tr10').value  = data.oltTr10;
  if ($('olt-tr10z') && data.oltTr10z) $('olt-tr10z').value = data.oltTr10z;
  if ($('olt-chk-4'))   $('olt-chk-4').checked   = !!data.oltChk4;
  if ($('olt-chk-10'))  $('olt-chk-10').checked  = !!data.oltChk10;
  if ($('olt-chk-10z')) $('olt-chk-10z').checked = !!data.oltChk10z;
  if ($('olt-apply-a')) $('olt-apply-a').checked  = data.oltApplyA !== undefined ? !!data.oltApplyA : false;
  if ($('olt-apply-b')) $('olt-apply-b').checked  = data.oltApplyB !== undefined ? !!data.oltApplyB : true;
  onOltChk();

  // パターンタイプ復元
  if (data.slot1Type) {
    var r1 = document.querySelector('input[name="slot1type"][value="' + data.slot1Type + '"]');
    if (r1) { r1.checked = true; }
  }
  if (data.slot2Type) {
    var r2 = document.querySelector('input[name="slot2type"][value="' + data.slot2Type + '"]');
    if (r2) { r2.checked = true; }
  }
  onPatternChange(); // UI再描画してから船社を復元

  // 船社セレクト復元（スロット別）
  function restoreCarrier(selId, val) {
    var el = $(selId); if (!el || !val) return;
    el.value = val;
  }
  if (data.s1ct)  restoreCarrier('s1-c-t',  data.s1ct);
  if (data.s1ck)  restoreCarrier('s1-c-k',  data.s1ck);
  if (data.s1ccl) restoreCarrier('s1-c-cl', data.s1ccl);
  if (data.s1cbt) restoreCarrier('s1-c-bt', data.s1cbt);
  if (data.s1cbk) restoreCarrier('s1-c-bk', data.s1cbk);
  if (data.s2ct)  restoreCarrier('s2-c-t',  data.s2ct);
  if (data.s2ck)  restoreCarrier('s2-c-k',  data.s2ck);
  if (data.s2ccl) restoreCarrier('s2-c-cl', data.s2ccl);
  if (data.s2cbt) restoreCarrier('s2-c-bt', data.s2cbt);
  if (data.s2cbk) restoreCarrier('s2-c-bk', data.s2cbk);
  onCarrierChange();
  onColoadChange();

  // AGENT
  if ($('sim-agent') && data.agent) { $('sim-agent').value = data.agent; onAgentChange(); }

  // コンテナ本数
  if ($('ca-t20')) $('ca-t20').value = data.caT20 || '0';
  if ($('ca-t40')) $('ca-t40').value = data.caT40 || '0';
  if ($('ca-k20')) $('ca-k20').value = data.caK20 || '0';
  if ($('ca-k40')) $('ca-k40').value = data.caK40 || '0';
  if ($('cb-t20')) $('cb-t20').value = data.cbT20 || data.cbN20 || '0';
  if ($('cb-t40')) $('cb-t40').value = data.cbT40 || data.cbN40 || '0';
  if ($('cb-k20')) $('cb-k20').value = data.cbK20 || '0';
  if ($('cb-k40')) $('cb-k40').value = data.cbK40 || '0';

  // BKGリスト（既存行を削除して再構築）
  var tbody = $('row-body');
  if (tbody) tbody.innerHTML = '';
  rowSeq = 0;

  if (data.rows && data.rows.length) {
    data.rows.forEach(function(r) {
      addRow();
      var id = rowSeq;
      // 顧客選択
      var custSel = document.querySelector('#row-' + id + ' .row-cust-sel');
      if (custSel && r.custId) {
        custSel.value = r.custId;
        onRowCust(id, custSel);
      }
      // 拠点（A/B個別、旧フォーマット後方互換あり）
      var baseAval = r.baseA || r.base || r.simBase || '東京';
      var baseBval = r.baseB || r.base || r.simBase || '東京';
      var baseAEl = document.getElementById('rb-base-a-' + id);
      var baseBEl = document.getElementById('rb-base-b-' + id);
      if (baseAEl) baseAEl.value = baseAval;
      if (baseBEl) baseBEl.value = baseBval;
      // 仕向地
      if (document.getElementById('rb-dest-' + id) && r.dest) {
        document.getElementById('rb-dest-' + id).value = r.dest;
        onDestChange(id);
      }
      // T/Sチェック
      if (document.getElementById('rb-tschk-' + id)) {
        document.getElementById('rb-tschk-' + id).checked = !!r.tsApply;
        onTsChk(id);
      }
      // 適用パターンチェック
      if (document.getElementById('rb-use-a-' + id))
        document.getElementById('rb-use-a-' + id).checked = r.useA !== undefined ? !!r.useA : true;
      if (document.getElementById('rb-use-b-' + id))
        document.getElementById('rb-use-b-' + id).checked = r.useB !== undefined ? !!r.useB : true;
      // 数値フィールドを上書き（顧客選択で上書きされた可能性があるため）
      var fields = ['vol','of','lss','pss','efs','ics','cfs','thc','drs',
                    'bl','decl','chand','ot','ds','dc','nstku','nstkq','pltu','pltq','ts'];
      fields.forEach(function(f) {
        var el = document.getElementById('rb-' + f + '-' + id);
        if (el && r[f] !== undefined && r[f] !== '') el.value = r[f];
      });
    });
  }

  // タイトル
  if ($('sim-title') && data.title) $('sim-title').value = data.title;

  calc();
}

// ── 保存して共有URLを生成 ──────────────────────────────────────
window.saveSimulation = async function() {
  var title = ($('sim-title') ? $('sim-title').value.trim() : '') || '無題のシミュレーション';
  var data = collectSimData();
  data.title = title;

  var code = genShareCode();
  var row = {
    title: title,
    share_code: code,
    data: data,
    updated_at: new Date().toISOString()
  };

  var btn = document.querySelector('#save-card .btn-a');
  if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }

  var r = await sbInsert('simulations', row);

  if (btn) { btn.disabled = false; btn.textContent = '💾 保存して共有URLを生成'; }

  if (r.error) {
    toast('保存失敗: ' + r.error.message, 'err');
    return;
  }

  // 共有URL生成
  var url = location.origin + location.pathname + '?s=' + code;
  if ($('share-url')) $('share-url').value = url;
  if ($('share-code-disp')) $('share-code-disp').textContent = '共有コード: ' + code + '　（保存日時: ' + new Date().toLocaleString('ja-JP') + '）';
  if ($('share-result')) $('share-result').style.display = '';

  // URLバーも更新
  history.replaceState(null, '', '?s=' + code);
  toast('保存しました！URLをコピーして共有してください');
};

// ── 共有URLをコピー ────────────────────────────────────────────
window.copyShareUrl = function() {
  var el = $('share-url');
  if (!el) return;
  el.select();
  document.execCommand('copy');
  toast('URLをコピーしました');
};

// ── 共有コードからデータを読み込む ───────────────────────────
async function loadFromShareCode(code) {
  $('conn-lbl').textContent = '共有データを読み込み中...';
  var url = SB_URL + '/rest/v1/simulations?share_code=eq.' + encodeURIComponent(code) + '&select=*';
  try {
    var res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var arr = await res.json();
    if (!arr || !arr.length) {
      toast('共有コード「' + code + '」が見つかりません', 'err');
      return;
    }
    var simData = arr[0].data;
    if ($('sim-title') && arr[0].title) $('sim-title').value = arr[0].title;

    // URLに共有コードを保持
    history.replaceState(null, '', '?s=' + code);

    // 保存したURLを表示
    var sharedUrl = location.origin + location.pathname + '?s=' + code;
    if ($('share-url')) $('share-url').value = sharedUrl;
    if ($('share-code-disp')) $('share-code-disp').textContent = '共有コード: ' + code + '　（保存タイトル: ' + (arr[0].title || '無題') + '）';
    if ($('share-result')) $('share-result').style.display = '';
    if ($('save-card'))    $('save-card').style.display    = '';

    await restoreSimData(simData);
    toast('「' + (arr[0].title || '無題') + '」を読み込みました');
  } catch(e) {
    toast('読み込みエラー: ' + e.message, 'err');
  }
}

// ══════════════════════════════════════════════════════════════
// ── ウィザード（パターン比較） ────────────────────────────────
// ══════════════════════════════════════════════════════════════

var wizStep = 1;          // 現在のステップ（1〜3）
var wizPatterns = [{}, {}, {}]; // 各ステップのデータ保存
var wizRowSeq = 0;

// ── 初期化 ───────────────────────────────────────────────────
function wizInitPage() {
  // シミュレーションのBKGリストを常に最新状態で転写
  var simRows = getSimRowsForWizard();
  if (simRows.length > 0) {
    // ステップ1のベース行として設定（保存済みでなければ上書き）
    if (!wizPatterns[0].saved) {
      wizPatterns[0]._simRows = simRows;
    }
    // ステップ2/3も保存済みでなければ更新
    if (!wizPatterns[1].saved) wizPatterns[1]._simRows = simRows;
    if (!wizPatterns[2].saved) wizPatterns[2]._simRows = simRows;
  }
  if (wizStep === 1 && !wizPatterns[0].saved) {
    wizReset();
  } else {
    wizRenderStep(wizStep);
  }
}

// シミュレーション画面のBKGリストをウィザード用フォーマットに変換
function getSimRowsForWizard() {
  var rows = [];
  document.querySelectorAll('#row-body tr').forEach(function(tr) {
    var id = tr.dataset.rid;
    if (!id) return;
    var g = function(f) { var el = document.getElementById('rb-' + f + '-' + id); return el ? nv(el.value) : 0; };
    var custSel = tr.querySelector('.row-cust-sel');
    var custId = custSel ? custSel.value : '';
    var custName = '（未選択）';
    customers.forEach(function(c) { if (c.id === custId) custName = c.name; });
    var dest = document.getElementById('rb-dest-' + id) ? document.getElementById('rb-dest-' + id).value : 'RTM';
    var tsRate = null;
    if (dest !== 'RTM') tsRates.forEach(function(t) { if (t.destination === dest) tsRate = t; });
    var baseAEl = document.getElementById('rb-base-a-' + id);
    rows.push({
      custId: custId, custName: custName,
      vol: g('vol'),
      base: baseAEl ? baseAEl.value : '東京',
      dest: dest, tsRate: tsRate,
      tsApply: document.getElementById('rb-tschk-' + id) ? document.getElementById('rb-tschk-' + id).checked : false,
      of: g('of'), lss: g('lss'), pss: g('pss'), efs: g('efs'), ics: g('ics'),
      cfs: g('cfs'), thc: g('thc'), drs: g('drs'), bl: g('bl'), ts: g('ts')
    });
  });
  return rows;
}

window.wizReset = function() {
  wizStep = 1;
  wizPatterns = [{}, {}, {}];
  wizRowSeq = 0;
  wizRenderStep(1);
};

// ── ステップ描画 ──────────────────────────────────────────────
function wizRenderStep(step) {
  wizStep = step;

  // インジケーター更新
  [1, 2, 3, 'r'].forEach(function(s) {
    var el = $('wiz-step-' + s);
    if (!el) return;
    el.classList.remove('wiz-active', 'wiz-done', 'wiz-skip');
    if (s === 'r') {
      if (step === 'result') el.classList.add('wiz-active');
      else if (wizPatterns[0].saved && wizPatterns[1].saved) el.classList.add('wiz-done');
      return;
    }
    var si = parseInt(s);
    if (si === step) el.classList.add('wiz-active');
    else if (wizPatterns[si-1] && wizPatterns[si-1].saved) el.classList.add('wiz-done');
    else if (wizPatterns[si-1] && wizPatterns[si-1].skipped) el.classList.add('wiz-skip');
  });

  if (step === 'result') {
    $('wiz-input-area').style.display = 'none';
    $('wiz-result-area').style.display = '';
    wizRenderResult();
    return;
  }

  $('wiz-input-area').style.display = '';
  $('wiz-result-area').style.display = 'none';

  // タイトル
  $('wiz-pattern-title').textContent = 'パターン' + step + ' 設定';

  // 保存済みデータがあれば復元
  var saved = wizPatterns[step - 1];

  // パターンタイプ
  var type = saved.type || 'TK';
  document.querySelectorAll('input[name="wiztype"]').forEach(function(r) {
    r.checked = (r.value === type);
  });
  // ボタンactive
  ['TK','KB','COLOAD','OLT'].forEach(function(t) {
    var btn = $('wbtn-' + t);
    if (btn) btn.classList.toggle('pt-active', t === type);
  });

  // 為替・名前
  var autoFx = window._autoFxJpy ? String(window._autoFxJpy) : '155';
  if ($('wiz-fx'))   $('wiz-fx').value   = saved.fx   || autoFx;
  if ($('wiz-name')) $('wiz-name').value = saved.name || ('パターン' + step);

  // 船社選択エリア描画
  wizRenderCarriers(type, saved);

  // CO-LOADレート表示
  wizUpdateColoadRateDisp(type, saved.clId || '');

  // ナビボタン
  $('wiz-btn-back').style.display = (step > 1) ? '' : 'none';
  $('wiz-btn-skip').style.display = (step === 3) ? '' : 'none';
  var nextBtn = $('wiz-btn-next');
  nextBtn.textContent = (step === 3) ? '比較へ →' : '次へ →';

  // BKGリスト描画
  wizBuildRows(step);

  // コンテナ構成描画
  wizRenderCntrInputs(type, saved);
  wizUpdateVolSummary();

  // 保存済みパターンがあればプレビューを自動表示、なければ非表示
  var previewCard = $('wiz-preview-card');
  if (previewCard) {
    if (saved.saved) {
      wizCalcPreview();
    } else {
      previewCard.style.display = 'none';
      var previewBody = $('wiz-preview-body');
      if (previewBody) previewBody.innerHTML = '<div style="color:var(--tx3);font-size:12px;text-align:center;padding:1rem">コンテナ構成を入力後、「再計算」ボタンを押すか自動計算値を反映してください</div>';
    }
  }
}

// ── パターンタイプ変更 ────────────────────────────────────────
window.onWizTypeChange = function() {
  var type = wizGetType();
  ['TK','KB','COLOAD','OLT'].forEach(function(t) {
    var btn = $('wbtn-' + t);
    if (btn) btn.classList.toggle('pt-active', t === type);
  });
  wizRenderCarriers(type, {});
  wizUpdateColoadRateDisp(type, '');
  wizRenderCntrInputs(type, {});
  wizUpdateVolSummary();
};

function wizGetType() {
  var checked = document.querySelector('input[name="wiztype"]:checked');
  return checked ? checked.value : 'TK';
}

// ── 船社選択エリア描画 ────────────────────────────────────────
function wizRenderCarriers(type, saved) {
  var el = $('wiz-carriers');
  if (!el) return;
  var html = '';

  function selHtml(id, label, color, brd, val) {
    var opts = '<option value="">-- 選択 --</option>';
    carriers.forEach(function(c) {
      opts += '<option value="' + c + '"' + (c === val ? ' selected' : '') + '>' + c + '</option>';
    });
    return '<div class="f"><label style="color:' + color + ';font-weight:700">' + label + '</label>' +
      '<select id="' + id + '" style="padding:6px 9px;border:1px solid ' + brd + ';border-radius:var(--r);background:var(--sur);font-size:13px;font-family:var(--mono)">' + opts + '</select></div>';
  }
  function clSelHtml(val) {
    var opts = '<option value="">-- 選択 --</option>';
    coloadRates.forEach(function(c) {
      opts += '<option value="' + c.id + '"' + (c.id === val ? ' selected' : '') + '>' + c.name + '</option>';
    });
    return '<div class="f"><label style="color:var(--amber);font-weight:700">CO-LOAD 業者</label>' +
      '<select id="wiz-c-cl" onchange="wizUpdateColoadRateDisp(\'' + wizGetType() + '\',this.value)" style="padding:6px 9px;border:1px solid var(--amber-brd);border-radius:var(--r);background:var(--sur);font-size:13px">' + opts + '</select></div>';
  }

  if (type === 'TK') {
    html = selHtml('wiz-c-t', '東京 船社', 'var(--blue)', 'var(--blue-brd)', saved.cT || '') +
           selHtml('wiz-c-k', '神戸 船社', 'var(--red)',  'var(--red-brd)',  saved.cK || '');
  } else if (type === 'KB') {
    html = selHtml('wiz-c-k', '神戸 船社', 'var(--red)', 'var(--red-brd)', saved.cK || '');
    el.style.gridTemplateColumns = '1fr';
  } else if (type === 'COLOAD') {
    html = clSelHtml(saved.clId || '');
    el.style.gridTemplateColumns = '1fr';
  } else if (type === 'OLT') {
    html = selHtml('wiz-c-bt', '東京 船社（OLT後）', 'var(--acc)',   'var(--acc-brd)',   saved.cBT || '') +
           selHtml('wiz-c-bk', '神戸 船社（OLT前）', 'var(--green)', 'var(--green-brd)', saved.cBK || '');
  }
  el.style.gridTemplateColumns = (type === 'KB' || type === 'COLOAD') ? '1fr 1fr' : '1fr 1fr';
  el.innerHTML = html;
}

function wizUpdateColoadRateDisp(type, clId) {
  var box = $('wiz-coload-rate');
  var det = $('wiz-coload-rate-detail');
  if (!box) return;
  if (type !== 'COLOAD') { box.style.display = 'none'; return; }
  box.style.display = '';
  var rate = coloadRates.find(function(r) { return r.id === clId; });
  if (rate && det) {
    det.textContent = rate.name + '：O/F $' + fmt(rate.of_usd) + ' + EFS $' + fmt(rate.efs_usd) + '/RT　ICS2 $' + fmt(rate.ics2_usd) + '/BL　CFS ¥' + fmt(rate.cfs_jpy) + ' THC ¥' + fmt(rate.thc_jpy) + ' DRS ¥' + fmt(rate.drs_jpy) + '/RT';
  } else if (det) {
    det.textContent = '業者を選択してください';
  }
}

// ── コンテナ構成入力 ──────────────────────────────────────────
function wizRenderCntrInputs(type, saved) {
  var el = $('wiz-cntr-inputs'); if (!el) return;
  function cntrBox(color, label, prefix, vals) {
    return '<div style="background:' + color + ';border-radius:var(--r);padding:.65rem .9rem">' +
      '<div style="font-size:10px;font-weight:700;color:var(--tx2);margin-bottom:.45rem">' + label + '</div>' +
      ['20FT','40HC'].map(function(t, i) {
        var pid = prefix + (i===0?'20':'40');
        return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
          '<label style="font-size:11px;color:var(--tx2);min-width:32px">' + t + '</label>' +
          '<input type="number" id="' + pid + '" min="0" value="' + (vals[pid]||0) + '" onchange="wizUpdateVolSummary()" style="width:52px;font-family:var(--mono);font-size:13px;padding:4px 6px;border:1px solid var(--brd2);border-radius:5px;text-align:center">' +
          '<span style="font-size:11px;color:var(--tx2)">本</span></div>';
      }).join('') +
    '</div>';
  }
  var cv = saved.cntr || {};
  var html = '';
  if (type === 'COLOAD') {
    html = '<div style="color:var(--amber);font-size:12px;padding:.5rem">CO-LOADはコンテナ本数不要です。</div>';
  } else if (type === 'TK') {
    html = cntrBox('var(--blue-bg)','東京','wiz-ct',cv) + cntrBox('var(--red-bg)','神戸','wiz-ck',cv);
  } else if (type === 'KB') {
    html = cntrBox('var(--red-bg)','神戸','wiz-ck',cv);
    el.style.gridTemplateColumns = '1fr';
  } else if (type === 'OLT') {
    html = cntrBox('var(--acc-bg)','東京（OLT後）','wiz-ct',cv) + cntrBox('var(--green-bg)','神戸（OLT前）','wiz-ck',cv);
  }
  el.innerHTML = html;
}

// ── BKGリスト ────────────────────────────────────────────────
function wizBuildRows(step) {
  var tbody = $('wiz-row-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  wizRowSeq = 0;

  var rows = [];

  if (step === 1) {
    // ステップ1: 保存済み行 > シミュレーション転写 > 空
    var pat1 = wizPatterns[0];
    if (pat1.rows && pat1.rows.length) {
      rows = pat1.rows.map(function(r) { return Object.assign({}, r); });
    } else {
      var simRows = getSimRowsForWizard();
      if (simRows.length > 0) rows = simRows;
    }
  } else {
    // ステップ2/3: 常にパターン1のBKGリストをベースにリセット
    // ただし現ステップに保存済みがあればそれを使う
    var pat = wizPatterns[step - 1];
    if (pat.rows && pat.rows.length) {
      rows = pat.rows.map(function(r) { return Object.assign({}, r); });
    } else {
      // パターン1の保存済み or シミュレーション転写
      var base = wizPatterns[0].rows && wizPatterns[0].rows.length
        ? wizPatterns[0].rows
        : getSimRowsForWizard();
      rows = base.map(function(r) { return Object.assign({}, r); });
    }
  }

  rows.forEach(function(r) { wizAddRow(r); });
  if (rows.length === 0) wizAddRow();
}

window.wizAddRow = function(d) {
  d = d || {};
  var id = ++wizRowSeq;
  var tbody = $('wiz-row-body'); if (!tbody) return;
  var tr = document.createElement('tr');
  tr.id = 'wiz-row-' + id; tr.dataset.rid = id;

  var custOpts = '<option value="">-- 選択 --</option>';
  customers.forEach(function(c) {
    var bi = baseInfo(c.origin);
    custOpts += '<option value="' + c.id + '"' + (c.id === d.custId ? ' selected' : '') + '>' + c.name + '（' + bi.label + '）</option>';
  });

  var destOpts = '<option value="RTM">RTM</option>';
  tsRates.forEach(function(t) {
    var lbl = t.destination + (nv(t.ts_tariff)>0?'(+$'+t.ts_tariff+')':nv(t.ts_tariff)<0?'(割引)':'($0)');
    destOpts += '<option value="' + t.destination + '"' + (t.destination===d.dest?' selected':'') + '>' + lbl + '</option>';
  });

  var rv = function(k, fb) {
    var n = nv(d[k] != null ? d[k] : (fb||0));
    return fmt(n, n%1!==0?2:0);
  };

  var baseOpts = '<option value="東京"' + (d.base==='東京'||!d.base?' selected':'') + '>東京</option>' +
                 '<option value="神戸"' + (d.base==='神戸'?' selected':'') + '>神戸</option>';

  tr.innerHTML =
    '<td><select class="ri ri-sel wiz-cust-sel" onchange="onWizRowCust(' + id + ',this)" style="min-width:120px">' + custOpts + '</select></td>' +
    '<td><input class="ri ri-sm" id="wr-vol-' + id + '" type="text" value="' + rv('vol',10) + '" oninput="fmtI(this);wizUpdateVolSummary()"></td>' +
    '<td><select class="ri ri-dest" id="wr-dest-' + id + '" onchange="onWizDestChange(' + id + ')" style="min-width:90px">' + destOpts + '</select><div id="wr-ts-disp-' + id + '" style="font-size:9px;color:var(--purple)"></div></td>' +
    '<td style="background:#E8F0FF"><select class="ri" id="wr-base-' + id + '" style="font-size:11px;padding:3px 5px;background:#E8F0FF;border-color:var(--blue-brd);color:var(--blue)">' + baseOpts + '</select></td>' +
    '<td><input class="ri ri-sm" id="wr-of-' + id + '"   type="text" value="' + rv('of')   + '" oninput="this.classList.add(\'edited\')"></td>' +
    '<td><input class="ri ri-sm" id="wr-lss-' + id + '"  type="text" value="' + rv('lss')  + '" oninput="this.classList.add(\'edited\')"></td>' +
    '<td><input class="ri ri-sm" id="wr-pss-' + id + '"  type="text" value="' + rv('pss')  + '" oninput="this.classList.add(\'edited\')"></td>' +
    '<td><input class="ri ri-sm" id="wr-efs-' + id + '"  type="text" value="' + rv('efs')  + '" oninput="this.classList.add(\'edited\')"></td>' +
    '<td><input class="ri ri-sm" id="wr-ics-' + id + '"  type="text" value="' + rv('ics')  + '" oninput="this.classList.add(\'edited\')"></td>' +
    '<td><input class="ri ri-sm" id="wr-cfs-' + id + '"  type="text" value="' + rv('cfs')  + '" oninput="this.classList.add(\'edited\')"></td>' +
    '<td><input class="ri ri-sm" id="wr-thc-' + id + '"  type="text" value="' + rv('thc')  + '" oninput="this.classList.add(\'edited\')"></td>' +
    '<td><input class="ri ri-sm" id="wr-drs-' + id + '"  type="text" value="' + rv('drs')  + '" oninput="this.classList.add(\'edited\')"></td>' +
    '<td><input class="ri ri-sm" id="wr-bl-'  + id + '"  type="text" value="' + rv('bl')   + '" oninput="this.classList.add(\'edited\')"></td>' +
    '<td><input class="ri ri-sm" id="wr-ts-'  + id + '"  type="text" value="' + rv('ts')   + '" oninput="this.classList.add(\'edited\')"></td>' +
    '<td style="text-align:center"><input type="checkbox" id="wr-tschk-' + id + '"' + (d.tsApply?' checked':'') + ' style="width:14px;height:14px;accent-color:var(--purple)"><div id="wr-tsauto-' + id + '" style="font-size:9px;color:var(--purple)"></div></td>' +
    '<td><button class="del-row" onclick="wizDelRow(' + id + ')">✕</button></td>';

  tbody.appendChild(tr);
  onWizDestChange(id);
};

window.wizDelRow = function(id) {
  var t = $('wiz-row-' + id); if (t) t.remove();
  wizUpdateVolSummary();
};

window.onWizRowCust = function(id, sel) {
  var c = null;
  customers.forEach(function(x) { if (x.id === sel.value) c = x; });
  if (!c) return;
  function s(f, v) {
    var el = $('wr-' + f + '-' + id); if (!el) return;
    var n = nv(v); el.value = fmt(n, n%1!==0?2:0); el.classList.remove('edited');
  }
  s('of',c.of_sell); s('lss',c.lss_sell); s('pss',c.pss_sell); s('efs',c.efs_sell);
  s('ics',c.ics_sell); s('cfs',c.cfs_sell); s('thc',c.thc_sell); s('drs',c.drs_sell);
  s('bl',c.bl_fee_sell); s('ts',c.ts_sell);
  var bi = baseInfo(c.origin);
  var baseEl = $('wr-base-' + id); if (baseEl) baseEl.value = bi.simBase;
  var destEl = $('wr-dest-' + id);
  if (destEl) { destEl.value = c.destination || 'RTM'; onWizDestChange(id); }
  wizUpdateVolSummary();
};

window.onWizDestChange = function(id) {
  var dest = $('wr-dest-' + id) ? $('wr-dest-' + id).value : 'RTM';
  var chk  = $('wr-tschk-' + id);
  var disp = $('wr-ts-disp-' + id);
  var auto = $('wr-tsauto-' + id);
  if (dest === 'RTM') {
    if (chk) chk.checked = false;
    if (disp) disp.textContent = '';
    if (auto) auto.textContent = '';
  } else {
    var rate = null;
    tsRates.forEach(function(t) { if (t.destination === dest) rate = t; });
    if (chk) chk.checked = true;
    if (auto) auto.textContent = '自動ON';
    if (rate && disp) {
      var tariff = nv(rate.ts_tariff);
      disp.textContent = tariff > 0 ? '+$' + rate.ts_tariff + '/m³' : tariff < 0 ? '割引$' + rate.ts_tariff : '$0';
    }
  }
};

// ── 物量サマリー更新 ──────────────────────────────────────────
function wizUpdateVolSummary() {
  var el = $('wiz-vol-summary'); if (!el) return;
  var rows = wizGetCurrentRows();
  var tM = rows.filter(function(r){return r.base==='東京';}).reduce(function(s,r){return s+r.vol;},0);
  var kM = rows.filter(function(r){return r.base==='神戸';}).reduce(function(s,r){return s+r.vol;},0);
  el.textContent = '東京: ' + fmt(tM,1) + ' m³　神戸: ' + fmt(kM,1) + ' m³　合計: ' + fmt(tM+kM,1) + ' m³';
}

window.wizAutoFill = function() {
  var type = wizGetType();
  var rows = wizGetCurrentRows();
  var tM = rows.filter(function(r){return r.base==='東京';}).reduce(function(s,r){return s+r.vol;},0);
  var kM = rows.filter(function(r){return r.base==='神戸';}).reduce(function(s,r){return s+r.vol;},0);
  var allM = tM + kM;
  // 船社からcap取得
  function getCap(selId, isHC) {
    var sel = $(selId); if (!sel || !sel.value) return isHC ? 50 : 25;
    var c = null;
    allCosts.forEach(function(r) { if (r.carrier === sel.value && r.container_type === (isHC?'40HC':'20FT')) c = r; });
    return c ? (nv(c.cap_m3)||( isHC?50:25)) : (isHC?50:25);
  }
  if (type === 'TK' || type === 'OLT') {
    var ct40 = getCap(type==='OLT'?'wiz-c-bt':'wiz-c-t', true);
    var ck40 = getCap(type==='OLT'?'wiz-c-bk':'wiz-c-k', true);
    if ($('wiz-ct20')) $('wiz-ct20').value = 0;
    if ($('wiz-ct40')) $('wiz-ct40').value = tM > 0 ? Math.ceil(tM/ct40) : 0;
    if ($('wiz-ck20')) $('wiz-ck20').value = 0;
    if ($('wiz-ck40')) $('wiz-ck40').value = kM > 0 ? Math.ceil(kM/ck40) : 0;
  } else if (type === 'KB') {
    var ck40 = getCap('wiz-c-k', true);
    if ($('wiz-ck20')) $('wiz-ck20').value = 0;
    if ($('wiz-ck40')) $('wiz-ck40').value = kM > 0 ? Math.ceil(kM/ck40) : 0;
  }
  wizUpdateVolSummary();
  wizCalcPreview();
};

// ── 行データ収集 ──────────────────────────────────────────────
function wizGetCurrentRows() {
  var rows = [];
  document.querySelectorAll('#wiz-row-body tr').forEach(function(tr) {
    var id = tr.dataset.rid;
    var g = function(f) { var el = $('wr-' + f + '-' + id); return el ? nv(el.value) : 0; };
    var custId = '';
    var custSel = tr.querySelector('.wiz-cust-sel');
    if (custSel) custId = custSel.value;
    var custName = '（未選択）';
    customers.forEach(function(c) { if (c.id === custId) custName = c.name; });
    var dest   = $('wr-dest-' + id) ? $('wr-dest-' + id).value : 'RTM';
    var tsRate = null;
    if (dest !== 'RTM') tsRates.forEach(function(t) { if (t.destination === dest) tsRate = t; });
    rows.push({
      custId: custId, custName: custName,
      vol: g('vol'), base: $('wr-base-' + id) ? $('wr-base-' + id).value : '東京',
      dest: dest, tsRate: tsRate,
      tsApply: $('wr-tschk-' + id) ? $('wr-tschk-' + id).checked : false,
      of:g('of'), lss:g('lss'), pss:g('pss'), efs:g('efs'), ics:g('ics'),
      cfs:g('cfs'), thc:g('thc'), drs:g('drs'), bl:g('bl'), ts:g('ts')
    });
  });
  return rows;
}

// ── パターンプレビュー計算・表示 ──────────────────────────────
window.wizCalcPreview = function() {
  var previewCard = $('wiz-preview-card');
  var previewBody = $('wiz-preview-body');
  var previewTitle = $('wiz-preview-title');
  if (!previewCard || !previewBody) return;

  // 現在の入力状態を一時保存して計算
  wizSaveCurrentStep();
  var pat = wizPatterns[wizStep - 1];
  var result = wizCalcPattern(pat);

  previewCard.style.display = '';
  if (previewTitle) previewTitle.textContent = pat.name + ' の計算結果';

  if (!result) {
    previewBody.innerHTML = '<div style="color:var(--tx3);font-size:12px;padding:.75rem">コンテナ構成または船社が未設定のため計算できません。</div>';
    return;
  }

  var fx = nv(pat.fx || 155);
  var type = pat.type;
  var rows = pat.rows || [];

  // コスト明細HTML生成
  var detailHtml = '';

  // コンテナ明細
  if (result.cntrBreakdown && result.cntrBreakdown.length) {
    detailHtml += '<div style="margin-bottom:.6rem">';
    detailHtml += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tx2);margin-bottom:.3rem">コンテナ・仕入コスト</div>';
    result.cntrBreakdown.forEach(function(line) {
      detailHtml += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid var(--brd)">' +
        '<span style="color:var(--tx2)">' + line.split(':')[0] + '</span>' +
        '<span style="font-family:var(--mono)">' + (line.split(':')[1]||'').trim() + '</span></div>';
    });
    detailHtml += '</div>';
  }

  // OLT（TK/OLTで神戸貨物あり）
  if ((type === 'TK' || type === 'OLT') && result.kM > 0) {
    var kM = result.kM;
    var oltObj = calcOLT(kM);
    if (oltObj.total > 0) {
      detailHtml += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid var(--brd)">' +
        '<span style="color:var(--blue)">OLT費用（トラック＋入出庫）</span>' +
        '<span style="font-family:var(--mono);color:var(--blue)">' + fmtY(oltObj.total) + '</span></div>';
    }
  }

  // T/Sコスト
  if (result.totalTs !== 0) {
    detailHtml += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid var(--brd)">' +
      '<span style="color:var(--purple)">T/Sコスト</span>' +
      '<span style="font-family:var(--mono);color:var(--purple)">' + fmtY(result.totalTs) + '</span></div>';
  }

  // 区切り線
  detailHtml += '<div style="border-top:2px solid var(--brd2);margin:.5rem 0"></div>';

  // サマリーグリッド
  detailHtml += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:.6rem">';
  function miniCard(label, val, color) {
    return '<div style="background:var(--sur2);border-radius:var(--r);padding:.4rem .7rem">' +
      '<div style="font-size:10px;color:var(--tx2);margin-bottom:2px">' + label + '</div>' +
      '<div style="font-family:var(--mono);font-size:13px;font-weight:600;color:' + color + '">' + fmtY(val) + '</div>' +
    '</div>';
  }
  detailHtml += miniCard('総売上', result.totalRev, 'var(--tx)');
  detailHtml += miniCard('総コスト', result.cost, 'var(--tx)');
  detailHtml += miniCard('利益', result.prof, result.prof >= 0 ? 'var(--acc)' : 'var(--red)');
  detailHtml += '</div>';

  // 利益強調バナー
  var profColor = result.prof >= 0 ? 'var(--acc)' : 'var(--red)';
  var profBg    = result.prof >= 0 ? 'var(--acc-bg)' : 'var(--red-bg)';
  var profBrd   = result.prof >= 0 ? 'var(--acc-brd)' : 'var(--red-brd)';
  detailHtml += '<div style="background:' + profBg + ';border:1px solid ' + profBrd + ';border-radius:var(--r);padding:.6rem .9rem;display:flex;align-items:center;justify-content:space-between">' +
    '<div>' +
      '<div style="font-size:10px;color:' + profColor + ';margin-bottom:2px">利益（売上 - コスト）</div>' +
      '<div style="font-size:10px;color:var(--tx3)">物量: 東京 ' + fmt(result.tM,1) + 'm³ / 神戸 ' + fmt(result.kM,1) + 'm³ / 合計 ' + fmt(result.allM,1) + 'm³</div>' +
    '</div>' +
    '<div style="font-family:var(--mono);font-size:20px;font-weight:900;color:' + profColor + '">' + fmtY(result.prof) + '</div>' +
  '</div>';

  // BKGリスト内訳
  detailHtml += '<div style="margin-top:.6rem">';
  detailHtml += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tx2);margin-bottom:.3rem">BKGリスト内訳</div>';
  rows.forEach(function(r) {
    var rowRev = (r.of + r.lss + r.pss + r.efs) * r.vol * fx + r.ics * fx +
                 (r.tsApply ? r.ts * r.vol * fx : 0) +
                 (r.cfs + r.thc + r.drs) * r.vol + r.bl;
    var bi = baseInfo(r.base === '東京' ? 'TOKYO' : 'KOBE');
    detailHtml += '<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:3px 0;border-bottom:1px solid var(--brd)">' +
      '<span style="flex:1;font-weight:500">' + r.custName + '</span>' +
      '<span class="cb-tag ' + bi.tagCls + '">' + bi.label + '</span>' +
      '<span style="color:var(--tx3);min-width:50px;text-align:right">' + fmt(r.vol,1) + 'm³</span>' +
      '<span style="font-family:var(--mono);min-width:90px;text-align:right;color:var(--acc)">' + fmtY(rowRev) + '</span>' +
    '</div>';
  });
  detailHtml += '</div>';

  previewBody.innerHTML = detailHtml;
};

// ── ステップ保存 ──────────────────────────────────────────────
function wizSaveCurrentStep() {
  var type = wizGetType();
  var cntr = {};
  ['wiz-ct20','wiz-ct40','wiz-ck20','wiz-ck40'].forEach(function(id) {
    var el = $(id); if (el) cntr[id] = parseInt(el.value)||0;
  });
  var clId = $('wiz-c-cl') ? $('wiz-c-cl').value : '';
  wizPatterns[wizStep - 1] = {
    saved:  true,
    skipped: false,
    step:   wizStep,
    type:   type,
    name:   $('wiz-name') ? $('wiz-name').value || ('パターン' + wizStep) : 'パターン' + wizStep,
    fx:     $('wiz-fx')   ? $('wiz-fx').value   : '155',
    cT:     $('wiz-c-t')  ? $('wiz-c-t').value  : '',
    cK:     $('wiz-c-k')  ? $('wiz-c-k').value  : '',
    cBT:    $('wiz-c-bt') ? $('wiz-c-bt').value : '',
    cBK:    $('wiz-c-bk') ? $('wiz-c-bk').value : '',
    clId:   clId,
    cntr:   cntr,
    rows:   wizGetCurrentRows()
  };
}

// ── ナビゲーション ────────────────────────────────────────────
window.wizNext = function() {
  wizSaveCurrentStep();
  if (wizStep === 3) {
    wizRenderStep('result');
  } else {
    wizRenderStep(wizStep + 1);
  }
};

window.wizBack = function() {
  wizSaveCurrentStep();
  if (wizStep > 1) wizRenderStep(wizStep - 1);
};

window.wizSkip = function() {
  wizPatterns[wizStep - 1] = { skipped: true, saved: false, step: wizStep };
  wizRenderStep('result');
};

window.wizBackToEdit = function() {
  // 最後に保存されたステップに戻る
  var lastStep = 3;
  if (wizPatterns[2].skipped) lastStep = 2;
  wizRenderStep(lastStep);
};

// ── コスト計算（1パターン分） ─────────────────────────────────
function wizCalcPattern(pat) {
  if (!pat || pat.skipped || !pat.saved) return null;
  var fx  = nv(pat.fx || 155);
  var eur = 165; // デフォルト
  var type = pat.type;
  var rows = pat.rows || [];
  var allM = rows.reduce(function(s,r){return s+r.vol;},0);
  var tsM  = rows.filter(function(r){return r.tsApply;}).reduce(function(s,r){return s+r.vol;},0);
  var tM   = rows.filter(function(r){return r.base==='東京';}).reduce(function(s,r){return s+r.vol;},0);
  var kM   = rows.filter(function(r){return r.base==='神戸';}).reduce(function(s,r){return s+r.vol;},0);

  // 売上
  var totalRev = rows.reduce(function(s,r) {
    return s + (r.of + r.lss + r.pss + r.efs) * r.vol * fx
             + r.ics * fx
             + (r.tsApply ? r.ts * r.vol * fx : 0)
             + (r.cfs + r.thc + r.drs) * r.vol
             + r.bl;
  }, 0);

  // T/Sコスト
  var totalTs = rows.reduce(function(s,r) {
    if (!r.tsApply || !r.tsRate) return s;
    var tariff = nv(r.tsRate.ts_tariff);
    if (tariff === 0) return s;
    var raw = r.vol * tariff;
    return s + (tariff > 0 ? Math.max(raw, nv(r.tsRate.ts_min)) : raw) * fx;
  }, 0);

  // コンテナコスト
  var cntr = pat.cntr || {};
  var cT20 = cntr['wiz-ct20']||0, cT40 = cntr['wiz-ct40']||0;
  var cK20 = cntr['wiz-ck20']||0, cK40 = cntr['wiz-ck40']||0;
  var cntrCost = 0, cntrBreakdown = [];

  function selByCarrier(carrier, type20) {
    var found = null;
    allCosts.forEach(function(r) {
      if (r.carrier === carrier && r.container_type === (type20?'20FT':'40HC')) found = r;
    });
    return found;
  }

  if (type === 'TK' || type === 'OLT') {
    var sT20 = selByCarrier(type==='TK'?pat.cT:pat.cBT, true);
    var sT40 = selByCarrier(type==='TK'?pat.cT:pat.cBT, false);
    var sK20 = selByCarrier(type==='TK'?pat.cK:pat.cBK, true);
    var sK40 = selByCarrier(type==='TK'?pat.cK:pat.cBK, false);
    var dT20 = ctByUnits(cT20, tM, sT20, fx, eur, false);
    var dT40 = ctByUnits(cT40, tM, sT40, fx, eur, false);
    var dK20 = ctByUnits(cK20, kM, sK20, fx, eur, true);
    var dK40 = ctByUnits(cK40, kM, sK40, fx, eur, true);
    cntrCost = dT20.total + dT40.total + dK20.total + dK40.total;
    if (cT20>0) cntrBreakdown.push('東京20FT×'+cT20+': '+fmtY(dT20.total));
    if (cT40>0) cntrBreakdown.push('東京40HC×'+cT40+': '+fmtY(dT40.total));
    if (cK20>0) cntrBreakdown.push('神戸20FT×'+cK20+': '+fmtY(dK20.total));
    if (cK40>0) cntrBreakdown.push('神戸40HC×'+cK40+': '+fmtY(dK40.total));
    // OLTコスト
    if (type === 'OLT' && kM > 0) {
      var oltObj = calcOLT(kM);
      cntrCost += oltObj.total;
      cntrBreakdown.push('OLT（トラック＋入出庫）: ' + fmtY(oltObj.total));
    }
  } else if (type === 'KB') {
    var sK20 = selByCarrier(pat.cK, true);
    var sK40 = selByCarrier(pat.cK, false);
    var dK20 = ctByUnits(cK20, kM, sK20, fx, eur, true);
    var dK40 = ctByUnits(cK40, kM, sK40, fx, eur, true);
    cntrCost = dK20.total + dK40.total;
    if (cK20>0) cntrBreakdown.push('神戸20FT×'+cK20+': '+fmtY(dK20.total));
    if (cK40>0) cntrBreakdown.push('神戸40HC×'+cK40+': '+fmtY(dK40.total));
  } else if (type === 'COLOAD') {
    var clRate = coloadRates.find(function(r){return r.id===pat.clId;});
    var ofUsd   = clRate ? nv(clRate.of_usd)  : 70;
    var efsUsd  = clRate ? nv(clRate.efs_usd) : 15;
    var ics2Usd = clRate ? nv(clRate.ics2_usd): 25;
    var cfsJpy  = clRate ? nv(clRate.cfs_jpy) : 4000;
    var thcJpy  = clRate ? nv(clRate.thc_jpy) : 1000;
    var drsJpy  = clRate ? nv(clRate.drs_jpy) : 300;
    var perRt = (ofUsd+efsUsd)*fx + (cfsJpy+thcJpy+drsJpy);
    var perBl = ics2Usd*fx;
    cntrCost = allM*perRt + rows.length*perBl;
    cntrBreakdown.push((clRate?clRate.name:'CO-LOAD') + '費用: ' + fmtY(cntrCost));
  }

  var cost = cntrCost + totalTs;
  var prof = totalRev - cost;
  return {
    name: pat.name || ('パターン'+pat.step),
    type: type,
    totalRev: totalRev, cost: cost, prof: prof,
    cntrCost: cntrCost, totalTs: totalTs,
    cntrBreakdown: cntrBreakdown,
    tM: tM, kM: kM, allM: allM, rows: rows
  };
}

// ── 比較テーブル描画 ──────────────────────────────────────────
function wizRenderResult() {
  // 全3パターン分を計算（スキップは null）
  var allResults = wizPatterns.map(function(p) { return wizCalcPattern(p); });
  // スキップされていない有効パターン
  var validResults = allResults.filter(Boolean);

  if (validResults.length < 2) {
    $('wiz-cmp-head').innerHTML = '';
    $('wiz-cmp-body').innerHTML = '<tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--tx3)">有効なパターンが2つ以上必要です</td></tr>';
    $('wiz-concl').innerHTML = '';
    return;
  }

  var totalCols = allResults.length; // 表示列数（スキップ含む）
  // 有効パターン中で最も利益が高いもの
  var bestProf = -Infinity;
  validResults.forEach(function(r) { if (r.prof > bestProf) bestProf = r.prof; });

  // ヘッダー生成
  var hCols = allResults.map(function(r, i) {
    if (!r) {
      // スキップ
      return '<th style="color:var(--tx3);background:var(--sur2);text-decoration:line-through">' +
             (wizPatterns[i].name || 'パターン'+(i+1)) + '<br><span style="font-size:10px;font-weight:400">SKIP</span></th>';
    }
    var isBest = (r.prof === bestProf);
    var badge = isBest ? ' <span class="wbadge">推奨</span>' : '';
    var color = isBest ? 'var(--acc)' : 'var(--tx)';
    var bg    = isBest ? 'var(--acc-bg)' : '';
    return '<th style="color:' + color + ';background:' + bg + '">' + r.name + badge + '</th>';
  }).join('');

  $('wiz-cmp-head').innerHTML =
    '<tr><th style="text-align:left">項目</th>' + hCols + '<th style="color:var(--tx3);font-size:10px">差額<br>（対①）</th></tr>' +
    '<tr><td></td>' + allResults.map(function(r) {
      if (!r) return '<td style="font-size:10px;text-align:right;color:var(--tx3)">─</td>';
      return '<td style="font-size:10px;text-align:right;color:var(--tx3);padding:2px 12px">' + PATTERN_LABELS[r.type] + '</td>';
    }).join('') + '<td></td></tr>';

  // ヘルパー：値セル（スキップは「─」、有効は金額/m³）
  function valCell(r, v, isBest, large, isM3) {
    if (!r) return '<td class="wv" style="color:var(--tx3)">─</td>';
    var vcls = isBest ? ' best' : '';
    var sty  = large ? 'font-size:16px;font-weight:900;' : '';
    if (isBest && large) sty += 'background:var(--acc-bg);border-radius:6px;padding:4px 8px;display:inline-block;';
    var txt = isM3 ? fmt(v,1) + ' m³' : fmtY(v);
    return '<td class="wv' + vcls + '" style="' + sty + '">' + txt + '</td>';
  }

  function tableRow(label, getter, cls, large, isM3) {
    // 有効パターン中の最善値を特定
    var bestVal = large ? -Infinity : null;
    if (large) validResults.forEach(function(r) { if (r.prof !== undefined && r.prof > bestVal) bestVal = r.prof; });
    var cells = allResults.map(function(r) {
      if (!r) return '<td class="wv" style="color:var(--tx3)">─</td>';
      var v = getter(r);
      var isBest = large ? (v === bestVal) : false;
      return valCell(r, v, isBest, large, isM3);
    }).join('');
    // 差額（対①）
    var base = allResults[0];
    var diff = '';
    if (base) {
      var dv = validResults.length >= 2 ? null : null;
      // 2列目以降の最初の有効パターンと①の差
      var diffVals = allResults.map(function(r, i) {
        if (i === 0) return null;
        if (!r || !base) return null;
        return getter(r) - getter(base);
      });
      var firstDiff = diffVals.find(function(d){return d!==null;});
      if (firstDiff !== null && firstDiff !== undefined) {
        var dcls = Math.abs(firstDiff) < 1 ? 'neu' : (firstDiff > 0 ? 'adv' : 'dis');
        diff = '<td class="wdiff ' + dcls + '">' + (Math.abs(firstDiff)<1 ? '同等' : (firstDiff>0?'+':'')+fmt(firstDiff)) + '</td>';
      } else {
        diff = '<td></td>';
      }
    }
    return '<tr class="' + (cls||'') + '"><td>' + label + '</td>' + cells + diff + '</tr>';
  }

  function secRow(label) {
    return '<tr class="wiz-section"><td colspan="' + (totalCols+2) + '">' + label + '</td></tr>';
  }

  var bodyHtml = '';

  // 物量（m³表示）
  bodyHtml += secRow('物量');
  bodyHtml += tableRow('東京 m³', function(r){return r.tM;}, '', false, true);
  bodyHtml += tableRow('神戸 m³', function(r){return r.kM;}, '', false, true);
  bodyHtml += tableRow('合計 m³', function(r){return r.allM;}, '', false, true);

  // コスト
  bodyHtml += secRow('コンテナ・仕入コスト');
  bodyHtml += tableRow('コンテナ/CO-LOADコスト', function(r){return r.cntrCost;});
  var hasTs = validResults.some(function(r){return r.totalTs!==0;});
  if (hasTs) bodyHtml += tableRow('T/Sコスト', function(r){return r.totalTs||0;});

  // 総コスト（最小が有利 → 差額列を反転）
  bodyHtml += '<tr class="wiz-total"><td>総コスト</td>' +
    allResults.map(function(r) {
      if (!r) return '<td class="wv" style="color:var(--tx3)">─</td>';
      var minCost = Math.min.apply(null, validResults.map(function(x){return x.cost;}));
      var isBest = r.cost === minCost;
      var sty = isBest ? 'color:var(--acc);font-weight:700' : '';
      return '<td class="wv" style="' + sty + '"><strong>' + fmtY(r.cost) + '</strong></td>';
    }).join('') + '<td></td></tr>';

  // 売上
  bodyHtml += secRow('売上');
  bodyHtml += tableRow('総売上', function(r){return r.totalRev;});

  // 利益（最強調）
  bodyHtml += '<tr class="wiz-profit"><td><strong>利益</strong></td>' +
    allResults.map(function(r) {
      if (!r) return '<td class="wv" style="color:var(--tx3);font-size:14px">─</td>';
      var isBest = r.prof === bestProf;
      if (isBest) {
        return '<td style="text-align:right;vertical-align:middle">' +
          '<div style="display:inline-block;background:var(--acc);color:#fff;border-radius:8px;padding:6px 14px;font-family:var(--mono);font-size:16px;font-weight:900;box-shadow:0 2px 8px rgba(26,92,58,.35)">' +
          fmtY(r.prof) + ' 🏆</div></td>';
      }
      var cls = r.prof >= 0 ? 'color:var(--tx)' : 'color:var(--red)';
      return '<td class="wv" style="font-size:14px;font-weight:700;' + cls + '">' + fmtY(r.prof) + '</td>';
    }).join('') +
    // 差額
    (function() {
      var base = allResults[0];
      if (!base) return '<td></td>';
      var firstValid = allResults.find(function(r,i){return i>0&&r;});
      if (!firstValid) return '<td></td>';
      var d = firstValid.prof - base.prof;
      var dcls = Math.abs(d)<1?'neu':d>0?'adv':'dis';
      return '<td class="wdiff ' + dcls + '" style="font-size:13px;font-weight:700">' + (Math.abs(d)<1?'同等':(d>0?'+':'')+fmt(d)) + '</td>';
    })() +
  '</tr>';

  $('wiz-cmp-body').innerHTML = bodyHtml;

  // 結論バナー
  var best = validResults.find(function(r){return r.prof===bestProf;});
  var maxDiff = validResults.reduce(function(mx,r){return r===best?mx:Math.max(mx,Math.abs(best.prof-r.prof));},0);
  $('wiz-concl').innerHTML =
    '<div style="background:var(--acc);border-radius:var(--rl);padding:1rem 1.3rem;margin-top:.5rem">' +
      '<div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:.5rem">🏆 ' + best.name + ' が最も有利</div>' +
      '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
        '<div style="background:rgba(255,255,255,.15);border-radius:8px;padding:.5rem 1.1rem;text-align:center">' +
          '<div style="font-size:10px;color:rgba(255,255,255,.75);margin-bottom:2px">最大差額</div>' +
          '<div style="font-family:var(--mono);font-size:22px;font-weight:900;color:#fff">' + fmtY(maxDiff) + '</div>' +
        '</div>' +
        '<div style="color:rgba(255,255,255,.9);font-size:12px;line-height:1.8">' +
          PATTERN_LABELS[best.type] + '<br>' +
          '総売上 ' + fmtY(best.totalRev) + '　総コスト ' + fmtY(best.cost) + '　利益 <strong>' + fmtY(best.prof) + '</strong>' +
        '</div>' +
      '</div>' +
    '</div>';

  // 合算比較UIの初期化
  wizRenderMergeUI(allResults);
}

// ── 利益合算比較 UI ───────────────────────────────────────────
function wizRenderMergeUI(allResults) {
  var grpA = $('wiz-merge-grp-a');
  var grpB = $('wiz-merge-grp-b');
  var res  = $('wiz-merge-result');
  if (!grpA || !grpB) return;
  if (res) res.innerHTML = '';

  // 有効パターンのみチェックボックスを生成
  var htmlA = '', htmlB = '';
  allResults.forEach(function(r, i) {
    if (!r) return; // スキップは除外
    var lbl = r.name + '（' + fmtY(r.prof) + '）';
    htmlA += '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">' +
      '<input type="checkbox" name="wiz-grp-a" value="' + i + '" style="width:14px;height:14px;accent-color:var(--blue)"> ' + lbl +
    '</label>';
    htmlB += '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">' +
      '<input type="checkbox" name="wiz-grp-b" value="' + i + '" style="width:14px;height:14px;accent-color:var(--red)"> ' + lbl +
    '</label>';
  });
  grpA.innerHTML = htmlA || '<span style="font-size:11px;color:var(--tx3)">有効なパターンなし</span>';
  grpB.innerHTML = htmlB || '<span style="font-size:11px;color:var(--tx3)">有効なパターンなし</span>';
}

window.wizCalcMerge = function() {
  var allResults = wizPatterns.map(function(p) { return wizCalcPattern(p); });
  var res = $('wiz-merge-result');
  if (!res) return;

  // 選択されたインデックスを取得
  var idxA = Array.from(document.querySelectorAll('input[name="wiz-grp-a"]:checked')).map(function(el) { return parseInt(el.value); });
  var idxB = Array.from(document.querySelectorAll('input[name="wiz-grp-b"]:checked')).map(function(el) { return parseInt(el.value); });

  if (idxA.length === 0 || idxB.length === 0) {
    res.innerHTML = '<div style="color:var(--red);font-size:12px;padding:.5rem">グループAとグループB両方にパターンを選択してください。</div>';
    return;
  }

  // 合算計算
  function sumGroup(indices) {
    var rev = 0, cost = 0, prof = 0;
    var names = [];
    indices.forEach(function(i) {
      var r = allResults[i];
      if (!r) return;
      rev  += r.totalRev;
      cost += r.cost;
      prof += r.prof;
      names.push(r.name);
    });
    return { rev: rev, cost: cost, prof: prof, names: names };
  }

  var gA = sumGroup(idxA);
  var gB = sumGroup(idxB);
  var diff = gA.prof - gB.prof;
  var aWins = diff > 0;
  var winnerName = aWins ? gA.names.join('＋') : gB.names.join('＋');
  var diffAbs = Math.abs(diff);

  // 結果テーブル
  function groupCol(g, color, bg) {
    return '<td style="text-align:right;padding:8px 14px;border-bottom:1px solid var(--brd)">' +
      '<div style="font-size:10px;color:' + color + ';margin-bottom:2px">' + g.names.join(' ＋ ') + '</div>' +
      '<div style="font-family:var(--mono);font-size:13px">' + fmtY(g.rev) + '</div></td>';
  }

  var html =
    '<div style="overflow-x:auto;margin-bottom:.75rem">' +
    '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr>' +
      '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid var(--brd);font-size:10px;color:var(--tx2)">項目</th>' +
      '<th style="text-align:right;padding:6px 14px;border-bottom:2px solid var(--brd);color:var(--blue)">グループA<br><span style="font-weight:400;font-size:10px">' + gA.names.join(' ＋ ') + '</span></th>' +
      '<th style="text-align:right;padding:6px 14px;border-bottom:2px solid var(--brd);color:var(--red)">グループB<br><span style="font-weight:400;font-size:10px">' + gB.names.join(' ＋ ') + '</span></th>' +
    '</tr></thead><tbody>' +
    '<tr><td style="padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--tx2)">総売上</td>' +
      '<td style="text-align:right;padding:6px 14px;border-bottom:1px solid var(--brd);font-family:var(--mono)">' + fmtY(gA.rev) + '</td>' +
      '<td style="text-align:right;padding:6px 14px;border-bottom:1px solid var(--brd);font-family:var(--mono)">' + fmtY(gB.rev) + '</td></tr>' +
    '<tr><td style="padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--tx2)">総コスト</td>' +
      '<td style="text-align:right;padding:6px 14px;border-bottom:1px solid var(--brd);font-family:var(--mono)">' + fmtY(gA.cost) + '</td>' +
      '<td style="text-align:right;padding:6px 14px;border-bottom:1px solid var(--brd);font-family:var(--mono)">' + fmtY(gB.cost) + '</td></tr>' +
    '<tr style="border-top:2px solid var(--tx)">' +
      '<td style="padding:8px 10px;font-weight:700">合算利益</td>' +
      (aWins
        ? '<td style="text-align:right;padding:8px 14px;vertical-align:middle"><div style="display:inline-block;background:var(--acc);color:#fff;border-radius:8px;padding:5px 12px;font-family:var(--mono);font-size:15px;font-weight:900">' + fmtY(gA.prof) + ' 🏆</div></td>' +
          '<td style="text-align:right;padding:8px 14px;font-family:var(--mono);font-size:14px;font-weight:700;color:var(--tx)">' + fmtY(gB.prof) + '</td>'
        : '<td style="text-align:right;padding:8px 14px;font-family:var(--mono);font-size:14px;font-weight:700;color:var(--tx)">' + fmtY(gA.prof) + '</td>' +
          '<td style="text-align:right;padding:8px 14px;vertical-align:middle"><div style="display:inline-block;background:var(--acc);color:#fff;border-radius:8px;padding:5px 12px;font-family:var(--mono);font-size:15px;font-weight:900">' + fmtY(gB.prof) + ' 🏆</div></td>') +
    '</tr></tbody></table></div>' +
    // 差額バナー
    '<div style="background:var(--purple);border-radius:var(--rl);padding:.9rem 1.2rem;display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
      '<div style="text-align:center">' +
        '<div style="font-size:10px;color:rgba(255,255,255,.75);margin-bottom:2px">合算最大差額</div>' +
        '<div style="font-family:var(--mono);font-size:22px;font-weight:900;color:#fff">' + fmtY(diffAbs) + '</div>' +
      '</div>' +
      '<div style="color:rgba(255,255,255,.9);font-size:12px">' +
        '🏆 <strong>' + winnerName + '</strong> の合算が有利<br>' +
        'グループA ' + fmtY(gA.prof) + '　vs　グループB ' + fmtY(gB.prof) +
      '</div>' +
    '</div>';

  res.innerHTML = html;
};

// ── Init ──────────────────────────────────────────────────────
// ── 為替レート自動取得（TTS近似） ────────────────────────────
async function fetchFxRate() {
  try {
    var res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var jpy = data && data.rates && data.rates.JPY;
    if (!jpy) throw new Error('JPY rate not found');
    // TTSは仲値+1円が目安。小数点以下切り捨てで整数に
    var tts = Math.floor(jpy) + 1;
    return tts;
  } catch(e) {
    console.warn('為替取得失敗、デフォルト値を使用:', e.message);
    return null;
  }
}

function applyFxRate(rate) {
  if (!rate) return;
  var r = String(rate);
  // EUR/JPYはUSD/JPY×0.92が近似（ECB基準）
  var eurNum = Math.floor(rate * 0.92);
  var eurRate = String(eurNum);
  // グローバル保持（ウィザード描画時に参照）
  window._autoFxJpy = rate;
  window._autoFxEur = eurNum;
  // シミュレーション画面
  if ($('sim-fx'))  { $('sim-fx').value  = r;       }
  if ($('sim-eur')) { $('sim-eur').value = eurRate;  }
  // ウィザード（現在表示中のフィールド）
  if ($('wiz-fx'))  $('wiz-fx').value  = r;
  // ヘッダーに表示
  var lbl = $('conn-lbl');
  if (lbl) {
    var orig = lbl.textContent;
    var fxNote = '　💱 USD/JPY ' + r + '  EUR/JPY ' + eurRate + '（自動取得）';
    if (orig.indexOf('💱') < 0) lbl.textContent = orig + fxNote;
  }
  // EUR反映後に再計算
  if (typeof calc === 'function') calc();
}

(async function() {
  // 為替取得とDB読み込みを並行実行
  var fxPromise = fetchFxRate();
  await loadAll();

  // 為替を適用（DBロード後にUIが存在するため）
  var fxRate = await fxPromise;
  applyFxRate(fxRate);

  // URLパラメータに共有コードがあれば読み込む
  var params = new URLSearchParams(location.search);
  var shareCode = params.get('s');
  if (shareCode) {
    await loadFromShareCode(shareCode);
  } else {
    addRow();
  }

  // 結果カード表示時に保存カードも表示
  var observer = new MutationObserver(function() {
    var rc = $('result-card');
    var sc = $('save-card');
    if (rc && sc) sc.style.display = rc.style.display === 'none' ? 'none' : '';
  });
  var rc = $('result-card');
  if (rc) observer.observe(rc, { attributes: true, attributeFilter: ['style'] });
})();
