/* =====================================================================
   3) Session, load & autosave
   ===================================================================== */
const roleOf=()=>session?session.role.role:'';
const isAdmin=()=>roleOf()==='admin';
const isNurse=()=>roleOf()==='nurse';
const canEditRules=()=>isAdmin()||(roleOf()==='head'&&!!session.role.canEditRules);
const myStaffId=()=>isNurse()?session.role.staffId:null;

function applyUnit(u){
  state.dept=u.name||'';state.staff=(u.staff||[]).map(s=>Object.assign({prefix:'น.ส.',oc:true,ot:true},s));
  const r=u.rules||{};const d=defaultRules();
  state.rules=Object.assign(d,r);state.rules.need=Object.assign(defaultRules().need,r.need||{});
  state.rules.needOff=Object.assign(defaultRules().needOff,r.needOff||(r.need?Object.assign({},r.need,{otrn:0,otpn:0}):{}));
  state.shifts=Object.assign(defaultShifts(),u.shifts||{});delete state.shifts.N;SHIFTS=state.shifts;
  {const noN=(a,d)=>{const x=(a||[]).filter(v=>v!=='N');return x.length?x:d};
   state.rules.weekdayShifts=noN(state.rules.weekdayShifts,['A']);state.rules.offShifts=noN(state.rules.offShifts,['M','A']);}
  state.paper=Object.assign(defaultPaper(),u.paper||{});
  state.holidayOverrides=u.holidayOverrides||{};
  state.staffSort=u.staffSort==='manual'?'manual':'name';state.staffLocked=!!u.staffLocked;
  rawLocked={rules:u.rules||null,shifts:u.shifts||null,name:u.name||''};
}
function unitPayload(){
  const ce=canEditRules();
  return JSON.parse(JSON.stringify({name:isAdmin()?state.dept:rawLocked.name,staff:state.staff,holidayOverrides:state.holidayOverrides,paper:state.paper,staffSort:state.staffSort,staffLocked:!!state.staffLocked,
    rules:ce?state.rules:rawLocked.rules,shifts:ce?state.shifts:rawLocked.shifts}));
}
function monthPayload(){
  const mp=monthPrefix();const assign={};
  for(const k in legacyAssign)if(k.startsWith(mp)&&legacyAssign[k]&&legacyAssign[k].id)assign[k]=legacyAssign[k];
  for(const k in state.assign)if(k.startsWith(mp)&&state.assign[k]&&state.assign[k].id)assign[k]=state.assign[k];
  const rotQueue=rotEndQueues();
  return JSON.parse(JSON.stringify({assign,log:state.log.slice(0,100),...(rotQueue?{rotQueue}:{})}));
}
const leaveJson=id=>JSON.stringify(Object.keys(state.unavail[id]||{}).filter(k=>state.unavail[id][k]).sort());
function applyLeaves(map){
  for(const id in map){state.unavail[id]=Object.assign({},(map[id]&&map[id].dates)||{});lastLeave[id]=leaveJson(id);}
}
function applyMonth(data,ym,isCur){
  for(const k in state.assign)if(k.startsWith(ym))delete state.assign[k];
  for(const k in legacyAssign)if(k.startsWith(ym))delete legacyAssign[k];
  if(data)for(const k in (data.assign||{})){
    if(k.split('|')[1]==='N')legacyAssign[k]=data.assign[k];else state.assign[k]=data.assign[k];
  }
  if(isCur)state.log=(data&&data.log)||[];
  if(ym===shiftYm(-1))rotPrevQueue=(data&&data.rotQueue)||null;
}
function setSave(st,msg){
  const el=$('#saveStatus');el.className='save '+st;
  el.textContent={pending:'กำลังรอบันทึก…',saving:'กำลังบันทึก…',saved:'บันทึกแล้ว ✓',error:'บันทึกไม่สำเร็จ'}[st];
  if(st==='error')toast(msg&&String(msg).includes('permission')?'ไม่มีสิทธิ์แก้ส่วนนี้':'บันทึกไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต แล้วแก้ไขอีกครั้ง');
}
function markDirty(){setSave('pending');clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,700)}
async function saveNow(){
  clearTimeout(saveTimer);saveTimer=null;if(!unitId||!session)return;
  const at=Date.now(),by=session.user.email,tasks=[];
  if(!isNurse()){
    const u=JSON.stringify(unitPayload()),mo=JSON.stringify(monthPayload());
    if(u!==lastUnitJson)tasks.push(B.saveUnit(unitId,{...JSON.parse(u),updatedAt:at,updatedBy:by}).then(()=>{lastUnitJson=u;lastUnitAt=at}));
    if(mo!==lastMonthJson)tasks.push(B.saveMonth(unitId,monthPrefix(),{...JSON.parse(mo),updatedAt:at,updatedBy:by}).then(()=>{lastMonthJson=mo;lastMonthAt=at}));
  }
  const ids=isNurse()?[myStaffId()]:state.staff.map(s=>s.id);
  ids.forEach(id=>{const j=leaveJson(id);if(j!==(lastLeave[id]||'[]')){
    const dates={};JSON.parse(j).forEach(k=>dates[k]=true);
    tasks.push(B.saveLeave(unitId,id,{dates,updatedAt:at,updatedBy:by}).then(()=>{lastLeave[id]=j}));}});
  if(!tasks.length){setSave('saved');return}
  saving=true;setSave('saving');
  try{await Promise.all(tasks);setSave('saved')}catch(e){console.error(e);setSave('error',e&&e.code)}finally{saving=false}
}
async function loadLeaves(){
  state.unavail={};lastLeave={};
  if(isNurse()){const v=await B.getLeave(unitId,myStaffId());applyLeaves({[myStaffId()]:v});}
  else applyLeaves(await B.listLeaves(unitId));
}
async function loadMonths(){
  state.assign={};legacyAssign={};
  const yms=[shiftYm(-1),monthPrefix(),shiftYm(1)];
  const ds=await Promise.all(yms.map(y=>B.getMonth(unitId,y)));
  ds.forEach((d,i)=>applyMonth(d,yms[i],i===1));
  lastMonthJson=JSON.stringify(monthPayload());lastMonthAt=ds[1]?ds[1].updatedAt:0;
  await loadHistory();
  watchCurrent();
}
function watchCurrent(){
  unsubs.forEach(f=>f());unsubs=[];
  unsubs.push(B.watchUnit(unitId,d=>{
    if(!d){toast('แผนกนี้ถูกลบแล้ว');if(isAdmin())goUnits();return}
    if(saveTimer||saving||d.updatedAt===lastUnitAt)return;
    applyUnit(d);lastUnitJson=JSON.stringify(unitPayload());lastUnitAt=d.updatedAt;renderAll();
    if(d.updatedBy&&d.updatedBy!==session.user.email)toast('ข้อมูลแผนกถูกแก้โดย '+d.updatedBy);
  }));
  const ym=monthPrefix();
  unsubs.push(B.watchMonth(unitId,ym,d=>{
    if(!d||saveTimer||saving||d.updatedAt===lastMonthAt||ym!==monthPrefix())return;
    applyMonth(d,ym,true);lastMonthJson=JSON.stringify(monthPayload());lastMonthAt=d.updatedAt;renderAll();
    if(d.updatedBy&&d.updatedBy!==session.user.email)toast('ตารางเวรถูกแก้โดย '+d.updatedBy);
  }));
  const onLeaves=map=>{
    if(saveTimer||saving)return;let who='';
    for(const id in map){const j=JSON.stringify(Object.keys((map[id]&&map[id].dates)||{}).filter(k=>map[id].dates[k]).sort());
      if(j!==lastLeave[id]){state.unavail[id]=Object.assign({},map[id].dates||{});lastLeave[id]=j;if(map[id].updatedBy&&map[id].updatedBy!==session.user.email)who=firstName(id);}}
    if(who){renderAll();toast('คุณ'+who+' แจ้งวันไม่ว่าง');}
  };
  unsubs.push(isNurse()?B.watchLeave(unitId,myStaffId(),onLeaves):B.watchLeaves(unitId,onLeaves));
}
async function openUnit(id){
  try{
    const u=await B.getUnit(id);
    if(!u){toast('ไม่พบแผนกนี้');if(isAdmin())goUnits();else showLoginError('ไม่พบแผนกที่ผูกกับบัญชีนี้ กรุณาติดต่อฝ่ายการพยาบาล');return}
    unitId=id;applyUnit(u);lastUnitJson=JSON.stringify(unitPayload());lastUnitAt=u.updatedAt||0;
    if(isNurse()&&!person(myStaffId())){showLoginError('ไม่พบชื่อของคุณในแผนก กรุณาติดต่อหัวหน้าแผนก');await B.signOut();return}
    const nm=nextMonthFromToday();state.year=nm.y;state.month=nm.m;undoStack=[];
    await loadLeaves();await loadMonths();showView('app');applyRoleUI();renderAll();setSave('saved');
  }catch(e){console.error(e);toast('เปิดแผนกไม่สำเร็จ: '+(e.code||e.message))}
}
async function changeMonth(d){
  await saveNow();state.month+=d;if(state.month<0){state.month=11;state.year--}if(state.month>11){state.month=0;state.year++}
  await loadMonths();renderAll();
}
async function goUnits(){
  if(unitId)await saveNow();
  unsubs.forEach(f=>f());unsubs=[];unitId=null;
  showView('units');renderUnits();renderUsers();
}
const ROLE_TH={admin:'แอดมิน',head:'หัวหน้าแผนก',nurse:'พยาบาล / เจ้าหน้าที่'};
function showView(v){
  ['login','units','app'].forEach(x=>$('#'+x+'View').classList.toggle('show',x===v));
  document.body.classList.toggle('login-mode',v==='login');
  $('#topTools').hidden=v!=='app';$('#userBox').hidden=v==='login';
  $('#backBtn').hidden=!(v==='app'&&isAdmin());
  document.body.classList.toggle('gray',v==='units');
  $('#deptLabel').textContent=v==='app'?state.dept:'ฝ่ายการพยาบาล';
  if(session){$('#userEmail').textContent=session.role.name||session.user.email;const r=$('#userRole');r.textContent=ROLE_TH[roleOf()];r.className='role '+(isAdmin()?'admin':'');}
  window.scrollTo(0,0);
}
function showLoginError(m){$('#liErr').textContent=m}
async function onAuthChanged(u){
  if(!u){session=null;unitId=null;unsubs.forEach(f=>f());unsubs=[];showView('login');return}
  let role=null;
  try{role=await B.getRole(u.email)}catch(e){console.error(e)}
  if(!role||!['admin','head','nurse'].includes(role.role)){showLoginError('บัญชี '+u.email+' ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาติดต่อฝ่ายการพยาบาล');await B.signOut();return}
  session={user:u,role};$('#liErr').textContent='';
  if(role.role==='admin')goUnits();else openUnit(role.unitId);
}

/* =====================================================================
   4) UI
   ===================================================================== */
const $=s=>document.querySelector(s);
const SVG=d=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_UP=SVG('<path d="m6 15 6-6 6 6"/>'),ICON_DN=SVG('<path d="m6 9 6 6 6-6"/>'),ICON_X=SVG('<path d="M6 6l12 12M18 6 6 18"/>');
const ICON_GRIP='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="5" r="1.8"/><circle cx="15" cy="5" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="19" r="1.8"/><circle cx="15" cy="19" r="1.8"/></svg>';
/* ปุ่มเลื่อนขึ้น/ลงแบบกะทัดรัด: attr = ชื่อ data-attribute, up/dn = ค่า, canUp/canDn = กดได้ไหม */
const ordBtns=(attr,up,dn,canUp,canDn,dis)=>`<span class="ord"><button ${attr}="${up}" ${dis||(canUp?'':'disabled')} aria-label="เลื่อนขึ้น" title="เลื่อนขึ้น">${ICON_UP}</button><button ${attr}="${dn}" ${dis||(canDn?'':'disabled')} aria-label="เลื่อนลง" title="เลื่อนลง">${ICON_DN}</button></span>`;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastT;
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),3200)}
function openModal(title,body,foot){
  $('#mTitle').textContent=title;$('#mBody').innerHTML=body;$('#mFoot').innerHTML=foot||'<button class="btn btn-line" data-close>ปิด</button>';
  $('#modal').classList.remove('hidden');$('#mFoot').querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);
}
function closeModal(){$('#modal').classList.add('hidden')}
$('#mClose').onclick=closeModal;
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
function confirmBox(title,msg,buttons){
  openModal(title,`<p style="font-size:1.08rem;margin:0">${msg}</p>`,buttons.map((b,i)=>`<button class="btn ${b.cls||'btn-line'}" data-i="${i}">${b.label}</button>`).join(''));
  $('#mFoot').querySelectorAll('[data-i]').forEach(el=>el.onclick=()=>{closeModal();const f=buttons[+el.dataset.i].fn;if(f)f();});
}
function snapshot(){return JSON.stringify({assign:state.assign,unavail:state.unavail,staff:state.staff,staffSort:state.staffSort,staffLocked:state.staffLocked,holidayOverrides:state.holidayOverrides,rules:state.rules,shifts:state.shifts,paper:state.paper,log:state.log,dept:state.dept})}
function pushUndo(){undoStack.push(snapshot());if(undoStack.length>60)undoStack.shift();}
function undo(){
  if(!undoStack.length){toast('ไม่มีรายการให้ย้อนกลับ');return}
  Object.assign(state,JSON.parse(undoStack.pop()));SHIFTS=state.shifts;addLog('ย้อนกลับการแก้ไขล่าสุด');markDirty();renderAll();toast('ย้อนกลับแล้ว');
}
function addLog(t){if(isNurse())return;const d=new Date();const who=session?(session.role.name||session.user.email.split('@')[0]):'';state.log.unshift({t,by:who,at:`${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`});if(state.log.length>100)state.log.pop();}

function applyRoleUI(){
  const n=isNurse();
  ['#autoBtn','#clearBtn','#undoBtn'].forEach(s=>$(s).hidden=n);
  $('[data-tab="settings"]').hidden=n;
  $('[data-tab="people"]').innerHTML=`<span class="num">2</span>${n?'แจ้งวันไม่ว่างของฉัน':'รายคน &amp; วันไม่ว่าง'}`;
  $('#peopleTitle').textContent=n?'แตะวันที่ที่คุณ “ไม่ว่าง / ขอลา” ในแถวชื่อของคุณ':'แตะช่องวันที่ เพื่อทำเครื่องหมาย “ไม่ว่าง”';
  $('#peopleHint').textContent=n?'หัวหน้าแผนกจะเห็นทันที · แตะซ้ำเพื่อยกเลิก · ถ้าวันนั้นคุณมีเวรอยู่แล้ว กรุณาแจ้งหัวหน้าเพื่อหาคนแทน':'แตะซ้ำเพื่อยกเลิก · แตะที่ชื่อเพื่อแก้ไขข้อมูล';
  $('#helpBox').hidden=n;
  document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab==='schedule'));
  document.querySelectorAll('#appView .panel').forEach(p=>p.classList.toggle('show',p.id==='tab-schedule'));
}
function renderHeader(){$('#monthLabel').textContent=monthTitle();$('#deptLabel').textContent=state.dept;$('#undoBtn').disabled=!undoStack.length;}

/* ---------- schedule ---------- */
function allProblems(){
  const idx=buildIndex(state.assign);const out=[];let filled=0;const slots=monthSlots();
  slots.forEach(s=>{const a=state.assign[s.key];
    if(!a||!a.id){out.push({s,t:'ยังไม่มีคน'});return}
    filled++;const pr=slotIssues(s.key,a,idx);if(pr.length)out.push({s,t:fullName(a.id)+' — '+pr.map(p=>p.t).join(', ')});});
  return{out,filled,total:slots.length,idx};
}
const okIcon='<div class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg></div>';
function renderSchedule(){
  const {out,filled,total,idx}=allProblems();const sb=$('#statusBox');
  if(isNurse()){
    const me=myStaffId();const c=monthCounts(idx,me);
    const l=c.list.slice().sort((a,b)=>a.dn-b.dn);
    sb.innerHTML=`<div class="status ok">${okIcon}<div class="txt"><b>เวรของคุณ${esc(person(me).name.split(' ')[0])} เดือนนี้: ${c.all} เวร${c.ot?` + OT ${c.ot} ครั้ง`:''}</b>
      <div>${l.length?Object.entries(l.reduce((m,x)=>{(m[x.iso]=m[x.iso]||new Set()).add(slotWord(x));return m},{})).map(([i,w])=>shortDate(i)+' ('+[...w].join('+')+')').join(' · '):'ยังไม่มีเวร'}</div>
      <div class="hint">ช่องที่มีชื่อคุณจะเป็นกรอบหนา · ต้องการแลกเวร ติดต่อหัวหน้าแผนก</div></div></div>`;
  }else if(filled===0){
    sb.innerHTML=`<div class="status bad"><div class="ic">!</div><div class="txt"><b>เดือนนี้ยังไม่ได้จัดเวร</b><div>กดปุ่ม “จัดเวรอัตโนมัติ” ระบบจะจัดให้ทั้งเดือนในไม่กี่วินาที</div></div></div>`;
  }else if(!out.length){
    sb.innerHTML=`<div class="status ok">${okIcon}<div class="txt"><b>เรียบร้อย จัดครบ ${filled}/${total} ช่อง</b><div>ไม่มีใครลาตรงเวร และไม่ผิดกฎของแผนกนี้</div></div></div>`;
  }else{
    sb.innerHTML=`<div class="status bad"><div class="ic">!</div><div class="txt"><b>มี ${out.length} ช่องที่ต้องแก้</b> (จัดแล้ว ${filled}/${total})
      <ul class="problist">${out.slice(0,6).map(o=>`<li><button data-k="${o.s.key}">${shortDate(o.s.iso)} ${o.s.ot?'OT':'เวร'+SHIFTS[o.s.shift].label} · ${SLOTM[o.s.pos].label}: ${esc(o.t)}</button></li>`).join('')}${out.length>6?`<li>…และอีก ${out.length-6} รายการ</li>`:''}</ul></div>
      <button class="btn btn-green btn-big" id="fixBtn">ให้ระบบหาคนแทนให้</button></div>`;
    sb.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>openSlot(b.dataset.k));$('#fixBtn').onclick=fixProblems;
  }
  const us=usedSlots();const me=myStaffId();
  let h=`<thead><tr><th style="text-align:center">วันที่</th><th>วัน</th><th>เวร</th>${us.map(p=>`<th><span class="pdot" style="background:${p.dot}"></span>${p.label}<div style="font-weight:400;font-size:.8rem;opacity:.85">${p.short}</div></th>`).join('')}</tr></thead><tbody>`;
  monthDays().forEach(iso=>{
    const shs=shiftsOf(iso);const off=isOff(iso);const hn=holidayName(iso);const d=parseIso(iso).d;
    if(!shs.length){h+=`<tr class="${off?'off':''} daystart"><td class="date">${d}</td><td class="dname">${DOW_L[dow(iso)]}</td><td colspan="${1+us.length}" class="hint">ไม่มีเวร</td></tr>`;return}
    shs.forEach((sh,si)=>{
      h+=`<tr class="${off?'off':''} ${si===0?'daystart':''}">`;
      if(si===0)h+=`<td class="date" rowspan="${shs.length}">${d}</td><td class="dname" rowspan="${shs.length}"${hn?` title="${esc(hn)}"`:''}>${DOW_L[dow(iso)]}${hn?`<small>${esc(hn)}</small>`:rotOn()&&iso>=rotStart()&&isHolQueueDay(iso)?'<small>↻ คิวนักขัตฤกษ์</small>':''}</td>`;
      h+=`<td><span class="shift sh-${sh}">${esc(SHIFTS[sh].label)} <small>${esc(SHIFTS[sh].time)}</small></span></td>`;
      us.forEach(p=>{h+='<td>';const n=needFor(iso,p.key);
        if(!n)h+='<span class="hint">—</span>';
        for(let i=0;i<n;i++){
          const k=`${iso}|${sh}|${p.key}|${i}`;const a=state.assign[k];
          if(!a||!a.id){h+=`<button class="chip empty" data-k="${k}" ${isNurse()?'disabled':''}>${isNurse()?'ว่าง':'+ เลือกคน'}</button>`;continue;}
          const pr=isNurse()?[]:slotIssues(k,a,idx);const mine=me&&a.id===me;
          h+=`<button class="chip ${p.cls} ${pr.length?'bad':''} ${mine?'mine':''}" data-k="${k}" ${isNurse()?'disabled':''} title="${esc(fullName(a.id)+(pr.length?' — '+pr.map(x=>x.t).join(', '):''))}">${pr.length?ICON_WARN:''}${esc(firstName(a.id))}${a.rot&&!isNurse()?' <small title="จัดตามคิวหมุนเวร">↻</small>':''}${a.locked&&!isNurse()?ICON_LOCK:''}</button>`;
        }
        h+='</td>';});
      h+='</tr>';
    });
  });
  const t=$('#schedTable');t.innerHTML=h+'</tbody>';
  if(!isNurse())t.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>openSlot(b.dataset.k));
  $('#logBox').hidden=isNurse();
  $('#logList').innerHTML=state.log.length?state.log.slice(0,30).map(l=>`<li><time>${esc(l.at)}</time>${esc(l.t)}${l.by?` <span class="hint">· ${esc(l.by)}</span>`:''}</li>`).join(''):'<li class="hint">ยังไม่มีการเปลี่ยนแปลง</li>';
}
function tagHtml(pr){
  if(!pr.length)return '<span class="tag ok">ว่าง ไม่ผิดกฎ</span>';
  const lv=Math.max(...pr.map(p=>p.lv));return `<span class="tag w${lv}">${esc([...new Set(pr.map(p=>p.t))].join(', '))}</span>`;
}
function openSlot(key){
  const keys=pairKeys(key);const [iso,,slot]=key.split('|');const cur=state.assign[key];const idx=buildIndex(state.assign);const p0=parseIso(iso);
  const cands=state.staff.filter(s=>eligible(s,slot)).map(s=>{const pr=unitProblems(keys,s.id,idx);const c=monthCounts(idx,s.id);
    return{s,pr,c,lv:pr.length?Math.max(...pr.map(p=>p.lv)):0}});
  const rq=rotQueueAt(iso,slot);const qi=id=>{const i=rq?rq.indexOf(id):-1;return i<0?1e3:i};
  cands.sort((a,b)=>a.lv-b.lv||(rq?qi(a.s.id)-qi(b.s.id):0)||(SLOTM[slot].ot?a.c.ot-b.c.ot:a.c.all-b.c.all));
  let b='';
  if(rq)b+=`<p class="hint" style="margin-top:0">↻ ช่องนี้หมุนตามคิว — เรียงตามลำดับคิว ณ วันนี้ (คนแรก = ถึงคิว)</p>`;
  if(keys.length>1)b+=`<p class="hint" style="margin-top:0">วันหยุด: คนเดียวกันอยู่ทุกเวรของวัน — เปลี่ยน/แลกครั้งเดียวจะเปลี่ยนทั้ง ${keys.length} เวร</p>`;
  if(cur&&cur.id){const pr=slotIssues(key,cur,idx);
    b+=`<div class="curbox"><div><div class="hint">คนที่อยู่เวรนี้ตอนนี้</div><div class="who">${esc(fullName(cur.id))}</div>${pr.length?tagHtml(pr):''}</div>
      <button class="btn btn-line" id="lockBtn">${ICON_LOCK} ${cur.locked?'ปลดล็อก (ให้ระบบจัดใหม่ได้)':'ล็อกไว้ (ห้ามระบบเปลี่ยน)'}</button></div>`;}
  b+=`<div class="sec"><h4><span class="n">1</span>ให้คนอื่นทำแทน <span class="hint" style="font-weight:400">— แตะชื่อเพื่อเลือก (สีเขียว = ว่าง)</span></h4><div class="cands">`+
    cands.map(c=>`<button class="cand ${cur&&cur.id===c.s.id?'cur':''}" data-id="${c.s.id}"><span class="nm">คุณ${esc(c.s.name)}</span><span class="meta">เดือนนี้ ${c.c.all} เวร${c.c.ot?` · OT ${c.c.ot}`:''} (วันหยุด ${c.c.off})</span><br>${cur&&cur.id===c.s.id?'<span class="tag ok">คนปัจจุบัน</span>':tagHtml(c.pr)}</button>`).join('')+`</div></div>`;
  if(cur&&cur.id)b+=`<div class="sec"><h4><span class="n">2</span>แลกเวรกับเพื่อน</h4>
      <select class="textin" id="swapSel"><option value="">— เลือกคนที่จะแลกด้วย —</option>${cands.filter(c=>c.s.id!==cur.id).map(c=>`<option value="${c.s.id}">คุณ${esc(c.s.name)}</option>`).join('')}</select>
      <div id="swapList" style="margin-top:10px"></div></div>`;
  openModal(`${DOW_L[dow(iso)]} ${p0.d} ${TH_M[p0.m]} · ${SLOTM[slot].ot?'OT':'เวร'+unitLabel(keys)} · ${SLOTM[slot].label}`,b,`${cur&&cur.id?'<button class="btn btn-danger" id="clrSlot">เอาคนออกจากช่องนี้</button>':''}<button class="btn btn-line" data-close>ปิด</button>`);
  $('#mBody').querySelectorAll('.cand[data-id]').forEach(el=>el.onclick=()=>{
    const id=el.dataset.id;if(cur&&cur.id===id&&!pairMismatch(key,state.assign)){closeModal();return}
    pushUndo();const old=cur&&cur.id;keys.forEach(k=>state.assign[k]={id,locked:true});
    addLog(`${shortDate(iso)} ${unitLabel(keys)} (${SLOTM[slot].short}): ${old?firstName(old)+' → ':''}${firstName(id)}`);
    markDirty();closeModal();renderAll();toast('เปลี่ยนเป็น คุณ'+person(id).name+' แล้ว');
  });
  const lb=$('#lockBtn');if(lb)lb.onclick=()=>{pushUndo();const v=!cur.locked;keys.forEach(k=>{if(state.assign[k])state.assign[k].locked=v});markDirty();renderAll();openSlot(key)};
  const cb=$('#clrSlot');if(cb)cb.onclick=()=>{pushUndo();addLog(`${shortDate(iso)} ${unitLabel(keys)}: เอา ${firstName(cur.id)} ออก`);keys.forEach(k=>delete state.assign[k]);markDirty();closeModal();renderAll()};
  const ss=$('#swapSel');
  if(ss)ss.onchange=()=>{
    const Bid=ss.value;const box=$('#swapList');if(!Bid){box.innerHTML='';return}
    const units=[];const seen=new Set();
    (idx[Bid]||[]).filter(x=>x.iso.startsWith(monthPrefix())&&eligible(person(cur.id),x.pos)).sort((a,b)=>a.dn-b.dn||SH_ORDER.indexOf(a.shift)-SH_ORDER.indexOf(b.shift))
      .forEach(x=>{const ks=pairKeys(x.key);if(seen.has(ks[0]))return;seen.add(ks[0]);units.push({iso:x.iso,pos:x.pos,ks:ks.filter(k=>state.assign[k]&&state.assign[k].id===Bid)});});
    if(!units.length){box.innerHTML='<p class="hint">คนนี้ยังไม่มีเวรที่แลกกันได้ในเดือนนี้ — ใช้ข้อ 1 “ให้คนอื่นทำแทน” แทนได้เลย</p>';return}
    box.innerHTML='<p class="hint" style="margin:0 0 8px">เลือกเวรของเพื่อนที่จะแลก (คุณ'+esc(person(cur.id).name)+' จะไปทำเวรนั้นแทน)</p><div class="cands">'+units.map((u,ui)=>{
      const asg2=Object.assign({},state.assign);keys.forEach(k=>asg2[k]={id:Bid});u.ks.forEach(k=>asg2[k]={id:cur.id});const i2=buildIndex(asg2);
      const pr=[...unitProblems(keys,Bid,i2),...unitProblems(u.ks,cur.id,i2)];
      return `<button class="cand" data-u="${ui}"><span class="nm">${shortDate(u.iso)}</span><span class="meta">${unitLabel(u.ks)} · ${SLOTM[u.pos].short}</span><br>${tagHtml(pr)}</button>`}).join('')+'</div>';
    box.querySelectorAll('[data-u]').forEach(el=>el.onclick=()=>{
      const u=units[+el.dataset.u];const A=cur.id;pushUndo();
      keys.forEach(k=>state.assign[k]={id:Bid,locked:true});u.ks.forEach(k=>state.assign[k]={id:A,locked:true});
      addLog(`แลกเวร: ${firstName(A)} (${shortDate(iso)}) ⇄ ${firstName(Bid)} (${shortDate(u.iso)})`);
      markDirty();closeModal();renderAll();toast('แลกเวรเรียบร้อย');
    });
  };
}
function fixProblems(){
  pushUndo();const before=allProblems().out.length;const un=autoFill('fix');
  addLog(`ระบบหาคนแทนอัตโนมัติ (แก้ ${before} ช่อง)`);markDirty();renderAll();
  toast(un?`แก้แล้ว แต่ยังมี ${un} ช่องที่หาคนว่างไม่ได้ ลองปิดกฎบางข้อในแท็บ 4`:'แก้ไขเรียบร้อย ทุกช่องมีคนแล้ว');
}

/* ---------- people grid ---------- */
function shiftsUsed(){return SH_ORDER.filter(s=>state.rules.weekdayShifts.includes(s)||state.rules.offShifts.includes(s))}
/* ---------- ลากย้ายลำดับ/ตำแหน่งในแท็บ 2 (ใช้ pointer events จึงลากได้ทั้งเมาส์และนิ้ว) ---------- */
function bindPeopleDrag(t){
  const wrap=t.closest('.tbl-wrap');
  t.querySelectorAll('[data-drag]').forEach(h=>h.onpointerdown=e=>{
    if(e.button>0)return;e.preventDefault();
    const id=h.dataset.drag,row=h.closest('tr');row.style.opacity='.35';document.body.style.cursor='grabbing';
    const line=document.createElement('div');line.style.cssText='position:fixed;height:3px;background:#1C6DB0;border-radius:2px;pointer-events:none;z-index:9999;display:none';document.body.appendChild(line);
    let drop=null,timer=null;
    const at=(x,y)=>{const el=document.elementFromPoint(x,y);const tr=el&&el.closest('#peopleTable tr[data-sid],#peopleTable tr.grp');if(!tr){drop=null;line.style.display='none';return}
      const r=tr.getBoundingClientRect(),w=(wrap||t).getBoundingClientRect();
      if(tr.classList.contains('grp'))drop={tid:null,pos:tr.dataset.gpos,after:false,y:r.bottom};
      else{const after=y>r.top+r.height/2;drop={tid:tr.dataset.sid,pos:tr.dataset.spos,after,y:after?r.bottom:r.top};}
      Object.assign(line.style,{display:'block',left:w.left+'px',width:w.width+'px',top:(drop.y-1)+'px'});};
    const move=ev=>{at(ev.clientX,ev.clientY);
      clearInterval(timer);if(wrap){const w=wrap.getBoundingClientRect();const d=ev.clientY<w.top+40?-12:ev.clientY>w.bottom-40?12:0;if(d)timer=setInterval(()=>wrap.scrollBy(0,d),16);}};
    const up=()=>{clearInterval(timer);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);
      line.remove();row.style.opacity='';document.body.style.cursor='';if(drop)movePerson(id,drop.tid,drop.pos,drop.after);};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);
  });
}
function movePerson(id,tid,pos,after){
  const p=person(id);if(!p||tid===id||!POSM[pos])return;
  const doMove=()=>{
    pushUndo();
    if(state.staffSort!=='manual'){state.staff=sortStaff(state.staff);state.staffSort='manual';toast('เปลี่ยนเป็น “เรียงลำดับเอง” แล้ว');}
    const oldPos=p.pos;const arr=state.staff.filter(s=>s.id!==id);p.pos=pos;
    let i=tid?arr.findIndex(s=>s.id===tid)+(after?1:0):arr.findIndex(s=>s.pos===pos);if(i<0)i=arr.length;
    arr.splice(i,0,p);state.staff=arr;
    addLog(oldPos!==pos?`ย้าย คุณ${p.name} จาก${POSM[oldPos].label} เป็น${POSM[pos].label}`:`เลื่อนลำดับ คุณ${p.name}`);
    markDirty();renderAll();};
  if(pos!==p.pos)confirmBox(`ย้ายคุณ${esc(p.name)} ไปเป็น${esc(POSM[pos].label)}?`,
    `ตำแหน่งจะเปลี่ยนจาก <b>${esc(POSM[p.pos].label)}</b> เป็น <b>${esc(POSM[pos].label)}</b> · เวรที่จัดไว้แล้วในช่องตำแหน่งเดิมจะขึ้นเตือน ให้กดจัดเวรใหม่ · ตรวจคิวหมุนเวรและกฎห้ามอยู่เวรร่วมกันของคนนี้ด้วย`,
    [{label:'ยกเลิก'},{label:'ย้ายตำแหน่ง',cls:'btn-primary',fn:doMove}]);
  else doMove();
}
function renderPeople(){
  $('#peopleLegend').innerHTML=shiftsUsed().map(s=>`<span><i class="lg" style="background:${SH_COLOR[s][0]};color:${SH_COLOR[s][1]}">${esc(SHIFTS[s].letter)}</i>เวร${esc(SHIFTS[s].label)}</span>`).join('')+
    `<span><i class="lg" style="background:#EEE8FB;color:#4A2C7A">OT</i>ล่วงเวลา</span><span><i class="lg" style="background:#E7DDF7;color:#4A2C7A">2+</i>หลายเวรในวันเดียว</span><span><i class="lg" style="background:#F7D3D3;color:#8E2020">ลา</i>ไม่ว่าง</span><span><i class="lg" style="background:var(--red);color:#fff">!</i>ไม่ว่างแต่ยังมีเวร</span>`;
  const days=monthDays();const idx=buildIndex(state.assign);const n=isNurse(),me=myStaffId();
  let h=`<thead><tr><th class="namecol">ชื่อ-สกุล</th>${days.map(iso=>`<th class="${isOff(iso)?'off':''}" title="${esc(holidayName(iso))}">${parseIso(iso).d}<small>${DOW_S[dow(iso)]}</small></th>`).join('')}<th>เวร</th><th>OT</th></tr></thead><tbody>`;
  POS.forEach(p=>{
    const list=staffOf(p.key);
    h+=`<tr class="grp" data-gpos="${p.key}"><td colspan="${days.length+3}"><span class="dot" style="background:${p.color}"></span>${p.label} (${list.length} คน)</td></tr>`;
    list.forEach((s,li)=>{
      const c=monthCounts(idx,s.id);const mine=n&&s.id===me;const ro=n&&!mine;
      const canMove=!n&&!state.staffLocked;
      const dragH=canMove?`<span class="dragh" data-drag="${s.id}" title="ลากเพื่อย้ายลำดับ/ตำแหน่ง">${ICON_GRIP}</span>`:'';
      const mv=canMove&&state.staffSort==='manual'?ordBtns('data-mv',s.id+'|-1',s.id+'|1',li>0,li<list.length-1):'';
      const ns=(s.noShift||[]).filter(sh=>SHIFTS[sh]);const tag=s.oc===false?`<span class="mini">${esc(s.posLabel||(s.ot!==false?'OT เท่านั้น':'ไม่อยู่เวร'))}</span>`:
        (s.posLabel?`<span class="mini">${esc(s.posLabel)}</span>`:'')+(ns.length?`<span class="mini">ไม่ขึ้น${esc(ns.map(sh=>SHIFTS[sh].label).join('/'))}</span>`:'')+(s.ot===false?'<span class="mini">ไม่รับ OT</span>':'');
      h+=`<tr class="${mine?'merow':''}" data-sid="${s.id}" data-spos="${s.pos}"><td class="namecol"><div style="display:flex;align-items:center;gap:4px">${dragH}${mv}<button class="namebtn" data-edit="${s.id}" ${n?'disabled':''}>คุณ${esc(s.name)} ${tag}${n?'':ICON_EDIT}</button></div></td>`;
      days.forEach(iso=>{
        const ms=c.list.filter(x=>x.iso===iso).sort((a,b)=>SH_ORDER.indexOf(a.shift)-SH_ORDER.indexOf(b.shift));
        const una=state.unavail[s.id]&&state.unavail[s.id][iso];
        let txt=ms.map(x=>x.ot?'OT':SHIFTS[x.shift].letter).join('');let cls='pc',style='';
        if(una){cls+=' una';if(ms.length){cls+=' has';txt='!';}else txt='ลา';}
        else if(ms.length===1)style=ms[0].ot?'background:#EEE8FB;color:#4A2C7A;font-size:.75rem':`background:${SH_COLOR[ms[0].shift][0]};color:${SH_COLOR[ms[0].shift][1]}`;
        else if(ms.length>1)style='background:#E7DDF7;color:#4A2C7A;font-size:.75rem';
        h+=`<td class="${isOff(iso)?'offc':''}"><button class="${cls}" style="${style}" data-p="${s.id}" data-d="${iso}" ${ro?'disabled':''} title="${esc('คุณ'+s.name+' · '+shortDate(iso))}">${esc(txt)}</button></td>`;
      });
      h+=`<td class="tot">${c.all}</td><td class="tot">${c.ot}</td></tr>`;
    });
    if(!n)h+=`<tr class="addrow"><td class="namecol" style="border-right:0"><button class="addbtn" data-add="${p.key}">+ เพิ่ม${p.label}</button></td><td colspan="${days.length+2}"></td></tr>`;
  });
  const t=$('#peopleTable');t.innerHTML=h+'</tbody>';
  t.querySelectorAll('[data-p]:not([disabled])').forEach(b=>b.onclick=()=>toggleUnavail(b.dataset.p,b.dataset.d));
  const ss=$('#sortSel');ss.hidden=n;ss.value=state.staffSort;ss.disabled=!!state.staffLocked;
  const lk=$('#lockOrder');lk.hidden=n;lk.textContent=state.staffLocked?'🔒 ล็อกตำแหน่งอยู่ (กดเพื่อปลด)':'🔓 ล็อกตำแหน่ง';lk.classList.toggle('btn-primary',!!state.staffLocked);lk.classList.toggle('btn-line',!state.staffLocked);
  lk.onclick=()=>{pushUndo();state.staffLocked=!state.staffLocked;addLog(state.staffLocked?'ล็อกลำดับ/ตำแหน่งรายชื่อ':'ปลดล็อกลำดับ/ตำแหน่งรายชื่อ');markDirty();renderAll()};
  if(!n&&!state.staffLocked)bindPeopleDrag(t);
  ss.onchange=()=>{pushUndo();if(ss.value==='manual')state.staff=sortStaff(state.staff); // เริ่มจากลำดับที่เห็นอยู่ตอนนี้
    state.staffSort=ss.value;addLog(ss.value==='manual'?'เปลี่ยนเป็นเรียงรายชื่อเอง':'เปลี่ยนเป็นเรียงรายชื่อตาม ก–ฮ');markDirty();renderAll()};
  t.querySelectorAll('[data-mv]').forEach(b=>b.onclick=()=>{
    const [id,d]=b.dataset.mv.split('|');const g=staffOf(person(id).pos);const o=g[g.findIndex(x=>x.id===id)+(+d)];if(!o)return;
    pushUndo();const i=state.staff.findIndex(x=>x.id===id),j=state.staff.findIndex(x=>x.id===o.id);[state.staff[i],state.staff[j]]=[state.staff[j],state.staff[i]];
    markDirty();renderAll()});
  if(!n){t.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editPerson(b.dataset.edit));
    t.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>editPerson(null,b.dataset.add));}
}
function toggleUnavail(id,iso){
  if(isNurse()&&id!==myStaffId())return;
  pushUndo();const u=state.unavail[id]=state.unavail[id]||{};const nm=person(id).name.split(' ')[0];
  if(u[iso]){delete u[iso];addLog(`ยกเลิกวันไม่ว่าง: ${nm} ${shortDate(iso)}`);markDirty();renderAll();if(isNurse())toast('ยกเลิกวันไม่ว่าง '+shortDate(iso)+' แล้ว');return}
  u[iso]=true;addLog(`${nm} ไม่ว่าง ${shortDate(iso)}`);markDirty();renderAll();
  const idx=buildIndex(state.assign);const has=(idx[id]||[]).filter(x=>x.iso===iso);
  if(isNurse()){toast(has.length?`วันที่ ${shortDate(iso)} คุณมีเวรอยู่ — กรุณาแจ้งหัวหน้าแผนกเพื่อหาคนแทน`:`แจ้งไม่ว่าง ${shortDate(iso)} แล้ว หัวหน้าแผนกจะเห็นทันที`);return}
  if(has.length)confirmBox('คุณ'+person(id).name+' มีเวรวันนี้',`วันที่ ${shortDate(iso)} มีเวร${[...new Set(has.map(slotWord))].join(', ')} อยู่ ต้องการให้ระบบหาคนที่ว่างมาแทนเลยไหม?`,[
    {label:'ยังไม่ต้อง'},
    {label:'ให้ระบบหาคนแทน',cls:'btn-primary',fn:()=>{
      const idx2=buildIndex(state.assign);const done=new Set();
      has.forEach(x=>{const ks=pairKeys(x.key);if(done.has(ks[0]))return;done.add(ks[0]);
        const c=state.staff.filter(s=>eligible(s,x.pos)&&s.id!==id).map(s=>({s,pr:unitProblems(ks,s.id,idx2),n:x.ot?monthCounts(idx2,s.id).ot:monthCounts(idx2,s.id).all})).filter(o=>!o.pr.length).sort((a,b)=>a.n-b.n)[0];
        if(c){ks.forEach(k=>{state.assign[k]={id:c.s.id,locked:true};(idx2[c.s.id]=idx2[c.s.id]||[]).push({key:k,iso,shift:k.split('|')[1],pos:x.pos,ot:x.ot,dn:dayNum(iso),off:isOff(iso)})});
          addLog(`${shortDate(iso)} ${unitLabel(ks)}: ${nm} → ${c.s.name.split(' ')[0]} (แทนอัตโนมัติ)`);toast('ได้คนแทน: คุณ'+c.s.name);}
        else{ks.forEach(k=>delete state.assign[k]);toast('ไม่มีคนว่างที่ไม่ผิดกฎ — ไปเลือกเองในแท็บ 1');}
      });
      markDirty();renderAll();}}]);
}
function editPerson(id,posKey){
  const p=id?person(id):{name:'',pos:posKey,prefix:'น.ส.',oc:true,ot:true,posLabel:''};
  openModal(id?'แก้ไขข้อมูล':'เพิ่มรายชื่อ',`
    <label class="lb">คำนำหน้า (ใช้ในใบลงเวลา)</label>
    <div class="toggles" id="pPre">${PREFIXES.map(x=>`<button class="tbtn ${x===p.prefix?'on':''}" data-v="${x}">${x}</button>`).join('')}</div>
    <label class="lb">ชื่อ-นามสกุล (ไม่ต้องใส่ “คุณ”)</label>
    <input class="textin" id="pName" value="${esc(p.name)}" placeholder="เช่น ดารารัตน์ สุขสว่าง">
    <label class="lb">ตำแหน่ง</label>
    <div class="toggles" id="pPos">${POS.map(x=>`<button class="tbtn ${x.key===p.pos?'on':''}" data-v="${x.key}">${x.label}</button>`).join('')}</div>
    <label class="lb">ขึ้นเวรอะไรได้บ้าง</label>
    <div class="toggles" id="pDuty">${SH_ORDER.map(sh=>`<button class="tbtn ${p.oc!==false&&!(p.noShift||[]).includes(sh)?'on':''}" data-v="${sh}">เวร${esc(SHIFTS[sh].label)}</button>`).join('')}<button class="tbtn ${p.ot!==false?'on':''}" data-v="OT">OT</button></div>
    <p class="hint" id="pDutyHint" style="margin:6px 0 0"></p>
    <label class="lb">ตำแหน่งที่แสดงในใบลงเวลา (ไม่บังคับ)</label>
    <input class="textin" id="pLabel" value="${esc(p.posLabel||'')}" placeholder="เว้นว่าง = RN / PN · หรือใส่ เช่น CO, Sup., CLA">`,
    `${id?'<button class="btn btn-danger" id="pDel">ลบคนนี้</button>':''}<button class="btn btn-line" data-close>ยกเลิก</button><button class="btn btn-primary" id="pSave">บันทึก</button>`);
  let pos=p.pos,pre=p.prefix||'น.ส.';
  const duty=new Set([...SH_ORDER.filter(sh=>p.oc!==false&&!(p.noShift||[]).includes(sh)),...(p.ot!==false?['OT']:[])]);
  const dutyHint=()=>{const reg=SH_ORDER.filter(sh=>duty.has(sh));$('#pDutyHint').textContent=
    !reg.length&&duty.has('OT')?'ขึ้น OT อย่างเดียว — ไม่จัดเวรเช้า/เย็นให้':!reg.length?'ไม่จัดเวรใด ๆ ให้ (เช่น หัวหน้า, Sup.)':
    reg.length<SH_ORDER.length?`จัดให้เฉพาะเวร${reg.map(sh=>SHIFTS[sh].label).join(', ')}${duty.has('OT')?' และ OT':''}`:duty.has('OT')?'ขึ้นได้ทุกเวรและ OT':'ขึ้นได้ทุกเวร แต่ไม่รับ OT';};
  $('#pDuty').querySelectorAll('.tbtn').forEach(b=>b.onclick=()=>{const v=b.dataset.v;duty.has(v)?duty.delete(v):duty.add(v);b.classList.toggle('on',duty.has(v));dutyHint()});dutyHint();
  const grp=(sel,set)=>$(sel).querySelectorAll('.tbtn').forEach(b=>b.onclick=()=>{set(b.dataset.v);$(sel).querySelectorAll('.tbtn').forEach(x=>x.classList.toggle('on',x===b))});
  grp('#pPos',v=>pos=v);grp('#pPre',v=>pre=v);
  $('#pName').focus();
  $('#pSave').onclick=()=>{
    const nm=$('#pName').value.trim().replace(/^(คุณ|น\.ส\.|นางสาว|นาง|นาย)\s*/,'');if(!nm){toast('กรุณาใส่ชื่อ');return}
    const reg=SH_ORDER.filter(sh=>duty.has(sh));const oc=reg.length>0,ot=duty.has('OT');const noShift=oc?SH_ORDER.filter(sh=>!duty.has(sh)):[];
    pushUndo();const v={name:nm,pos,prefix:pre,oc,ot,noShift,posLabel:$('#pLabel').value.trim()};
    if(id){const old=person(id);Object.assign(old,v);for(const k in state.assign){const [,sh,sl]=k.split('|');
      if(state.assign[k]&&state.assign[k].id===id&&(!eligible(old,sl)||(!SLOTM[sl].ot&&noShift.includes(sh))))delete state.assign[k];}addLog('แก้ไขข้อมูล คุณ'+nm);}
    else{state.staff.push(Object.assign({id:'x'+Date.now().toString(36)},v));addLog('เพิ่ม คุณ'+nm+' ('+POSM[pos].label+')');}
    markDirty();closeModal();renderAll();
  };
  const del=$('#pDel');
  if(del)del.onclick=()=>confirmBox('ลบรายชื่อถาวร?',`ลบ คุณ${esc(p.name)} ออกจากฐานข้อมูลทั้งหมด — ชื่อในแผนก เวรในตารางทุกเดือน และวันไม่ว่าง <b>กู้คืนไม่ได้</b>`,[
    {label:'ยกเลิก'},{label:'ลบถาวร',cls:'btn-danger',fn:()=>purgeStaff([id],'ลบ คุณ'+p.name)}]);
}

/* ---------- report ---------- */
function reportCols(){
  const r=state.rules;
  return [...SH_ORDER.filter(s=>r.weekdayShifts.includes(s)).map(s=>({s,off:false,h:SHIFTS[s].label,sub:'วันธรรมดา'})),
          ...SH_ORDER.filter(s=>r.offShifts.includes(s)).map(s=>({s,off:true,h:SHIFTS[s].label,sub:'วันหยุด'}))];
}
function reportRows(){
  const idx=buildIndex(state.assign);const mp=monthPrefix();const cols=reportCols();
  return POS.map(p=>({p,rows:staffOf(p.key).map(s=>{
    const l=monthCounts(idx,s.id).list;const oc=l.filter(x=>!x.ot);
    return{s,hist:(HIST[s.id]||{all:0}).all,est:!!(HIST[s.id]&&HIST[s.id].est),per:cols.map(c=>oc.filter(x=>x.off===c.off&&x.shift===c.s).length),total:oc.length,ot:l.length-oc.length,days:new Set(l.map(x=>x.iso)).size,
      hours:Math.round(oc.reduce((a,x)=>a+hoursOf(x.shift),0)*10)/10,
      leave:Object.keys(state.unavail[s.id]||{}).filter(i=>i.startsWith(mp)&&state.unavail[s.id][i]).length,dates:[...new Set(l.map(x=>x.iso))].sort()};
  })})).filter(g=>g.rows.length);
}
function renderReport(){
  const cols=reportCols();const groups=reportRows();const all=groups.flatMap(g=>g.rows);const max=Math.max(1,...all.map(r=>r.total+r.ot));
  const showOT=usedSlots().some(s=>s.ot);
  let h=`<div class="rep-cards"><div class="rcard"><div class="rl">เวรทั้งเดือน (รวมทุกคน)</div><div class="rv">${all.reduce((s,r)=>s+r.total,0)}</div><div class="rl">${esc(state.dept)} · ${monthTitle()}</div></div>`+
    groups.map(g=>{const t=g.rows.filter(r=>r.s.oc!==false).map(r=>r.total);if(!t.length)return '';const avg=t.reduce((a,b)=>a+b,0)/t.length;
      return `<div class="rcard"><div class="rl"><span class="dot" style="background:${g.p.color}"></span>${g.p.label} ในเวร OC (${t.length} คน)</div><div class="rv">${avg.toFixed(1)} <small>เวร/คน</small></div><div class="rl">น้อยสุด ${Math.min(...t)} · มากสุด ${Math.max(...t)}</div></div>`}).join('')+`</div>`;
  const nc=cols.length+8+(showOT?1:0);
  h+=`<div class="tbl-wrap" style="max-height:none"><table class="sched rep"><thead><tr><th>ชื่อ-สกุล</th>${cols.map(c=>`<th class="n">${esc(c.h)}<br><small>${c.sub}</small></th>`).join('')}<th class="n">รวมเวร</th>${showOT?'<th class="n">OT</th>':''}<th class="n">วันที่<br>ขึ้นเวร</th><th class="n">ชั่วโมง<br><small>ไม่รวม OT</small></th><th class="n">วันลา</th><th class="n">สะสม<br><small>12 เดือนก่อน</small></th><th class="n">รวมสะสม<br><small>รวมเดือนนี้</small></th><th style="min-width:150px">เทียบจำนวนเวร</th></tr></thead><tbody>`;
  groups.forEach(g=>{
    h+=`<tr class="grp"><td colspan="${nc}"><span class="dot" style="background:${g.p.color}"></span>${g.p.label}</td></tr>`;
    g.rows.forEach(r=>{h+=`<tr><td><b>คุณ${esc(r.s.name)}</b>${r.s.oc===false?' <span class="mini">ไม่อยู่เวร OC</span>':''}<div class="hint" style="font-size:.8rem">${r.dates.map(i=>parseIso(i).d).join(', ')||'-'}</div></td>
      ${r.per.map(v=>`<td class="n">${v}</td>`).join('')}<td class="n big">${r.total}</td>${showOT?`<td class="n">${r.ot}</td>`:''}<td class="n">${r.days}</td><td class="n">${r.hours}</td><td class="n">${r.leave||'-'}</td><td class="n">${r.s.oc===false?'-':r.hist+(r.est?'*':'')}</td><td class="n big">${r.s.oc===false?'-':r.hist+r.total}</td>
      <td><div class="barbg"><div class="bar" style="width:${r.total/max*100}%;background:${g.p.color}"></div></div></td></tr>`});
    const sum=f=>g.rows.reduce((s,r)=>s+f(r),0);
    h+=`<tr class="sum"><td>รวม${g.p.label}</td>${cols.map((c,i)=>`<td class="n">${sum(r=>r.per[i])}</td>`).join('')}<td class="n big">${sum(r=>r.total)}</td>${showOT?`<td class="n">${sum(r=>r.ot)}</td>`:''}<td class="n">${sum(r=>r.days)}</td><td class="n">${Math.round(sum(r=>r.hours)*10)/10}</td><td class="n">${sum(r=>r.leave)||'-'}</td><td class="n">${sum(r=>r.s.oc===false?0:r.hist)}</td><td class="n big">${sum(r=>r.s.oc===false?0:r.hist+r.total)}</td><td></td></tr>`;
  });
  $('#reportBox').innerHTML=h+'</tbody></table></div>';
}

/* ---------- settings ---------- */
function stepper(id,val,dis){return `<div class="stepper"><button data-st="${id}" data-dir="-1" aria-label="ลด" ${dis}>−</button><span>${val}</span><button data-st="${id}" data-dir="1" aria-label="เพิ่ม" ${dis}>+</button></div>`}
function renderSettings(){
  if(isNurse())return;
  const r=state.rules;const ce=canEditRules();const dis=ce?'':'disabled';const P=state.paper;
  $('#roNote').innerHTML=ce?'':'<div class="ro-note">กฎและรูปแบบเวรของแผนกนี้ กำหนดโดยฝ่ายการพยาบาล — หัวหน้าแผนกแก้ได้เฉพาะวันหยุดเพิ่มเติมและหัวกระดาษ (ถ้าต้องการเปลี่ยนกฎ ติดต่อแอดมิน)</div>';
  const days=monthDays();const first=dow(days[0]);
  let cal=DOW_S.map(d=>`<div class="h">${d}</div>`).join('')+'<div></div>'.repeat(first);
  days.forEach(iso=>{const hn=holidayName(iso);cal+=`<button class="${hn?'hol':isWeekend(iso)?'we':''}" data-hol="${iso}" ${hn?`data-tip="${parseIso(iso).d} ${TH_MS[parseIso(iso).m]} — ${esc(hn)}" title="${esc(hn)}"`:''}><span class="cd">${parseIso(iso).d}</span><small>${esc(hn)}</small></button>`});
  const sw=(k,label,sub)=>`<div class="row"><label>${label}<small>${sub}</small></label><button class="switch ${r[k]?'on':''}" data-sw="${k}" aria-label="เปิด/ปิด" ${dis}></button></div>`;
  const tog=f=>`<div class="toggles" style="margin-top:6px">${SH_ORDER.map(s=>`<button class="tbtn ${r[f].includes(s)?'on':''}" data-sh="${f}" data-v="${s}" ${dis}>เวร${esc(SHIFTS[s].label)}</button>`).join('')}</div>`;
  const pin=(k,l)=>`<label class="lb">${l}</label><input class="textin" data-paper="${k}" value="${esc(P[k])}">`;
  $('#settingsBox').innerHTML=`
  <div class="card"><h3>กฎการจัดเวร</h3><p class="hint">สีเขียว = ใช้กฎนี้ · ระบบจะไม่จัดให้ผิดกฎ และขึ้นเตือนสีแดงถ้าแก้ด้วยมือแล้วผิดกฎ (กฎข้อ 1, 4, 5 ไม่ใช้กับ OT)</p>
    ${sw('evNextMorning',`เวร${esc(SHIFTS.A.label)} ห้ามต่อเวรเช้าวันรุ่งขึ้น`,'คนอยู่เวรเย็นวันนี้ จะไม่ได้เวรเช้าพรุ่งนี้')}
    ${sw('holidaySame','วันหยุด: ทุกเวรของวันเป็นคนเดียวกัน','เช่น คนเดียวอยู่ทั้งเช้าและเย็นวันเสาร์ (นับแยกเวร)')}
    ${sw('noSameDay','ห้ามคนเดียวอยู่ 2 เวรในวันเดียวกัน','ยกเว้นวันหยุด ถ้าเปิดกฎข้อบน · OT กับเวรประจำวันเดียวกันห้ามเสมอ')}
    ${sw('noSameShiftConsec','ห้ามเวรเดียวกันติดกัน 2 วัน','เช่น เช้า-เช้า หรือ เย็น-เย็น')}
    ${sw('noConsecDays','ห้ามอยู่เวรวันติดกันเลย','ปิดไว้ = ขึ้นวันติดกันได้ถ้าไม่ผิดข้ออื่น')}
    <div class="row"><label>จำนวนเวรสูงสุดต่อคน/เดือน<small>0 = ไม่จำกัด · ไม่นับ OT</small></label>${stepper('maxPer',r.maxPer,dis)}</div>
    <div class="row"><label>เวรวันหยุดสูงสุดต่อคน/เดือน<small>0 = ไม่จำกัด</small></label>${stepper('maxOffPer',r.maxOffPer,dis)}</div>
  </div>
  ${conflictCard(dis)}
  ${rotationCard(dis)}
  <div class="card"><h3>รูปแบบเวรของแผนกนี้</h3>
    <div class="row" style="display:block"><label>วันธรรมดา (จ–ศ) มีเวร</label>${tog('weekdayShifts')}</div>
    <div class="row" style="display:block"><label>เสาร์ อาทิตย์ และวันนักขัตฤกษ์ มีเวร</label>${tog('offShifts')}</div>
    <div style="margin-top:8px"><b>จำนวนคนต่อ 1 เวร</b><div class="hint">0 = ไม่มีช่องนี้</div>
    <table class="needtbl"><thead><tr><th></th><th>วันธรรมดา</th><th>วันหยุด</th></tr></thead><tbody>
      ${SLOTS.map(s=>`<tr><td>${s.short}<small>${s.label}</small></td><td>${stepper('need.'+s.key,r.need[s.key]||0,dis)}</td><td>${stepper('needOff.'+s.key,r.needOff[s.key]||0,dis)}</td></tr>`).join('')}
    </tbody></table></div>
    <div style="margin-top:14px"><b>ชื่อและเวลาของเวร</b><div class="hint">ตัวย่อ 1–2 ตัวอักษร ใช้ในตารางรายคน</div>
      ${SH_ORDER.map(s=>`<div class="shiftrow"><span class="shift sh-${s}">${s==='M'?'เวร 1':'เวร 2'}</span>
        <input class="textin" data-shf="${s}.label" value="${esc(SHIFTS[s].label)}" ${dis} aria-label="ชื่อเวร">
        <input class="textin" data-shf="${s}.time" value="${esc(SHIFTS[s].time)}" ${dis} aria-label="เวลา">
        <input class="textin" data-shf="${s}.letter" value="${esc(SHIFTS[s].letter)}" maxlength="2" ${dis} aria-label="ตัวย่อ"></div>`).join('')}</div>
  </div>
  <div class="card"><h3>วันหยุดนักขัตฤกษ์ ${monthTitle()}</h3><p class="hint">แตะวันที่เพื่อเพิ่ม/ลบวันหยุด (วันหยุดราชการแบบวันที่ตายตัวใส่ให้แล้ว วันพระ เช่น มาฆบูชา ให้แตะเพิ่มเอง)</p>
    <div class="cal">${cal}</div></div>
  <div class="card"><h3>หัวกระดาษใบลงเวลา (รูป PNG รายคน)</h3>
    ${pin('l1','บรรทัดที่ 1')}${pin('l2','บรรทัดที่ 2')}${pin('l3','บรรทัดที่ 3')}${pin('unitPrefix','คำหน้าชื่อแผนก')}${pin('mark','คำในช่องวันที่มีเวร')}
    ${isAdmin()?`<hr style="border:0;border-top:1px solid var(--line);margin:18px 0 6px"><h3>ข้อมูลแผนก (แอดมิน)</h3>
    <label class="lb">ชื่อแผนก</label><input class="textin" id="deptIn" value="${esc(state.dept)}">
    <button class="btn btn-danger" id="delUnitBtn" style="margin-top:12px">ลบแผนกนี้</button>`:''}
  </div>`;
  const Bx=$('#settingsBox');
  Bx.querySelectorAll('[data-st]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.st,dir=+b.dataset.dir;pushUndo();
    if(k.includes('.')){const [g,p]=k.split('.');r[g][p]=Math.min(3,Math.max(0,(r[g][p]||0)+dir));}else r[k]=Math.min(31,Math.max(0,r[k]+dir));
    addLog('แก้กฎ/รูปแบบเวร');markDirty();renderAll();});
  Bx.querySelectorAll('[data-sw]').forEach(b=>b.onclick=()=>{pushUndo();r[b.dataset.sw]=!r[b.dataset.sw];addLog('แก้กฎ/รูปแบบเวร');markDirty();renderAll()});
  Bx.querySelectorAll('[data-sh]').forEach(b=>b.onclick=()=>{pushUndo();const arr=r[b.dataset.sh];const v=b.dataset.v;const i=arr.indexOf(v);if(i>=0)arr.splice(i,1);else arr.push(v);addLog('แก้กฎ/รูปแบบเวร');markDirty();renderAll()});
  Bx.querySelectorAll('[data-shf]').forEach(inp=>inp.onchange=()=>{const [s,f]=inp.dataset.shf.split('.');const v=inp.value.trim();if(!v){renderSettings();return}pushUndo();SHIFTS[s][f]=v;markDirty();renderAll()});
  Bx.querySelectorAll('[data-paper]').forEach(inp=>inp.onchange=()=>{pushUndo();state.paper[inp.dataset.paper]=inp.value.trim();markDirty()});
  Bx.querySelectorAll('[data-hol]').forEach(b=>b.onclick=()=>{
    const iso=b.dataset.hol;
    if(holidayName(iso)){pushUndo();state.holidayOverrides[iso]='';addLog('ยกเลิกวันหยุด '+shortDate(iso));markDirty();renderAll();return}
    openModal('เพิ่มวันหยุด '+shortDate(iso),`<label class="lb" style="margin-top:0">ชื่อวันหยุด</label><input class="textin" id="holName" placeholder="เช่น วันมาฆบูชา">`,
      `<button class="btn btn-line" data-close>ยกเลิก</button><button class="btn btn-primary" id="holOk">เพิ่มวันหยุด</button>`);
    $('#holName').focus();
    $('#holOk').onclick=()=>{pushUndo();state.holidayOverrides[iso]=$('#holName').value.trim()||'วันหยุด';addLog('เพิ่มวันหยุด '+shortDate(iso));markDirty();closeModal();renderAll();};
  });
  bindRotationCard(Bx);bindConflictCard(Bx);
  const di=$('#deptIn');if(di)di.onchange=()=>{state.dept=di.value.trim()||state.dept;markDirty();renderHeader()};
  const du=$('#delUnitBtn');if(du)du.onclick=()=>deleteUnit(unitId,state.dept);
}
/* ---------- การ์ดคิวหมุนเวร ---------- */
function rotList(kind,create){
  const r=state.rules;
  if(!r.rotation){if(!create)return [];r.rotation={on:false,start:'',otrn:[],otpn:[],hol:{senior:[],junior:[],pn:[]}};}
  const R=r.rotation;if(kind.hol){R.hol=R.hol||{};return R.hol[kind.slot]=R.hol[kind.slot]||[];}
  return R[kind.slot]=R[kind.slot]||[];
}
function rotationCard(dis){
  const R=state.rules.rotation||{};const on=!!R.on;
  const lists=ROT_KINDS.map((kind,ki)=>{
    const list=rotList(kind);const next=on?rotStartQueue(kind).slice(0,3):[];
    const rest=state.staff.filter(s=>eligible(s,kind.slot)&&!list.includes(s.id));
    if(!list.length){const def=rotDefault(kind);
      return `<details class="rotk" style="margin-top:8px"><summary><b>${esc(kind.label)}</b> <span class="hint">(ยังไม่ได้ตั้งลำดับ · ใช้ลำดับรายชื่อ ${def.length} คน)</span></summary>
        ${def.length?`<p class="hint" style="margin:6px 0">ระบบใช้ลำดับตามรายชื่อในแผนก: ${def.map(id=>esc(firstName(id))).join(' → ')}</p>
        ${dis?'':`<button class="btn btn-line" data-rfill="${ki}">ใส่ทั้ง ${def.length} คนลงคิว เพื่อเรียงลำดับเอง</button>`}`
        :`<p class="hint" style="margin:6px 0">ยังไม่มีคนที่${kind.hol?'อยู่เวรประจำตำแหน่งนี้':'รับ OT ตำแหน่งนี้ได้'} — เพิ่มรายชื่อ หรือเปิด “${kind.hol?'อยู่ในเวรประจำ (OC)':'รับ OT ได้'}” ที่ชื่อคนในแท็บ 2</p>`}</details>`;}
    return `<details class="rotk" style="margin-top:8px"><summary><b>${esc(kind.label)}</b> <span class="hint">(${list.length} คน${next.length?` · ต้นเดือนนี้เริ่มที่ ${next.map(id=>esc(firstName(id))).join(' → ')}`:''})</span></summary>
      <div style="margin:6px 0">${list.map((id,i)=>`<div class="rotrow"><span class="no">${i+1}.</span><span class="nm">${esc(person(id)?person(id).name:'(ไม่พบชื่อ)')}</span>
        ${ordBtns('data-rmv',`${ki}|${i}|-1`,`${ki}|${i}|1`,i>0,i<list.length-1,dis)}<button class="icox" data-rdel="${ki}|${i}" ${dis} aria-label="เอาออกจากคิว" title="เอาออกจากคิว">${ICON_X}</button></div>`).join('')}</div>
      ${rest.length&&!dis?`<select class="textin" data-radd="${ki}"><option value="">+ เพิ่มคนท้ายคิว</option>${rest.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>`:''}</details>`}).join('');
  return `<div class="card"><h3>คิวหมุนเวร</h3><p class="hint">เปิดแล้ว ปุ่มจัดอัตโนมัติจะจัด <b>OT</b> และ <b>เวรประจำวันนักขัตฤกษ์</b> ตามลำดับคิว (วันละ 1 คนต่อช่อง) · คิวนักขัตฤกษ์รวมเสาร์-อาทิตย์ที่ติดกับวันนักขัตฤกษ์ และถ้าห่างกันแค่ 1 วันทำงาน วันทำงานที่คั่นกับเสาร์-อาทิตย์นั้นก็เข้าคิวด้วย · คนที่ถึงคิวแต่ลา/ติดเวรวันนั้นจะถูกข้าม และได้วันถัดไปแทน · คิวต่อจากเดือนก่อนอัตโนมัติ · ช่องที่แก้มือนับว่าคนนั้นใช้คิวแล้ว</p>
    <div class="row"><label>ใช้คิวหมุนเวร<small>ปิด = ระบบเกลี่ยจำนวนเวรเหมือนเดิม</small></label><button class="switch ${on?'on':''}" id="rotOn" aria-label="เปิด/ปิด" ${dis}></button></div>
    <div class="row"><label>เริ่มหมุนตั้งแต่วันที่<small>ก่อนวันนี้ระบบจัดแบบเดิม</small></label><input type="date" class="textin" id="rotStartIn" style="max-width:180px" value="${esc(R.start||'')}" ${dis}></div>
    ${lists}</div>`;
}
function bindRotationCard(Bx){
  const ch=()=>{addLog('แก้คิวหมุนเวร');markDirty();renderAll()};
  const ro=$('#rotOn');if(ro)ro.onclick=()=>{pushUndo();rotList(ROT_KINDS[0],true);state.rules.rotation.on=!state.rules.rotation.on;ch()};
  const rs=$('#rotStartIn');if(rs)rs.onchange=()=>{pushUndo();rotList(ROT_KINDS[0],true);state.rules.rotation.start=rs.value;ch()};
  Bx.querySelectorAll('[data-rmv]').forEach(b=>b.onclick=()=>{const [ki,i,d]=b.dataset.rmv.split('|').map(Number);pushUndo();const l=rotList(ROT_KINDS[ki],true);[l[i],l[i+d]]=[l[i+d],l[i]];ch()});
  Bx.querySelectorAll('[data-rdel]').forEach(b=>b.onclick=()=>{const [ki,i]=b.dataset.rdel.split('|').map(Number);pushUndo();rotList(ROT_KINDS[ki],true).splice(i,1);ch()});
  Bx.querySelectorAll('[data-rfill]').forEach(b=>b.onclick=()=>{const kind=ROT_KINDS[+b.dataset.rfill];pushUndo();const l=rotList(kind,true);l.push(...rotDefault(kind).filter(id=>!l.includes(id)));ch()});
  Bx.querySelectorAll('[data-radd]').forEach(s=>s.onchange=()=>{if(!s.value)return;pushUndo();rotList(ROT_KINDS[+s.dataset.radd],true).push(s.value);ch()});
  // คงสถานะเปิด/ปิดของรายการคิวหลัง render ใหม่
  Bx.querySelectorAll('details.rotk').forEach((d,i)=>{d.open=!!(window.__rotOpen||{})[i];d.ontoggle=()=>{(window.__rotOpen=window.__rotOpen||{})[i]=d.open}});
}
/* ---------- การ์ดกฎห้ามอยู่เวรร่วมกัน (rules.conflicts) ---------- */
const slotName=s=>s==='any'?'ช่องใดก็ได้':'ช่อง '+SLOTM[s].short;
const namesOf=ids=>(ids||[]).map(id=>person(id)?firstName(id):'(ไม่พบชื่อ)').join(', ')||'—';
function conflictCard(dis){
  const cs=state.rules.conflicts||[];
  return `<div class="card"><h3>กฎห้ามอยู่เวรร่วมกัน</h3><p class="hint">เช่น คนที่เพิ่งย้ายมาตำแหน่งใหม่ ห้ามอยู่วันเดียวกับคนใหม่อีกคน · ระบบจัดอัตโนมัติจะหลีกเลี่ยง และขึ้นเตือนถ้าแก้มือแล้วผิดกฎ</p>
    ${cs.length?`<ol style="margin:6px 0 10px 18px;padding:0">${cs.map((c,i)=>`<li style="margin:6px 0"><b>${esc(namesOf(c.a))}</b> <span class="hint">(${slotName(c.aSlot||'any')})</span>
      ห้ามอยู่${c.scope==='shift'?'เวรเดียวกัน':'วันเดียวกัน'}กับ <b>${esc(namesOf(c.b))}</b> <span class="hint">(${slotName(c.bSlot||'any')})</span>${c.note?` <span class="hint">· ${esc(c.note)}</span>`:''}
      <button class="btn btn-line" style="padding:0 8px" data-cedit="${i}" ${dis}>แก้</button><button class="icox" style="vertical-align:middle" data-cdel="${i}" ${dis} aria-label="ลบกฎ" title="ลบกฎ">${ICON_X}</button></li>`).join('')}</ol>`:'<p class="hint">ยังไม่มีกฎ</p>'}
    <button class="btn btn-primary" id="addConflict" ${dis}>+ เพิ่มกฎ</button></div>`;
}
function openConflict(i){
  const cs=state.rules.conflicts||[];const c=i==null?{a:[],aSlot:'any',b:[],bSlot:'any',scope:'day',note:''}:cs[i];
  const slotSel=(id,v)=>`<select class="textin" id="${id}"><option value="any">ช่องใดก็ได้</option>${SLOTS.map(s=>`<option value="${s.key}" ${v===s.key?'selected':''}>${esc(s.short)} — ${esc(s.label)}</option>`).join('')}</select>`;
  const checks=(g,sel)=>`<div class="cands" style="max-height:220px;overflow:auto">${POS.map(p=>{const l=staffOf(p.key);return l.length?`<div class="hint" style="margin-top:6px">${esc(p.label)}</div>`+l.map(s=>`<label style="display:block;padding:2px 0"><input type="checkbox" data-g="${g}" value="${s.id}" ${sel.includes(s.id)?'checked':''}> ${esc(s.name)}</label>`).join(''):''}).join('')}</div>`;
  openModal(i==null?'เพิ่มกฎห้ามอยู่เวรร่วมกัน':'แก้กฎห้ามอยู่เวรร่วมกัน',`
    <label class="lb" style="margin-top:0">กลุ่มที่ 1 — เลือกชื่อ</label>${checks('a',c.a||[])}
    <label class="lb">กลุ่มที่ 1 อยู่ในช่อง</label>${slotSel('cfASlot',c.aSlot||'any')}
    <label class="lb">ห้ามอยู่</label><select class="textin" id="cfScope"><option value="day">วันเดียวกัน</option><option value="shift" ${c.scope==='shift'?'selected':''}>เวรเดียวกัน (เช้า/เย็น เดียวกัน)</option></select>
    <label class="lb">กับกลุ่มที่ 2 — เลือกชื่อ</label>${checks('b',c.b||[])}
    <label class="lb">กลุ่มที่ 2 อยู่ในช่อง</label>${slotSel('cfBSlot',c.bSlot||'any')}
    <label class="lb">หมายเหตุ (ไม่บังคับ)</label><input class="textin" id="cfNote" value="${esc(c.note||'')}" placeholder="เช่น เพิ่งย้ายมาตำแหน่ง Senior">`,
    `<button class="btn btn-line" data-close>ยกเลิก</button><button class="btn btn-primary" id="cfOk">บันทึกกฎ</button>`);
  $('#cfOk').onclick=()=>{
    const pick=g=>[...document.querySelectorAll(`#mBody input[data-g="${g}"]:checked`)].map(x=>x.value);
    const v={a:pick('a'),aSlot:$('#cfASlot').value,b:pick('b'),bSlot:$('#cfBSlot').value,scope:$('#cfScope').value,note:$('#cfNote').value.trim()};
    if(!v.a.length||!v.b.length){toast('เลือกชื่ออย่างน้อย 1 คนในแต่ละกลุ่ม');return}
    pushUndo();state.rules.conflicts=cs.slice();if(i==null)state.rules.conflicts.push(v);else state.rules.conflicts[i]=v;
    addLog('แก้กฎห้ามอยู่เวรร่วมกัน');markDirty();closeModal();renderAll();toast('บันทึกกฎแล้ว — กดจัดเวรอัตโนมัติใหม่เพื่อใช้กฎนี้');
  };
}
function bindConflictCard(Bx){
  const ab=$('#addConflict');if(ab)ab.onclick=()=>openConflict(null);
  Bx.querySelectorAll('[data-cedit]').forEach(b=>b.onclick=()=>openConflict(+b.dataset.cedit));
  Bx.querySelectorAll('[data-cdel]').forEach(b=>b.onclick=()=>{pushUndo();state.rules.conflicts=(state.rules.conflicts||[]).filter((_,i)=>i!==+b.dataset.cdel);addLog('ลบกฎห้ามอยู่เวรร่วมกัน');markDirty();renderAll()});
}
function deleteUnit(id,name){
  confirmBox('ลบแผนก '+esc(name)+'?','รายชื่อ กฎ และตารางเวรทั้งหมดของแผนกนี้จะเข้าถึงไม่ได้อีก และบัญชีที่ผูกกับแผนกนี้จะเข้าระบบไม่ได้จนกว่าจะผูกแผนกใหม่ — ย้อนกลับไม่ได้',[
    {label:'ยกเลิก'},{label:'ลบแผนก',cls:'btn-danger',fn:async()=>{
      if(unitId===id){clearTimeout(saveTimer);saveTimer=null;unsubs.forEach(f=>f());unsubs=[];unitId=null;}
      try{await B.delUnit(id);toast('ลบแผนกแล้ว')}catch(e){toast('ลบไม่สำเร็จ')}goUnits();}}]);
}

/* ---------- admin: units (การ์ด) ---------- */
const UNIT_ICONS=['<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>','<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>','<path d="M4 20V9l8-5 8 5v11"/><path d="M10 20v-5h4v5M12 8v4M10 10h4"/>','<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z"/>'];
const UNIT_TINT=[['#EEF0FD','#4F5BD5'],['#E7F6F7','#0E8A93'],['#FFF2E2','#C27C0E'],['#FCEBEF','#C2416B']];
function whenText(t){if(!t||t<1e10)return 'ยังไม่มีการแก้ไข';const d=new Date(t);return `แก้ไขล่าสุด ${pad(d.getHours())}:${pad(d.getMinutes())} น., ${d.getDate()} ${TH_MS[d.getMonth()]}`}
async function renderUnits(){
  const box=$('#unitCards');box.innerHTML='<p class="hint">กำลังโหลด…</p>';
  let units=[];try{units=await B.listUnits()}catch(e){box.innerHTML='<p class="hint">โหลดรายชื่อแผนกไม่สำเร็จ</p>';return}
  units.sort((a,b)=>(a.name||'').localeCompare(b.name||'','th'));
  const nm=nextMonthFromToday();const ym=ymOf(nm.y,nm.m);
  $('#unitsHint').textContent=`ทั้งหมด ${units.length} แผนก · สถานะคือเดือน ${TH_M[nm.m]} ${be(nm.y)}`;
  box.innerHTML=units.map((u,i)=>{const t=UNIT_TINT[i%4];return `<div class="fcard" data-unit="${esc(u.id)}" tabindex="0" role="button" aria-label="เปิดแผนก ${esc(u.name)}">
    <div class="fc-top"><div class="fc-icon" style="background:${t[0]};color:${t[1]}"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${UNIT_ICONS[i%4]}</svg></div>
      <div class="fc-right"><button class="fc-menu" data-menu="${esc(u.id)}" aria-label="ตัวเลือก"><svg width="8" height="22" viewBox="0 0 8 22" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="4" cy="3" r="2.2"/><circle cx="4" cy="11" r="2.2"/><circle cx="4" cy="19" r="2.2"/></svg></button>
      <div class="fc-stat">${(u.staff||[]).length} คน</div></div></div>
    <div class="fc-name">${esc(u.name)}</div><div class="fc-sub">${whenText(u.updatedAt)}</div>
    <span class="st no" id="st-${esc(u.id)}">กำลังตรวจ…</span>
    <div class="fc-pop" id="pop-${esc(u.id)}" hidden><button data-act="open">เปิดแผนก</button><button data-act="rename">เปลี่ยนชื่อ</button><button data-act="del" class="dg">ลบแผนก</button></div></div>`}).join('')+
    `<button class="fcard add" id="addUnitCard"><div class="fc-icon" style="background:#EEF0FD;color:#4F5BD5"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></div><div class="fc-name">เพิ่มแผนกใหม่</div></button>`;
  box.querySelectorAll('.fcard[data-unit]').forEach(c=>{const id=c.dataset.unit;
    c.onclick=e=>{if(e.target.closest('.fc-menu,.fc-pop'))return;openUnit(id)};
    c.onkeydown=e=>{if(e.key==='Enter')openUnit(id)};});
  box.querySelectorAll('[data-menu]').forEach(b=>b.onclick=e=>{e.stopPropagation();const p=document.getElementById('pop-'+b.dataset.menu);const was=p.hidden;document.querySelectorAll('.fc-pop').forEach(x=>x.hidden=true);p.hidden=!was;});
  box.querySelectorAll('.fc-pop button').forEach(b=>b.onclick=e=>{e.stopPropagation();const id=b.closest('.fcard').dataset.unit;const u=units.find(z=>z.id===id);b.parentElement.hidden=true;
    if(b.dataset.act==='open')openUnit(id);
    if(b.dataset.act==='del')deleteUnit(id,u.name);
    if(b.dataset.act==='rename'){openModal('เปลี่ยนชื่อแผนก',`<label class="lb" style="margin-top:0">ชื่อใหม่</label><input class="textin" id="rnName" value="${esc(u.name)}">`,`<button class="btn btn-line" data-close>ยกเลิก</button><button class="btn btn-primary" id="rnOk">บันทึก</button>`);
      $('#rnOk').onclick=async()=>{const v=$('#rnName').value.trim();if(!v)return;try{await B.saveUnit(id,{...(({id:_x,...rest})=>rest)(u),name:v,updatedAt:Date.now(),updatedBy:session.user.email});closeModal();renderUnits();renderUsers();toast('เปลี่ยนชื่อแล้ว')}catch(e){toast('ไม่สำเร็จ')}}}});
  $('#addUnitCard').onclick=()=>addUnit(units);
  units.forEach(async u=>{const el=document.getElementById('st-'+u.id);if(!el)return;
    try{const m=await B.getMonth(u.id,ym);const n=m&&m.assign?Object.keys(m.assign).length:0;
      el.className='st '+(n?'ok':'no');el.textContent=n?`${TH_MS[nm.m]} จัดแล้ว ${n} ช่อง`:`${TH_MS[nm.m]} ยังไม่ได้จัด`;}catch(e){el.textContent='—'}});
}
document.addEventListener('click',()=>document.querySelectorAll('.fc-pop').forEach(x=>x.hidden=true));
function addUnit(units){
  openModal('เพิ่มแผนกใหม่',`
    <label class="lb" style="margin-top:0">ชื่อแผนก</label><input class="textin" id="nuName" placeholder="เช่น หอผู้ป่วยศัลยกรรมชาย">
    <label class="lb">กฎและรูปแบบเวร</label>
    <select class="textin" id="nuCopy"><option value="">ใช้ค่าเริ่มต้น</option><option value="preset2570">${esc(PRESET_2570.label)}</option>${units.map(u=>`<option value="${esc(u.id)}">คัดลอกจาก ${esc(u.name)}</option>`).join('')}</select>
    <p class="hint">สร้างเสร็จแล้วไปเพิ่มรายชื่อและแก้กฎได้ในแผนกนั้น</p>`,
    `<button class="btn btn-line" data-close>ยกเลิก</button><button class="btn btn-primary" id="nuOk">สร้างแผนก</button>`);
  $('#nuName').focus();
  $('#nuOk').onclick=async()=>{
    const name=$('#nuName').value.trim();if(!name){toast('กรุณาใส่ชื่อแผนก');return}
    const src=units.find(u=>u.id===$('#nuCopy').value);const id='u'+Date.now().toString(36);
    const data={name,staff:[],rules:src?src.rules:defaultRules(),shifts:src?src.shifts:defaultShifts(),paper:src&&src.paper?src.paper:defaultPaper(),holidayOverrides:{},updatedAt:Date.now(),updatedBy:session.user.email};
    if($('#nuCopy').value==='preset2570')Object.assign(data,buildPreset2570());
    try{await B.saveUnit(id,JSON.parse(JSON.stringify(data)));closeModal();toast('สร้างแผนก '+name+' แล้ว');openUnit(id);}catch(e){toast('สร้างไม่สำเร็จ: '+(e.code||e.message))}
  };
}

/* ---------- admin: users ---------- */
async function renderUsers(){
  const t=$('#userTable');t.innerHTML='<tr><td class="hint">กำลังโหลด…</td></tr>';
  let roles=[],units=[];try{[roles,units]=await Promise.all([B.listRoles(),B.listUnits()])}catch(e){t.innerHTML='<tr><td>โหลดไม่สำเร็จ</td></tr>';return}
  const um=Object.fromEntries(units.map(u=>[u.id,u]));const ord={admin:0,head:1,nurse:2};
  roles.sort((a,b)=>(ord[a.role]-ord[b.role])||a.email.localeCompare(b.email));
  const who=r=>{const u=um[r.unitId];if(r.role==='admin')return 'ทุกแผนก';if(!u)return '⚠ ไม่พบแผนก';
    if(r.role==='nurse'){const s=(u.staff||[]).find(x=>x.id===r.staffId);return esc(u.name)+'<br><span class="hint">'+(s?'คุณ'+esc(s.name):'⚠ ไม่พบชื่อในแผนก')+'</span>'}return esc(u.name)};
  t.innerHTML=`<thead><tr><th>อีเมล</th><th>ชื่อที่แสดง</th><th>สิทธิ์</th><th>แผนก / ชื่อ</th><th>แก้กฎได้</th><th></th></tr></thead><tbody>`+
    roles.map(r=>`<tr><td><b>${esc(r.email)}</b></td><td>${esc(r.name||'')}</td><td><span class="role ${r.role==='admin'?'admin':''}" style="border:1px solid var(--line)">${ROLE_TH[r.role]||r.role}</span></td>
      <td>${who(r)}</td><td>${r.role==='admin'?'✓':r.role==='head'&&r.canEditRules?'✓':'—'}</td>
      <td style="white-space:nowrap"><button class="btn btn-line btn-small" data-ue="${esc(r.email)}">แก้ไข</button></td></tr>`).join('')+'</tbody>';
  t.querySelectorAll('[data-ue]').forEach(b=>b.onclick=()=>editUser(roles.find(r=>r.email===b.dataset.ue),units));
  $('#addUserBtn').onclick=()=>editUser(null,units);
}
function editUser(r,units){
  const isNew=!r;r=r||{email:'',role:'head',unitId:units[0]&&units[0].id,canEditRules:false,name:''};
  const self=session.user.email===r.email;
  openModal(isNew?'เพิ่มผู้ใช้':'แก้ไขสิทธิ์ '+r.email,`
    <label class="lb" style="margin-top:0">อีเมล (ต้องตรงกับบัญชีที่สร้างใน Firebase)</label>
    <input class="textin" id="ueEmail" type="email" value="${esc(r.email)}" ${isNew?'':'disabled'}>
    <label class="lb">ชื่อที่แสดง</label>
    <input class="textin" id="ueName" value="${esc(r.name||'')}" placeholder="เช่น หัวหน้าห้องผ่าตัดโสตฯ">
    <label class="lb">สิทธิ์</label>
    <div class="toggles" id="ueRole">
      <button class="tbtn" data-v="admin" ${self?'disabled':''}>แอดมิน (ทุกแผนก)</button>
      <button class="tbtn" data-v="head" ${self?'disabled':''}>หัวหน้าแผนก</button>
      <button class="tbtn" data-v="nurse" ${self?'disabled':''}>พยาบาล / เจ้าหน้าที่</button></div>
    <div id="ueUnitBox"><label class="lb">แผนก</label>
      <select class="textin" id="ueUnit">${units.map(u=>`<option value="${esc(u.id)}" ${u.id===r.unitId?'selected':''}>${esc(u.name)}</option>`).join('')}</select></div>
    <div id="ueHead"><div class="row" style="border:0"><label>อนุญาตให้แก้กฎและรูปแบบเวรของแผนก<small>ปิดไว้ = แก้ได้เฉพาะตารางเวร รายชื่อ วันลา</small></label><button class="switch ${r.canEditRules?'on':''}" id="ueRules"></button></div></div>
    <p class="hint" id="ueNurse">พยาบาล / เจ้าหน้าที่: ใส่ "ชื่อที่แสดง" ให้ตรงกับชื่อในรายชื่อแผนก (ไม่ต้องใส่คำนำหน้า) ระบบจะผูกบัญชีให้อัตโนมัติ</p>
    ${self?'<p class="hint">ไม่สามารถเปลี่ยนสิทธิ์หรือลบบัญชีของตัวเองได้</p>':''}`,
    `${!isNew&&!self?'<button class="btn btn-danger" id="ueDel">ถอนสิทธิ์</button>':''}<button class="btn btn-line" data-close>ยกเลิก</button><button class="btn btn-primary" id="ueOk">บันทึก</button>`);
  let role=r.role,rules=!!r.canEditRules;
  const normName=x=>String(x||'').replace(/^\s*(คุณ|นางสาว|น\.ส\.|นาง|นาย)\s*/,'').replace(/\s+/g,' ').trim();
  const sync=()=>{$('#ueUnitBox').hidden=role==='admin';$('#ueHead').hidden=role!=='head';$('#ueNurse').hidden=role!=='nurse';$('#ueRole').querySelectorAll('.tbtn').forEach(b=>b.classList.toggle('on',b.dataset.v===role))};
  sync();
  $('#ueRole').querySelectorAll('.tbtn').forEach(b=>b.onclick=()=>{role=b.dataset.v;sync()});
  $('#ueRules').onclick=()=>{rules=!rules;$('#ueRules').classList.toggle('on',rules)};
  $('#ueOk').onclick=async()=>{
    const email=$('#ueEmail').value.trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){toast('อีเมลไม่ถูกต้อง');return}
    if(role!=='admin'&&!$('#ueUnit').value){toast('กรุณาสร้างแผนกก่อน');return}
    const nm=$('#ueName').value.trim();
    let staffId='';
    if(role==='nurse'){
      if(!nm){toast('กรุณาใส่ชื่อที่แสดง (ต้องตรงกับชื่อในรายชื่อแผนก)');return}
      const u=units.find(z=>z.id===$('#ueUnit').value);
      const m=((u&&u.staff)||[]).filter(x=>normName(x.name)===normName(nm));
      if(m.length!==1){toast(m.length?'มีชื่อซ้ำในแผนก ไม่สามารถผูกอัตโนมัติได้':'ไม่พบชื่อนี้ในรายชื่อแผนก ให้หัวหน้าแผนกเพิ่มชื่อในแท็บ 2 ก่อน');return}
      staffId=m[0].id;
    }
    const v=role==='admin'?{role:'admin',name:nm}:role==='head'?{role:'head',unitId:$('#ueUnit').value,canEditRules:rules,name:nm}
      :{role:'nurse',unitId:$('#ueUnit').value,staffId,name:nm};
    try{await B.setRole(email,v);closeModal();toast('บันทึกสิทธิ์ของ '+email+' แล้ว');renderUsers();}catch(e){toast('บันทึกไม่สำเร็จ: '+(e.code||e.message))}
  };
  const del=$('#ueDel');if(del)del.onclick=()=>confirmBox('ถอนสิทธิ์ '+esc(r.email)+'?','บัญชีนี้จะเข้าระบบจัดเวรไม่ได้อีก (บัญชีอีเมลใน Firebase ยังอยู่ ลบได้ที่ Firebase Console)',[
    {label:'ยกเลิก'},{label:'ถอนสิทธิ์',cls:'btn-danger',fn:async()=>{try{await B.delRole(r.email);toast('ถอนสิทธิ์แล้ว');renderUsers()}catch(e){toast('ไม่สำเร็จ')}}}]);
}

/* ---------- wiring ---------- */
function renderAll(){if(!unitId)return;renderHeader();renderSchedule();renderPeople();renderReport();renderSettings();}
document.querySelectorAll('[data-tab]').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===t));
  document.querySelectorAll('#appView .panel').forEach(p=>p.classList.toggle('show',p.id==='tab-'+t.dataset.tab));});
document.querySelectorAll('[data-utab]').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('[data-utab]').forEach(x=>x.classList.toggle('active',x===t));
  document.querySelectorAll('#unitsView .panel').forEach(p=>p.classList.toggle('show',p.id==='utab-'+t.dataset.utab));});
$('#prevM').onclick=()=>changeMonth(-1);
$('#nextM').onclick=()=>changeMonth(1);
$('#undoBtn').onclick=undo;

/* ---------- รายชื่อตัวอย่าง (ไว้สอน / ลองเล่น) ---------- */
const MOCK_STAFF=[
  ['senior','กนกพร ศรีสวัสดิ์',{prefix:'นาง',posLabel:'Sup.',oc:false,ot:false}],['senior','วิไลวรรณ ทองประเสริฐ',{posLabel:'CLA',oc:false,ot:false}],
  ['senior','ดารารัตน์ สุขสว่าง'],['senior','พิมพ์ชนก ศรีวงศ์'],['senior','วันเพ็ญ ทองดี'],['senior','สุดารัตน์ มานะกุล'],['senior','วิภาวรรณ แสงทอง'],['senior','กนกวรรณ รุ่งเรือง'],
  ['junior','ชุติมา ใจดี'],['junior','นงนุช บุญมา'],['junior','กัญญารัตน์ สืบสาย'],['junior','ปัณณพร ดวงดี'],['junior','พรรณี มีสุข'],['junior','ธิดารัตน์ แก้วใส'],['junior','ศศิธร พรหมมา'],['junior','อรอุมา ชัยวัฒน์'],['junior','ณัฐธิดา วงศ์ใหญ่'],['junior','เบญจมาศ สายทอง'],
  ['junior','อภิสรา นาคสวัสดิ์',{oc:false}],['junior','นันทนา พรหมดี',{oc:false}],
  ['pn','อำไพ ชื่นจิต',{prefix:'นาง',oc:false}],['pn','ปิยวรรณ เหล่าดี',{oc:false}],['pn','จีรนันท์ ทองคำ'],['pn','วรารัตน์ คำแก้ว',{prefix:'นาง'}],['pn','กิตติยา ประเสริฐ'],['pn','สุนิสา แสนดี'],['pn','ปิยะนุช ศรีสุข'],['pn','อัมพร อ่อนศรี']];
const hasMock=()=>state.staff.some(s=>s.mock);
function addMockStaff(){
  pushUndo();
  MOCK_STAFF.forEach(([pos,name,o],i)=>state.staff.push(Object.assign({id:'mock-'+(i+1),name,pos,prefix:'น.ส.',oc:true,ot:true,mock:true},o||{})));
  [['mock-3',[14,15,16]],['mock-9',[24,25]],['mock-23',[28]]].forEach(([id,ds])=>{state.unavail[id]={};ds.forEach(d=>state.unavail[id][isoOf(state.year,state.month,d)]=true)});
  addLog('ใส่รายชื่อตัวอย่าง '+MOCK_STAFF.length+' คน');
  markDirty();renderAll();toast('ใส่รายชื่อตัวอย่างแล้ว — กด “ย้อนกลับ” มุมขวาบนเพื่อยกเลิก');
}
/* ลบถาวร: ตัดชื่อออกจากแผนก + ลบเวรของคนนี้ในตารางทุกเดือน + ลบเอกสารวันไม่ว่าง ออกจากฐานข้อมูลจริง */
async function purgeStaff(idList,label){
  const ids=new Set(idList);if(!ids.size)return;
  clearTimeout(saveTimer);saveTimer=null;
  const before=snapshot(),beforeLegacy=JSON.stringify(legacyAssign),beforeLastLeave={...lastLeave};
  state.staff=state.staff.filter(s=>!ids.has(s.id));
  if(state.rules.rotation)ROT_KINDS.forEach(kind=>{const l=rotList(kind,true);l.splice(0,l.length,...l.filter(id=>!ids.has(id)))});
  if(state.rules.conflicts)state.rules.conflicts=state.rules.conflicts.map(c=>({...c,a:c.a.filter(id=>!ids.has(id)),b:c.b.filter(id=>!ids.has(id))})).filter(c=>c.a.length&&c.b.length);
  for(const k in state.assign)if(state.assign[k]&&ids.has(state.assign[k].id))delete state.assign[k];
  for(const k in legacyAssign)if(legacyAssign[k]&&ids.has(legacyAssign[k].id))delete legacyAssign[k];
  ids.forEach(id=>{delete state.unavail[id];delete lastLeave[id]});
  undoStack=[];addLog(label);renderAll();
  saving=true;setSave('saving');
  try{
    const at=Date.now(),by=session.user.email,cur=monthPrefix(),changed={};
    const months=await B.listMonths(unitId);           // เดือนอื่น ๆ ทั้งหมด
    changed[cur]={...monthPayload(),updatedAt:at,updatedBy:by};
    for(const ym in months){if(ym===cur)continue;
      const as=(months[ym]&&months[ym].assign)||{};const keep={};let hit=false;
      for(const k in as){if(as[k]&&ids.has(as[k].id))hit=true;else keep[k]=as[k]}
      if(hit)changed[ym]={...months[ym],assign:keep,updatedAt:at,updatedBy:by};}
    await B.purgeStaff(unitId,{...unitPayload(),updatedAt:at,updatedBy:by},changed,[...ids]);
    lastUnitJson=JSON.stringify(unitPayload());lastUnitAt=at;
    lastMonthJson=JSON.stringify(monthPayload());lastMonthAt=at;
    HIST={};await loadHistory();renderAll();setSave('saved');
    toast('ลบ '+ids.size+' คนออกจากฐานข้อมูลแล้ว');
  }catch(e){
    console.error(e);Object.assign(state,JSON.parse(before));legacyAssign=JSON.parse(beforeLegacy);SHIFTS=state.shifts;lastLeave=beforeLastLeave;
    renderAll();setSave('error',e&&e.code);toast('ลบไม่สำเร็จ — ข้อมูลเดิมยังอยู่ครบ');
  }finally{saving=false}
}
const removeMockStaff=all=>purgeStaff(state.staff.filter(s=>all||s.mock).map(s=>s.id),(all?'ลบรายชื่อทั้งหมด ':'ลบรายชื่อตัวอย่าง ')+state.staff.filter(s=>all||s.mock).length+' คน');
$('#mockBtn').onclick=()=>{
  if(hasMock()){toast('มีรายชื่อตัวอย่างอยู่แล้ว — ลบก่อนถ้าต้องการใส่ใหม่');return}
  const btns=[{label:'ยกเลิก'},{label:'ใส่รายชื่อตัวอย่าง',cls:'btn-primary',fn:()=>addMockStaff()}];
  confirmBox('ใส่รายชื่อตัวอย่าง?','จะเพิ่มพยาบาลตัวอย่าง '+MOCK_STAFF.length+' คน (ซีเนียร์ จูเนียร์ ผู้ช่วย) พร้อมวันไม่ว่างตัวอย่าง รายชื่อเดิมของแผนกไม่ถูกแตะ · ยกเลิกได้ด้วยปุ่ม “ย้อนกลับ”',btns);
};
$('#mockClearBtn').onclick=()=>{
  const nm=state.staff.filter(x=>x.mock).length,n=state.staff.length;
  if(!n){toast('ไม่มีรายชื่อให้ลบ');return}
  const btns=[{label:'ยกเลิก'}];
  if(nm&&nm<n)btns.push({label:'ลบเฉพาะตัวอย่าง ('+nm+')',cls:'btn-danger',fn:()=>removeMockStaff(false)});
  btns.push({label:'ลบรายชื่อทั้งหมด ('+n+')',cls:'btn-danger',fn:()=>removeMockStaff(true)});
  confirmBox('ลบรายชื่อถาวร?','ลบออกจากฐานข้อมูลทั้งหมด — ชื่อในแผนก เวรในตารางทุกเดือน และวันไม่ว่างของคนเหล่านั้น <b>กู้คืนไม่ได้</b>'+(nm&&nm<n?' · “เฉพาะตัวอย่าง” เก็บรายชื่อจริงไว้':''),btns);
};
$('#backBtn').onclick=goUnits;
$('#logoutBtn').onclick=async()=>{await saveNow();B.signOut()};
$('#pngDailyBtn').onclick=exportDaily;
$('#pngPeopleBtn').onclick=exportPeople;
$('#pngReportBtn').onclick=exportReport;
$('#csvBtn').onclick=exportCSV;
$('#holTableBtn').onclick=()=>openHolidayTable(state.year);

/* ---------- ตารางเวรนักขัตฤกษ์ทั้งปี ----------
   ทุกวันที่เข้าคิวนักขัตฤกษ์ (isHolQueueDay) ของปี: วันที่จัดแล้วแสดงชื่อจริง,
   วันที่ยังไม่จัดแสดงชื่อตามคิว (คาดการณ์) โดยเดินคิวตั้งแต่วันเริ่มหมุนเหมือน applyRotation */
const HOL_COLS=[{pos:'senior',h:'RN Senior'},{pos:'junior',h:'RN Junior'},{pos:'pn',h:'PN'}];
async function holidayTableRows(year){
  let months={};try{months=await B.listMonths(unitId)}catch(e){console.error(e)}
  const asg={};for(const ym in months){const a=(months[ym]&&months[ym].assign)||{};for(const k in a)if(a[k]&&a[k].id)asg[k]=a[k];}
  for(const k in asg)if(k.startsWith(monthPrefix())||k.startsWith(shiftYm(-1))||k.startsWith(shiftYm(1)))delete asg[k];
  for(const k in state.assign)if(state.assign[k]&&state.assign[k].id)asg[k]=state.assign[k]; // ใช้ข้อมูลล่าสุดในหน้าจอ
  const idsOn=(iso,pos)=>{const out=[];shiftsOf(iso).forEach(sh=>{for(let i=0;i<needFor(iso,pos);i++){const a=asg[`${iso}|${sh}|${pos}|${i}`];if(a&&a.id&&!out.includes(a.id))out.push(a.id)}});return out};
  const rot=rotOn(),first=`${year}-01-01`,last=`${year}-12-31`;
  let d=rot&&rotStart()&&rotStart()<first?rotStart():first;
  const q={};HOL_COLS.forEach(c=>q[c.pos]=rot?rotOrder(ROT_KINDS.find(k=>k.hol&&k.slot===c.pos)):[]);
  const rows=[];
  for(;d<=last;d=addDays(d,1)){
    if(!isHolQueueDay(d))continue;const inRot=rot&&d>=rotStart();
    const cells=HOL_COLS.map(c=>{
      const n=needFor(d,c.pos);if(!n)return{names:[],fc:false};
      let ids=idsOn(d,c.pos),fc=false;
      if(!ids.length&&inRot){ids=[];for(let i=0;i<n;i++){const id=q[c.pos].find(x=>!ids.includes(x)&&eligible(person(x),c.pos)&&!(state.unavail[x]&&state.unavail[x][d]));if(id)ids.push(id)}fc=ids.length>0;}
      if(inRot)ids.forEach(id=>{const j=q[c.pos].indexOf(id);if(j>=0){q[c.pos].splice(j,1);q[c.pos].push(id)}});
      return{names:ids.map(firstName),fc};});
    if(d>=first)rows.push({iso:d,hol:holidayName(d)||(isWeekend(d)?'เสาร์-อาทิตย์ติดวันหยุด':'วันทำงานคั่นวันหยุด'),real:!!holidayName(d),cells});
  }
  return rows;
}
const thDate=iso=>{const p=parseIso(iso);return `${p.d} ${TH_MS[p.m]} ${be(p.y)}`};
async function openHolidayTable(year){
  openModal(`ตารางเวรนักขัตฤกษ์ ปี ${be(year)}`,'<p class="hint">กำลังโหลด…</p>');
  const rows=await holidayTableRows(year);
  const anyFc=rows.some(r=>r.cells.some(c=>c.fc));
  const body=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><button class="btn btn-line" id="hyPrev" aria-label="ปีก่อน">‹ ${be(year-1)}</button><b style="flex:1;text-align:center">${esc(state.dept)} · ปี ${be(year)} · ${rows.length} วัน</b><button class="btn btn-line" id="hyNext" aria-label="ปีถัดไป">${be(year+1)} ›</button></div>
    ${anyFc?'<p class="hint" style="margin:0 0 8px">ชื่อ<i style="color:#8a94a6">ตัวเอียงสีเทา</i> = ยังไม่ได้จัดเวรเดือนนั้น แสดงตามลำดับคิว (คาดการณ์) · ตัวปกติ = จัดในตารางแล้ว</p>':''}
    ${rows.length?`<div class="tbl-wrap" style="max-height:60vh"><table class="sched rep"><thead><tr><th class="n">ลำดับ</th><th>วัน</th><th>ว/ด/ป</th><th>นักขัตฤกษ์</th>${HOL_COLS.map(c=>`<th>${c.h}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r,i)=>`<tr class="off"><td class="n">${i+1}</td><td>${DOW_L[dow(r.iso)]}</td><td style="white-space:nowrap">${thDate(r.iso)}</td><td>${r.real?esc(r.hol):`<span class="hint">${esc(r.hol)}</span>`}</td>
      ${r.cells.map(c=>`<td>${c.names.length?(c.fc?`<i style="color:#8a94a6">${esc(c.names.join(', '))}</i>`:esc(c.names.join(', '))):'<span class="hint">—</span>'}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`:'<p class="hint">ไม่มีวันนักขัตฤกษ์ในปีนี้</p>'}`;
  openModal(`ตารางเวรนักขัตฤกษ์ ปี ${be(year)}`,body,`<button class="btn btn-line" id="hyCsv">ดาวน์โหลด Excel (CSV)</button><button class="btn btn-line" id="hyPrint">พิมพ์</button><button class="btn btn-primary" data-close>ปิด</button>`);
  $('#hyPrev').onclick=()=>openHolidayTable(year-1);$('#hyNext').onclick=()=>openHolidayTable(year+1);
  const flat=r=>[DOW_L[dow(r.iso)],thDate(r.iso),r.hol,...r.cells.map(c=>c.names.join(', ')+(c.fc?' (คาดการณ์)':''))];
  $('#hyCsv').onclick=()=>{const lines=[[`ตารางเวรนักขัตฤกษ์ ${state.dept} ปี ${be(year)}`],['ลำดับ','วัน','ว/ด/ป','นักขัตฤกษ์',...HOL_COLS.map(c=>c.h)],...rows.map((r,i)=>[i+1,...flat(r)])];
    downloadBlob(new Blob(['﻿'+lines.map(l=>l.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n')],{type:'text/csv'}),`เวรนักขัตฤกษ์-${state.dept.replace(/[\\/:*?"<>|\s]+/g,'_')}-${be(year)}.csv`);toast('ดาวน์โหลดไฟล์แล้ว')};
  $('#hyPrint').onclick=()=>{const w=window.open('','_blank');if(!w){toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต pop-up แล้วลองอีกครั้ง');return}
    w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ตารางเวรนักขัตฤกษ์ ${be(year)}</title><style>body{font-family:${FONT};padding:24px}h2{margin:0 0 4px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #000;padding:6px 8px;text-align:left}th{background:#F4B084}td.n,th.n{text-align:center}i{color:#666}</style></head><body>
      <h2>ตารางเวรนักขัตฤกษ์ ปี ${be(year)}</h2><div style="margin-bottom:12px">${esc(state.dept)}</div>
      <table><thead><tr><th class="n">ลำดับ</th><th>วัน</th><th>ว/ด/ป</th><th>นักขัตฤกษ์</th>${HOL_COLS.map(c=>`<th>${c.h}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((r,i)=>`<tr><td class="n">${i+1}</td><td>${DOW_L[dow(r.iso)]}</td><td>${thDate(r.iso)}</td><td>${esc(r.hol)}</td>${r.cells.map(c=>`<td>${c.fc?'<i>':''}${esc(c.names.join(', '))}${c.fc?'</i>':''}</td>`).join('')}</tr>`).join('')}
      </tbody></table>${anyFc?'<p><i>ตัวเอียง = คาดการณ์ตามคิว ยังไม่ได้จัดในตาราง</i></p>':''}</body></html>`);
    w.document.close();w.focus();setTimeout(()=>w.print(),300);};
}
function runAuto(mode){pushUndo();const un=autoFill(mode);addLog(`จัดเวรอัตโนมัติ ${monthTitle()}${mode==='keepLocked'?' (คงช่องที่ล็อกไว้)':''}`);markDirty();renderAll();
  const nx=shiftYm(1);const nextDone=rotOn()&&Object.keys(state.assign).some(k=>k.startsWith(nx)&&state.assign[k]&&state.assign[k].id);
  toast((un?`จัดแล้ว แต่มี ${un} ช่องที่หาคนว่างไม่ได้ — ลองปิดกฎบางข้อในแท็บ 4`:'จัดเวรครบทุกช่องแล้ว')+(nextDone?' · เดือนถัดไปจัดไว้แล้ว คิวหมุนเวรอาจไม่ต่อเนื่อง ควรจัดเดือนถัดไปใหม่':''));}
$('#autoBtn').onclick=()=>{
  const mk=monthSlots().map(s=>s.key);const has=mk.filter(k=>state.assign[k]&&state.assign[k].id);const locked=has.filter(k=>state.assign[k].locked).length;
  if(!has.length){runAuto('all');return}
  confirmBox('จัดเวรใหม่ทั้งเดือน?',`เดือนนี้มีตารางอยู่แล้ว${locked?` และมี <b>${locked} ช่อง</b> ที่แก้ด้วยมือ (มีรูปกุญแจ)`:''} ต้องการจัดใหม่แบบไหน?`,[
    {label:'ยกเลิก'},...(locked?[{label:'จัดใหม่ทั้งหมด',fn:()=>runAuto('all')}]:[]),
    {label:locked?'จัดใหม่ แต่คงช่องที่แก้เอง':'จัดใหม่',cls:'btn-primary',fn:()=>runAuto(locked?'keepLocked':'all')}]);
};
$('#clearBtn').onclick=()=>confirmBox('ล้างตารางเดือนนี้?','เวรทุกช่องในเดือนนี้จะถูกลบ (กด “ย้อนกลับ” ได้ถ้ากดผิด)',[
  {label:'ยกเลิก'},{label:'ล้างตาราง',cls:'btn-danger',fn:()=>{pushUndo();monthSlots().forEach(s=>delete state.assign[s.key]);addLog('ล้างตาราง '+monthTitle());markDirty();renderAll();}}]);
$('#loginForm').onsubmit=async e=>{
  e.preventDefault();$('#liErr').textContent='';$('#liBtn').disabled=true;
  try{await B.signIn($('#liEmail').value.trim(),$('#liPw').value,$('#liRemember').checked)}
  catch(err){
    const c=err.code||'';console.error('Sign-in failed:',c,err.message);
    showLoginError(c.includes('too-many')?'ลองผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่'
      :c.includes('network')?'เชื่อมต่ออินเทอร์เน็ตไม่ได้'
      :c.includes('unauthorized-domain')?'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase Authentication'
      :c.includes('operation-not-allowed')?'ยังไม่ได้เปิดการเข้าระบบแบบอีเมล/รหัสผ่านใน Firebase'
      :c.includes('user-disabled')?'บัญชีนี้ถูกระงับใน Firebase Authentication'
      :c.includes('invalid-credential')||c.includes('user-not-found')||c.includes('wrong-password')?'ไม่พบบัญชีนี้ใน Firebase หรือรหัสผ่านไม่ตรง'
      :'เข้าสู่ระบบไม่สำเร็จ'+(c?' ('+c+')':''));
  }
  finally{$('#liBtn').disabled=false}
};
$('#pwToggle').onclick=()=>{
  const pw=$('#liPw'),show=pw.type==='password';pw.type=show?'text':'password';
  $('#pwToggle').setAttribute('aria-pressed',String(show));
  $('#pwToggle').setAttribute('aria-label',show?'ซ่อนรหัสผ่าน':'แสดงรหัสผ่าน');pw.focus();
};
$('#forgotBtn').onclick=async()=>{
  const em=$('#liEmail').value.trim();if(!em){showLoginError('พิมพ์อีเมลก่อน แล้วกด “ลืมรหัสผ่าน?” อีกครั้ง');return}
  try{await B.resetPw(em);showLoginError('');toast('ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ '+em+' แล้ว (ดูในกล่องจดหมาย/สแปม)')}catch(e){showLoginError('ส่งอีเมลไม่สำเร็จ ตรวจสอบอีเมลอีกครั้ง')}
};
window.addEventListener('beforeunload',e=>{if(saveTimer||saving){saveNow();e.preventDefault();e.returnValue=''}});

(async function boot(){
  showView('login');
  try{
    B=await makeFirebaseBackend();
    B.onAuth(onAuthChanged);
  }catch(e){console.error(e);showLoginError('เชื่อมต่อระบบไม่ได้ — ตรวจสอบอินเทอร์เน็ต หรือค่า FIREBASE_CONFIG')}
})();
