// ★ RenderのURLを設定
const API = 'https://shopping-app-api-ibu8.onrender.com';
const WS  = API.replace('https://','wss://').replace('http://','ws://');

// ── State ──
let me        = '妻';
let selFreq   = 'once';
let selDays   = 1;
let adults    = 2;
let kids      = 0;
let shopList  = [], invList = [], recurring = [], histData = [], masters = [], categories = [];
let delTarget = null, zeroTarget = null;
let ws = null, wsTimer = null;
let vapidKey = '', pushSub = null;

// ── Cache ──
const CK = { shop:'c_shop', inv:'c_inv', rec:'c_rec', hist:'c_hist', masters:'c_masters', cats:'c_cats' };
function loadCache(k){ try{ return JSON.parse(localStorage.getItem(k)||'null')||null; }catch{ return null; } }
function saveCache(k,d){ try{ localStorage.setItem(k,JSON.stringify(d)); }catch{} }

// ── Init ──
async function init(){
  // キャッシュを即座に表示（速度改善①）
  shopList   = loadCache(CK.shop)    || [];
  invList    = loadCache(CK.inv)     || [];
  recurring  = loadCache(CK.rec)     || [];
  histData   = loadCache(CK.hist)    || [];
  masters    = loadCache(CK.masters) || [];
  categories = loadCache(CK.cats)    || [];
  renderAll();
  populateCatSelects();

  // バックグラウンドで並列取得（速度改善②）
  refreshAll();
  connectWS();
  initSW();
  api('/api/recurring/check','POST',{}).catch(()=>{});
  initPullToRefresh();
}

async function refreshAll(){
  try {
    const [s,i,r,h,m,c] = await Promise.all([
      api('/api/items'), api('/api/inventory'), api('/api/recurring'),
      api('/api/history'), api('/api/history/masters'), api('/api/categories')
    ]);
    shopList=s;    saveCache(CK.shop,s);
    invList=i;     saveCache(CK.inv,i);
    recurring=r;   saveCache(CK.rec,r);
    histData=h;    saveCache(CK.hist,h);
    masters=m;     saveCache(CK.masters,m);
    categories=c;  saveCache(CK.cats,c);
    renderAll();
    populateCatSelects();
  } catch(e){ /* オフライン時はキャッシュで継続 */ }
}

function renderAll(){ renderList(); renderInv(); renderRec(); renderHist(); renderCatSettings(); updateBadges(); }

// ── API ──
async function api(path, method='GET', body=null){
  showLoad(true);
  try {
    const opts = { method, headers:{'Content-Type':'application/json'} };
    if(body) opts.body = JSON.stringify(body);
    const res = await fetch(API+path, opts);
    if(!res.ok) throw new Error(await res.text());
    return await res.json();
  } finally { showLoad(false); }
}

// ── WebSocket（速度改善③：再接続を2秒に短縮）──
function connectWS(){
  if(ws && ws.readyState === WebSocket.OPEN) return;
  try {
    ws = new WebSocket(WS);
    const dot = document.getElementById('wsDot');
    ws.onopen  = () => { dot.className='ws-dot on'; if(wsTimer){ clearTimeout(wsTimer); wsTimer=null; } };
    ws.onerror = () => { dot.className='ws-dot err'; };
    ws.onclose = () => { dot.className='ws-dot'; wsTimer=setTimeout(connectWS,2000); }; // 2秒で再接続
    ws.onmessage = e => { try{ handleWS(JSON.parse(e.data)); }catch{} };
  } catch{}
}

function handleWS(msg){
  const {type,payload}=msg;
  switch(type){
    case 'SHOP_ADDED':
      if(!shopList.find(s=>s.id===payload.id)){
        shopList.push(payload); saveCache(CK.shop,shopList);
        renderList(); updateBadges();
        showToast(`${payload.added_by}が「${payload.name}」を追加`);
      }
      break;
    case 'SHOP_CHECKED': {
      const it=shopList.find(s=>s.id===payload.id);
      if(it){ it.checked=payload.checked; saveCache(CK.shop,shopList); renderList(); updateBadges(); }
      break;
    }
    case 'SHOP_DELETED':
      shopList=shopList.filter(s=>s.id!==payload.id); saveCache(CK.shop,shopList); renderList(); updateBadges(); break;
    case 'SHOP_COMPLETED':
      refreshAll(); showToast('買い物完了が同期されました'); break;
    case 'INV_ADDED':
      if(!invList.find(i=>i.id===payload.id)){ invList.push(payload); saveCache(CK.inv,invList); renderInv(); } break;
    case 'INV_UPDATED': {
      const iv=invList.find(i=>i.id===payload.id);
      if(iv){ iv.stage=payload.stage; saveCache(CK.inv,invList); renderInv(); } break;
    }
    case 'INV_DELETED':
      invList=invList.filter(i=>i.id!==payload.id); saveCache(CK.inv,invList); renderInv(); break;
    case 'REC_DELETED':
      recurring=recurring.filter(r=>r.id!==payload.id); saveCache(CK.rec,recurring); renderRec(); break;
    case 'RECURRING_TRIGGERED':
      api('/api/items').then(s=>{ shopList=s; saveCache(CK.shop,s); renderList(); updateBadges();
        showToast(`定期購入 ${payload.added}件 が追加されました`); }); break;
    case 'CAT_ADDED':
      if(!categories.find(c=>c.id===payload.id)){ categories.push(payload); saveCache(CK.cats,categories); populateCatSelects(); renderCatSettings(); } break;
    case 'CAT_DELETED':
      categories=categories.filter(c=>c.id!==payload.id); saveCache(CK.cats,categories); populateCatSelects(); renderCatSettings(); renderList(); renderInv(); break;
  }
}

// ── Categories ──
function populateCatSelects(){
  const opts = `<option value="">未分類</option>` + categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  ['fCat','ifCat'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=opts; });
}

function renderCatSettings(){
  const el = document.getElementById('catList'); if(!el) return;
  if(!categories.length){ el.innerHTML='<div style="color:var(--text3);font-size:13px;padding:6px 0">カテゴリーがありません</div>'; return; }
  el.innerHTML = categories.map(c=>`
    <div class="cat-row">
      <div class="cat-color-dot" style="background:${c.color}"></div>
      <span class="cat-row-name">${c.name}</span>
      <button class="btn-x" style="font-size:14px;padding:4px 6px" onclick="askDel('cat',${c.id})">✕</button>
    </div>`).join('');
}

async function addCategory(){
  const name  = document.getElementById('newCatName').value.trim();
  const color = document.getElementById('newCatColor').value;
  if(!name){ showToast('カテゴリー名を入力してください'); return; }
  try {
    const cat = await api('/api/categories','POST',{name,color});
    if(!categories.find(c=>c.id===cat.id)) categories.push(cat);
    saveCache(CK.cats,categories); populateCatSelects(); renderCatSettings();
    document.getElementById('newCatName').value='';
    showToast('カテゴリーを追加しました');
  } catch(e){ showToast('追加に失敗しました'); }
}

// ── User ──
function toggleUser(){
  me=me==='妻'?'夫':'妻';
  document.getElementById('uLabel').textContent=me;
  document.getElementById('uDot').style.background=me==='妻'?'#7d3c98':'#2d6a4f';
}

// ── Navigation ──
function goPage(id,el){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}

// ── Add form ──
let formOpen=false;
function toggleForm(){
  formOpen=!formOpen;
  document.getElementById('addForm').classList.toggle('open',formOpen);
  document.getElementById('formIcon').textContent=formOpen?'▴':'▾';
}
function selFreqBtn(el){
  selFreq=el.dataset.freq;
  document.querySelectorAll('.freq-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}

let invFormOpen=false;
function toggleInvForm(){
  invFormOpen=!invFormOpen;
  document.getElementById('invAddForm').classList.toggle('open',invFormOpen);
  document.getElementById('invFormIcon').textContent=invFormOpen?'▴':'▾';
}

// ── Suggest ──
function onNameInput(){
  const val=document.getElementById('fName').value.trim();
  const sg=document.getElementById('sgList');
  if(!val){ sg.style.display='none'; return; }
  const hits=masters.filter(m=>m.name.includes(val)||(m.brand||'').includes(val));
  if(!hits.length){ sg.style.display='none'; return; }
  sg.innerHTML=hits.slice(0,6).map(m=>`<div class="sg-item" onclick="pickSg(${m.id})"><span>${m.name}</span><span class="sg-sub">${m.brand||''}</span></div>`).join('');
  sg.style.display='block';
}
function pickSg(id){
  const m=masters.find(x=>x.id===id); if(!m) return;
  document.getElementById('fName').value=m.name;
  document.getElementById('fBrand').value=m.brand||'';
  document.getElementById('fNote').value=m.note||'';
  document.getElementById('fStore').value=m.store||'';
  if(m.category_id) document.getElementById('fCat').value=m.category_id;
  document.getElementById('sgList').style.display='none';
}
function onInvNameInput(){
  const val=document.getElementById('ifName').value.trim();
  const sg=document.getElementById('ifSgList');
  if(!val){ sg.style.display='none'; return; }
  const hits=masters.filter(m=>m.name.includes(val)||(m.brand||'').includes(val));
  if(!hits.length){ sg.style.display='none'; return; }
  sg.innerHTML=hits.slice(0,6).map(m=>`<div class="sg-item" onclick="pickInvSg(${m.id})"><span>${m.name}</span><span class="sg-sub">${m.brand||''}</span></div>`).join('');
  sg.style.display='block';
}
function pickInvSg(id){
  const m=masters.find(x=>x.id===id); if(!m) return;
  document.getElementById('ifName').value=m.name;
  document.getElementById('ifBrand').value=m.brand||'';
  document.getElementById('ifStore').value=m.store||'';
  if(m.category_id) document.getElementById('ifCat').value=m.category_id;
  document.getElementById('ifSgList').style.display='none';
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.suggest-wrap')){
    document.getElementById('sgList').style.display='none';
    const s2=document.getElementById('ifSgList'); if(s2) s2.style.display='none';
  }
});

// ── Add Item ──
async function addItem(){
  const name=document.getElementById('fName').value.trim();
  if(!name){ showToast('商品名を入力してください'); return; }
  const brand=document.getElementById('fBrand').value.trim();
  const note=document.getElementById('fNote').value.trim();
  const store=document.getElementById('fStore').value.trim();
  const catEl=document.getElementById('fCat');
  const category_id=catEl&&catEl.value?+catEl.value:null;
  const btn=document.querySelector('#addForm .btn-primary');
  btn.disabled=true;
  try {
    const item=await api('/api/items','POST',{name,brand,note,store,added_by:me,freq:selFreq,category_id});
    if(!shopList.find(s=>s.id===item.id)) shopList.push(item);
    if(selFreq!=='once'){ const r=await api('/api/recurring'); recurring=r; saveCache(CK.rec,r); }
    const m=await api('/api/history/masters'); masters=m; saveCache(CK.masters,m);
    saveCache(CK.shop,shopList); renderList(); renderRec(); updateBadges();
    ['fName','fBrand','fNote','fStore'].forEach(id=>document.getElementById(id).value='');
    if(catEl) catEl.value='';
    document.querySelectorAll('.freq-btn').forEach(b=>b.classList.remove('active'));
    document.querySelector('[data-freq="once"]').classList.add('active');
    selFreq='once';
    showToast('追加しました');
  } catch(e){ showToast('追加に失敗しました'); }
  finally { btn.disabled=false; }
}

async function addInvDirect(){
  const name=document.getElementById('ifName').value.trim();
  if(!name){ showToast('商品名を入力してください'); return; }
  const brand=document.getElementById('ifBrand').value.trim();
  const store=document.getElementById('ifStore').value.trim();
  const catEl=document.getElementById('ifCat');
  const category_id=catEl&&catEl.value?+catEl.value:null;
  const btn=document.querySelector('#invAddForm .btn-primary');
  btn.disabled=true;
  try {
    const inv=await api('/api/inventory/direct','POST',{name,brand,store,category_id});
    if(!invList.find(i=>i.id===inv.id)) invList.push(inv);
    saveCache(CK.inv,invList); renderInv();
    const m=await api('/api/history/masters'); masters=m; saveCache(CK.masters,m);
    ['ifName','ifBrand','ifStore'].forEach(id=>document.getElementById(id).value='');
    if(catEl) catEl.value='';
    showToast('在庫に追加しました');
  } catch(e){ showToast('追加に失敗しました'); }
  finally { btn.disabled=false; }
}

// ── Render: List（カテゴリー別折りたたみ）──
const openCats = {}; // カテゴリーの開閉状態
function renderList(){
  const wrap=document.getElementById('listWrap');
  if(!shopList.length){
    wrap.innerHTML='<div class="empty-state"><div class="empty-icon">🛒</div><p>リストは空です</p></div>';
    document.getElementById('completeWrap').style.display='none'; return;
  }
  document.getElementById('completeWrap').style.display=shopList.some(s=>s.checked)?'block':'none';

  // カテゴリーでグループ化
  const groups = {};
  shopList.forEach(item=>{
    const key = item.category_id ? `cat-${item.category_id}` : 'none';
    if(!groups[key]) groups[key] = { name: item.category_name||'未分類', color: item.category_color||'#888', items:[] };
    groups[key].items.push(item);
  });

  // カテゴリーのソート順に並べる
  const sortedKeys = Object.keys(groups).sort((a,b)=>{
    if(a==='none') return 1;
    if(b==='none') return -1;
    const ai=categories.findIndex(c=>`cat-${c.id}`===a);
    const bi=categories.findIndex(c=>`cat-${c.id}`===b);
    return ai-bi;
  });

  wrap.innerHTML = sortedKeys.map(key=>{
    const g=groups[key];
    const isOpen = openCats[key]!==false; // デフォルトは開く
    const total=g.items.length;
    const done=g.items.filter(i=>i.checked).length;
    return `<div class="cat-group">
      <div class="cat-header" onclick="toggleCat('${key}')">
        <div class="cat-dot" style="background:${g.color}"></div>
        <span class="cat-name">${g.name}</span>
        <span class="cat-count">${done}/${total}</span>
        <span class="cat-arrow ${isOpen?'open':''}" id="arrow-${key}">▾</span>
      </div>
      <div class="cat-items ${isOpen?'open':''}" id="catitems-${key}">
        ${g.items.map(item=>shopItemHTML(item)).join('')}
      </div>
    </div>`;
  }).join('');
}

function toggleCat(key){
  openCats[key] = openCats[key]===false ? true : false;
  const items=document.getElementById('catitems-'+key);
  const arrow=document.getElementById('arrow-'+key);
  if(items) items.classList.toggle('open', openCats[key]!==false);
  if(arrow) arrow.classList.toggle('open', openCats[key]!==false);
}

function shopItemHTML(item){
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
}

async function toggleCheck(id,checked){
  const it=shopList.find(s=>s.id===id); if(!it) return;
  it.checked=checked; saveCache(CK.shop,shopList); renderList(); updateBadges();
  try{ await api(`/api/items/${id}/check`,'PATCH',{checked}); }
  catch(e){ it.checked=!checked; saveCache(CK.shop,shopList); renderList(); updateBadges(); }
}

function openCompleteModal(){
  const checked=shopList.filter(s=>s.checked); if(!checked.length) return;
  const names=checked.map(s=>s.name);
  const preview=names.slice(0,3).join('・')+(names.length>3?` 他${names.length-3}点`:'');
  document.getElementById('ov-complete-body').textContent=`${preview} を在庫に追加し、リストから削除します。\n(毎週・毎月の商品は在庫管理外です)`;
  openOv('ov-complete');
}
async function confirmComplete(){
  closeOv('ov-complete');
  try{ await api('/api/items/complete','POST',{bought_by:me}); await refreshAll(); showToast('買い物完了！'); }
  catch(e){ showToast('処理に失敗しました。再度お試しください。'); }
}

// ── Render: Inventory（カテゴリー別折りたたみ）──
const openInvCats = {};
function renderInv(){
  const wrap=document.getElementById('invWrap');
  const empty=document.getElementById('invEmpty');
  if(!invList.length){ wrap.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  const SL={full:'満タン',many:'多い',few:'少ない',none:'なし'};

  const groups={};
  invList.forEach(iv=>{
    const key=iv.category_id?`cat-${iv.category_id}`:'none';
    if(!groups[key]) groups[key]={name:iv.category_name||'未分類',color:iv.category_color||'#888',items:[]};
    groups[key].items.push(iv);
  });

  const sortedKeys=Object.keys(groups).sort((a,b)=>{
    if(a==='none') return 1; if(b==='none') return -1;
    const ai=categories.findIndex(c=>`cat-${c.id}`===a);
    const bi=categories.findIndex(c=>`cat-${c.id}`===b);
    return ai-bi;
  });

  wrap.innerHTML=sortedKeys.map(key=>{
    const g=groups[key];
    const isOpen=openInvCats[key]!==false;
    return `<div class="cat-group">
      <div class="cat-header" onclick="toggleInvCat('${key}')">
        <div class="cat-dot" style="background:${g.color}"></div>
        <span class="cat-name">${g.name}</span>
        <span class="cat-count">${g.items.length}件</span>
        <span class="cat-arrow ${isOpen?'open':''}" id="invarrow-${key}">▾</span>
      </div>
      <div class="cat-items ${isOpen?'open':''}" id="invitems-${key}">
        ${g.items.map(iv=>`
          <div class="inv-item">
            <div class="inv-header">
              <div><div class="inv-name">${iv.name}</div><div class="inv-sub">${iv.brand||''}${iv.store?` ／ 📍${iv.store}`:''}</div></div>
              <button class="btn-x" onclick="askDel('inv',${iv.id})" style="font-size:16px;padding:4px 6px">✕</button>
            </div>
            <div class="stage-row">
              ${['full','many','few','none'].map(s=>`<button class="stage-btn s-${s}${iv.stage===s?' active':''}" onclick="setStage(${iv.id},'${s}')">${SL[s]}</button>`).join('')}
            </div>
            ${iv.store?`<div style="margin-top:8px"><span class="tag tag-store">📍${iv.store}</span></div>`:''}
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function toggleInvCat(key){
  openInvCats[key]=openInvCats[key]===false?true:false;
  const items=document.getElementById('invitems-'+key);
  const arrow=document.getElementById('invarrow-'+key);
  if(items) items.classList.toggle('open',openInvCats[key]!==false);
  if(arrow) arrow.classList.toggle('open',openInvCats[key]!==false);
}

async function setStage(id,stage){
  const iv=invList.find(i=>i.id===id); if(!iv) return;
  const prev=iv.stage; iv.stage=stage; saveCache(CK.inv,invList); renderInv();
  try{
    await api(`/api/inventory/${id}/stage`,'PATCH',{stage});
    if(stage==='none'&&prev!=='none'){
      zeroTarget=id;
      document.getElementById('ov-zero-body').innerHTML=`「<strong>${iv.name}</strong>」の在庫がなくなりました。<br>買い物リストに追加しますか？`;
      openOv('ov-zero');
    }
  } catch(e){ iv.stage=prev; saveCache(CK.inv,invList); renderInv(); }
}

async function confirmZero(){
  const iv=invList.find(i=>i.id===zeroTarget);
  if(iv){
    try{
      const result=await api(`/api/inventory/${iv.id}/zero-to-list`,'POST',{added_by:me});
      invList=invList.filter(i=>i.id!==iv.id); saveCache(CK.inv,invList); renderInv();
      showToast(result.added?'買い物リストに追加しました':'既にリストにあります');
    } catch(e){ showToast('処理に失敗しました。再度お試しください。'); }
  }
  zeroTarget=null; closeOv('ov-zero');
}

// ── Render: Recurring ──
function renderRec(){
  const wkEl=document.getElementById('recWeekly');
  const moEl=document.getElementById('recMonthly');
  const empty=document.getElementById('recEmpty');
  const wk=recurring.filter(r=>r.freq==='weekly');
  const mo=recurring.filter(r=>r.freq==='monthly');
  if(!wk.length&&!mo.length){ wkEl.innerHTML=''; moEl.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  const fmt=d=>{ const dt=new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; };
  const row=arr=>arr.map(r=>{
    const tag=r.freq==='weekly'?`<span class="tag tag-week">毎週</span>`:`<span class="tag tag-month">毎月</span>`;
    return `<div class="rec-item">
      <div class="rec-left"><div class="rec-name">${r.name}</div><div class="rec-sub">${r.brand||''}${r.store?` ／ 📍${r.store}`:''}</div><div class="rec-next">次回：${fmt(r.next_date)}</div></div>
      <div class="rec-right">${tag}<button class="btn-x" onclick="askDel('rec',${r.id})">✕</button></div>
    </div>`;
  }).join('');
  wkEl.innerHTML=wk.length?row(wk):'<div style="color:var(--text3);font-size:13px;padding:4px 0">なし</div>';
  moEl.innerHTML=mo.length?row(mo):'<div style="color:var(--text3);font-size:13px;padding:4px 0">なし</div>';
}

// ── Render: History ──
function renderHist(){
  const wrap=document.getElementById('histWrap');
  const empty=document.getElementById('histEmpty');
  if(!histData.length){ wrap.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  wrap.innerHTML=histData.slice(0,60).map(h=>{
    const cls=h.bought_by==='妻'?'tag-wife':'tag-husb';
    return `<div class="hist-item">
      <div style="flex:1;min-width:0"><div class="hist-name">${h.name}</div><div class="hist-sub">${h.brand||''}${h.store?` ／ ${h.store}`:''}</div></div>
      <div style="text-align:right;flex-shrink:0"><div class="hist-date">${h.bought_at}</div><span class="hist-who tag ${cls}">${h.bought_by}</span></div>
      <button class="btn-x" style="font-size:14px;padding:4px 6px" onclick="deleteHist(${h.id})">✕</button>
    </div>`;
  }).join('');
}

function switchHistTab(tab,el){
  document.querySelectorAll('.hist-tab').forEach(b=>b.classList.remove('active')); el.classList.add('active');
  document.getElementById('hist-list-pane').style.display    =tab==='list'?'block':'none';
  document.getElementById('hist-filter-pane').style.display  =tab==='filter'?'block':'none';
  document.getElementById('hist-analytics-pane').style.display=tab==='analytics'?'block':'none';
  if(tab==='analytics') loadAnalytics();
}

async function deleteHist(id){
  try{ await api(`/api/history/${id}`,'DELETE'); histData=histData.filter(h=>h.id!==id); saveCache(CK.hist,histData); renderHist(); showToast('削除しました'); }
  catch(e){ showToast('削除に失敗しました'); }
}
function askDeleteAllHist(){
  if(!confirm('購入履歴をすべて削除しますか？')) return;
  api('/api/history','DELETE').then(()=>{ histData=[]; saveCache(CK.hist,[]); renderHist(); showToast('全履歴を削除しました'); }).catch(()=>showToast('削除に失敗しました'));
}
async function applyFilter(){
  const name=document.getElementById('filt-name').value.trim();
  const who=document.getElementById('filt-who').value;
  const store=document.getElementById('filt-store').value.trim();
  const params=new URLSearchParams();
  if(name) params.set('name',name); if(who) params.set('who',who); if(store) params.set('store',store); params.set('limit','100');
  try{
    const rows=await api(`/api/history?${params.toString()}`);
    const wrap=document.getElementById('filtWrap'); const empty=document.getElementById('filtEmpty');
    if(!rows.length){ wrap.innerHTML=''; empty.style.display='block'; return; }
    empty.style.display='none';
    wrap.innerHTML=rows.map(h=>{ const cls=h.bought_by==='妻'?'tag-wife':'tag-husb';
      return `<div class="hist-item"><div style="flex:1;min-width:0"><div class="hist-name">${h.name}</div><div class="hist-sub">${h.brand||''}${h.store?` ／ ${h.store}`:''}</div></div><div style="text-align:right"><div class="hist-date">${h.bought_at}</div><span class="hist-who tag ${cls}">${h.bought_by}</span></div></div>`;
    }).join('');
  } catch(e){ showToast('取得に失敗しました'); }
}
async function loadAnalytics(){
  const wrap=document.getElementById('analyticsWrap');
  wrap.innerHTML='<div class="ai-loading"><div class="spinner"></div><p>分析中...</p></div>';
  try{
    const d=await api('/api/history/analytics');
    wrap.innerHTML=`
      <div class="section-head">よく買うもの TOP10</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);overflow:hidden;margin-bottom:12px">
        ${d.top.map((r,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:${i<d.top.length-1?'1px solid var(--border)':'none'}"><div><span style="font-size:13px;font-weight:700;color:var(--text2);margin-right:8px">${i+1}</span><span style="font-size:14px;font-weight:500">${r.name}</span></div><div style="text-align:right"><span style="font-size:13px;color:var(--green);font-weight:700">${r.count}回</span><div style="font-size:11px;color:var(--text3)">最終：${r.last_bought}</div></div></div>`).join('')}
      </div>
      <div class="section-head">購入者別</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        ${d.byWho.map(r=>{ const cls=r.bought_by==='妻'?'tag-wife':'tag-husb'; return `<div style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);padding:12px;text-align:center"><span class="tag ${cls}" style="margin-bottom:6px;display:inline-block">${r.bought_by}</span><div style="font-size:22px;font-weight:700">${r.count}</div><div style="font-size:11px;color:var(--text3)">件</div></div>`; }).join('')}
      </div>
      ${d.byStore.length?`<div class="section-head">よく使うスーパー</div><div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);overflow:hidden;margin-bottom:12px">${d.byStore.map((r,i)=>`<div style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:${i<d.byStore.length-1?'1px solid var(--border)':'none'}"><span class="tag tag-store">📍${r.store}</span><span style="font-size:13px;font-weight:700;color:var(--green)">${r.count}回</span></div>`).join('')}</div>`:''}
      ${d.byMonth.length?`<div class="section-head">月別購入数</div><div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);overflow:hidden;margin-bottom:12px">${d.byMonth.map((r,i)=>{ const max=Math.max(...d.byMonth.map(x=>+x.count)); const pct=Math.round((+r.count/max)*100); return `<div style="padding:8px 12px;border-bottom:${i<d.byMonth.length-1?'1px solid var(--border)':'none'}"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:var(--text2)">${r.month}</span><span style="font-size:12px;font-weight:700;color:var(--green)">${r.count}件</span></div><div style="height:6px;background:var(--border);border-radius:3px"><div style="height:100%;width:${pct}%;background:var(--green);border-radius:3px"></div></div></div>`; }).join('')}</div>`:''}
    `;
  } catch(e){ wrap.innerHTML='<div class="empty-state"><p>分析データの取得に失敗しました</p></div>'; }
}

// ── Meal ──
function changeCount(type,delta){
  if(type==='adults'){ adults=Math.max(0,adults+delta); document.getElementById('adults-val').textContent=adults; }
  else { kids=Math.max(0,kids+delta); document.getElementById('kids-val').textContent=kids; }
}
function selDay(el){ selDays=+el.dataset.d; document.querySelectorAll('.day-btn').forEach(b=>b.classList.remove('active')); el.classList.add('active'); }
function toggleMood(el){ el.classList.toggle('active'); }

// 献立で材料をリストに追加（追加済み管理）
const addedIngs = new Set();

async function addIngToList(ingText, btnEl){
  if(addedIngs.has(ingText)) return;
  // 食材名だけ抽出（分量を除く）例："鶏もも肉 300g" → "鶏もも肉"
  const namePart = ingText.split(/\s+/)[0];
  try {
    const item = await api('/api/items','POST',{name:ingText, added_by:me, freq:'once'});
    if(!shopList.find(s=>s.id===item.id)) shopList.push(item);
    saveCache(CK.shop,shopList); renderList(); updateBadges();
    addedIngs.add(ingText);
    if(btnEl){ btnEl.textContent='追加済み'; btnEl.classList.add('added'); btnEl.disabled=true; }
    showToast(`「${namePart}」をリストに追加しました`);
  } catch(e){ showToast('追加に失敗しました'); }
}

async function generateMeals(){
  const btn=document.getElementById('btnAI');
  btn.disabled=true;
  addedIngs.clear();
  document.getElementById('mealResults').innerHTML='<div class="ai-loading"><div class="spinner"></div>献立を考えています...</div>';
  const moods=Array.from(document.querySelectorAll('.mood-btn.active')).map(b=>b.textContent);
  try{
    const data=await api('/api/meal/suggest','POST',{days:selDays,moods,adults,kids});
    renderMeals(data.meals||[], data.tokenInfo);
  } catch(e){
    document.getElementById('mealResults').innerHTML='<div class="ai-loading">⚠️ 取得に失敗しました。しばらくしてから再試行してください。</div>';
  }
  btn.disabled=false;
}

function renderMeals(meals, tokenInfo){
  const ti=document.getElementById('mealTokenInfo');
  if(ti&&tokenInfo){ ti.textContent=`入力:${tokenInfo.inputTokens}トークン / 出力:${tokenInfo.outputTokens}トークン / 約¥${tokenInfo.costJpy}`; ti.style.display='block'; }
  else if(ti){ ti.style.display='none'; }

  if(!meals.length){ document.getElementById('mealResults').innerHTML=''; return; }
  document.getElementById('mealResults').innerHTML=meals.map((m,i)=>{
    const ings=(m.ingredients||[]);
    return `<div class="meal-card">
      <div class="meal-hd" onclick="toggleMeal(${i})">
        <div style="flex:1;min-width:0">
          <div class="meal-day">${selDays===1?'今日の献立':`${m.day}日目`}</div>
          <div class="meal-name">${m.name}</div>
          <div class="meal-tags">
            ${m.mood?`<span class="meal-tag meal-tag-mood">${m.mood}</span>`:''}
            ${m.calories_per_person?`<span class="meal-tag meal-tag-cal">🔥 ${m.calories_per_person}</span>`:''}
          </div>
        </div>
        <div class="meal-toggle" id="mt-${i}">▾</div>
      </div>
      <div class="meal-bd" id="mb-${i}">
        ${ings.length?`
          <div class="meal-sec">🛒 必要な材料（${(adults+kids)||2}人分）</div>
          <div class="ing-list">
            ${ings.map(s=>{
              const text=typeof s==='object'?(s.name||String(s)):String(s);
              const safeText=text.replace(/'/g,"\\'");
              return `<div class="ing-row-item">
                <span>${text}</span>
                <button class="ing-add-btn" onclick="addIngToList('${safeText}',this)">＋リストに追加</button>
              </div>`;
            }).join('')}
          </div>`:''}
        ${m.steps&&m.steps.length?`<div class="meal-sec">👨‍🍳 作り方</div><div class="meal-steps"><ol>${m.steps.map(s=>`<li>${s}</li>`).join('')}</ol></div>`:''}
      </div>
    </div>`;
  }).join('');
}

function toggleMeal(i){
  const bd=document.getElementById('mb-'+i); const tg=document.getElementById('mt-'+i);
  const open=bd.classList.toggle('open'); tg.classList.toggle('open',open);
}

// ── Delete ──
function askDel(type,id){
  delTarget={type,id};
  const labels={
    shop:()=>{ const s=shopList.find(x=>x.id===id); return s?`「${s.name}」をリストから削除します。`:'削除します。'; },
    inv: ()=>{ const i=invList.find(x=>x.id===id);  return i?`「${i.name}」を在庫から削除します。`:'削除します。'; },
    rec: ()=>{ const r=recurring.find(x=>x.id===id);return r?`「${r.name}」の定期購入を解除します。`:'削除します。'; },
    cat: ()=>{ const c=categories.find(x=>x.id===id);return c?`「${c.name}」カテゴリーを削除します。\n（商品のカテゴリーは未分類になります）`:'削除します。'; }
  };
  document.getElementById('ov-del-body').textContent=(labels[type]||(() =>'削除します。'))();
  openOv('ov-del');
}
async function confirmDel(){
  if(!delTarget) return;
  const{type,id}=delTarget;
  try{
    if(type==='shop'){ await api(`/api/items/${id}`,'DELETE'); shopList=shopList.filter(s=>s.id!==id); saveCache(CK.shop,shopList); renderList(); updateBadges(); }
    else if(type==='inv'){ await api(`/api/inventory/${id}`,'DELETE'); invList=invList.filter(i=>i.id!==id); saveCache(CK.inv,invList); renderInv(); }
    else if(type==='rec'){ await api(`/api/recurring/${id}`,'DELETE'); recurring=recurring.filter(r=>r.id!==id); saveCache(CK.rec,recurring); renderRec(); }
    else if(type==='cat'){ await api(`/api/categories/${id}`,'DELETE'); categories=categories.filter(c=>c.id!==id); saveCache(CK.cats,categories); populateCatSelects(); renderCatSettings(); renderList(); renderInv(); }
  } catch(e){ showToast('削除に失敗しました'); }
  delTarget=null; closeOv('ov-del');
}

// ── Badges ──
function updateBadges(){
  const n=shopList.filter(s=>!s.checked).length; const b=document.getElementById('listBadge');
  b.textContent=n; b.style.display=n>0?'flex':'none';
  const rn=recurring.length; const rb=document.getElementById('recBadge');
  rb.textContent=rn; rb.style.display=rn>0?'flex':'none';
}

// ── Reload ──
async function reloadApp(){
  showToast('キャッシュをクリア中...');
  try{
    if('caches' in window){ const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); }
    if('serviceWorker' in navigator){ const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); }
  } catch{}
  setTimeout(()=>location.reload(true),400);
}

// ── Pull to Refresh ──
function initPullToRefresh(){
  let startY=0, pulling=false;
  const bar=document.getElementById('pullIndicator'); const threshold=75;
  document.addEventListener('touchstart',e=>{ if(window.scrollY===0){ startY=e.touches[0].clientY; pulling=true; } },{passive:true});
  document.addEventListener('touchmove',e=>{ if(!pulling) return; const dist=e.touches[0].clientY-startY; if(dist>0&&window.scrollY===0){ const pct=Math.min(dist/threshold,1); bar.style.opacity=pct; bar.style.transform=`scaleX(${pct})`; } },{passive:true});
  document.addEventListener('touchend',e=>{ if(!pulling) return; const dist=e.changedTouches[0].clientY-startY; bar.style.opacity=0; bar.style.transform='scaleX(0)'; if(dist>threshold&&window.scrollY===0) refreshAll().then(()=>showToast('更新しました')); pulling=false; },{passive:true});
}

// ── SW & Push ──
async function initSW(){
  if(!('serviceWorker' in navigator)) return;
  try{
    const reg=await navigator.serviceWorker.register('./sw.js');
    navigator.serviceWorker.addEventListener('controllerchange',()=>showToast('新しいバージョンがあります。↺で更新してください。'));
    const vr=await fetch(API+'/api/push/vapid-public-key').then(r=>r.json()).catch(()=>({}));
    vapidKey=vr.key||'';
    pushSub=await reg.pushManager.getSubscription();
    if(Notification.permission==='default'&&vapidKey){ const nb=document.getElementById('notifBanner'); if(nb) nb.style.display='flex'; }
    else if(Notification.permission==='granted'&&vapidKey&&!pushSub) await subscribePush(reg);
  } catch(e){ console.error('SW:',e); }
}
async function requestNotifPermission(){
  const nb=document.getElementById('notifBanner'); if(nb) nb.style.display='none';
  const perm=await Notification.requestPermission();
  if(perm==='granted'){ const reg=await navigator.serviceWorker.ready; await subscribePush(reg); showToast('通知を設定しました'); }
}
function urlB64ToUint8(b64){ const pad='='.repeat((4-b64.length%4)%4); const raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from([...raw].map(c=>c.charCodeAt(0))); }
async function subscribePush(reg){
  if(!vapidKey) return;
  try{ const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToUint8(vapidKey)}); pushSub=sub; await fetch(API+'/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub,user:me})}); } catch(e){ console.error('Push:',e); }
}

// ── Modals ──
function openOv(id){ document.getElementById(id).classList.add('open'); }
function closeOv(id){ document.getElementById(id).classList.remove('open'); }

// ── UI ──
let toastT=null;
function showToast(msg){ const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show'); if(toastT) clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),2500); }
function showLoad(on){ const b=document.getElementById('loadBar'); b.className=on?'loading-bar on':'loading-bar done'; if(!on) setTimeout(()=>b.className='loading-bar',350); }

// ── Start ──
init();
