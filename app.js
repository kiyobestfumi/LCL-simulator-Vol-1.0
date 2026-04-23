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

  // シミュレーション画面の船社セレクト初期化
  function initCarrierSel(id) {
    var el = $(id); if (!el) return;
    var cur = el.value;
    el.innerHTML = '<option value="">-- 選択 --</option>';
    carriers.forEach(function(c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      el.appendChild(o);
    });
    if (cur && carriers.indexOf(cur) >= 0) el.value = cur;
  }
  initCarrierSel('sim-carrier-t');
  initCarrierSel('sim-carrier-k');

  // CO-LOADセレクト初期化
  var clSel = $('sim-coload-id');
  if (clSel) {
    var curCl = clSel.value;
    clSel.innerHTML = '<option value="">-- 選択 --</option>';
    coloadRates.forEach(function(c) {
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      clSel.appendChild(o);
    });
    if (curCl) clSel.value = curCl;
  }

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

  // シミュレーション画面の新セレクト（sim-carrier-t / sim-carrier-k）
  var pt = getSelByCarrier('sim-carrier-t'); selT20 = pt[0]; selT40 = pt[1];
  var pk = getSelByCarrier('sim-carrier-k'); selK20 = pk[0]; selK40 = pk[1];

  // ウィザード用スロット（後方互換）
  var t1 = getSlotType(1);
  var t2 = getSlotType(2);
  var ps1t = getSelByCarrier('s1-c-t');  if (ps1t[0]||ps1t[1]) { selT20=ps1t[0]; selT40=ps1t[1]; }
  var ps1k = getSelByCarrier('s1-c-k');  if (ps1k[0]||ps1k[1]) { selK20=ps1k[0]; selK40=ps1k[1]; }
  var ps1cl= getSelByCarrier('s1-c-cl'); selCL20=ps1cl[0]; selCL40=ps1cl[1];
  var ps1bt= getSelByCarrier('s1-c-bt'); selBT20=ps1bt[0]; selBT40=ps1bt[1];
  var ps1bk= getSelByCarrier('s1-c-bk'); selBK20=ps1bk[0]; selBK40=ps1bk[1];
  var ps2t = getSelByCarrier('s2-c-t');  sel2T20=ps2t[0]; sel2T40=ps2t[1];
  var ps2k = getSelByCarrier('s2-c-k');  sel2K20=ps2k[0]; sel2K40=ps2k[1];
  var ps2cl= getSelByCarrier('s2-c-cl'); sel2CL20=ps2cl[0]; sel2CL40=ps2cl[1];
  var ps2bt= getSelByCarrier('s2-c-bt'); sel2BT20=ps2bt[0]; sel2BT40=ps2bt[1];
  var ps2bk= getSelByCarrier('s2-c-bk'); sel2BK20=ps2bk[0]; sel2BK40=ps2bk[1];

  // 後方互換
  selB20 = selBT20 || sel2BT20;
  selB40 = selBT40 || sel2BT40;
  sel20  = selT20 || selK20;
  sel40  = selT40 || selK40;

  // VANNING/ラッシング自動反映
  if (selT20 && $('van-tokyo')) $('van-tokyo').value = fmt(nv(selT20.vanning_tokyo_jpy) || 2800);
  if (selK20 && $('van-kobe'))  $('van-kobe').value  = fmt(nv(selK20.vanning_kobe_jpy)  || 2600);
  if (selK20 && $('lashing'))   $('lashing').value   = fmt(nv(selK20.lashing_jpy)       || 6000);
  var oltSrc = selBT20 || selT20 || null;
  if (oltSrc && nv(oltSrc.olt_handling_jpy) && $('olt-handling'))
    $('olt-handling').value = fmt(nv(oltSrc.olt_handling_jpy));

  // バッジ更新（シミュレーション用）
  function badgeInfo(c20, c40, elId) {
    var el = $(elId); if (!el) return;
    if (!c20 && !c40) { el.textContent = ''; return; }
    var parts = [];
    if (c20) parts.push('20FT: $' + fmt(c20.ocean_freight) + (nv(c20.refund_per_rt) ? ' REF$' + fmt(c20.refund_per_rt) : ''));
    if (c40) parts.push('40HC: $' + fmt(c40.ocean_freight) + (nv(c40.refund_per_rt) ? ' REF$' + fmt(c40.refund_per_rt) : ''));
    el.textContent = parts.join(' / ');
  }
  badgeInfo(selT20, selT40, 'ci-sim-t');
  badgeInfo(selK20, selK40, 'ci-sim-k');

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

// ── REFUND（コンテナタイプ別・T/S物量・NOMINATION物量を除外） ─────────────────
// m3: 対象物量, tsM3: T/S物量, nomM3: NOMINATION物量（比例按分で除外）, C: cost_master行, fx: 為替
function calcRefundForCntr(m3, tsM3Total, totalM3, C, fx, nomM3Total) {
  if (!C || m3 <= 0) return 0;
  // T/S物量・NOMINATION物量を全体比率で按分除外
  var tsExclude  = totalM3 > 0 ? tsM3Total  * (m3 / totalM3) : 0;
  var nomExclude = totalM3 > 0 ? (nomM3Total||0) * (m3 / totalM3) : 0;
  var refM3 = Math.max(0, m3 - tsExclude - nomExclude);
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
    '<td><input class="ri ri-sm" id="rb-vol-' + id + '" type="number" inputmode="decimal" min="0" step="0.1" value="' + nv(d.vol || 10) + '" oninput="onVolChange(' + id + ')" style="text-align:right"></td>' +
    '<td><select class="ri ri-dest" id="rb-dest-' + id + '" onchange="onDestChange(' + id + ')">' + destOpts + '</select><div id="rb-ts-disp-' + id + '" style="font-size:9px;color:var(--purple);margin-top:1px"></div></td>' +
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
    // スロット列削除済み：拠点は顧客マスターのoriginから自動判定
    var custObj = null;
    if (custId) customers.forEach(function(c) { if (c.id === custId) custObj = c; });
    var autoBase = custObj ? baseInfo(custObj.origin).simBase : '東京';
    var isNomination = !!(custObj && custObj.is_nomination);
    var baseA = autoBase;
    var baseB = autoBase;
    var useA = true; var useB = true;
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
      isNomination: isNomination,
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

// ── Main Calc（3パターン固定比較） ───────────────────────────
window.calc = function() {
  var rows = getRows();
  var fx  = nv($('sim-fx') ? $('sim-fx').value : 155);
  var eur = nv($('sim-eur') ? $('sim-eur').value : 165);

  // 全行の物量集計（baseAを使用）
  var tRows = rows.filter(function(r){return r.baseA==='東京';});
  var kRows = rows.filter(function(r){return r.baseA==='神戸';});
  var tM = tRows.reduce(function(s,r){return s+r.vol;},0);
  var kM = kRows.reduce(function(s,r){return s+r.vol;},0);
  var allM = tM + kM;
  var tsM  = rows.filter(function(r){return r.tsApply;}).reduce(function(s,r){return s+r.vol;},0);
  var nomM = rows.filter(function(r){return r.isNomination;}).reduce(function(s,r){return s+r.vol;},0);
  var refM = Math.max(0, allM - tsM - nomM);

  // 物量サマリー表示
  var simVolEl = $('sim-vol-summary');
  var simVolDet = $('sim-vol-detail');
  if (simVolEl) simVolEl.style.display = rows.length > 0 ? '' : 'none';
  if (simVolDet) {
    var capT = nv(selT20?selT20.cap_m3:0)||25;
    var capK = nv(selK20?selK20.cap_m3:0)||25;
    simVolDet.textContent =
      '東京: ' + fmt(tM,1) + ' m³（目安 40HC×' + Math.ceil(tM/(nv(selT40?selT40.cap_m3:0)||50)) + '本）　' +
      '神戸: ' + fmt(kM,1) + ' m³（目安 40HC×' + Math.ceil(kM/(nv(selK40?selK40.cap_m3:0)||50)) + '本）　' +
      '合計: ' + fmt(allM,1) + ' m³';
  }

  // OLT計算
  var oltObj = calcOLT(kM);
  var oltDisp = $('olt-total-disp');
  var oltDet  = $('olt-detail-disp');
  if (oltDisp) oltDisp.textContent = kM > 0 ? fmt(oltObj.truck) + '円' : '¥0（神戸貨物なし）';
  if (oltDet)  oltDet.textContent  = kM > 0 && oltObj.truck > 0 ? oltObj.desc : (kM > 0 ? '手配なし' : '');

  // sum-bar更新
  if ($('sv-t'))   $('sv-t').textContent   = fmt(tM,1) + 'm³';
  if ($('sv-k'))   $('sv-k').textContent   = fmt(kM,1) + 'm³';
  if ($('sv-all')) $('sv-all').textContent = fmt(allM,1) + 'm³';
  if ($('sv-ts'))  $('sv-ts').textContent  = fmt(tsM,1) + 'm³';
  if ($('sv-rv'))  $('sv-rv').textContent  = fmt(refM,1) + 'm³';

  // 総売上（共通）
  var totalRev = rows.reduce(function(s,r){
    return s + (r.of+r.lss+r.pss+r.efs)*r.vol*fx + r.ics*fx
             + (r.tsApply?r.ts*r.vol*fx:0)
             + (r.cfs+r.thc+r.drs)*r.vol + r.bl + r.decl + r.chand + r.ot + r.ds*fx;
  },0);
  if ($('sv-rev')) $('sv-rev').textContent = fmtY(totalRev);
  $('sum-bar').style.display = rows.length > 0 ? 'flex' : 'none';

  // AGENT・T/Sコスト（共通）
  var totalTs = rows.reduce(function(s,r){
    if(!r.tsApply||!r.tsRate) return s;
    var t=nv(r.tsRate.ts_tariff); if(t===0) return s;
    var raw=r.vol*t; return s+(t>0?Math.max(raw,nv(r.tsRate.ts_min)):raw)*fx;
  },0);
  function calcAgentCostRows(targetRows) {
    var cost=0; if(!selAgent) return cost;
    targetRows.forEach(function(r){
      var rate=null;
      selAgent.rates.forEach(function(a){if(a.destination===r.dest)rate=a;});
      if(!rate) selAgent.rates.forEach(function(a){if(a.destination==='ALL')rate=a;});
      if(!rate) return;
      cost+=(nv(rate.ts_cost_usd)*r.vol+nv(rate.fixed_usd))*fx+nv(rate.handling_jpy);
    });
    return cost;
  }
  var agentCost = calcAgentCostRows(rows);

  // コンテナ本数（UI削除のため0固定）
  var simT20=0, simT40=0, simK20=0, simK40=0;

  // CO-LOAD業者レート取得
  var clId   = $('sim-coload-id') ? $('sim-coload-id').value : '';
  var clRate = coloadRates.find(function(r){return r.id===clId;});
  var clOfUsd  = clRate ? nv(clRate.of_usd)  : 70;
  var clEfsUsd = clRate ? nv(clRate.efs_usd) : 15;
  var clIcs2   = clRate ? nv(clRate.ics2_usd): 25;
  var clCfs    = clRate ? nv(clRate.cfs_jpy) : 4000;
  var clThc    = clRate ? nv(clRate.thc_jpy) : 1000;
  var clDrs    = clRate ? nv(clRate.drs_jpy) : 300;
  // CO-LOAD情報バッジ更新
  var ciCl = $('ci-sim-cl');
  if (ciCl) ciCl.textContent = clRate
    ? clRate.name+': O/F $'+fmt(clOfUsd)+' EFS $'+fmt(clEfsUsd)+'/RT  ICS2 $'+fmt(clIcs2)+'/BL  CFS ¥'+fmt(clCfs)+' THC ¥'+fmt(clThc)+' DRS ¥'+fmt(clDrs)+'/RT'
    : '';

  // 船社コスト計算ヘルパー（再利用）
  function cntrCost(units, m3, C, isKobe) {
    return ctByUnits(units, m3, C, fx, eur, isKobe).total;
  }

  // ────────────────────────────────────────────────────────────
  // パターン① OLT合算：神戸→東京OLT後、東京船社で仕立て
  //   東京荷主：東京船社　神戸荷主：OLT費用（トラック＋入出庫）＋東京船社に合流
  // ────────────────────────────────────────────────────────────
  var cntrCostP1T = cntrCost(simT20, tM, selT20, false) + cntrCost(simT40, tM, selT40, false);
  // 神戸荷主は東京コンテナに合流（全体m3で計算済みのOLT費用を加算）
  var cntrCostP1 = cntrCostP1T + oltObj.total;
  // REFUNDは東京船社基準
  var refP1 = 0;
  if (selT20||selT40) {
    var cap20T=nv(selT20?selT20.cap_m3:0)||25, cap40T=nv(selT40?selT40.cap_m3:0)||50;
    var bM20P1=simT20>0&&(simT20+simT40>0)?allM*simT20*cap20T/(simT20*cap20T+simT40*cap40T||1):(simT40===0?allM:0);
    var bM40P1=simT40>0&&(simT20+simT40>0)?allM*simT40*cap40T/(simT20*cap20T+simT40*cap40T||1):(simT20===0?allM:0);
    refP1=calcRefundForCntr(bM20P1,tsM,allM,selT20,fx,nomM)+calcRefundForCntr(bM40P1,tsM,allM,selT40,fx,nomM);
  }
  var costP1 = cntrCostP1 + totalTs + agentCost;
  var profP1 = totalRev - costP1 + refP1;

  // ────────────────────────────────────────────────────────────
  // パターン② CO-LOAD＋東京独立
  //   東京荷主：東京船社で仕立て　神戸荷主：CO-LOAD
  // ────────────────────────────────────────────────────────────
  var cntrCostP2T = cntrCost(simT20, tM, selT20, false) + cntrCost(simT40, tM, selT40, false);
  var coloadCostP2 = kM*(clOfUsd+clEfsUsd)*fx + kM*(clCfs+clThc+clDrs) + kRows.length*clIcs2*fx;
  var cntrCostP2 = cntrCostP2T + coloadCostP2;
  // REFUNDは東京荷主分のみ
  var refP2 = 0;
  if (selT20||selT40) {
    var cap20T=nv(selT20?selT20.cap_m3:0)||25, cap40T=nv(selT40?selT40.cap_m3:0)||50;
    var bM20P2=simT20>0&&(simT20+simT40>0)?tM*simT20*cap20T/(simT20*cap20T+simT40*cap40T||1):(simT40===0?tM:0);
    var bM40P2=simT40>0&&(simT20+simT40>0)?tM*simT40*cap40T/(simT20*cap20T+simT40*cap40T||1):(simT20===0?tM:0);
    refP2=calcRefundForCntr(bM20P2,tsM,tM,selT20,fx,nomM)+calcRefundForCntr(bM40P2,tsM,tM,selT40,fx,nomM);
  }
  var costP2 = cntrCostP2 + totalTs + agentCost;
  var profP2 = totalRev - costP2 + refP2;

  // ────────────────────────────────────────────────────────────
  // パターン③ 東京・神戸 それぞれ独立
  //   東京荷主：東京船社　神戸荷主：神戸船社
  // ────────────────────────────────────────────────────────────
  var cntrCostP3T = cntrCost(simT20, tM, selT20, false) + cntrCost(simT40, tM, selT40, false);
  var cntrCostP3K = cntrCost(simK20, kM, selK20, true) + cntrCost(simK40, kM, selK40, true);
  var cntrCostP3 = cntrCostP3T + cntrCostP3K;
  // REFUND：東京＋神戸それぞれ
  var refP3 = 0;
  if (selT20||selT40) {
    var c20T=nv(selT20?selT20.cap_m3:0)||25, c40T=nv(selT40?selT40.cap_m3:0)||50;
    var bM20T=simT20>0&&(simT20+simT40>0)?tM*simT20*c20T/(simT20*c20T+simT40*c40T||1):(simT40===0?tM:0);
    var bM40T=simT40>0&&(simT20+simT40>0)?tM*simT40*c40T/(simT20*c20T+simT40*c40T||1):(simT20===0?tM:0);
    refP3+=calcRefundForCntr(bM20T,tsM,allM,selT20,fx,nomM)+calcRefundForCntr(bM40T,tsM,allM,selT40,fx,nomM);
  }
  if (selK20||selK40) {
    var c20K=nv(selK20?selK20.cap_m3:0)||25, c40K=nv(selK40?selK40.cap_m3:0)||50;
    var bM20K=simK20>0&&(simK20+simK40>0)?kM*simK20*c20K/(simK20*c20K+simK40*c40K||1):(simK40===0?kM:0);
    var bM40K=simK40>0&&(simK20+simK40>0)?kM*simK40*c40K/(simK20*c20K+simK40*c40K||1):(simK20===0?kM:0);
    refP3+=calcRefundForCntr(bM20K,tsM,allM,selK20,fx,nomM)+calcRefundForCntr(bM40K,tsM,allM,selK40,fx,nomM);
  }
  var costP3 = cntrCostP3 + totalTs + agentCost;
  var profP3 = totalRev - costP3 + refP3;

  // 船社チェック
  if (!rows.length) {
    if ($('save-card')) $('save-card').style.display = 'none';
    return;
  }

  // ── 3パターン比較テーブルは削除済み（ウィザードで行う） ──────
  // sum-bar と save-card のみ更新
  $('result-card').style.display = 'none'; // 非表示固定
  if ($('save-card')) $('save-card').style.display = rows.length > 0 ? '' : 'none';
};


// ── シミュレーション コンテナ自動計算 ────────────────────────
window.simAutoFill = function() {
  var rows = getRows();
  var tM = rows.filter(function(r){return r.baseA==='東京';}).reduce(function(s,r){return s+r.vol;},0);
  var kM = rows.filter(function(r){return r.baseA==='神戸';}).reduce(function(s,r){return s+r.vol;},0);
  var capT40 = nv(selT40?selT40.cap_m3:0)||50;
  var capK40 = nv(selK40?selK40.cap_m3:0)||50;
  if ($('sim-t20')) $('sim-t20').value = 0;
  if ($('sim-t40')) $('sim-t40').value = tM > 0 ? Math.ceil(tM/capT40) : 0;
  if ($('sim-k20')) $('sim-k20').value = 0;
  if ($('sim-k40')) $('sim-k40').value = kM > 0 ? Math.ceil(kM/capK40) : 0;
  calc();
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
    var nomBadge = c.is_nomination
      ? '<span style="font-size:10px;background:var(--amber-bg);color:var(--amber);padding:1px 5px;border-radius:3px;font-weight:700">NOM</span>'
      : '<span style="font-size:10px;color:var(--tx3)">-</span>';
    return '<tr><td><strong>' + c.name + '</strong></td><td><span class="tag ' + bi.tagCls + '">' + bi.label + '</span></td><td>' + destBadge + '</td>' +
      '<td>' + fmt(c.of_sell,2) + '</td><td>' + fmt(c.lss_sell,2) + '</td><td>' + fmt(c.pss_sell,2) + '</td><td>' + fmt(c.efs_sell,2) + '</td><td>' + fmt(c.ts_sell,2) + '</td><td>' + fmt(c.ics_sell,2) + '</td>' +
      '<td>' + fmt(c.cfs_sell) + '</td><td>' + fmt(c.thc_sell) + '</td><td>' + fmt(c.drs_sell) + '</td>' +
      '<td>' + fmt(c.bl_fee_sell) + '</td><td>' + fmt(c.customs_declaration_jpy) + '</td><td>' + fmt(c.customs_handling_jpy) + '</td><td>' + fmt(c.other_fee) + '</td>' +
      '<td>$' + fmt(c.oversea_sell,2) + '</td><td>$' + fmt(c.oversea_cost,2) + '</td>' +
      '<td style="text-align:center">' + nomBadge + '</td>' +
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
  var nomChk = $('cm-nomination');
  if (nomChk) nomChk.checked = !!(c && c.is_nomination);
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
    is_nomination: !!($('cm-nomination') && $('cm-nomination').checked),
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
// ══════════════════════════════════════════════════════════════
// ── ウィザード（パターン比較）スロットA/B×ステップ1〜3 ──────
// ══════════════════════════════════════════════════════════════

// ── シミュレーションBKGをウィザード用行データに変換 ───────────
function getSimRowsForWizard() {
  var rows = [];
  document.querySelectorAll('#row-body tr').forEach(function(tr) {
    var id = tr.dataset.rid;
    var g = function(f) { var el = document.getElementById('rb-' + f + '-' + id); return el ? nv(el.value) : 0; };
    var custId = '';
    var custSel = tr.querySelector('.row-cust-sel');
    if (custSel) custId = custSel.value;
    var custName = '（未選択）';
    var custObj = null;
    customers.forEach(function(c) { if (c.id === custId) { custName = c.name; custObj = c; } });
    var dest = document.getElementById('rb-dest-' + id) ? document.getElementById('rb-dest-' + id).value : 'RTM';
    var tsRate = null;
    if (dest !== 'RTM') tsRates.forEach(function(t) { if (t.destination === dest) tsRate = t; });
    var tsApply = document.getElementById('rb-tschk-' + id) ? document.getElementById('rb-tschk-' + id).checked : false;
    var autoBase = custObj ? baseInfo(custObj.origin).simBase : '東京';
    rows.push({
      custId: custId, custName: custName,
      vol: g('vol'), base: autoBase,
      slot: 'AB',        // シミュレーション→ウィザード転写時はデフォルトで両スロット対象
      isCoload: false,
      isOlt:    false,
      dest: dest, tsRate: tsRate, tsApply: tsApply,
      of: g('of'), lss: g('lss'), pss: g('pss'), efs: g('efs'), ics: g('ics'),
      cfs: g('cfs'), thc: g('thc'), drs: g('drs'), bl: g('bl'), ts: g('ts')
    });
  });
  return rows;
}

var wizStep = 1;
// wizSteps[step-1] = { slotA:{...}, slotB:{...}, rows:[...], saved, skipped }
var wizSteps = [{}, {}, {}];
var wizRowSeq = 0;

// タイプラベル
var WIZ_TYPE_LABELS = {
  TK: '東京・神戸 独立', COLOAD: 'CO-LOAD＋東京', OLT: 'OLT＋東京COMBINE'
};

// ── 初期化 ───────────────────────────────────────────────────
function wizInitPage() {
  // シミュレーション画面のBKGを常に取得して全ステップに反映（未保存ステップのみ上書き）
  var simRows = getSimRowsForWizard();
  [0, 1, 2].forEach(function(si) {
    // 保存済みステップはユーザー編集を尊重（_simRows更新のみ）
    wizSteps[si]._simRows = simRows;
    // 未保存かつ未スキップの場合は行データもリセット
    if (!wizSteps[si].saved && !wizSteps[si].skipped) {
      wizSteps[si].rows = null;
    }
  });
  if (wizStep === 1 && !wizSteps[0].saved) wizReset();
  else wizRenderStep(wizStep);
}

window.wizReset = function() {
  wizStep = 1;
  wizSteps = [{}, {}, {}];
  wizRowSeq = 0;
  // シミュレーション画面のBKGを取得して全ステップの_simRowsに設定
  var simRows = getSimRowsForWizard();
  [0, 1, 2].forEach(function(si) { wizSteps[si]._simRows = simRows; });
  wizRenderStep(1);
};

// ── ステップ描画 ──────────────────────────────────────────────
function wizRenderStep(step) {
  wizStep = step;

  // インジケーター
  [1,2,3,'r'].forEach(function(s) {
    var el = $('wiz-step-' + s); if (!el) return;
    el.classList.remove('wiz-active','wiz-done','wiz-skip');
    if (s === 'r') {
      if (step === 'result') el.classList.add('wiz-active');
      else if (wizSteps[0].saved && wizSteps[1].saved) el.classList.add('wiz-done');
      return;
    }
    var si = parseInt(s);
    if (si === step) el.classList.add('wiz-active');
    else if (wizSteps[si-1] && wizSteps[si-1].saved) el.classList.add('wiz-done');
    else if (wizSteps[si-1] && wizSteps[si-1].skipped) el.classList.add('wiz-skip');
  });

  if (step === 'result') {
    $('wiz-input-area').style.display = 'none';
    $('wiz-result-area').style.display = '';
    wizRenderResult();
    return;
  }

  $('wiz-input-area').style.display = '';
  $('wiz-result-area').style.display = 'none';

  var st = wizSteps[step - 1];
  var sA = st.slotA || {};
  var sB = st.slotB || {};

  // タイトル
  if ($('wiz-pattern-title')) $('wiz-pattern-title').textContent = 'ステップ' + step + ' 設定';

  // 為替・共通コスト設定の復元
  // 未保存の場合はシミュレーション画面の現在値をデフォルトとして使用
  var autoFx  = window._autoFxJpy ? String(window._autoFxJpy) : '155';
  var autoEur = window._autoFxEur ? String(window._autoFxEur) : '187';

  // シミュレーション画面から各種設定を読み取り（ウィザードのデフォルト初期値に使う）
  var simVanTokyo   = $('van-tokyo')    ? $('van-tokyo').value    : '2,800';
  var simVanKobe    = $('van-kobe')     ? $('van-kobe').value     : '2,600';
  var simLashing    = $('lashing')      ? $('lashing').value      : '6,000';
  var simOltHandling= $('olt-handling') ? $('olt-handling').value : '1,800';

  // OLTトラック費：シミュレーション画面でチェックされているトラックの合計を引き継ぐ
  function calcSimOltTruck() {
    var truck = 0;
    if ($('olt-chk-4')   && $('olt-chk-4').checked)   truck += nv($('olt-tr4')   ? $('olt-tr4').value   : 0);
    if ($('olt-chk-10')  && $('olt-chk-10').checked)  truck += nv($('olt-tr10')  ? $('olt-tr10').value  : 0);
    if ($('olt-chk-10z') && $('olt-chk-10z').checked) truck += nv($('olt-tr10z') ? $('olt-tr10z').value : 0);
    return truck;
  }
  var simOltTruck = calcSimOltTruck();

  if ($('wiz-fx'))           $('wiz-fx').value           = st.fx          || autoFx;
  if ($('wiz-eur'))          $('wiz-eur').value          = st.eur         || autoEur;
  if ($('wiz-van-tokyo'))    $('wiz-van-tokyo').value    = st.vanTokyo    || simVanTokyo;
  if ($('wiz-van-kobe'))     $('wiz-van-kobe').value     = st.vanKobe     || simVanKobe;
  if ($('wiz-lashing'))      $('wiz-lashing').value      = st.lashing     || simLashing;
  if ($('wiz-olt-handling')) $('wiz-olt-handling').value = st.oltHandling || simOltHandling;
  if ($('wiz-olt-truck'))    $('wiz-olt-truck').value    = st.oltTruck != null ? st.oltTruck : fmt(simOltTruck);

  // スロットA/B タイプ設定
  ['A','B'].forEach(function(sl) {
    var saved = sl === 'A' ? sA : sB;
    var type = saved.type || (sl === 'A' ? 'TK' : 'COLOAD');
    var radioName = 'wiztype' + sl;
    document.querySelectorAll('input[name="' + radioName + '"]').forEach(function(r) {
      r.checked = (r.value === type);
    });
    document.querySelectorAll('.wt-btn[data-slot="' + sl + '"]').forEach(function(lb) {
      lb.classList.toggle('pt-active', lb.dataset.val === type);
    });
    wizRenderSlotCarriers(sl, type, saved);
    // 名称：保存済みがあればそれを使用、なければ自動生成
    var nameEl = $('wiz-name' + sl);
    if (nameEl) {
      if (saved.name) {
        nameEl.value = saved.name;
        nameEl.dataset.auto = '0';
      } else {
        nameEl.value = 'スロット' + sl + '（' + (WIZ_TYPE_LABELS[type] || type) + '）';
        nameEl.dataset.auto = '1';
      }
    }
  });

  // ナビ
  $('wiz-btn-back').style.display = step > 1 ? '' : 'none';
  // ステップ1は必須（スキップ不可）、2・3はスキップ可
  $('wiz-btn-skip').style.display = step >= 2 ? '' : 'none';
  $('wiz-btn-next').textContent = step === 3 ? '比較へ →' : '次へ →';

  // BKGリスト
  wizBuildRows(step);

  // コンテナ構成
  wizRenderCntrInputs('A', sA.type || 'TK', sA);
  wizRenderCntrInputs('B', sB.type || 'COLOAD', sB);
  wizUpdateVolSummary();

  // プレビュー（常に自動計算）
  var preCard = $('wiz-preview-card');
  if (preCard) {
    preCard.style.display = '';
    wizCalcPreview();
  }
}

// ── タイプ変更 ────────────────────────────────────────────────
window.onWizSlotTypeChange = function(sl) {
  var type = wizGetSlotType(sl);
  document.querySelectorAll('.wt-btn[data-slot="' + sl + '"]').forEach(function(lb) {
    lb.classList.toggle('pt-active', lb.dataset.val === type);
  });
  // スロット名称を自動生成
  var nameEl = $('wiz-name' + sl);
  if (nameEl && (!nameEl.value || nameEl.dataset.auto === '1')) {
    nameEl.value = 'スロット' + sl + '（' + (WIZ_TYPE_LABELS[type] || type) + '）';
    nameEl.dataset.auto = '1';
  }
  wizRenderSlotCarriers(sl, type, {});
  wizRenderCntrInputs(sl, type, {});
  wizUpdateVolSummary();
};

function wizGetSlotType(sl) {
  var checked = document.querySelector('input[name="wiztype' + sl + '"]:checked');
  return checked ? checked.value : (sl === 'A' ? 'TK' : 'COLOAD');
}

// ── 船社選択描画 ──────────────────────────────────────────────
function wizRenderSlotCarriers(sl, type, saved) {
  var el = $('wiz-carriers' + sl); if (!el) return;
  var clRateEl = $('wiz-coload-rate' + sl);
  var html = '';

  function selHtml(id, label, color, brd, val) {
    var opts = '<option value="">-- 選択 --</option>';
    carriers.forEach(function(c) {
      opts += '<option value="' + c + '"' + (c===val?' selected':'') + '>' + c + '</option>';
    });
    return '<div class="f"><label style="color:' + color + ';font-weight:700;font-size:11px">' + label + '</label>' +
      '<select onchange="onCarrierChange()" style="padding:5px 8px;width:100%;border:1px solid ' + brd + ';border-radius:var(--r);background:var(--sur);font-size:12px;font-family:var(--mono)" id="wiz-c-' + id + '-' + sl + '">' + opts + '</select></div>';
  }
  function clSelHtml(val) {
    var opts = '<option value="">-- 選択 --</option>';
    coloadRates.forEach(function(c) {
      opts += '<option value="' + c.id + '"' + (c.id===val?' selected':'') + '>' + c.name + '</option>';
    });
    return '<div class="f"><label style="color:var(--amber);font-weight:700;font-size:11px">CO-LOAD 業者</label>' +
      '<select id="wiz-cl-' + sl + '" onchange="wizUpdateClRate(\'' + sl + '\')" style="padding:5px 8px;width:100%;border:1px solid var(--amber-brd);border-radius:var(--r);background:var(--sur);font-size:12px">' + opts + '</select></div>';
  }

  if (type === 'TK') {
    // 未保存の場合はシミュレーション画面の東京・神戸船社を引き継ぐ
    var defaultCT = saved.cT || ($('sim-carrier-t') ? $('sim-carrier-t').value : '');
    var defaultCK = saved.cK || ($('sim-carrier-k') ? $('sim-carrier-k').value : '');
    html = selHtml('t', '東京 船社', 'var(--blue)', 'var(--blue-brd)', defaultCT) +
           selHtml('k', '神戸 船社', 'var(--red)',  'var(--red-brd)',  defaultCK);
  } else if (type === 'COLOAD') {
    // CO-LOAD業者：シミュレーション画面の選択を引き継ぐ
    var defaultCL = saved.clId || ($('sim-coload-id') ? $('sim-coload-id').value : '');
    var defaultCT = saved.cT   || ($('sim-carrier-t') ? $('sim-carrier-t').value : '');
    html = clSelHtml(defaultCL) +
           selHtml('t', '東京 船社', 'var(--blue)', 'var(--blue-brd)', defaultCT);
  } else if (type === 'OLT') {
    var defaultCT = saved.cT || ($('sim-carrier-t') ? $('sim-carrier-t').value : '');
    html = selHtml('t', '東京 船社（OLT後合流）', 'var(--acc)', 'var(--acc-brd)', defaultCT);
  }
  el.innerHTML = html;

  // CO-LOAD情報更新
  wizUpdateClRate(sl);
}

window.wizUpdateClRate = function(sl) {
  var el = $('wiz-coload-rate' + sl); if (!el) return;
  var selEl = $('wiz-cl-' + sl);
  if (!selEl) { el.style.display = 'none'; return; }
  var id = selEl.value;
  var rate = coloadRates.find(function(r){return r.id===id;});
  el.style.display = id ? '' : 'none';
  if (rate) el.textContent = rate.name + ': O/F $'+fmt(rate.of_usd)+' EFS $'+fmt(rate.efs_usd)+'/RT  ICS2 $'+fmt(rate.ics2_usd)+'/BL  CFS ¥'+fmt(rate.cfs_jpy)+' THC ¥'+fmt(rate.thc_jpy)+' DRS ¥'+fmt(rate.drs_jpy)+'/RT';
  calc();
};

// ── コンテナ構成入力 ──────────────────────────────────────────
function wizRenderCntrInputs(sl, type, saved) {
  var el = $('wiz-cntr-inputs' + sl); if (!el) return;
  var cv = saved.cntr || {};
  function numBox(label, id) {
    return '<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--tx2);min-width:60px">' + label + '</label>' +
      '<input type="number" id="' + id + '" min="0" value="' + (cv[id]||0) + '" onchange="wizUpdateVolSummary()" style="width:50px;font-family:var(--mono);font-size:13px;padding:3px 5px;border:1px solid var(--brd2);border-radius:5px;text-align:center">' +
      '<span style="font-size:11px;color:var(--tx2)">本</span></div>';
  }
  var color = sl === 'A' ? 'var(--blue)' : 'var(--acc)';
  var bg    = sl === 'A' ? 'var(--blue-bg)' : 'var(--acc-bg)';
  var brd   = sl === 'A' ? 'var(--blue-brd)' : 'var(--acc-brd)';

  if (type === 'TK') {
    // 東京コンテナ + 神戸コンテナ（独立）
    el.innerHTML =
      '<div style="background:'+bg+';border-radius:var(--r);padding:.6rem .8rem;border:1px solid '+brd+'">' +
        '<div style="font-size:10px;font-weight:700;color:'+color+';margin-bottom:.4rem">スロット'+sl+' — 東京・神戸独立</div>' +
        '<div style="font-size:10px;color:var(--blue);margin-bottom:4px;font-weight:700">東京コンテナ</div>' +
        numBox('20FT', 'wiz-ct20-'+sl) + numBox('40HC', 'wiz-ct40-'+sl) +
        '<div style="font-size:10px;color:var(--red);margin:6px 0 4px;font-weight:700">神戸コンテナ</div>' +
        numBox('20FT', 'wiz-ck20-'+sl) + numBox('40HC', 'wiz-ck40-'+sl) +
      '</div>';

  } else if (type === 'COLOAD') {
    // 東京コンテナ（東京行用） + CO-LOAD（神戸行は自動）
    el.innerHTML =
      '<div style="background:'+bg+';border-radius:var(--r);padding:.6rem .8rem;border:1px solid '+brd+'">' +
        '<div style="font-size:10px;font-weight:700;color:'+color+';margin-bottom:.4rem">スロット'+sl+' — CO-LOAD＋東京</div>' +
        '<div style="font-size:10px;color:var(--blue);margin-bottom:4px;font-weight:700">東京コンテナ（東京荷主分）</div>' +
        numBox('20FT', 'wiz-ct20-'+sl) + numBox('40HC', 'wiz-ct40-'+sl) +
        '<div style="background:var(--amber-bg);border:1px solid var(--amber-brd);border-radius:4px;padding:.4rem .6rem;margin-top:6px">' +
          '<div style="font-size:10px;font-weight:700;color:var(--amber);margin-bottom:2px">📦 CO-LOAD（神戸荷主分・本数不要）</div>' +
          '<div id="wiz-cl-m3-disp-'+sl+'" style="font-family:var(--mono);font-size:12px;color:var(--amber)">神戸荷主あり → 自動計算</div>' +
        '</div>' +
      '</div>';

  } else if (type === 'OLT') {
    // 東京コンテナ（東京+神戸合流） + OLT費用
    el.innerHTML =
      '<div style="background:'+bg+';border-radius:var(--r);padding:.6rem .8rem;border:1px solid '+brd+'">' +
        '<div style="font-size:10px;font-weight:700;color:'+color+';margin-bottom:.4rem">スロット'+sl+' — OLT＋東京COMBINE</div>' +
        '<div style="font-size:10px;color:var(--blue);margin-bottom:4px;font-weight:700">東京コンテナ（東京＋神戸合流分）</div>' +
        numBox('20FT', 'wiz-ct20-'+sl) + numBox('40HC', 'wiz-ct40-'+sl) +
        '<div style="background:var(--acc-bg);border:1px solid var(--acc-brd);border-radius:4px;padding:.4rem .6rem;margin-top:6px">' +
          '<div style="font-size:10px;font-weight:700;color:var(--acc);margin-bottom:2px">🚛 OLT費用（神戸行に適用・共通設定から自動計算）</div>' +
          '<div style="font-size:10px;color:var(--tx2)">神戸物量 × 入出庫料 ＋ OLTトラック費</div>' +
        '</div>' +
      '</div>';
  }
}

// ── 物量サマリー ─────────────────────────────────────────────
function wizUpdateVolSummary() {
  var el = $('wiz-vol-summary'); if (!el) return;
  var rows = wizGetCurrentRows();
  var tM = rows.filter(function(r){return r.base==='東京';}).reduce(function(s,r){return s+r.vol;},0);
  var kM = rows.filter(function(r){return r.base==='神戸';}).reduce(function(s,r){return s+r.vol;},0);
  var allM = tM+kM;
  el.textContent = '東京: '+fmt(tM,1)+'m³　神戸: '+fmt(kM,1)+'m³　合計: '+fmt(allM,1)+'m³';
  // COLOAD型のコンテナ欄にm³表示（スロット別）
  ['A','B'].forEach(function(sl){
    var clDisp=$('wiz-cl-m3-disp-'+sl);
    if(clDisp){
      // COLOAD型では神戸物量がCO-LOAD対象
      clDisp.textContent = kM>0 ? '神戸（CO-LOAD対象）: '+fmt(kM,1)+' m³' : '0 m³';
    }
  });
}

window.wizAutoFill = function() {
  var rows = wizGetCurrentRows();
  var tM = rows.filter(function(r){return r.base==='東京';}).reduce(function(s,r){return s+r.vol;},0);
  var kM = rows.filter(function(r){return r.base==='神戸';}).reduce(function(s,r){return s+r.vol;},0);

  // 振り分けルール：≤25m³→20FT×1本、25m³超→40HC（cap基準）
  function allocate(m3, cap40) {
    if (m3 <= 0)  return {n20:0, n40:0};
    if (m3 <= 25) return {n20:1, n40:0};
    return {n20:0, n40: Math.ceil(m3 / (cap40 || 50))};
  }
  function getCap40(selId) {
    var sel=$(selId); if(!sel||!sel.value) return 50;
    var c=null; allCosts.forEach(function(r){if(r.carrier===sel.value&&r.container_type==='40HC')c=r;});
    return c ? (nv(c.cap_m3)||50) : 50;
  }

  ['A','B'].forEach(function(sl) {
    var type = wizGetSlotType(sl);
    var t20El=$('wiz-ct20-'+sl), t40El=$('wiz-ct40-'+sl);
    var k20El=$('wiz-ck20-'+sl), k40El=$('wiz-ck40-'+sl);

    if (type === 'COLOAD') {
      // CO-LOAD型：東京行のみコンテナ本数、神戸行はCO-LOAD（本数不要）
      var aT = allocate(tM, getCap40('wiz-c-t-'+sl));
      if(t20El) t20El.value=aT.n20; if(t40El) t40El.value=aT.n40;
      if(k20El) k20El.value=0;      if(k40El) k40El.value=0;
    } else if (type === 'OLT') {
      // OLT型：東京+神戸合流 → 東京コンテナに集約
      var combM = tM + kM;
      var aT = allocate(combM, getCap40('wiz-c-t-'+sl));
      if(t20El) t20El.value=aT.n20; if(t40El) t40El.value=aT.n40;
      if(k20El) k20El.value=0;      if(k40El) k40El.value=0;
    } else {
      // TK型：東京コンテナ ＋ 神戸コンテナ独立
      var aT = allocate(tM, getCap40('wiz-c-t-'+sl));
      var aK = allocate(kM, getCap40('wiz-c-k-'+sl));
      if(t20El) t20El.value=aT.n20; if(t40El) t40El.value=aT.n40;
      if(k20El) k20El.value=aK.n20; if(k40El) k40El.value=aK.n40;
    }
  });
  wizUpdateVolSummary();
  wizCalcPreview();
};

// ── BKGリスト ────────────────────────────────────────────────
function wizBuildRows(step) {
  var tbody = $('wiz-row-body'); if (!tbody) return;
  tbody.innerHTML = ''; wizRowSeq = 0;
  var rows = [];
  var st = wizSteps[step-1];
  if (st.saved && st.rows && st.rows.length) {
    // 保存済みステップ：ユーザーが編集した内容を使用
    rows = st.rows.map(function(r){return Object.assign({},r);});
  } else {
    // 未保存ステップ：常にシミュレーション画面の最新BKGを反映
    var simRows = getSimRowsForWizard();
    rows = simRows.length > 0 ? simRows : [];
  }
  rows.forEach(function(r){wizAddRow(r);});
  if (rows.length === 0) wizAddRow();
}

window.wizAddRow = function(d) {
  d = d || {};
  var id = ++wizRowSeq;
  var tbody = $('wiz-row-body'); if (!tbody) return;
  var tr = document.createElement('tr');
  tr.id = 'wiz-row-'+id; tr.dataset.rid = id;

  var custOpts = '<option value="">-- 選択 --</option>';
  customers.forEach(function(c){
    var bi=baseInfo(c.origin);
    custOpts+='<option value="'+c.id+'"'+(c.id===d.custId?' selected':'')+'>'+c.name+'（'+bi.label+'）</option>';
  });

  var destOpts = '<option value="RTM">RTM</option>';
  tsRates.forEach(function(t){
    var lbl=t.destination+(nv(t.ts_tariff)>0?'(+$'+t.ts_tariff+')':nv(t.ts_tariff)<0?'(割引)':'($0)');
    destOpts+='<option value="'+t.destination+'"'+(t.destination===d.dest?' selected':'')+'>'+lbl+'</option>';
  });

  var rv=function(k,fb){var n=nv(d[k]!=null?d[k]:(fb||0));return fmt(n,n%1!==0?2:0);};

  // 積み地（東京/神戸のみ）
  var baseVal = d.base || '東京';
  // CO-LOAD/OLTで保存されていた場合は東京にフォールバック
  if(baseVal==='CO-LOAD'||baseVal==='OLT') baseVal='東京';
  var baseStyle = baseVal==='神戸'
    ? 'font-size:11px;padding:3px 5px;background:var(--red-bg);border:1px solid var(--red-brd);color:var(--red);border-radius:var(--r)'
    : 'font-size:11px;padding:3px 5px;background:#E8F0FF;border:1px solid var(--blue-brd);color:var(--blue);border-radius:var(--r)';
  var baseOptHtml =
    '<option value="東京"'+(baseVal==='東京'?' selected':'')+'>東京</option>'+
    '<option value="神戸"'+(baseVal==='神戸'?' selected':'')+'>神戸</option>';

  tr.innerHTML=
    '<td><select class="ri ri-sel wiz-cust-sel" onchange="onWizRowCust('+id+',this)" style="min-width:100px">'+custOpts+'</select></td>'+
    '<td><input class="ri ri-sm" id="wr-vol-'+id+'" type="number" inputmode="decimal" min="0" step="0.1" value="'+(nv(d.vol)||10)+'" oninput="wizUpdateVolSummary()" style="text-align:right"></td>'+
    '<td><select class="ri ri-dest" id="wr-dest-'+id+'" onchange="onWizDestChange('+id+')" style="min-width:80px">'+destOpts+'</select><div id="wr-ts-disp-'+id+'" style="font-size:9px;color:var(--purple)"></div></td>'+
    '<td><select class="ri" id="wr-base-'+id+'" onchange="onWizBaseChange('+id+',this)" style="'+baseStyle+'">'+baseOptHtml+'</select></td>'+
    '<td><input class="ri ri-sm" id="wr-of-'+id+'"  type="text" value="'+rv('of')+'"  oninput="this.classList.add(\"edited\")"></td>'+
    '<td><input class="ri ri-sm" id="wr-lss-'+id+'" type="text" value="'+rv('lss')+'" oninput="this.classList.add(\"edited\")"></td>'+
    '<td><input class="ri ri-sm" id="wr-pss-'+id+'" type="text" value="'+rv('pss')+'" oninput="this.classList.add(\"edited\")"></td>'+
    '<td><input class="ri ri-sm" id="wr-efs-'+id+'" type="text" value="'+rv('efs')+'" oninput="this.classList.add(\"edited\")"></td>'+
    '<td><input class="ri ri-sm" id="wr-ics-'+id+'" type="text" value="'+rv('ics')+'" oninput="this.classList.add(\"edited\")"></td>'+
    '<td><input class="ri ri-sm" id="wr-cfs-'+id+'" type="text" value="'+rv('cfs')+'" oninput="this.classList.add(\"edited\")"></td>'+
    '<td><input class="ri ri-sm" id="wr-thc-'+id+'" type="text" value="'+rv('thc')+'" oninput="this.classList.add(\"edited\")"></td>'+
    '<td><input class="ri ri-sm" id="wr-drs-'+id+'" type="text" value="'+rv('drs')+'" oninput="this.classList.add(\"edited\")"></td>'+
    '<td><input class="ri ri-sm" id="wr-bl-'+id+'"  type="text" value="'+rv('bl')+'"  oninput="this.classList.add(\"edited\")"></td>'+
    '<td><input class="ri ri-sm" id="wr-ts-'+id+'"  type="text" value="'+rv('ts')+'"  oninput="this.classList.add(\"edited\")"></td>'+
    '<td style="text-align:center"><input type="checkbox" id="wr-tschk-'+id+'"'+(d.tsApply?' checked':'')+' style="width:14px;height:14px;accent-color:var(--purple)"><div id="wr-tsauto-'+id+'" style="font-size:9px;color:var(--purple)"></div></td>'+
    '<td><button class="del-row" onclick="wizDelRow('+id+')">✕</button></td>';
  tbody.appendChild(tr);
  onWizDestChange(id);
};

window.wizDelRow=function(id){var t=$('wiz-row-'+id);if(t)t.remove();wizUpdateVolSummary();};

// 積み地変更（東京/神戸）
window.onWizBaseChange=function(id,sel){
  var v=sel.value;
  if(v==='神戸'){
    sel.style.background='var(--red-bg)';sel.style.borderColor='var(--red-brd)';sel.style.color='var(--red)';
  } else {
    sel.style.background='#E8F0FF';sel.style.borderColor='var(--blue-brd)';sel.style.color='var(--blue)';
  }
  wizUpdateVolSummary();
};

window.onWizRowCust=function(id,sel){
  var c=null; customers.forEach(function(x){if(x.id===sel.value)c=x;});
  if(!c)return;
  function s(f,v){var el=$('wr-'+f+'-'+id);if(!el)return;var n=nv(v);el.value=fmt(n,n%1!==0?2:0);el.classList.remove('edited');}
  s('of',c.of_sell);s('lss',c.lss_sell);s('pss',c.pss_sell);s('efs',c.efs_sell);
  s('ics',c.ics_sell);s('cfs',c.cfs_sell);s('thc',c.thc_sell);s('drs',c.drs_sell);
  s('bl',c.bl_fee_sell);s('ts',c.ts_sell);
  var bi=baseInfo(c.origin);
  var baseEl=$('wr-base-'+id);if(baseEl)baseEl.value=bi.simBase;
  var destEl=$('wr-dest-'+id);
  if(destEl){destEl.value=c.destination||'RTM';onWizDestChange(id);}
  wizUpdateVolSummary();
};

window.onWizDestChange=function(id){
  var dest=$('wr-dest-'+id)?$('wr-dest-'+id).value:'RTM';
  var chk=$('wr-tschk-'+id);var disp=$('wr-ts-disp-'+id);var auto=$('wr-tsauto-'+id);
  if(dest==='RTM'){if(chk)chk.checked=false;if(disp)disp.textContent='';if(auto)auto.textContent='';}
  else{
    var rate=null;tsRates.forEach(function(t){if(t.destination===dest)rate=t;});
    if(chk)chk.checked=true;if(auto)auto.textContent='自動ON';
    if(rate&&disp){var t=nv(rate.ts_tariff);disp.textContent=t>0?'+$'+rate.ts_tariff+'/m³':t<0?'割引$'+rate.ts_tariff:'$0';}
  }
};

// ── 行データ収集 ──────────────────────────────────────────────
function wizGetCurrentRows() {
  var rows = [];
  document.querySelectorAll('#wiz-row-body tr').forEach(function(tr) {
    var id=tr.dataset.rid;
    var g=function(f){var el=$('wr-'+f+'-'+id);return el?nv(el.value):0;};
    var custId=''; var custSel=tr.querySelector('.wiz-cust-sel');
    if(custSel)custId=custSel.value;
    var custName='（未選択）'; customers.forEach(function(c){if(c.id===custId)custName=c.name;});
    var dest=$('wr-dest-'+id)?$('wr-dest-'+id).value:'RTM';
    var tsRate=null; if(dest!=='RTM')tsRates.forEach(function(t){if(t.destination===dest)tsRate=t;});
    var baseVal = $('wr-base-'+id)?$('wr-base-'+id).value:'東京';
    // CO-LOAD/OLTが残存していた場合は東京にフォールバック
    if(baseVal==='CO-LOAD'||baseVal==='OLT') baseVal='東京';
    rows.push({
      custId:custId, custName:custName,
      vol:g('vol'), base:baseVal,
      dest:dest, tsRate:tsRate,
      tsApply:$('wr-tschk-'+id)?$('wr-tschk-'+id).checked:false,
      of:g('of'),lss:g('lss'),pss:g('pss'),efs:g('efs'),ics:g('ics'),
      cfs:g('cfs'),thc:g('thc'),drs:g('drs'),bl:g('bl'),ts:g('ts')
    });
  });
  return rows;
}

// ── ステップ保存 ──────────────────────────────────────────────
function wizSaveCurrentStep() {
  function slotData(sl) {
    var type = wizGetSlotType(sl);
    var cntr = {};
    ['ct20','ct40','ck20','ck40'].forEach(function(k){
      var el=$('wiz-'+k+'-'+sl); if(el) cntr['wiz-'+k+'-'+sl]=parseInt(el.value)||0;
    });
    return {
      type: type,
      name: $('wiz-name'+sl) ? ($('wiz-name'+sl).value||('ステップ'+wizStep+'-'+sl)) : ('ステップ'+wizStep+'-'+sl),
      cT:  $('wiz-c-t-'+sl)  ? $('wiz-c-t-'+sl).value  : '',
      cK:  $('wiz-c-k-'+sl)  ? $('wiz-c-k-'+sl).value  : '',
      clId:$('wiz-cl-'+sl)   ? $('wiz-cl-'+sl).value   : '',
      cntr: cntr
    };
  }
  wizSteps[wizStep-1] = {
    saved: true, skipped: false, step: wizStep,
    fx:          $('wiz-fx')          ? $('wiz-fx').value          : '155',
    eur:         $('wiz-eur')         ? $('wiz-eur').value         : '187',
    vanTokyo:    $('wiz-van-tokyo')   ? $('wiz-van-tokyo').value   : '2800',
    vanKobe:     $('wiz-van-kobe')    ? $('wiz-van-kobe').value    : '2600',
    lashing:     $('wiz-lashing')     ? $('wiz-lashing').value     : '6000',
    oltHandling: $('wiz-olt-handling')? $('wiz-olt-handling').value: '1800',
    oltTruck:    $('wiz-olt-truck')   ? $('wiz-olt-truck').value   : '0',
    agentName:   selAgent ? selAgent.name : '',
    slotA: slotData('A'),
    slotB: slotData('B'),
    rows: wizGetCurrentRows()
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
  wizSteps[wizStep-1] = {skipped:true,saved:false,step:wizStep};
  if (wizStep < 3) wizRenderStep(wizStep + 1);
  else wizRenderStep('result');
};
window.wizBackToEdit = function() {
  // スキップされていない最後のステップに戻る
  var last = 1;
  for (var i = 2; i >= 0; i--) {
    if (!wizSteps[i].skipped) { last = i + 1; break; }
  }
  wizRenderStep(last);
};

// ── 1スロット分の計算（正式版） ───────────────────────────────
// スロットタイプ（TK/COLOAD/OLT）が同じBKGデータに対してどのコストを適用するかを決める
// TK     : 東京行→東京船社、神戸行→神戸船社
// COLOAD : 東京行→東京船社、神戸行→CO-LOAD業者コスト（REFUND対象外）
// OLT    : 東京行→東京船社、神戸行→OLT費用（入出庫料+トラック）で東京コンテナに合流
function wizCalcSlot(slotData, rows, fx, st) {
  if (!slotData || !rows || rows.length === 0) return null;
  var type = slotData.type || 'TK';
  var sl   = slotData._sl || 'A';

  // ── コスト設定（ウィザード共通設定 → シミュレーション画面 → デフォルト）──
  st = st || {};
  var eur        = nv(st.eur         || ($('wiz-eur')          ? $('wiz-eur').value          : ($('sim-eur')     ? $('sim-eur').value     : '187')));
  var vanTokyo   = nv(st.vanTokyo    || ($('wiz-van-tokyo')    ? $('wiz-van-tokyo').value    : ($('van-tokyo')   ? $('van-tokyo').value   : '2800')));
  var vanKobe    = nv(st.vanKobe     || ($('wiz-van-kobe')     ? $('wiz-van-kobe').value     : ($('van-kobe')    ? $('van-kobe').value    : '2600')));
  var lashingJPY = nv(st.lashing     || ($('wiz-lashing')      ? $('wiz-lashing').value      : ($('lashing')     ? $('lashing').value     : '6000')));
  var oltHandling= nv(st.oltHandling || ($('wiz-olt-handling') ? $('wiz-olt-handling').value : ($('olt-handling')? $('olt-handling').value : '1800')));
  var oltTruck   = nv(st.oltTruck    || ($('wiz-olt-truck')    ? $('wiz-olt-truck').value    : '0'));

  // ── 積み地別に行を分類 ──
  var tRows = rows.filter(function(r){ return r.base === '東京'; });
  var kRows = rows.filter(function(r){ return r.base === '神戸'; });
  var tM = tRows.reduce(function(s,r){ return s+r.vol; }, 0);
  var kM = kRows.reduce(function(s,r){ return s+r.vol; }, 0);

  // OLT型では神戸行を東京コンテナに合流 → 東京コンテナ搭載物量 = tM+kM
  var tCombM = (type === 'OLT') ? tM + kM : tM;

  var tsM  = rows.filter(function(r){ return r.tsApply; }).reduce(function(s,r){ return s+r.vol; }, 0);
  var nomM = rows.filter(function(r){ return r.isNomination; }).reduce(function(s,r){ return s+r.vol; }, 0);

  // ── 売上（全行共通） ──
  var totalRev = rows.reduce(function(s,r){
    return s + (r.of+r.lss+r.pss+r.efs)*r.vol*fx + r.ics*fx
             + (r.tsApply ? r.ts*r.vol*fx : 0)
             + (r.cfs+r.thc+r.drs)*r.vol + r.bl;
  }, 0);

  // ── T/Sコスト（共通） ──
  var totalTs = rows.reduce(function(s,r){
    if (!r.tsApply || !r.tsRate) return s;
    var t = nv(r.tsRate.ts_tariff); if (t === 0) return s;
    var raw = r.vol * t;
    return s + (t > 0 ? Math.max(raw, nv(r.tsRate.ts_min)) : raw) * fx;
  }, 0);

  // ── AGENTコスト（シミュレーション画面の選択 or ステップ保存値を引き継ぐ） ──
  var agentName = st.agentName || (selAgent ? selAgent.name : '');
  var agentRatesForWiz = agentName
    ? agentRates.filter(function(r){ return r.agent_name === agentName; })
    : [];
  var totalAgent = 0;
  if (agentRatesForWiz.length > 0) {
    rows.forEach(function(r){
      var rate = null;
      agentRatesForWiz.forEach(function(a){ if(a.destination===r.dest) rate=a; });
      if(!rate) agentRatesForWiz.forEach(function(a){ if(a.destination==='ALL') rate=a; });
      if(!rate) return;
      totalAgent += (nv(rate.ts_cost_usd)*r.vol + nv(rate.fixed_usd))*fx + nv(rate.handling_jpy);
    });
  }

  // ── コンテナコスト計算ヘルパー ──
  function selByCarrier(carrier, isHC) {
    var found = null;
    allCosts.forEach(function(r){
      if (r.carrier === carrier && r.container_type === (isHC ? '40HC' : '20FT')) found = r;
    });
    return found;
  }

  function calcCntrDetail(units, m3, C, isKobe) {
    if (!C || units <= 0) return { total:0, of:0, fix:0, van:0, lash:0, sur:0 };
    var ofJPY  = (nv(C.ocean_freight) + nv(C.baf_ees_efs)) * fx;
    var fixJPY = nv(C.thc_etc) + nv(C.doc_fee) + nv(C.seal_fee) + nv(C.cml_fee);
    var vRate  = isKobe ? vanKobe : vanTokyo;
    var vanMin = isKobe ? 10 : (C.container_type === '40HC' ? 26 : 13);
    var van    = Math.max(m3 / units, vanMin) * units * vRate;
    var lash   = isKobe ? units * lashingJPY : 0;
    var surUSD = nv(C.ens_usd)+nv(C.csl_usd)+nv(C.ecc_usd)+nv(C.stf_usd)+nv(C.efl_usd);
    var sur    = (surUSD * fx + nv(C.ees_eur) * eur) * units;
    return {
      total: (ofJPY+fixJPY)*units + van + lash + sur,
      of: ofJPY*units, fix: fixJPY*units, van: van, lash: lash, sur: sur
    };
  }

  // REFUND計算（CO-LOAD型では神戸物量はREFUND対象外、T/S・NOMINATION物量も除外）
  function calcRef(targetM3, totalForRef, C) {
    if (!C || targetM3 <= 0) return 0;
    var tsExclude  = totalForRef > 0 ? tsM  * (targetM3 / totalForRef) : 0;
    var nomExclude = totalForRef > 0 ? nomM * (targetM3 / totalForRef) : 0;
    return Math.max(0, targetM3 - tsExclude - nomExclude) * nv(C.refund_per_rt) * fx;
  }

  function bdRow(label, jpy, color) { return { label: label, jpy: jpy, color: color || '' }; }

  // コンテナ本数（ウィザード設定）
  var cntr = slotData.cntr || {};
  var cT20n = cntr['wiz-ct20-'+sl] || 0;
  var cT40n = cntr['wiz-ct40-'+sl] || 0;
  var cK20n = cntr['wiz-ck20-'+sl] || 0;
  var cK40n = cntr['wiz-ck40-'+sl] || 0;

  var cntrCostTotal = 0, oltCostTotal = 0, clCostTotal = 0, refund = 0;
  var cntrCostTokyo = 0, cntrCostKobe = 0; // 個別コスト追跡
  var bdItems = [];
  var cT = slotData.cT || '未選択';
  var cK = slotData.cK || '未選択';

  // ══════════════════════════════════════════════════════════
  if (type === 'TK') {
  // ══════════════════════════════════════════════════════════
  // 東京行 → 東京船社コンテナ
  // 神戸行 → 神戸船社コンテナ
    var sT20=selByCarrier(cT,false), sT40=selByCarrier(cT,true);
    var sK20=selByCarrier(cK,false), sK40=selByCarrier(cK,true);
    var dT20=calcCntrDetail(cT20n,tM,sT20,false), dT40=calcCntrDetail(cT40n,tM,sT40,false);
    var dK20=calcCntrDetail(cK20n,kM,sK20,true),  dK40=calcCntrDetail(cK40n,kM,sK40,true);
    cntrCostTokyo = dT20.total+dT40.total;
    cntrCostKobe  = dK20.total+dK40.total;
    cntrCostTotal = cntrCostTokyo + cntrCostKobe;
    refund = calcRef(tM, tM, sT20||sT40) + calcRef(kM, kM, sK20||sK40);

    if (tM > 0) {
      if (cT20n > 0) {
        bdItems.push(bdRow('🚢 東京 20FT×'+cT20n+' ['+cT+'] O/F＋固定費（'+fmt(tM,1)+'m³）', dT20.of+dT20.fix, 'var(--blue)'));
        bdItems.push(bdRow('　├ VANNING（東京）', dT20.van));
        if (dT20.sur > 0) bdItems.push(bdRow('　└ 追加サーチャージ', dT20.sur));
      }
      if (cT40n > 0) {
        bdItems.push(bdRow('🚢 東京 40HC×'+cT40n+' ['+cT+'] O/F＋固定費（'+fmt(tM,1)+'m³）', dT40.of+dT40.fix, 'var(--blue)'));
        bdItems.push(bdRow('　├ VANNING（東京）', dT40.van));
        if (dT40.sur > 0) bdItems.push(bdRow('　└ 追加サーチャージ', dT40.sur));
      }
      if (cT20n===0 && cT40n===0) bdItems.push(bdRow('⚠️ 東京コンテナ本数0 → 自動計算ボタンで設定', 0, 'var(--red)'));
    }
    if (kM > 0) {
      if (cK20n > 0) {
        bdItems.push(bdRow('🚢 神戸 20FT×'+cK20n+' ['+cK+'] O/F＋固定費（'+fmt(kM,1)+'m³）', dK20.of+dK20.fix, 'var(--red)'));
        bdItems.push(bdRow('　├ VANNING（神戸）', dK20.van));
        if (dK20.lash > 0) bdItems.push(bdRow('　├ ラッシング', dK20.lash));
        if (dK20.sur  > 0) bdItems.push(bdRow('　└ 追加サーチャージ', dK20.sur));
      }
      if (cK40n > 0) {
        bdItems.push(bdRow('🚢 神戸 40HC×'+cK40n+' ['+cK+'] O/F＋固定費（'+fmt(kM,1)+'m³）', dK40.of+dK40.fix, 'var(--red)'));
        bdItems.push(bdRow('　├ VANNING（神戸）', dK40.van));
        if (dK40.lash > 0) bdItems.push(bdRow('　├ ラッシング', dK40.lash));
        if (dK40.sur  > 0) bdItems.push(bdRow('　└ 追加サーチャージ', dK40.sur));
      }
      if (cK20n===0 && cK40n===0) bdItems.push(bdRow('⚠️ 神戸コンテナ本数0 → 自動計算ボタンで設定', 0, 'var(--red)'));
    }

  // ══════════════════════════════════════════════════════════
  } else if (type === 'COLOAD') {
  // ══════════════════════════════════════════════════════════
  // 東京行 → 東京船社コンテナ（コンテナ本数設定必要）
  // 神戸行 → CO-LOAD業者コスト（コンテナ本数不要、REFUND対象外）
    var sT20=selByCarrier(cT,false), sT40=selByCarrier(cT,true);
    var dT20=calcCntrDetail(cT20n,tM,sT20,false), dT40=calcCntrDetail(cT40n,tM,sT40,false);
    refund = calcRef(tM, tM, sT20||sT40); // 東京のみREFUND対象

    var clRate = coloadRates.find(function(r){ return r.id === slotData.clId; });
    var ofU  = clRate ? nv(clRate.of_usd)  : 70,  efsU = clRate ? nv(clRate.efs_usd) : 15;
    var ics2U= clRate ? nv(clRate.ics2_usd): 25,  cfsJ = clRate ? nv(clRate.cfs_jpy) : 4000;
    var thcJ = clRate ? nv(clRate.thc_jpy) : 1000, drsJ = clRate ? nv(clRate.drs_jpy): 300;
    var clName = clRate ? clRate.name : '未選択（デフォルト値使用）';
    var clOf  = kM * (ofU + efsU) * fx;
    var clDom = kM * (cfsJ + thcJ + drsJ);
    var clIcs = kRows.length * ics2U * fx;
    clCostTotal = clOf + clDom + clIcs;
    cntrCostTokyo = dT20.total + dT40.total;
    cntrCostTotal = cntrCostTokyo + clCostTotal;

    if (tM > 0) {
      if (cT20n > 0) {
        bdItems.push(bdRow('🚢 東京 20FT×'+cT20n+' ['+cT+'] O/F＋固定費（'+fmt(tM,1)+'m³）', dT20.of+dT20.fix, 'var(--blue)'));
        bdItems.push(bdRow('　├ VANNING（東京）', dT20.van));
        if (dT20.sur > 0) bdItems.push(bdRow('　└ 追加サーチャージ', dT20.sur));
      }
      if (cT40n > 0) {
        bdItems.push(bdRow('🚢 東京 40HC×'+cT40n+' ['+cT+'] O/F＋固定費（'+fmt(tM,1)+'m³）', dT40.of+dT40.fix, 'var(--blue)'));
        bdItems.push(bdRow('　├ VANNING（東京）', dT40.van));
        if (dT40.sur > 0) bdItems.push(bdRow('　└ 追加サーチャージ', dT40.sur));
      }
      if (cT20n===0 && cT40n===0) bdItems.push(bdRow('⚠️ 東京コンテナ本数0 → 自動計算ボタンで設定', 0, 'var(--red)'));
    } else {
      bdItems.push(bdRow('ℹ️ 東京荷主なし（東京コンテナコスト = 0）', 0, 'var(--tx3)'));
    }
    if (kM > 0) {
      bdItems.push(bdRow('📦 CO-LOAD ['+clName+'] O/F＋EFS（'+fmt(kM,1)+'m³×$'+(ofU+efsU)+'）', clOf, 'var(--amber)'));
      bdItems.push(bdRow('　├ CFS＋THC＋DRS（'+fmt(kM,1)+'m³）', clDom, 'var(--amber)'));
      if (clIcs > 0) bdItems.push(bdRow('　└ ICS2（'+kRows.length+'BL×$'+ics2U+'）', clIcs, 'var(--amber)'));
    } else {
      bdItems.push(bdRow('ℹ️ 神戸荷主なし（CO-LOADコスト = 0）', 0, 'var(--tx3)'));
    }

  // ══════════════════════════════════════════════════════════
  } else if (type === 'OLT') {
  // ══════════════════════════════════════════════════════════
  // 東京行 → 東京船社コンテナ（東京+神戸合計物量で計算）
  // 神戸行 → OLT費用（入出庫料 + トラック費）で東京コンテナに合流
    var sT20=selByCarrier(cT,false), sT40=selByCarrier(cT,true);
    // tCombM = tM + kM（神戸行も東京コンテナに合流）
    var dT20=calcCntrDetail(cT20n,tCombM,sT20,false), dT40=calcCntrDetail(cT40n,tCombM,sT40,false);
    var oltHandlingCost = kM * oltHandling;
    oltCostTotal = oltTruck + oltHandlingCost;
    cntrCostTokyo = dT20.total + dT40.total;
    cntrCostTotal = cntrCostTokyo + oltCostTotal;
    refund = calcRef(tCombM, tCombM, sT20||sT40);

    if (cT20n > 0) {
      bdItems.push(bdRow('🚢 東京 20FT×'+cT20n+' ['+cT+'] O/F＋固定費（東京+OLT合流 '+fmt(tCombM,1)+'m³）', dT20.of+dT20.fix, 'var(--blue)'));
      bdItems.push(bdRow('　├ VANNING（東京）', dT20.van));
      if (dT20.sur > 0) bdItems.push(bdRow('　└ 追加サーチャージ', dT20.sur));
    }
    if (cT40n > 0) {
      bdItems.push(bdRow('🚢 東京 40HC×'+cT40n+' ['+cT+'] O/F＋固定費（東京+OLT合流 '+fmt(tCombM,1)+'m³）', dT40.of+dT40.fix, 'var(--blue)'));
      bdItems.push(bdRow('　├ VANNING（東京）', dT40.van));
      if (dT40.sur > 0) bdItems.push(bdRow('　└ 追加サーチャージ', dT40.sur));
    }
    if (cT20n===0 && cT40n===0) bdItems.push(bdRow('⚠️ 東京コンテナ本数0 → 自動計算ボタンで設定', 0, 'var(--red)'));
    if (kM > 0) {
      if (oltTruck > 0) bdItems.push(bdRow('🚛 OLTトラック費（神戸→東京）', oltTruck, 'var(--acc)'));
      bdItems.push(bdRow('　└ OLT入出庫料（'+fmt(kM,1)+'m³×¥'+fmt(oltHandling)+'/m³）', oltHandlingCost, 'var(--acc)'));
    } else {
      bdItems.push(bdRow('ℹ️ 神戸荷主なし（OLT費用 = 0）', 0, 'var(--tx3)'));
    }
  }
  // ══════════════════════════════════════════════════════════

  if (totalTs     > 0) bdItems.push(bdRow('🌐 T/Sコスト（買値）', totalTs, 'var(--purple)'));
  if (totalAgent  > 0) bdItems.push(bdRow('👤 AGENTコスト（'+agentName+'）', totalAgent, 'var(--purple)'));
  if (refund      > 0) bdItems.push(bdRow('💰 REFUND（控除）', -refund, 'var(--green)'));

  var cost = cntrCostTotal + totalTs + totalAgent - refund;
  var prof = totalRev - cost;

  return {
    name: slotData.name, type: type,
    totalRev: totalRev, cost: cost, prof: prof,
    cntrCost: cntrCostTotal,
    cntrCostTokyo: cntrCostTokyo, cntrCostKobe: cntrCostKobe,
    oltCost: oltCostTotal, clCost: clCostTotal,
    totalTs: totalTs, totalAgent: totalAgent, refund: refund,
    bdItems: bdItems,
    tM: tM, kM: kM, allM: tM+kM, rows: rows
  };
}

// ── プレビュー表示 ────────────────────────────────────────────
window.wizCalcPreview = function() {
  var preCard = $('wiz-preview-card'); if (!preCard) return;
  // 現在のDOM状態から直接データを取得（保存は不要）
  var fx  = nv($('wiz-fx')  ? $('wiz-fx').value  : '155');
  var rows = wizGetCurrentRows();

  // コスト共通設定を直接DOMから取得
  var stNow = {
    eur:         $('wiz-eur')          ? $('wiz-eur').value          : '187',
    vanTokyo:    $('wiz-van-tokyo')    ? $('wiz-van-tokyo').value    : '2800',
    vanKobe:     $('wiz-van-kobe')     ? $('wiz-van-kobe').value     : '2600',
    lashing:     $('wiz-lashing')      ? $('wiz-lashing').value      : '6000',
    oltHandling: $('wiz-olt-handling') ? $('wiz-olt-handling').value : '1800',
    oltTruck:    $('wiz-olt-truck')    ? $('wiz-olt-truck').value    : '0'
  };

  preCard.style.display = '';
  if ($('wiz-preview-title')) $('wiz-preview-title').textContent = 'ステップ'+wizStep+' 計算結果';

  ['A','B'].forEach(function(sl) {
    var el = $('wiz-preview-'+sl); if (!el) return;

    // 現在のDOMからスロットデータを直接収集
    var type = wizGetSlotType(sl);
    var cntr = {};
    ['ct20','ct40','ck20','ck40'].forEach(function(k){
      var e=$('wiz-'+k+'-'+sl); if(e) cntr['wiz-'+k+'-'+sl]=parseInt(e.value)||0;
    });
    var sd = {
      _sl: sl, type: type,
      name: $('wiz-name'+sl) ? ($('wiz-name'+sl).value||'スロット'+sl) : 'スロット'+sl,
      cT:  $('wiz-c-t-'+sl)  ? $('wiz-c-t-'+sl).value  : '',
      cK:  $('wiz-c-k-'+sl)  ? $('wiz-c-k-'+sl).value  : '',
      clId:$('wiz-cl-'+sl)   ? $('wiz-cl-'+sl).value   : '',
      cntr: cntr
    };

    var res = wizCalcSlot(sd, rows, fx, stNow);
    if (!res) {
      el.innerHTML='<div style="font-size:12px;color:var(--tx3);padding:.5rem;text-align:center">BKGを入力してください</div>';
      return;
    }

    var color = sl==='A'?'var(--blue)':'var(--acc)';
    var bg    = sl==='A'?'var(--blue-bg)':'var(--acc-bg)';
    var brd   = sl==='A'?'var(--blue-brd)':'var(--acc-brd)';
    var profColor = res.prof>=0?'var(--acc)':'var(--red)';

    var bdHtml = res.bdItems.map(function(b){
      var isNeg = b.jpy < 0;
      var valColor = isNeg ? 'var(--acc)' : 'var(--tx)';
      var valWeight = isNeg ? '700' : '400';
      return '<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;padding:2px 0;border-bottom:1px solid var(--brd)">' +
        '<span style="color:'+(b.color||'var(--tx2)')+';flex:1">'+b.label+'</span>' +
        '<span style="font-family:var(--mono);color:'+valColor+';font-weight:'+valWeight+'">' +
          (isNeg?'▲ ':'') + fmtY(Math.abs(b.jpy))+
        '</span></div>';
    }).join('');

    el.innerHTML =
      '<div style="border:1px solid '+brd+';border-radius:var(--r);padding:.75rem 1rem;background:'+bg+'">' +
        '<div style="font-size:12px;font-weight:700;color:'+color+';margin-bottom:.6rem">スロット'+sl+'：'+res.name+'</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:.8rem">' +
          '<div style="background:var(--sur);border-radius:4px;padding:.4rem .5rem;text-align:center"><div style="font-size:9px;color:var(--tx2);margin-bottom:2px">総売上</div><div style="font-family:var(--mono);font-size:12px;font-weight:500">'+fmtY(res.totalRev)+'</div></div>' +
          '<div style="background:var(--sur);border-radius:4px;padding:.4rem .5rem;text-align:center"><div style="font-size:9px;color:var(--tx2);margin-bottom:2px">総コスト</div><div style="font-family:var(--mono);font-size:12px;font-weight:500">'+fmtY(res.cost)+'</div></div>' +
          '<div style="background:var(--sur);border-radius:4px;padding:.4rem .5rem;text-align:center;border:2px solid '+brd+'"><div style="font-size:9px;color:var(--tx2);margin-bottom:2px">粗利</div><div style="font-family:var(--mono);font-size:14px;font-weight:700;color:'+profColor+'">'+fmtY(res.prof)+'</div></div>' +
        '</div>' +
        '<div style="font-size:10px;font-weight:700;color:var(--tx2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">📋 コスト明細</div>' +
        '<div style="background:var(--sur);border-radius:4px;padding:.4rem .6rem">' +
          (bdHtml || '<div style="font-size:11px;color:var(--amber);padding:4px">⚠️ 自動計算ボタンでコンテナ本数を設定してください</div>') +
          '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:4px 0;margin-top:3px;border-top:2px solid var(--brd2)">' +
            '<span>合計コスト</span><span style="font-family:var(--mono)">'+fmtY(res.cost)+'</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  });
};

// ── 比較結果描画（最大6パターン） ────────────────────────────
function wizRenderResult() {
  // 有効なスロットのみ収集（SKIPステップは完全除外）
  var validSlots = [];
  var stepLabels = [];
  var stepColors = ['var(--blue)','var(--acc)','var(--blue)','var(--acc)','var(--blue)','var(--acc)'];
  var stepColorIdx = 0;

  wizSteps.forEach(function(st, si) {
    if (!st || st.skipped || !st.saved) return; // SKIPは列ごと除外
    var fx = nv(st.fx||155);
    var rows = st.rows || [];
    ['A','B'].forEach(function(sl) {
      var sd = Object.assign({_sl:sl}, sl==='A'?st.slotA:st.slotB);
      var res = wizCalcSlot(sd, rows, fx, st);
      if (res) {
        validSlots.push(res);
        stepLabels.push('S'+(si+1)+'-'+sl);
      }
    });
  });

  if (validSlots.length < 2) {
    $('wiz-cmp-head').innerHTML = '';
    $('wiz-cmp-body').innerHTML = '<tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--tx3)">有効なパターンが2つ以上必要です</td></tr>';
    $('wiz-concl').innerHTML = '';
    wizRenderMergeUI(validSlots, stepLabels);
    return;
  }

  var bestProf = -Infinity;
  validSlots.forEach(function(r){if(r.prof>bestProf)bestProf=r.prof;});

  // ヘッダー（有効スロットのみ）
  var hCols = validSlots.map(function(r, i) {
    var isBest = r.prof === bestProf;
    var color = isBest ? '#fff' : stepColors[i % stepColors.length];
    var bg    = isBest ? 'var(--acc)' : '';
    return '<th style="color:'+color+';background:'+bg+';padding:6px 10px;min-width:120px">' +
      stepLabels[i] + (isBest?' 🏆':'') +
      '<br><span style="font-size:10px;font-weight:400">' + r.name + '</span></th>';
  }).join('');

  $('wiz-cmp-head').innerHTML =
    '<tr><th style="text-align:left;font-size:10px;color:var(--tx2);min-width:120px">項目</th>' +
    hCols + '<th style="font-size:10px;color:var(--tx3);min-width:70px">差額</th></tr>';

  // 行生成ヘルパー
  function simRow(label, getter, isProf) {
    var cells = validSlots.map(function(r, i) {
      var v = getter(r);
      var isBest = isProf && v === bestProf;
      if (isBest) return '<td style="text-align:right;vertical-align:middle;padding:5px 10px">' +
        '<div style="display:inline-block;background:var(--acc);color:#fff;border-radius:6px;padding:4px 10px;font-family:var(--mono);font-size:14px;font-weight:900">'+fmtY(v)+' 🏆</div></td>';
      var isM3 = label.indexOf('m³') >= 0;
      var txt = isM3 ? fmt(v,1)+' m³' : fmtY(v);
      return '<td class="wv"' + (v<0&&isProf?' style="color:var(--red)"':'') + '>' + txt + '</td>';
    }).join('');
    // 差額（最大 - 最小）
    var vals = validSlots.map(getter);
    var mx = Math.max.apply(null,vals), mn = Math.min.apply(null,vals);
    var diff = mx - mn;
    var diffCell = isProf
      ? '<td class="wdiff" style="font-size:12px;font-weight:700;color:var(--purple)">' + (diff<1?'同等':fmtY(diff)) + '</td>'
      : '<td></td>';
    return '<tr><td style="padding:5px 10px;font-size:12px;color:var(--tx2)">'+label+'</td>'+cells+diffCell+'</tr>';
  }
  function secRow(label) {
    return '<tr><td colspan="'+(validSlots.length+2)+'" style="background:var(--sur2);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tx2);padding:4px 10px">'+label+'</td></tr>';
  }

  var bodyHtml = '';
  bodyHtml += secRow('物量');
  bodyHtml += simRow('東京 m³', function(r){return r.tM;});
  bodyHtml += simRow('神戸 m³', function(r){return r.kM;});
  bodyHtml += simRow('合計 m³', function(r){return r.allM;});
  bodyHtml += secRow('コスト内訳');
  // 東京コンテナコスト（全タイプ）
  bodyHtml += simRow('🚢 東京コンテナコスト', function(r){return r.cntrCostTokyo||0;});
  // 神戸コンテナコスト（TKタイプのみ出現）
  var hasKobe = validSlots.some(function(r){return r.type==='TK'&&(r.cntrCostKobe||0)>0;});
  if(hasKobe) bodyHtml += simRow('🚢 神戸コンテナコスト', function(r){return (r.type==='TK'?r.cntrCostKobe:0)||0;});
  // CO-LOADコスト（COLOADタイプ）
  var hasCl = validSlots.some(function(r){return (r.clCost||0)>0;});
  if(hasCl) bodyHtml += simRow('📦 CO-LOADコスト（神戸行）', function(r){return r.clCost||0;});
  // OLTコスト（OLTタイプ）
  var hasOlt = validSlots.some(function(r){return (r.oltCost||0)>0;});
  if(hasOlt) bodyHtml += simRow('🚛 OLTコスト（神戸→東京）', function(r){return r.oltCost||0;});
  var hasTs = validSlots.some(function(r){return r.totalTs!==0;});
  if(hasTs) bodyHtml += simRow('🌐 T/Sコスト（買値）', function(r){return r.totalTs||0;});
  var hasAgent = validSlots.some(function(r){return (r.totalAgent||0)!==0;});
  if(hasAgent) bodyHtml += simRow('👤 AGENTコスト', function(r){return r.totalAgent||0;});
  var hasRef = validSlots.some(function(r){return r.refund>0;});
  if(hasRef) bodyHtml += simRow('REFUND（▲控除）', function(r){return -(r.refund||0);});
  bodyHtml += '<tr style="border-top:2px solid var(--brd2)"><td style="padding:6px 10px;font-weight:700;font-size:12px">総コスト</td>' +
    validSlots.map(function(r){return '<td class="wv"><strong>'+fmtY(r.cost)+'</strong></td>';}).join('') + '<td></td></tr>';
  bodyHtml += secRow('売上・粗利');
  bodyHtml += simRow('総売上', function(r){return r.totalRev;});
  bodyHtml += simRow('粗利', function(r){return r.prof;}, true);

  // ── コスト明細展開セクション ──
  bodyHtml += '<tr><td colspan="'+(validSlots.length+2)+'" style="padding:0">' +
    '<button onclick="this.parentElement.parentElement.nextElementSibling.style.display=this.parentElement.parentElement.nextElementSibling.style.display===\'none\'?\'table-row-group\':\'none\';this.textContent=this.textContent.indexOf(\'▶\')>=0?\'▼ コスト明細を閉じる\':\'▶ コスト明細を表示\';" ' +
    'style="width:100%;font-family:var(--sans);font-size:11px;color:var(--tx2);border:none;border-top:1px solid var(--brd);background:var(--sur2);padding:5px 10px;cursor:pointer;text-align:left">▶ コスト明細を表示</button>' +
    '</td></tr>';
  $('wiz-cmp-body').innerHTML = bodyHtml;

  // 明細テーブル（tbody形式で追加）
  var detailTbody = document.createElement('tbody');
  detailTbody.style.display = 'none';

  // 各スロットの明細行を行ごとに並べる
  // まず全スロットで使われるラベルを収集して縦並び表示
  var maxItems = Math.max.apply(null, validSlots.map(function(r){return r.bdItems.length;}));
  var detHtml = '';
  detHtml += '<tr><td colspan="'+(validSlots.length+2)+'" style="background:var(--sur2);font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--tx2);padding:4px 10px;text-transform:uppercase">コスト明細（項目別）</td></tr>';
  // スロット別に明細を列で表示
  for(var ii=0; ii<maxItems; ii++){
    var hasAny = validSlots.some(function(r){return r.bdItems[ii];});
    if(!hasAny) continue;
    var rowCells = validSlots.map(function(r){
      var b = r.bdItems[ii];
      if(!b) return '<td></td>';
      var isNeg = b.jpy<0;
      return '<td style="padding:3px 10px;font-size:11px;vertical-align:middle">' +
        '<div style="color:'+(b.color||'var(--tx2)')+'">'+b.label+'</div>' +
        '<div style="font-family:var(--mono);font-size:11px;color:'+(isNeg?'var(--acc)':'var(--tx)')+'">'+(isNeg?'▲ -':'')+fmtY(Math.abs(b.jpy))+'</div>' +
        '</td>';
    }).join('');
    detHtml += '<tr style="border-bottom:1px solid var(--brd)">'+
      '<td style="padding:3px 10px;font-size:10px;color:var(--tx3);white-space:nowrap">#'+(ii+1)+'</td>'+
      rowCells+'<td></td></tr>';
  }
  detailTbody.innerHTML = detHtml;
  $('wiz-cmp-table').appendChild(detailTbody);

  // 結論バナー
  var best = validSlots.find(function(r){return r.prof===bestProf;});
  var maxDiff = validSlots.reduce(function(mx,r){return r===best?mx:Math.max(mx,Math.abs(best.prof-r.prof));},0);
  $('wiz-concl').innerHTML =
    '<div style="background:var(--acc);border-radius:var(--rl);padding:1rem 1.3rem;display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
      '<div style="background:rgba(255,255,255,.15);border-radius:8px;padding:.5rem 1.1rem;text-align:center">' +
        '<div style="font-size:10px;color:rgba(255,255,255,.75);margin-bottom:2px">最大差額</div>' +
        '<div style="font-family:var(--mono);font-size:22px;font-weight:900;color:#fff">'+fmtY(maxDiff)+'</div>' +
      '</div>' +
      '<div style="color:rgba(255,255,255,.9);font-size:13px;font-weight:700">' +
        '🏆 '+best.name+' が最も有利<br>' +
        '<span style="font-size:11px;font-weight:400">'+WIZ_TYPE_LABELS[best.type]+'　粗利 '+fmtY(best.prof)+'</span>' +
      '</div>' +
    '</div>';

  wizRenderMergeUI(validSlots, stepLabels);
}

// ── 利益合算比較UI ────────────────────────────────────────────
function wizRenderMergeUI(validSlots, stepLabels) {
  var grpA = $('wiz-merge-grp-a');
  var grpB = $('wiz-merge-grp-b');
  var res  = $('wiz-merge-result');
  if (!grpA||!grpB) return;
  if (res) res.innerHTML = '';
  var htmlA='',htmlB='';
  (validSlots||[]).forEach(function(r,i){
    if(!r)return;
    var lbl=(stepLabels&&stepLabels[i]?stepLabels[i]+': ':'')+r.name+'（'+fmtY(r.prof)+'）';
    htmlA+='<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" name="wiz-grp-a" value="'+i+'" style="width:14px;height:14px;accent-color:var(--blue)"> '+lbl+'</label>';
    htmlB+='<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" name="wiz-grp-b" value="'+i+'" style="width:14px;height:14px;accent-color:var(--red)"> '+lbl+'</label>';
  });
  grpA.innerHTML = htmlA||'<span style="font-size:11px;color:var(--tx3)">有効なパターンなし</span>';
  grpB.innerHTML = htmlB||'<span style="font-size:11px;color:var(--tx3)">有効なパターンなし</span>';
  // validSlotsをwindowに保持してwizCalcMergeから参照
  window._wizValidSlots = validSlots || [];
}

window.wizCalcMerge = function() {
  var allSlots = window._wizValidSlots || [];
  var res=$('wiz-merge-result'); if(!res)return;
  var idxA=Array.from(document.querySelectorAll('input[name="wiz-grp-a"]:checked')).map(function(el){return parseInt(el.value);});
  var idxB=Array.from(document.querySelectorAll('input[name="wiz-grp-b"]:checked')).map(function(el){return parseInt(el.value);});
  if(!idxA.length||!idxB.length){res.innerHTML='<div style="color:var(--red);font-size:12px;padding:.5rem">グループAとグループB両方にパターンを選択してください。</div>';return;}
  function sumGroup(indices){
    var rev=0,cost=0,prof=0,names=[];
    indices.forEach(function(i){var r=allSlots[i];if(!r)return;rev+=r.totalRev;cost+=r.cost;prof+=r.prof;names.push(r.name);});
    return{rev:rev,cost:cost,prof:prof,names:names};
  }
  var gA=sumGroup(idxA),gB=sumGroup(idxB);
  var diff=gA.prof-gB.prof,aWins=diff>0,diffAbs=Math.abs(diff);
  var winnerName=aWins?gA.names.join('＋'):gB.names.join('＋');
  res.innerHTML=
    '<div style="overflow-x:auto;margin-bottom:.75rem"><table style="width:100%;border-collapse:collapse;font-size:12px">'+
    '<thead><tr>'+
      '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid var(--brd);font-size:10px;color:var(--tx2)">項目</th>'+
      '<th style="text-align:right;padding:6px 14px;border-bottom:2px solid var(--brd);color:var(--blue)">グループA<br><span style="font-weight:400;font-size:10px">'+gA.names.join('＋')+'</span></th>'+
      '<th style="text-align:right;padding:6px 14px;border-bottom:2px solid var(--brd);color:var(--red)">グループB<br><span style="font-weight:400;font-size:10px">'+gB.names.join('＋')+'</span></th>'+
    '</tr></thead><tbody>'+
    '<tr><td style="padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--tx2)">総売上</td><td style="text-align:right;padding:6px 14px;border-bottom:1px solid var(--brd);font-family:var(--mono)">'+fmtY(gA.rev)+'</td><td style="text-align:right;padding:6px 14px;border-bottom:1px solid var(--brd);font-family:var(--mono)">'+fmtY(gB.rev)+'</td></tr>'+
    '<tr><td style="padding:6px 10px;border-bottom:1px solid var(--brd);color:var(--tx2)">総コスト</td><td style="text-align:right;padding:6px 14px;border-bottom:1px solid var(--brd);font-family:var(--mono)">'+fmtY(gA.cost)+'</td><td style="text-align:right;padding:6px 14px;border-bottom:1px solid var(--brd);font-family:var(--mono)">'+fmtY(gB.cost)+'</td></tr>'+
    '<tr style="border-top:2px solid var(--tx)"><td style="padding:8px 10px;font-weight:700">合算粗利</td>'+
    (aWins
      ?'<td style="text-align:right;padding:8px 14px;vertical-align:middle"><div style="display:inline-block;background:var(--acc);color:#fff;border-radius:8px;padding:5px 12px;font-family:var(--mono);font-size:15px;font-weight:900">'+fmtY(gA.prof)+' 🏆</div></td><td style="text-align:right;padding:8px 14px;font-family:var(--mono);font-size:14px;font-weight:700">'+fmtY(gB.prof)+'</td>'
      :'<td style="text-align:right;padding:8px 14px;font-family:var(--mono);font-size:14px;font-weight:700">'+fmtY(gA.prof)+'</td><td style="text-align:right;padding:8px 14px;vertical-align:middle"><div style="display:inline-block;background:var(--acc);color:#fff;border-radius:8px;padding:5px 12px;font-family:var(--mono);font-size:15px;font-weight:900">'+fmtY(gB.prof)+' 🏆</div></td>')+
    '</tr></tbody></table></div>'+
    '<div style="background:var(--purple);border-radius:var(--rl);padding:.9rem 1.2rem;display:flex;align-items:center;gap:16px;flex-wrap:wrap">'+
      '<div style="text-align:center"><div style="font-size:10px;color:rgba(255,255,255,.75);margin-bottom:2px">合算最大差額</div><div style="font-family:var(--mono);font-size:22px;font-weight:900;color:#fff">'+fmtY(diffAbs)+'</div></div>'+
      '<div style="color:rgba(255,255,255,.9);font-size:12px">🏆 <strong>'+winnerName+'</strong> の合算が有利<br>グループA '+fmtY(gA.prof)+'　vs　グループB '+fmtY(gB.prof)+'</div>'+
    '</div>';
};

// ── Init ──────────────────────────────────────────────────────
// ── 為替レート自動取得（TTS近似） ────────────────────────────
async function fetchFxRate() {
  try {
    var res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var jpy = data && data.rates && data.rates.JPY;
    var eur = data && data.rates && data.rates.EUR;
    if (!jpy) throw new Error('JPY rate not found');
    // TTSは仲値+1円が目安。小数点以下切り捨てで整数に
    var tts = Math.floor(jpy) + 1;
    // EUR/JPY = USD/JPY ÷ USD/EUR
    var eurJpy = eur ? Math.floor(jpy / eur) + 1 : Math.floor(tts * 1.08);
    return { usd: tts, eur: eurJpy };
  } catch(e) {
    console.warn('為替取得失敗、デフォルト値を使用:', e.message);
    return null;
  }
}

function applyFxRate(rate) {
  if (!rate) return;
  var usdRate = rate.usd || rate; // 後方互換
  var eurRate = rate.eur || 187;
  var r    = String(usdRate);
  var rEur = String(eurRate);
  // グローバル保持（ウィザード描画時に参照）
  window._autoFxJpy = usdRate;
  window._autoFxEur = eurRate;
  // シミュレーション画面
  if ($('sim-fx'))  { $('sim-fx').value  = r;    }
  if ($('sim-eur')) { $('sim-eur').value = rEur;  }
  // ウィザード（現在表示中のフィールド）
  if ($('wiz-fx'))  $('wiz-fx').value  = r;
  if ($('wiz-eur')) $('wiz-eur').value = rEur;
  // ヘッダーに表示
  var lbl = $('conn-lbl');
  if (lbl) {
    var orig = lbl.textContent;
    var fxNote = '　💱 USD/JPY ' + r + '  EUR/JPY ' + rEur + '（自動取得）';
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

  // save-cardの表示はcalc()内で直接制御
})();
