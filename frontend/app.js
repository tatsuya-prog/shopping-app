// ═══════════════════════════════════════
//  ★ RenderのURLに書き換えてください
// ═══════════════════════════════════════
const API = 'https://shopping-app-api-ibu8.onrender.com';
// ═══════════════════════════════════════

const WS = API.replace('https://', 'wss://').replace('http://', 'ws://');

// ── State ──
let me       = '妻';
let selFreq  = 'once';
let selDays  = 1;
let selSrcMode = 'stock';
let shopList = [], invList = [], recurring = [], histData = [], masters = [];
let delTarget = null, zeroTarget = null;
let ws = null, wsTimer = null;
let vapidKey = '';
let pushSub  = null;

const CK = { shop:'c_shop', inv:'c_inv', rec:'c_rec', hist:'c_hist', masters:'c_masters' };
function loadCache(k) { try { return JSON.parse(localStorage.getItem(k)||'null')||null; } catch { return null; } }
function saveCache(k,d) { try { localStorage.setItem(k, JSON.stringify(d)); } catch {} }

// ── Service Worker & Push ──
async function initSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    // VAPID公開鍵を取得
    const vr = await fetch(API + '/api/push/vapid-public-key').then(r => r.json()).catch(() => ({}));
    vapidKey = vr.key || '';
    // 既存の購読を確認
    pushSub = await reg.pushManager.getSubscription();
    // 通知バナー表示（未許可・未購読の場合）
    if (Notification.permission === 'default' && vapidKey) {
      document.getElementById('notifBanner').style.display = 'flex';
    } else if (Notification.permission === 'granted' && vapidKey && !pushSub) {
      await subscribePush(reg);
    }
  } catch(e) { console.error('SW init error:', e); }
}

async function requestNotifPermission() {
  document.getElementById('notifBanner').style.display = 'none';
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    const reg = await navigator.serviceWorker.ready;
    await subscribePush(reg);
    showToast('通知を設定しました');
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function subscribePush(reg) {
  if (!vapidKey) return;
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey)
    });
    pushSub = sub;
    await fetch(API + '/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, user: me })
    });
  } catch(e) { console.error('Push subscribe error:', e); }
}

// ── Init ──
async function init() {
  shopList = loadCache(CK.shop) || [];
  invList  = loadCache(CK.inv)  || [];
  recurring= loadCache(CK.rec)  || [];
  histData = loadCache(CK.hist) || [];
  masters  = loadCache(CK.masters) || [];
  renderAll();
  await refreshAll();
  connectWS();
  initSW();
  api('/api/recurring/check', 'POST', {}).catch(() => {});
}

async function refreshAll() {
  try {
    const [s,i,r,h,m] = await Promise.all([
      api('/api/items'), api('/api/inventory'), api('/api/recurring'),
      api('/api/history'), api('/api/history/masters')
    ]);
    shopList=s; saveCache(CK.shop,s);
    invList=i;  saveCache(CK.inv,i);
    recurring=r;saveCache(CK.rec,r);
    histData=h; saveCache(CK.hist,h);
    masters=m;  saveCache(CK.masters,m);
    renderAll();
  } catch { showToast('オフライン - キャッシュを表示中'); }
}

function renderAll() { renderList(); renderInv(); renderRec(); renderHist(); updateBadges(); }

// ── API ──
async function api(path, method='GET', body=null) {
  showLoad(true);
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch(e) {

    throw e;
  } finally { showLoad(false); }
}

// ── WebSocket ──
function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  try {
    ws = new WebSocket(WS);
    const dot = document.getElementById('wsDot');
    ws.onopen  = () => { dot.className='ws-dot on'; if(wsTimer){clearTimeout(wsTimer);wsTimer=null;} };
    ws.onerror = () => { dot.className='ws-dot err'; };
    ws.onclose = () => { dot.className='ws-dot'; wsTimer=setTimeout(connectWS,5000); };
    ws.onmessage = e => { try { handleWS(JSON.parse(e.data)); } catch {} };
  } catch {}
}

function handleWS(msg) {
  const {type,payload} = msg;
  switch(type) {
    case 'SHOP_ADDED':
      if (!shopList.find(s=>s.id===payload.id)) {
        shopList.push(payload); saveCache(CK.shop,shopList);
        renderList(); updateBadges();
        showToast(`${payload.added_by}が「${payload.name}」を追加`);
      }
      break;
    case 'SHOP_CHECKED': {
      const it=shopList.find(s=>s.id===payload.id);
      if(it){it.checked=payload.checked;saveCache(CK.shop,shopList);renderList();updateBadges();}
      break;
    }
    case 'SHOP_DELETED':
      shopList=shopList.filter(s=>s.id!==payload.id);
      saveCache(CK.shop,shopList); renderList(); updateBadges();
      break;
    case 'SHOP_COMPLETED':
      refreshAll(); showToast('買い物完了が同期されました');
      break;
    case 'INV_ADDED':
      if(!invList.find(i=>i.id===payload.id)){
        invList.push(payload); saveCache(CK.inv,invList); renderInv();
      }
      break;
    case 'INV_UPDATED': {
      const iv=invList.find(i=>i.id===payload.id);
      if(iv){iv.stage=payload.stage;saveCache(CK.inv,invList);renderInv();}
      break;
    }
    case 'INV_DELETED':
      invList=invList.filter(i=>i.id!==payload.id);
      saveCache(CK.inv,invList); renderInv();
      break;
    case 'REC_DELETED':
      recurring=recurring.filter(r=>r.id!==payload.id);
      saveCache(CK.rec,recurring); renderRec();
      break;
    case 'RECURRING_TRIGGERED':
      api('/api/items').then(s=>{shopList=s;saveCache(CK.shop,s);renderList();updateBadges();
        showToast(`定期購入 ${payload.added}件 が追加されました`);});
      break;
  }
}

// ── User ──
function toggleUser() {
  me = me==='妻'?'夫':'妻';
  document.getElementById('uLabel').textContent=me;
  document.getElementById('uDot').style.background=me==='妻'?'#7d3c98':'#2d6a4f';
}

// ── Navigation ──
function goPage(id,el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}

// ── Add Form (list) ──
let formOpen=false;
function toggleForm() {
  formOpen=!formOpen;
  document.getElementById('addForm').classList.toggle('open',formOpen);
  document.getElementById('formIcon').textContent=formOpen?'▴':'▾';
}
function selFreqBtn(el) {
  selFreq=el.dataset.freq;
  document.querySelectorAll('.freq-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}

// ── Add Form (inventory direct) ──
let invFormOpen=false;
function toggleInvForm() {
  invFormOpen=!invFormOpen;
  document.getElementById('invAddForm').classList.toggle('open',invFormOpen);
  document.getElementById('invFormIcon').textContent=invFormOpen?'▴':'▾';
}

async function addInvDirect() {
  const name=document.getElementById('ifName').value.trim();
  if(!name){showToast('商品名を入力してください');return;}
  const brand=document.getElementById('ifBrand').value.trim();
  const store=document.getElementById('ifStore').value.trim();
  const btn=document.querySelector('#invAddForm .btn-primary');
  btn.disabled=true;
  try {
    const inv=await api('/api/inventory/direct','POST',{name,brand,store});
    if(!invList.find(i=>i.id===inv.id)) invList.push(inv);
    saveCache(CK.inv,invList); renderInv();
    const m=await api('/api/history/masters');
    masters=m; saveCache(CK.masters,m);
    ['ifName','ifBrand','ifStore'].forEach(id=>document.getElementById(id).value='');
    showToast('在庫に追加しました');
  } finally { btn.disabled=false; }
}

// ── Suggest (list) ──
function onNameInput() {
  const val=document.getElementById('fName').value.trim();
  const sg=document.getElementById('sgList');
  if(!val){sg.style.display='none';return;}
  const hits=masters.filter(m=>m.name.includes(val)||(m.brand||'').includes(val));
  if(!hits.length){sg.style.display='none';return;}
  sg.innerHTML=hits.slice(0,6).map(m=>
    `<div class="sg-item" onclick="pickSg(${m.id})"><span>${m.name}</span><span class="sg-sub">${m.brand||''}</span></div>`
  ).join('');
  sg.style.display='block';
}
function pickSg(id) {
  const m=masters.find(x=>x.id===id); if(!m)return;
  document.getElementById('fName').value=m.name;
  document.getElementById('fBrand').value=m.brand||'';
  document.getElementById('fNote').value=m.note||'';
  document.getElementById('fStore').value=m.store||'';
  document.getElementById('sgList').style.display='none';
}

// ── Suggest (inventory) ──
function onInvNameInput() {
  const val=document.getElementById('ifName').value.trim();
  const sg=document.getElementById('ifSgList');
  if(!val){sg.style.display='none';return;}
  const hits=masters.filter(m=>m.name.includes(val)||(m.brand||'').includes(val));
  if(!hits.length){sg.style.display='none';return;}
  sg.innerHTML=hits.slice(0,6).map(m=>
    `<div class="sg-item" onclick="pickInvSg(${m.id})"><span>${m.name}</span><span class="sg-sub">${m.brand||''}</span></div>`
  ).join('');
  sg.style.display='block';
}
function pickInvSg(id) {
  const m=masters.find(x=>x.id===id); if(!m)return;
  document.getElementById('ifName').value=m.name;
  document.getElementById('ifBrand').value=m.brand||'';
  document.getElementById('ifStore').value=m.store||'';
  document.getElementById('ifSgList').style.display='none';
}

document.addEventListener('click',e=>{
  if(!e.target.closest('.suggest-wrap')){
    document.getElementById('sgList').style.display='none';
    const isg=document.getElementById('ifSgList');
    if(isg)isg.style.display='none';
  }
});

// ── Add Item ──
async function addItem() {
  const name=document.getElementById('fName').value.trim();
  if(!name){showToast('商品名を入力してください');return;}
  const brand=document.getElementById('fBrand').value.trim();
  const note=document.getElementById('fNote').value.trim();
  const store=document.getElementById('fStore').value.trim();
  const btn=document.querySelector('#addForm .btn-primary');
  btn.disabled=true;
  try {
    const item=await api('/api/items','POST',{name,brand,note,store,added_by:me,freq:selFreq});
    if(!shopList.find(s=>s.id===item.id)) shopList.push(item);
    if(selFreq!=='once'){const r=await api('/api/recurring');recurring=r;saveCache(CK.rec,r);}
    const m=await api('/api/history/masters');masters=m;saveCache(CK.masters,m);
    saveCache(CK.shop,shopList);
    renderList();renderRec();updateBadges();
    ['fName','fBrand','fNote','fStore'].forEach(id=>document.getElementById(id).value='');
    document.querySelectorAll('.freq-btn').forEach(b=>b.classList.remove('active'));
    document.querySelector('[data-freq="once"]').classList.add('active');
    selFreq='once';
    showToast('追加しました');
  } finally { btn.disabled=false; }
}

// ── Render: List ──
function renderList() {
  const wrap=document.getElementById('listWrap');
  if(!shopList.length){
    wrap.innerHTML='<div class="empty-state"><div class="empty-icon">🛒</div><p>リストは空です</p></div>';
    document.getElementById('completeWrap').style.display='none';return;
  }
  document.getElementById('completeWrap').style.display=shopList.some(s=>s.checked)?'block':'none';
  wrap.innerHTML=shopList.map(item=>{
    const whoTag=item.added_by==='妻'?`<span class="tag tag-wife">妻</span>`:`<span class="tag tag-husb">夫</span>`;
    const freqTag=item.freq==='weekly'?`<span class="tag tag-week">毎週</span>`:item.freq==='monthly'?`<span class="tag tag-month">毎月</span>`:'';
    return `<div class="shop-item${item.checked?' checked':''}">
      <div class="cb-wrap" onclick="toggleCheck(${item.id},${!item.checked})">
        <div class="cb${item.checked?' on':''}">${item.checked?'✓':''}</div>
      </div>
      <div class="item-body">
        <div class="item-name">${item.name}</div>
        ${item.brand?`<div class="item-brand">${item.brand}</div>`:''}
        ${item.note?`<div class="item-note">📝 ${item.note}</div>`:''}
        <div class="item-tags">
          ${item.store?`<span class="tag tag-store">📍${item.store}</span>`:''}
          ${whoTag}${freqTag}
        </div>
      </div>
      <button class="btn-x" onclick="askDel('shop',${item.id})">✕</button>
    </div>`;
  }).join('');
}

async function toggleCheck(id,checked) {
  const it=shopList.find(s=>s.id===id); if(!it)return;
  it.checked=checked; saveCache(CK.shop,shopList);
  renderList(); updateBadges();
  await api(`/api/items/${id}/check`,'PATCH',{checked});
}

function openCompleteModal() {
  const checked=shopList.filter(s=>s.checked);
  const names=checked.map(s=>s.name);
  const preview=names.slice(0,3).join('・')+(names.length>3?` 他${names.length-3}点`:'');
  document.getElementById('ov-complete-body').textContent=`${preview} を在庫に追加し、リストから削除します。\n(毎週・毎月の商品は在庫管理外です)`;
  openOv('ov-complete');
}
async function confirmComplete() {
  closeOv('ov-complete');
  await api('/api/items/complete','POST',{bought_by:me});
  await refreshAll(); showToast('買い物完了！');
}

// ── Render: Inventory ──
function renderInv() {
  const wrap=document.getElementById('invWrap');
  const empty=document.getElementById('invEmpty');
  if(!invList.length){wrap.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  const SL={full:'満タン',many:'多い',few:'少ない',none:'なし'};
  wrap.innerHTML=invList.map(iv=>`
    <div class="inv-item">
      <div class="inv-header">
        <div>
          <div class="inv-name">${iv.name}</div>
          <div class="inv-sub">${iv.brand||''}${iv.store?` ／ 📍${iv.store}`:''}</div>
        </div>
        <button class="btn-x" onclick="askDel('inv',${iv.id})" style="font-size:16px;padding:4px 6px">✕</button>
      </div>
      <div class="stage-row">
        ${['full','many','few','none'].map(s=>
          `<button class="stage-btn s-${s}${iv.stage===s?' active':''}" onclick="setStage(${iv.id},'${s}')">${SL[s]}</button>`
        ).join('')}
      </div>
      ${iv.store?`<div style="margin-top:8px"><span class="tag tag-store">📍${iv.store}</span></div>`:''}
    </div>`
  ).join('');
}

async function setStage(id,stage) {
  const iv=invList.find(i=>i.id===id); if(!iv)return;
  const prev=iv.stage; iv.stage=stage;
  saveCache(CK.inv,invList); renderInv();
  await api(`/api/inventory/${id}/stage`,'PATCH',{stage});
  if(stage==='none'&&prev!=='none'){
    zeroTarget=id;
    document.getElementById('ov-zero-body').innerHTML=`「<strong>${iv.name}</strong>」の在庫がなくなりました。<br>買い物リストに追加しますか？`;
    openOv('ov-zero');
  }
}

async function confirmZero() {
  const iv=invList.find(i=>i.id===zeroTarget);
  if(iv){
    try {
      // バックエンドで在庫削除＋リスト追加を1トランザクションで処理（二重防止）
      const result=await api(`/api/inventory/${iv.id}/zero-to-list`,'POST',{added_by:me});
      // ローカルを更新
      invList=invList.filter(i=>i.id!==iv.id);
      if(result.added && result.item && !shopList.find(s=>s.id===result.item.id)){
        shopList.push(result.item);
      }
      saveCache(CK.inv,invList);saveCache(CK.shop,shopList);
      renderInv();renderList();updateBadges();
      showToast(result.added?'買い物リストに追加しました':'既にリストにあります');
    } catch(e) {
      showToast('処理に失敗しました。再度お試しください。');
    }
  }
  zeroTarget=null;closeOv('ov-zero');
}

// ── Render: Recurring ──
function renderRec() {
  const wkEl=document.getElementById('recWeekly');
  const moEl=document.getElementById('recMonthly');
  const empty=document.getElementById('recEmpty');
  const wk=recurring.filter(r=>r.freq==='weekly');
  const mo=recurring.filter(r=>r.freq==='monthly');
  if(!wk.length&&!mo.length){wkEl.innerHTML='';moEl.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  const fmt=d=>{const dt=new Date(d);return`${dt.getMonth()+1}/${dt.getDate()}`;};
  const row=arr=>arr.map(r=>{
    const tag=r.freq==='weekly'?`<span class="tag tag-week">毎週</span>`:`<span class="tag tag-month">毎月</span>`;
    return `<div class="rec-item">
      <div class="rec-left">
        <div class="rec-name">${r.name}</div>
        <div class="rec-sub">${r.brand||''}${r.store?` ／ 📍${r.store}`:''}</div>
        <div class="rec-next">次回：${fmt(r.next_date)}</div>
      </div>
      <div class="rec-right">${tag}<button class="btn-x" onclick="askDel('rec',${r.id})">✕</button></div>
    </div>`;
  }).join('');
  wkEl.innerHTML=wk.length?row(wk):'<div style="color:var(--text3);font-size:13px;padding:4px 0">なし</div>';
  moEl.innerHTML=mo.length?row(mo):'<div style="color:var(--text3);font-size:13px;padding:4px 0">なし</div>';
}

// ── Render: History ──
function renderHist() {
  const wrap=document.getElementById('histWrap');
  const empty=document.getElementById('histEmpty');
  if(!histData.length){wrap.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  wrap.innerHTML=histData.slice(0,60).map(h=>{
    const cls=h.bought_by==='妻'?'tag-wife':'tag-husb';
    return `<div class="hist-item">
      <div style="flex:1;min-width:0">
        <div class="hist-name">${h.name}</div>
        <div class="hist-sub">${h.brand||''}${h.store?` ／ ${h.store}`:''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="hist-date">${h.bought_at}</div>
        <span class="hist-who tag ${cls}">${h.bought_by}</span>
      </div>
      <button class="btn-x" style="font-size:14px;padding:4px 6px;flex-shrink:0" onclick="deleteHist(${h.id})">✕</button>
    </div>`;
  }).join('');
}

// ── History: タブ切替 ──
function switchHistTab(tab, el) {
  document.querySelectorAll('#page-hist .freq-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('hist-list-pane').style.display     = tab==='list'      ? 'block' : 'none';
  document.getElementById('hist-filter-pane').style.display   = tab==='filter'    ? 'block' : 'none';
  document.getElementById('hist-analytics-pane').style.display= tab==='analytics' ? 'block' : 'none';
  if(tab==='analytics') loadAnalytics();
}

// ── History: 削除 ──
async function deleteHist(id) {
  try {
    await api(`/api/history/${id}`,'DELETE');
    histData=histData.filter(h=>h.id!==id);
    saveCache(CK.hist,histData); renderHist();
    showToast('削除しました');
  } catch(e) { showToast('削除に失敗しました'); }
}

function askDeleteAllHist() {
  if(!confirm('購入履歴をすべて削除しますか？')) return;
  api('/api/history','DELETE').then(()=>{
    histData=[]; saveCache(CK.hist,[]); renderHist();
    showToast('全履歴を削除しました');
  }).catch(()=>showToast('削除に失敗しました'));
}

// ── History: フィルター ──
async function applyFilter() {
  const name  = document.getElementById('filt-name').value.trim();
  const who   = document.getElementById('filt-who').value;
  const store = document.getElementById('filt-store').value.trim();
  const params = new URLSearchParams();
  if(name)  params.set('name',name);
  if(who)   params.set('who',who);
  if(store) params.set('store',store);
  params.set('limit','100');
  try {
    const rows = await api(`/api/history?${params.toString()}`);
    const wrap  = document.getElementById('filtWrap');
    const empty = document.getElementById('filtEmpty');
    if(!rows.length){wrap.innerHTML='';empty.style.display='block';return;}
    empty.style.display='none';
    wrap.innerHTML = rows.map(h=>{
      const cls=h.bought_by==='妻'?'tag-wife':'tag-husb';
      return `<div class="hist-item">
        <div style="flex:1;min-width:0">
          <div class="hist-name">${h.name}</div>
          <div class="hist-sub">${h.brand||''}${h.store?` ／ ${h.store}`:''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="hist-date">${h.bought_at}</div>
          <span class="hist-who tag ${cls}">${h.bought_by}</span>
        </div>
      </div>`;
    }).join('');
  } catch(e) { showToast('フィルター取得に失敗しました'); }
}

// ── History: 分析 ──
async function loadAnalytics() {
  const wrap = document.getElementById('analyticsWrap');
  wrap.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>分析中...</p></div>';
  try {
    const d = await api('/api/history/analytics');
    wrap.innerHTML = `
      <div class="section-head">よく買うもの TOP10</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);overflow:hidden;margin-bottom:12px">
        ${d.top.map((r,i)=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:${i<d.top.length-1?'1px solid var(--border)':'none'}">
            <div>
              <span style="font-size:13px;font-weight:700;color:var(--text2);margin-right:8px">${i+1}</span>
              <span style="font-size:14px;font-weight:500">${r.name}</span>
            </div>
            <div style="text-align:right">
              <span style="font-size:13px;color:var(--green);font-weight:700">${r.count}回</span>
              <div style="font-size:11px;color:var(--text3)">最終:${r.last_bought}</div>
            </div>
          </div>`).join('')}
      </div>

      <div class="section-head">購入者別</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        ${d.byWho.map(r=>{
          const cls=r.bought_by==='妻'?'tag-wife':'tag-husb';
          return `<div style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);padding:12px;text-align:center">
            <span class="tag ${cls}" style="margin-bottom:6px;display:inline-block">${r.bought_by}</span>
            <div style="font-size:22px;font-weight:700;color:var(--text)">${r.count}</div>
            <div style="font-size:11px;color:var(--text3)">件</div>
          </div>`;
        }).join('')}
      </div>

      ${d.byStore.length ? `
      <div class="section-head">よく使うスーパー</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);overflow:hidden;margin-bottom:12px">
        ${d.byStore.map((r,i)=>`
          <div style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:${i<d.byStore.length-1?'1px solid var(--border)':'none'}">
            <span class="tag tag-store">📍${r.store}</span>
            <span style="font-size:13px;font-weight:700;color:var(--green)">${r.count}回</span>
          </div>`).join('')}
      </div>` : ''}

      ${d.byMonth.length ? `
      <div class="section-head">月別購入数</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);overflow:hidden;margin-bottom:12px">
        ${d.byMonth.map((r,i)=>{
          const max=Math.max(...d.byMonth.map(x=>+x.count));
          const pct=Math.round((+r.count/max)*100);
          return `<div style="padding:8px 12px;border-bottom:${i<d.byMonth.length-1?'1px solid var(--border)':'none'}">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:12px;color:var(--text2)">${r.month}</span>
              <span style="font-size:12px;font-weight:700;color:var(--green)">${r.count}件</span>
            </div>
            <div style="height:6px;background:var(--border);border-radius:3px">
              <div style="height:100%;width:${pct}%;background:var(--green);border-radius:3px"></div>
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}
    `;
  } catch(e) {
    wrap.innerHTML = '<div class="empty-state"><p>分析データの取得に失敗しました</p></div>';
  }
}

// ── Meal / AI ──
function selDay(el) {
  selDays=+el.dataset.d;
  document.querySelectorAll('.day-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}
function toggleMood(el) { el.classList.toggle('active'); }
function selSrc(src,el) {
  selSrcMode=src;
  document.querySelectorAll('.src-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}

async function generateMeals() {
  const btn=document.getElementById('btnAI');
  btn.disabled=true;
  document.getElementById('mealResults').innerHTML='<div class="ai-loading"><div class="spinner"></div>献立を考えています...</div>';
  const moods=Array.from(document.querySelectorAll('.mood-btn.active')).map(b=>b.textContent);
  const inventory=invList.map(iv=>({name:iv.name,stage:iv.stage}));
  try {
    const data=await api('/api/meal/suggest','POST',{days:selDays,moods,source:selSrcMode,inventory});
    renderMeals(data.meals||[]);
  } catch {
    document.getElementById('mealResults').innerHTML='<div class="ai-loading">⚠️ 取得に失敗しました。もう一度お試しください。</div>';
  }
  btn.disabled=false;
}

function renderMeals(meals) {
  if(!meals.length){document.getElementById('mealResults').innerHTML='';return;}
  document.getElementById('mealResults').innerHTML=meals.map((m,i)=>`
    <div class="meal-card">
      <div class="meal-hd" onclick="toggleMeal(${i})">
        <div>
          <div class="meal-day">${selDays===1?'今日の献立':`${m.day}日目`}</div>
          <div class="meal-name">${m.name}</div>
          ${m.mood?`<div class="meal-mood">${m.mood}</div>`:''}
        </div>
        <div class="meal-toggle" id="mt-${i}">▾</div>
      </div>
      <div class="meal-bd" id="mb-${i}">
        ${m.ingredients_stock?.length?`<div class="meal-sec">🥦 在庫から使う食材</div><div class="ing-row">${m.ingredients_stock.map(s=>`<span class="ing ing-s">${s}</span>`).join('')}</div>`:''}
        ${m.ingredients_buy?.length?`<div class="meal-sec">🛒 購入が必要な食材</div><div class="ing-row">${m.ingredients_buy.map(s=>`<span class="ing ing-b">${s}</span>`).join('')}</div>`:''}
        ${m.steps?.length?`<div class="meal-sec">👨‍🍳 作り方</div><div class="meal-steps"><ol>${m.steps.map(s=>`<li>${s}</li>`).join('')}</ol></div>`:''}
      </div>
    </div>`
  ).join('');
}

function toggleMeal(i) {
  const bd=document.getElementById('mb-'+i);
  const tg=document.getElementById('mt-'+i);
  const open=bd.classList.toggle('open');
  tg.classList.toggle('open',open);
}

// ── Delete ──
function askDel(type,id) {
  delTarget={type,id};
  const labels={
    shop:()=>{const s=shopList.find(x=>x.id===id);return s?`「${s.name}」をリストから削除します。`:'削除します。';},
    inv:()=>{const i=invList.find(x=>x.id===id);return i?`「${i.name}」を在庫から削除します。`:'削除します。';},
    rec:()=>{const r=recurring.find(x=>x.id===id);return r?`「${r.name}」の定期購入を解除します。`:'削除します。';}
  };
  document.getElementById('ov-del-body').textContent=(labels[type]||(() =>'削除します。'))();
  openOv('ov-del');
}
async function confirmDel() {
  if(!delTarget)return;
  const{type,id}=delTarget;
  if(type==='shop'){await api(`/api/items/${id}`,'DELETE');shopList=shopList.filter(s=>s.id!==id);saveCache(CK.shop,shopList);renderList();updateBadges();}
  else if(type==='inv'){await api(`/api/inventory/${id}`,'DELETE');invList=invList.filter(i=>i.id!==id);saveCache(CK.inv,invList);renderInv();}
  else if(type==='rec'){await api(`/api/recurring/${id}`,'DELETE');recurring=recurring.filter(r=>r.id!==id);saveCache(CK.rec,recurring);renderRec();}
  delTarget=null;closeOv('ov-del');
}

// ── Badges ──
function updateBadges() {
  const n=shopList.filter(s=>!s.checked).length;
  const b=document.getElementById('listBadge');
  b.textContent=n;b.style.display=n>0?'flex':'none';
  const rn=recurring.length;
  const rb=document.getElementById('recBadge');
  rb.textContent=rn;rb.style.display=rn>0?'flex':'none';
}

// ── UI helpers ──
function openOv(id){document.getElementById(id).classList.add('open');}
function closeOv(id){document.getElementById(id).classList.remove('open');}
let toastT=null;
function showToast(msg){
  const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');
  if(toastT)clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),2500);
}
function showLoad(on){
  const b=document.getElementById('loadBar');
  b.className=on?'loading-bar on':'loading-bar done';
  if(!on)setTimeout(()=>b.className='loading-bar',350);
}

// ── Reload ──
function reloadApp() {
  if ('caches' in window) {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).finally(() => location.reload(true));
  } else {
    location.reload(true);
  }
}

init();
