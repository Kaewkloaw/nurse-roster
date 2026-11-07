/* ---------- date helpers ---------- */
const pad=n=>String(n).padStart(2,'0');
const isoOf=(y,m,d)=>`${y}-${pad(m+1)}-${pad(d)}`;
const parseIso=iso=>{const [y,m,d]=iso.split('-').map(Number);return{y,m:m-1,d}};
const dayNum=iso=>{const p=parseIso(iso);return Date.UTC(p.y,p.m,p.d)/864e5};
const dow=iso=>{const p=parseIso(iso);return new Date(Date.UTC(p.y,p.m,p.d)).getUTCDay()};
const daysIn=(y,m)=>new Date(Date.UTC(y,m+1,0)).getUTCDate();
const be=y=>y+543;
const shortDate=iso=>{const p=parseIso(iso);return `${DOW_S[dow(iso)]} ${p.d} ${TH_MS[p.m]}`};
const ymOf=(y,m)=>`${y}-${pad(m+1)}`;
const monthPrefix=()=>ymOf(state.year,state.month);
const monthTitle=()=>`${TH_M[state.month]} ${be(state.year)}`;
function shiftYm(d){let y=state.year,m=state.month+d;while(m<0){m+=12;y--}while(m>11){m-=12;y++}return ymOf(y,m)}
function nextMonthFromToday(){const t=new Date();let y=t.getFullYear(),m=t.getMonth()+1;if(m>11){m=0;y++}return{y,m}}
function hoursOf(sh){const t=(SHIFTS[sh]&&SHIFTS[sh].time)||'';const r=t.match(/(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/);if(!r)return 8;let h=(+r[3]+r[4]/60)-(+r[1]+r[2]/60);if(h<=0)h+=24;return Math.round(h*10)/10}

const holCache={};
function baseHolidays(y){
  if(holCache[y])return holCache[y];
  const map={};
  FIXED_HOL.forEach(([m,d,n])=>{map[isoOf(y,m-1,d)]=n});
  FIXED_HOL.forEach(([m,d,n])=>{
    const iso=isoOf(y,m-1,d),w=dow(iso);
    if(w===0||w===6){let t=Date.UTC(y,m-1,d);
      for(let k=0;k<10;k++){t+=864e5;const dt=new Date(t);const i2=isoOf(dt.getUTCFullYear(),dt.getUTCMonth(),dt.getUTCDate());const w2=dt.getUTCDay();
        if(w2!==0&&w2!==6&&!map[i2]){map[i2]='ชดเชย'+n;break;}}}
  });
  return holCache[y]=map;
}
function holidayName(iso){
  if(iso in state.holidayOverrides)return state.holidayOverrides[iso];
  const y=parseIso(iso).y;return baseHolidays(y)[iso]||baseHolidays(y-1)[iso]||'';
}
const isWeekend=iso=>{const w=dow(iso);return w===0||w===6};
const isOff=iso=>isWeekend(iso)||!!holidayName(iso);

/* ---------- slots ---------- */
const needFor=(iso,slot)=>((isOff(iso)?state.rules.needOff:state.rules.need)[slot])||0;
const usedSlots=()=>SLOTS.filter(s=>(state.rules.need[s.key]||0)>0||(state.rules.needOff[s.key]||0)>0);
const maxNeed=slot=>Math.max(state.rules.need[slot]||0,state.rules.needOff[slot]||0);
const eligible=(st,slot)=>{const s=SLOTM[slot];return !!st&&s.elig.includes(st.pos)&&(s.ot?st.ot!==false:st.oc!==false)};
function monthDays(){const n=daysIn(state.year,state.month);return Array.from({length:n},(_,i)=>isoOf(state.year,state.month,i+1))}
function shiftsOf(iso){const arr=isOff(iso)?state.rules.offShifts:state.rules.weekdayShifts;return SH_ORDER.filter(s=>arr.includes(s))}
function monthSlots(){
  const out=[];
  monthDays().forEach(iso=>{const off=isOff(iso);shiftsOf(iso).forEach(sh=>SLOTS.forEach(s=>{
    for(let i=0;i<needFor(iso,s.key);i++)out.push({iso,shift:sh,pos:s.key,idx:i,key:`${iso}|${sh}|${s.key}|${i}`,off,ot:s.ot});
  }))});
  return out;
}
function keyValid(k){const [iso,sh,pos,i]=k.split('|');return !!SLOTM[pos]&&shiftsOf(iso).includes(sh)&&(+i)<needFor(iso,pos)}
function buildIndex(asg){
  const idx={};
  for(const k in asg){const a=asg[k];if(!a||!a.id||!keyValid(k))continue;
    const [iso,sh,pos]=k.split('|');(idx[a.id]=idx[a.id]||[]).push({key:k,iso,shift:sh,pos,ot:SLOTM[pos].ot,dn:dayNum(iso),off:isOff(iso)});}
  return idx;
}
const person=id=>state.staff.find(s=>s.id===id);
const fullName=id=>{const p=person(id);return p?'คุณ'+p.name:'(ไม่พบชื่อ)'};
const firstName=id=>{const p=person(id);return p?p.name.split(' ')[0]:'?'};
const slotWord=x=>x.ot?'OT':SHIFTS[x.shift].label;

/* ---------- rules ---------- */
function problems(key,id,idx){
  const [iso,sh,slot]=key.split('|');const dn=dayNum(iso);const r=state.rules;const res=[];const off=isOff(iso);const isOT=SLOTM[slot].ot;
  const st=person(id);
  if(st&&!eligible(st,slot))res.push({t:isOT?'ไม่ได้รับ OT':'ไม่อยู่ในเวร OC ของตำแหน่งนี้',lv:1});
  if(state.unavail[id]&&state.unavail[id][iso])res.push({t:'ไม่ว่าง / ลา วันนี้',lv:2});
  const mine=(idx[id]||[]).filter(x=>x.key!==key);
  for(const x of mine){
    const diff=x.dn-dn;
    if(diff===0){
      if(x.shift===sh&&x.pos===slot)res.push({t:'อยู่ในเวรนี้แล้ว',lv:2});
      else if(x.ot||isOT)res.push({t:'มีเวร'+slotWord(x)+'วันเดียวกัน',lv:1});
      else if(off&&r.holidaySame&&x.pos===slot){}
      else if(r.noSameDay)res.push({t:'มีเวร'+slotWord(x)+'วันเดียวกัน',lv:1});
    }else if(Math.abs(diff)===1&&!x.ot&&!isOT){
      const prevSh=diff<0?x.shift:sh,nextSh=diff<0?sh:x.shift;
      if(r.noConsecDays)res.push({t:'ติดเวร '+shortDate(x.iso)+' (ห้ามขึ้นวันติดกัน)',lv:1});
      else if(r.evNextMorning&&prevSh==='A'&&nextSh==='M')res.push({t:SHIFTS[prevSh].label+'ต่อเช้าวันรุ่งขึ้น ('+shortDate(x.iso)+')',lv:1});
      else if(r.noSameShiftConsec&&x.shift===sh)res.push({t:'เวร'+SHIFTS[sh].label+'ติดกัน 2 วัน ('+shortDate(x.iso)+')',lv:1});
    }
  }
  const mp=monthPrefix();const inMonth=mine.filter(x=>x.iso.startsWith(mp)&&!x.ot);
  if(iso.startsWith(mp)&&!isOT){
    if(r.maxPer>0&&inMonth.length+1>r.maxPer)res.push({t:'เกิน '+r.maxPer+' เวร/เดือน',lv:1});
    if(r.maxOffPer>0&&off&&inMonth.filter(x=>x.off).length+1>r.maxOffPer)res.push({t:'เวรวันหยุดเกิน '+r.maxOffPer+' เวร',lv:1});
  }
  const seen=new Set();return res.filter(p=>seen.has(p.t)?false:(seen.add(p.t),true));
}
function pairKeys(key){
  const [iso,,pos,i]=key.split('|');
  if(!SLOTM[pos].ot&&state.rules.holidaySame&&isOff(iso)){const ks=shiftsOf(iso).map(s=>`${iso}|${s}|${pos}|${i}`);if(ks.length>1)return ks;}
  return[key];
}
function pairMismatch(key,asg){const ids=pairKeys(key).map(k=>asg[k]&&asg[k].id).filter(Boolean);return new Set(ids).size>1}
function unitProblems(keys,id,idx){const all=[];keys.forEach(k=>all.push(...problems(k,id,idx)));const seen=new Set();return all.filter(p=>seen.has(p.t)?false:(seen.add(p.t),true))}
function slotIssues(key,a,idx){
  const pr=problems(key,a.id,idx);const ks=pairKeys(key);
  if(ks.length>1&&key===ks[ks.length-1]&&pairMismatch(key,state.assign))pr.push({t:'วันหยุด: ทุกเวรของวันควรเป็นคนเดียวกัน',lv:1});
  return pr;
}
function unitLabel(keys){const p=keys[0].split('|')[2];return SLOTM[p].ot?'OT':keys.map(k=>SHIFTS[k.split('|')[1]].label).join('+')}
function monthCounts(idx,id){const mp=monthPrefix();const l=(idx[id]||[]).filter(x=>x.iso.startsWith(mp));const oc=l.filter(x=>!x.ot);
  return{all:oc.length,off:oc.filter(x=>x.off).length,ot:l.length-oc.length,list:l}}

/* ---------- auto scheduling ---------- */
/* เวรสะสมย้อนหลัง 12 เดือน (ก่อนเดือนที่เปิดอยู่) — ใช้เฉลี่ยเวรข้ามเดือน/ข้ามปี */
let HIST={};
async function loadHistory(){
  HIST={};if(isNurse())return;
  let docs={};try{docs=await B.listMonths(unitId)}catch(e){console.error(e);return}
  const cur=monthPrefix(),from=shiftYm(-12),t={};
  for(const ym in docs){if(ym>=cur||ym<from)continue;
    const as=(docs[ym]&&docs[ym].assign)||{};
    for(const k in as){const a=as[k];if(!a||!a.id)continue;const [iso,sh,pos]=k.split('|');if(sh==='N'||!SLOTM[pos])continue;
      const c=t[a.id]=t[a.id]||{all:0,off:0,ot:0};
      if(SLOTM[pos].ot)c.ot++;else{c.all++;if(isOff(iso))c.off++;}}}
  // คนที่ยังไม่มีประวัติ (เพิ่งเข้าใหม่) ใช้ค่าเฉลี่ยของตำแหน่งเดียวกัน จะได้ไม่ถูกจัดเวรถล่มทลาย
  POS.forEach(p=>{const ms=state.staff.filter(s=>s.pos===p.key&&s.oc!==false);const w=ms.filter(s=>t[s.id]);
    if(!w.length)return;const avg=f=>Math.round(w.reduce((a,s)=>a+t[s.id][f],0)/w.length);
    ms.forEach(s=>{if(!t[s.id])t[s.id]={all:avg('all'),off:avg('off'),ot:avg('ot'),est:true}})});
  HIST=t;
}
function effCounts(idx,id){const c=monthCounts(idx,id),h=HIST[id]||{all:0,off:0,ot:0};return{all:c.all+h.all,off:c.off+h.off,ot:c.ot+h.ot}}
function variance(a){if(!a.length)return 0;const m=a.reduce((s,x)=>s+x,0)/a.length;return a.reduce((s,x)=>s+(x-m)**2,0)/a.length}
function autoFill(mode){
  const slots=monthSlots().sort((a,b)=>(a.ot-b.ot));const mk=new Set(slots.map(s=>s.key));
  const curIdx=buildIndex(state.assign);const base={};
  for(const k in state.assign){
    const a=state.assign[k];if(!a||!a.id)continue;
    if(!mk.has(k)){if(keyValid(k))base[k]=a;continue;}
    if(mode==='keepLocked'&&a.locked)base[k]=a;
    if(mode==='fix'){const pr=problems(k,a.id,curIdx);const mm=pairMismatch(k,state.assign);
      if((!pr.length&&!mm)||(a.locked&&!pr.some(p=>p.lv===2)))base[k]=a;}
  }
  const iters=mode==='fix'?150:300;let best=null;
  for(let it=0;it<iters;it++){
    const asg=Object.assign({},base);const idx=buildIndex(asg);let unfilled=0;
    for(const s of slots){
      if(asg[s.key])continue;
      const all=pairKeys(s.key);const ks=all.filter(k=>!asg[k]);
      const pre=all.map(k=>asg[k]).find(a=>a&&a.id);
      let bp=null,bs=Infinity;const dn=dayNum(s.iso);
      if(pre){const p=person(pre.id);if(p&&!unitProblems(ks,p.id,idx).length)bp=p;}
      if(!bp)for(const p of state.staff){
        if(!eligible(p,s.pos)||unitProblems(ks,p.id,idx).length)continue;
        const c=effCounts(idx,p.id);
        let sc=s.ot?c.ot*10+c.all*3+Math.random()*7:c.all*10+(s.off?c.off*16:0)+Math.random()*7;
        if(!s.ot)for(const x of idx[p.id]||[]){if(x.ot)continue;const d=Math.abs(x.dn-dn);if(d<=4)sc+=(5-d)*3;}
        if(sc<bs){bs=sc;bp=p;}
      }
      if(bp)ks.forEach(k=>{asg[k]={id:bp.id,locked:false};(idx[bp.id]=idx[bp.id]||[]).push({key:k,iso:s.iso,shift:k.split('|')[1],pos:s.pos,ot:s.ot,dn,off:s.off});});
      else{unfilled+=ks.length;ks.forEach(k=>asg[k]=null);}
    }
    for(const k in asg)if(asg[k]===null)delete asg[k];
    let score=unfilled*1e5;
    POS.forEach(p=>{const ids=state.staff.filter(s=>s.pos===p.key&&s.oc!==false).map(s=>s.id);
      score+=variance(ids.map(id=>effCounts(idx,id).all))*60+variance(ids.map(id=>effCounts(idx,id).off))*90;});
    ['otrn','otpn'].forEach(sl=>{const ids=state.staff.filter(s=>eligible(s,sl)).map(s=>s.id);score+=variance(ids.map(id=>effCounts(idx,id).ot))*40;});
    if(!best||score<best.score)best={asg,score,unfilled};
  }
  mk.forEach(k=>{delete state.assign[k]});
  mk.forEach(k=>{if(best.asg[k])state.assign[k]=best.asg[k]});
  return best.unfilled;
}

