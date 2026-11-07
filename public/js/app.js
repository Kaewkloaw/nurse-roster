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
  rawLocked={rules:u.rules||null,shifts:u.shifts||null,name:u.name||''};
}
function unitPayload(){
  const ce=canEditRules();
  return JSON.parse(JSON.stringify({name:isAdmin()?state.dept:rawLocked.name,staff:state.staff,holidayOverrides:state.holidayOverrides,paper:state.paper,
    rules:ce?state.rules:rawLocked.rules,shifts:ce?state.shifts:rawLocked.shifts}));
}
function monthPayload(){
  const mp=monthPrefix();const assign={};
  for(const k in legacyAssign)if(k.startsWith(mp)&&legacyAssign[k]&&legacyAssign[k].id)assign[k]=legacyAssign[k];
  for(const k in state.assign)if(k.startsWith(mp)&&state.assign[k]&&state.assign[k].id)assign[k]=state.assign[k];
  return JSON.parse(JSON.stringify({assign,log:state.log.slice(0,100)}));
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
function snapshot(){return JSON.stringify({assign:state.assign,unavail:state.unavail,staff:state.staff,holidayOverrides:state.holidayOverrides,rules:state.rules,shifts:state.shifts,paper:state.paper,log:state.log,dept:state.dept})}
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
      if(si===0)h+=`<td class="date" rowspan="${shs.length}">${d}</td><td class="dname" rowspan="${shs.length}"${hn?` title="${esc(hn)}"`:''}>${DOW_L[dow(iso)]}${hn?`<small>${esc(hn)}</small>`:''}</td>`;
      h+=`<td><span class="shift sh-${sh}">${esc(SHIFTS[sh].label)} <small>${esc(SHIFTS[sh].time)}</small></span></td>`;
      us.forEach(p=>{h+='<td>';const n=needFor(iso,p.key);
        if(!n)h+='<span class="hint">—</span>';
        for(let i=0;i<n;i++){
          const k=`${iso}|${sh}|${p.key}|${i}`;const a=state.assign[k];
          if(!a||!a.id){h+=`<button class="chip empty" data-k="${k}" ${isNurse()?'disabled':''}>${isNurse()?'ว่าง':'+ เลือกคน'}</button>`;continue;}
          const pr=isNurse()?[]:slotIssues(k,a,idx);const mine=me&&a.id===me;
          h+=`<button class="chip ${p.cls} ${pr.length?'bad':''} ${mine?'mine':''}" data-k="${k}" ${isNurse()?'disabled':''} title="${esc(fullName(a.id)+(pr.length?' — '+pr.map(x=>x.t).join(', '):''))}">${pr.length?ICON_WARN:''}${esc(firstName(a.id))}${a.locked&&!isNurse()?ICON_LOCK:''}</button>`;
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
    return{s,pr,c,lv:pr.length?Math.max(...pr.map(p=>p.lv)):0}}).sort((a,b)=>a.lv-b.lv||(SLOTM[slot].ot?a.c.ot-b.c.ot:a.c.all-b.c.all));
  let b='';
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
function renderPeople(){
  $('#peopleLegend').innerHTML=shiftsUsed().map(s=>`<span><i class="lg" style="background:${SH_COLOR[s][0]};color:${SH_COLOR[s][1]}">${esc(SHIFTS[s].letter)}</i>เวร${esc(SHIFTS[s].label)}</span>`).join('')+
    `<span><i class="lg" style="background:#EEE8FB;color:#4A2C7A">OT</i>ล่วงเวลา</span><span><i class="lg" style="background:#E7DDF7;color:#4A2C7A">2+</i>หลายเวรในวันเดียว</span><span><i class="lg" style="background:#F7D3D3;color:#8E2020">ลา</i>ไม่ว่าง</span><span><i class="lg" style="background:var(--red);color:#fff">!</i>ไม่ว่างแต่ยังมีเวร</span>`;
  const days=monthDays();const idx=buildIndex(state.assign);const n=isNurse(),me=myStaffId();
  let h=`<thead><tr><th class="namecol">ชื่อ-สกุล</th>${days.map(iso=>`<th class="${isOff(iso)?'off':''}" title="${esc(holidayName(iso))}">${parseIso(iso).d}<small>${DOW_S[dow(iso)]}</small></th>`).join('')}<th>เวร</th><th>OT</th></tr></thead><tbody>`;
  POS.forEach(p=>{
    const list=state.staff.filter(s=>s.pos===p.key).sort((a,b)=>(a.oc!==false)-(b.oc!==false));
    h+=`<tr class="grp"><td colspan="${days.length+3}"><span class="dot" style="background:${p.color}"></span>${p.label} (${list.length} คน)</td></tr>`;
    list.forEach(s=>{
      const c=monthCounts(idx,s.id);const mine=n&&s.id===me;const ro=n&&!mine;
      const tag=s.oc===false?`<span class="mini">${esc(s.posLabel||(s.ot!==false?'OT เท่านั้น':'ไม่อยู่เวร'))}</span>`:(s.posLabel?`<span class="mini">${esc(s.posLabel)}</span>`:'');
      h+=`<tr class="${mine?'merow':''}"><td class="namecol"><button class="namebtn" data-edit="${s.id}" ${n?'disabled':''}>คุณ${esc(s.name)} ${tag}${n?'':ICON_EDIT}</button></td>`;
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
    <div class="row"><label>อยู่ในเวรประจำ (OC)<small>ปิด = ไม่จัดเวร OC ให้ เช่น หัวหน้า, Sup., หรือคนที่มาช่วยเฉพาะ OT</small></label><button class="switch ${p.oc!==false?'on':''}" id="pOc"></button></div>
    <div class="row"><label>รับ OT ได้<small>ระบบจะเลือกคนนี้ลงช่อง OT RN / OT PN</small></label><button class="switch ${p.ot!==false?'on':''}" id="pOt"></button></div>
    <label class="lb">ตำแหน่งที่แสดงในใบลงเวลา (ไม่บังคับ)</label>
    <input class="textin" id="pLabel" value="${esc(p.posLabel||'')}" placeholder="เว้นว่าง = RN / PN · หรือใส่ เช่น CO, Sup., CLA">`,
    `${id?'<button class="btn btn-danger" id="pDel">ลบคนนี้</button>':''}<button class="btn btn-line" data-close>ยกเลิก</button><button class="btn btn-primary" id="pSave">บันทึก</button>`);
  let pos=p.pos,pre=p.prefix||'น.ส.',oc=p.oc!==false,ot=p.ot!==false;
  const grp=(sel,set)=>$(sel).querySelectorAll('.tbtn').forEach(b=>b.onclick=()=>{set(b.dataset.v);$(sel).querySelectorAll('.tbtn').forEach(x=>x.classList.toggle('on',x===b))});
  grp('#pPos',v=>pos=v);grp('#pPre',v=>pre=v);
  $('#pOc').onclick=()=>{oc=!oc;$('#pOc').classList.toggle('on',oc)};$('#pOt').onclick=()=>{ot=!ot;$('#pOt').classList.toggle('on',ot)};
  $('#pName').focus();
  $('#pSave').onclick=()=>{
    const nm=$('#pName').value.trim().replace(/^(คุณ|น\.ส\.|นางสาว|นาง|นาย)\s*/,'');if(!nm){toast('กรุณาใส่ชื่อ');return}
    pushUndo();const v={name:nm,pos,prefix:pre,oc,ot,posLabel:$('#pLabel').value.trim()};
    if(id){const old=person(id);Object.assign(old,v);for(const k in state.assign)if(state.assign[k]&&state.assign[k].id===id&&!eligible(old,k.split('|')[2]))delete state.assign[k];addLog('แก้ไขข้อมูล คุณ'+nm);}
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
  return POS.map(p=>({p,rows:state.staff.filter(s=>s.pos===p.key).map(s=>{
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
  const di=$('#deptIn');if(di)di.onchange=()=>{state.dept=di.value.trim()||state.dept;markDirty();renderHeader()};
  const du=$('#delUnitBtn');if(du)du.onclick=()=>deleteUnit(unitId,state.dept);
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
    <select class="textin" id="nuCopy"><option value="">ใช้ค่าเริ่มต้น</option>${units.map(u=>`<option value="${esc(u.id)}">คัดลอกจาก ${esc(u.name)}</option>`).join('')}</select>
    <p class="hint">สร้างเสร็จแล้วไปเพิ่มรายชื่อและแก้กฎได้ในแผนกนั้น</p>`,
    `<button class="btn btn-line" data-close>ยกเลิก</button><button class="btn btn-primary" id="nuOk">สร้างแผนก</button>`);
  $('#nuName').focus();
  $('#nuOk').onclick=async()=>{
    const name=$('#nuName').value.trim();if(!name){toast('กรุณาใส่ชื่อแผนก');return}
    const src=units.find(u=>u.id===$('#nuCopy').value);const id='u'+Date.now().toString(36);
    const data={name,staff:[],rules:src?src.rules:defaultRules(),shifts:src?src.shifts:defaultShifts(),paper:src&&src.paper?src.paper:defaultPaper(),holidayOverrides:{},updatedAt:Date.now(),updatedBy:session.user.email};
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
function runAuto(mode){pushUndo();const un=autoFill(mode);addLog(`จัดเวรอัตโนมัติ ${monthTitle()}${mode==='keepLocked'?' (คงช่องที่ล็อกไว้)':''}`);markDirty();renderAll();
  toast(un?`จัดแล้ว แต่มี ${un} ช่องที่หาคนว่างไม่ได้ — ลองปิดกฎบางข้อในแท็บ 4`:'จัดเวรครบทุกช่องแล้ว');}
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
