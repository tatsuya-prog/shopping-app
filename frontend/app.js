// ═══════════════════════════════════════
//  ★ ここだけ書き換えてください
// ═══════════════════════════════════════
const API = 'https://shopping-app-api-ibu8.onrender.com';
// ═══════════════════════════════════════

const WS = API.replace('https://', 'wss://').replace('http://', 'ws://');

// ── State ──
let me           = '妻';
let selFreq      = 'once';
let shopList     = [];
let invList      = [];
let recurring    = [];
let histData     = [];
let masters      = [];
let delTarget    = null;
let zeroTarget   = null;
let ws           = null;
let wsTimer      = null;

// ── localStorage キャッシュ ──
// APIから取得したデータをローカルに保存し、次回起動時は即座に表示
// バックグラウンドで最新を取得してから差分があれば更新する
const CACHE_KEYS = { shop:'c_shop', inv:'c_inv', rec:'c_rec', hist:'c_hist', masters:'c_masters' };

function loadCache(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function saveCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ── Service Worker 登録 ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.error);
}

// ── Init ──
async function init() {
  // まずキャッシュで即座に表示（通信待ちなし）
  shopList = loadCache(CACHE_KEYS.shop) || [];
  invList  = loadCache(CACHE_KEYS.inv)  || [];
  recurring= loadCache(CACHE_KEYS.rec)  || [];
  histData = loadCache(CACHE_KEYS.hist) || [];
  masters  = loadCache(CACHE_KEYS.masters) || [];
  renderAll();

  // バックグラウンドで最新を取得
  await refreshAll();
  connectWS();
  // 定期購入チェック（サーバー側で処理）
  api('/api/recurring/check', 'POST', {}).catch(() => {});
}

async function refreshAll() {
  try {
    const [s, i, r, h, m] = await Promise.all([
      api('/api/items'),
      api('/api/inventory'),
      api('/api/recurring'),
      api('/api/history'),
      api('/api/history/masters')
    ]);
    shopList = s; saveCache(CACHE_KEYS.shop, s);
    invList  = i; saveCache(CACHE_KEYS.inv,  i);
    recurring= r; saveCache(CACHE_KEYS.rec,  r);
    histData = h; saveCache(CACHE_KEYS.hist, h);
    masters  = m; saveCache(CACHE_KEYS.masters, m);
    renderAll();
  } catch (e) {
    // オフライン時はキャッシュで動作継続
    showToast('オフライン - キャッシュを表示中');
  }
}

function renderAll() {
  renderList(); renderInv(); renderRec(); renderHist(); updateBadges();
}

// ── API helper（gzip対応・エラーハンドリング）──
async function api(path, method = 'GET', body = null) {
  showLoad(true);
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (e) {
    if (method === 'GET') throw e;
    showToast('通信エラー - 後でもう一度お試しください');
    throw e;
  } finally {
    showLoad(false);
  }
}

// ── WebSocket ──
function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  try {
    ws = new WebSocket(WS);
    const dot = document.getElementById('wsDot');
    ws.onopen  = () => { dot.className = 'ws-dot on'; if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; } };
    ws.onerror = () => { dot.className = 'ws-dot err'; };
    ws.onclose = () => { dot.className = 'ws-dot'; wsTimer = setTimeout(connectWS, 5000); };
    ws.onmessage = e => {
      try { handleWS(JSON.parse(e.data)); } catch {}
    };
  } catch {}
}

function handleWS(msg) {
  const { type, payload } = msg;
  switch (type) {
    case 'SHOP_ADDED':
      if (!shopList.find(s => s.id === payload.id)) {
        shopList.push(payload);
        saveCache(CACHE_KEYS.shop, shopList);
        renderList(); updateBadges();
        showToast(`${payload.added_by}が「${payload.name}」を追加`);
      }
      break;
    case 'SHOP_CHECKED': {
      const it = shopList.find(s => s.id === payload.id);
      if (it) { it.checked = payload.checked; saveCache(CACHE_KEYS.shop, shopList); renderList(); updateBadges(); }
      break;
    }
    case 'SHOP_DELETED':
      shopList = shopList.filter(s => s.id !== payload.id);
      saveCache(CACHE_KEYS.shop, shopList);
      renderList(); updateBadges();
      break;
    case 'SHOP_COMPLETED':
      refreshAll();
      showToast('買い物完了が同期されました');
      break;
    case 'INV_UPDATED': {
      const iv = invList.find(i => i.id === payload.id);
      if (iv) { iv.stage = payload.stage; saveCache(CACHE_KEYS.inv, invList); renderInv(); }
      break;
    }
    case 'INV_DELETED':
      invList = invList.filter(i => i.id !== payload.id);
      saveCache(CACHE_KEYS.inv, invList);
      renderInv();
      break;
    case 'REC_DELETED':
      recurring = recurring.filter(r => r.id !== payload.id);
      saveCache(CACHE_KEYS.rec, recurring);
      renderRec();
      break;
    case 'RECURRING_TRIGGERED':
      api('/api/items').then(s => {
        shopList = s; saveCache(CACHE_KEYS.shop, s);
        renderList(); updateBadges();
        showToast(`定期購入 ${payload.added}件 が追加されました`);
      });
      break;
  }
}

// ── User ──
function toggleUser() {
  me = me === '妻' ? '夫' : '妻';
  document.getElementById('uLabel').textContent = me;
  document.getElementById('uDot').style.background = me === '妻' ? '#7d3c98' : '#2d6a4f';
}

// ── Navigation ──
function goPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

// ── Add form ──
let formOpen = false;
function toggleForm() {
  formOpen = !formOpen;
  document.getElementById('addForm').classList.toggle('open', formOpen);
  document.getElementById('formIcon').textContent = formOpen ? '▴' : '▾';
}

function selFreqBtn(el) {
  selFreq = el.dataset.freq;
  document.querySelectorAll('.freq-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

// ── Suggest ──
function onNameInput() {
  const val = document.getElementById('fName').value.trim();
  const sg  = document.getElementById('sgList');
  if (!val) { sg.style.display = 'none'; return; }
  const hits = masters.filter(m => m.name.includes(val) || (m.brand || '').includes(val));
  if (!hits.length) { sg.style.display = 'none'; return; }
  sg.innerHTML = hits.slice(0, 6).map(m =>
    `<div class="sg-item" onclick="pickSg(${m.id})">
       <span>${m.name}</span><span class="sg-sub">${m.brand || ''}</span>
     </div>`
  ).join('');
  sg.style.display = 'block';
}

function pickSg(id) {
  const m = masters.find(x => x.id === id);
  if (!m) return;
  document.getElementById('fName').value  = m.name;
  document.getElementById('fBrand').value = m.brand || '';
  document.getElementById('fNote').value  = m.note  || '';
  document.getElementById('fStore').value = m.store || '';
  document.getElementById('sgList').style.display = 'none';
}

document.addEventListener('click', e => {
  if (!e.target.closest('.suggest-wrap'))
    document.getElementById('sgList').style.display = 'none';
});

// ── Add item ──
async function addItem() {
  const name  = document.getElementById('fName').value.trim();
  if (!name) { showToast('商品名を入力してください'); return; }
  const brand = document.getElementById('fBrand').value.trim();
  const note  = document.getElementById('fNote').value.trim();
  const store = document.getElementById('fStore').value.trim();
  const btn   = document.querySelector('#addForm .btn-primary');
  btn.disabled = true;
  try {
    const item = await api('/api/items', 'POST', { name, brand, note, store, added_by: me, freq: selFreq });
    // 楽観的ローカル更新（WebSocketが来るまでの間もUIに反映）
    if (!shopList.find(s => s.id === item.id)) shopList.push(item);
    if (selFreq !== 'once') {
      const r = await api('/api/recurring');
      recurring = r; saveCache(CACHE_KEYS.rec, r);
    }
    const m = await api('/api/history/masters');
    masters = m; saveCache(CACHE_KEYS.masters, m);
    saveCache(CACHE_KEYS.shop, shopList);
    renderList(); renderRec(); updateBadges();
    ['fName','fBrand','fNote','fStore'].forEach(id => document.getElementById(id).value = '');
    document.querySelectorAll('.freq-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-freq="once"]').classList.add('active');
    selFreq = 'once';
    showToast('追加しました');
  } finally { btn.disabled = false; }
}

// ── Render: List ──
function renderList() {
  const wrap = document.getElementById('listWrap');
  if (!shopList.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">🛒</div><p>リストは空です</p></div>';
    document.getElementById('completeWrap').style.display = 'none';
    return;
  }
  document.getElementById('completeWrap').style.display =
    shopList.some(s => s.checked) ? 'block' : 'none';

  wrap.innerHTML = shopList.map(item => {
    const whoTag  = item.added_by === '妻' ? `<span class="tag tag-wife">妻</span>` : `<span class="tag tag-husb">夫</span>`;
    const freqTag = item.freq === 'weekly' ? `<span class="tag tag-week">毎週</span>` :
                    item.freq === 'monthly'? `<span class="tag tag-month">毎月</span>` : '';
    return `<div class="shop-item${item.checked ? ' checked' : ''}">
      <div class="cb-wrap" onclick="toggleCheck(${item.id},${!item.checked})">
        <div class="cb${item.checked ? ' on' : ''}">${item.checked ? '✓' : ''}</div>
      </div>
      <div class="item-body">
        <div class="item-name">${item.name}</div>
        ${item.brand ? `<div class="item-brand">${item.brand}</div>` : ''}
        ${item.note  ? `<div class="item-note">📝 ${item.note}</div>`  : ''}
        <div class="item-tags">
          ${item.store ? `<span class="tag tag-store">📍${item.store}</span>` : ''}
          ${whoTag}${freqTag}
        </div>
      </div>
      <button class="btn-x" onclick="askDel('shop',${item.id})">✕</button>
    </div>`;
  }).join('');
}

async function toggleCheck(id, checked) {
  const it = shopList.find(s => s.id === id);
  if (!it) return;
  it.checked = checked; // 楽観的更新（即座にUI反映）
  saveCache(CACHE_KEYS.shop, shopList);
  renderList(); updateBadges();
  await api(`/api/items/${id}/check`, 'PATCH', { checked });
}

// ── Complete ──
function openCompleteModal() {
  const checked = shopList.filter(s => s.checked);
  const names = checked.map(s => s.name);
  const preview = names.slice(0, 3).join('・') + (names.length > 3 ? ` 他${names.length - 3}点` : '');
  document.getElementById('ov-complete-body').textContent =
    `${preview} を在庫に追加し、リストから削除します。\n(毎週・毎月の商品は在庫管理外です)`;
  openOv('ov-complete');
}

async function confirmComplete() {
  closeOv('ov-complete');
  await api('/api/items/complete', 'POST', { bought_by: me });
  await refreshAll();
  showToast('買い物完了！');
}

// ── Render: Inventory ──
function renderInv() {
  const wrap  = document.getElementById('invWrap');
  const empty = document.getElementById('invEmpty');
  if (!invList.length) { wrap.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const SL = { full:'満タン', many:'多い', few:'少ない', none:'なし' };
  wrap.innerHTML = invList.map(iv => `
    <div class="inv-item">
      <div class="inv-header">
        <div>
          <div class="inv-name">${iv.name}</div>
          <div class="inv-sub">${iv.brand || ''}${iv.store ? ` ／ 📍${iv.store}` : ''}</div>
        </div>
        <button class="btn-x" onclick="askDel('inv',${iv.id})" style="font-size:16px;padding:4px 6px">✕</button>
      </div>
      <div class="stage-row">
        ${['full','many','few','none'].map(s =>
          `<button class="stage-btn s-${s}${iv.stage===s?' active':''}" onclick="setStage(${iv.id},'${s}')">${SL[s]}</button>`
        ).join('')}
      </div>
      ${iv.store ? `<div style="margin-top:8px"><span class="tag tag-store">📍${iv.store}</span></div>` : ''}
    </div>`
  ).join('');
}

async function setStage(id, stage) {
  const iv = invList.find(i => i.id === id);
  if (!iv) return;
  const prev = iv.stage;
  iv.stage = stage; // 楽観的更新
  saveCache(CACHE_KEYS.inv, invList);
  renderInv();
  await api(`/api/inventory/${id}/stage`, 'PATCH', { stage });
  if (stage === 'none' && prev !== 'none') {
    zeroTarget = id;
    document.getElementById('ov-zero-body').innerHTML =
      `「<strong>${iv.name}</strong>」の在庫がなくなりました。<br>買い物リストに追加しますか？`;
    openOv('ov-zero');
  }
}

async function confirmZero() {
  const iv = invList.find(i => i.id === zeroTarget);
  if (iv) {
    const already = shopList.find(s => s.master_id === iv.master_id && !s.checked);
    if (!already) {
      const item = await api('/api/items', 'POST', { name: iv.name, brand: iv.brand || '', store: iv.store || '', added_by: me, freq: 'once' });
      shopList.push(item);
    }
    await api(`/api/inventory/${iv.id}`, 'DELETE');
    invList = invList.filter(i => i.id !== iv.id);
    saveCache(CACHE_KEYS.inv, invList);
    saveCache(CACHE_KEYS.shop, shopList);
    renderInv(); renderList(); updateBadges();
    showToast('買い物リストに追加しました');
  }
  zeroTarget = null; closeOv('ov-zero');
}

// ── Render: Recurring ──
function renderRec() {
  const wkEl  = document.getElementById('recWeekly');
  const moEl  = document.getElementById('recMonthly');
  const empty = document.getElementById('recEmpty');
  const wk = recurring.filter(r => r.freq === 'weekly');
  const mo = recurring.filter(r => r.freq === 'monthly');
  if (!wk.length && !mo.length) { wkEl.innerHTML = ''; moEl.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const fmt = d => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; };
  const row = arr => arr.map(r => {
    const tag = r.freq === 'weekly' ? `<span class="tag tag-week">毎週</span>` : `<span class="tag tag-month">毎月</span>`;
    return `<div class="rec-item">
      <div class="rec-left">
        <div class="rec-name">${r.name}</div>
        <div class="rec-sub">${r.brand || ''}${r.store ? ` ／ 📍${r.store}` : ''}</div>
        <div class="rec-next">次回：${fmt(r.next_date)}</div>
      </div>
      <div class="rec-right">${tag}
        <button class="btn-x" onclick="askDel('rec',${r.id})">✕</button>
      </div>
    </div>`;
  }).join('');
  wkEl.innerHTML = wk.length ? row(wk) : '<div style="color:var(--text3);font-size:13px;padding:4px 0">なし</div>';
  moEl.innerHTML = mo.length ? row(mo) : '<div style="color:var(--text3);font-size:13px;padding:4px 0">なし</div>';
}

// ── Render: History ──
function renderHist() {
  const wrap  = document.getElementById('histWrap');
  const empty = document.getElementById('histEmpty');
  if (!histData.length) { wrap.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  wrap.innerHTML = histData.slice(0, 60).map(h => {
    const cls = h.bought_by === '妻' ? 'tag-wife' : 'tag-husb';
    return `<div class="hist-item">
      <div>
        <div class="hist-name">${h.name}</div>
        <div class="hist-sub">${h.brand || ''}${h.store ? ` ／ ${h.store}` : ''}</div>
      </div>
      <div>
        <div class="hist-date">${h.bought_at}</div>
        <span class="hist-who tag ${cls}">${h.bought_by}</span>
      </div>
    </div>`;
  }).join('');
}

// ── Delete ──
function askDel(type, id) {
  delTarget = { type, id };
  const labels = {
    shop: () => { const s = shopList.find(x => x.id===id); return s ? `「${s.name}」をリストから削除します。` : '削除します。'; },
    inv:  () => { const i = invList.find(x => x.id===id);  return i ? `「${i.name}」を在庫から削除します。` : '削除します。'; },
    rec:  () => { const r = recurring.find(x => x.id===id);return r ? `「${r.name}」の定期購入を解除します。` : '削除します。'; }
  };
  document.getElementById('ov-del-body').textContent = (labels[type] || (() => '削除します。'))();
  openOv('ov-del');
}

async function confirmDel() {
  if (!delTarget) return;
  const { type, id } = delTarget;
  if (type === 'shop') {
    await api(`/api/items/${id}`, 'DELETE');
    shopList = shopList.filter(s => s.id !== id);
    saveCache(CACHE_KEYS.shop, shopList);
    renderList(); updateBadges();
  } else if (type === 'inv') {
    await api(`/api/inventory/${id}`, 'DELETE');
    invList = invList.filter(i => i.id !== id);
    saveCache(CACHE_KEYS.inv, invList);
    renderInv();
  } else if (type === 'rec') {
    await api(`/api/recurring/${id}`, 'DELETE');
    recurring = recurring.filter(r => r.id !== id);
    saveCache(CACHE_KEYS.rec, recurring);
    renderRec();
  }
  delTarget = null; closeOv('ov-del');
}

// ── Badges ──
function updateBadges() {
  const n = shopList.filter(s => !s.checked).length;
  const b = document.getElementById('listBadge');
  b.textContent = n; b.style.display = n > 0 ? 'flex' : 'none';
  const rn = recurring.length;
  const rb = document.getElementById('recBadge');
  rb.textContent = rn; rb.style.display = rn > 0 ? 'flex' : 'none';
}

// ── UI helpers ──
function openOv(id)  { document.getElementById(id).classList.add('open'); }
function closeOv(id) { document.getElementById(id).classList.remove('open'); }

let toastT = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2500);
}

function showLoad(on) {
  const b = document.getElementById('loadBar');
  b.className = on ? 'loading-bar on' : 'loading-bar done';
  if (!on) setTimeout(() => b.className = 'loading-bar', 350);
}

// ── Start ──
init();
