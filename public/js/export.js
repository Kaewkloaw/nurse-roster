function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}
const fileTag=()=>`${state.dept}-${TH_M[state.month]}-${be(state.year)}`.replace(/[\\/:*?"<>|\s]+/g,'_');
function exportCSV(){
  const cols=reportCols();
  const lines=[[`รายงานจำนวนเวร ${state.dept} ${monthTitle()}`],['ชื่อ-สกุล','ตำแหน่ง',...cols.map(c=>`${c.h} (${c.sub})`),'รวมเวร','OT','วันที่ขึ้นเวร','ชั่วโมง (ไม่รวม OT)','วันลา','วันที่มีเวร']];
  reportRows().forEach(g=>g.rows.forEach(r=>lines.push([(r.s.prefix||'')+' '+r.s.name,g.p.label,...r.per,r.total,r.ot,r.days,r.hours,r.leave,r.dates.map(i=>parseIso(i).d).join(' ')])));
  downloadBlob(new Blob(['﻿'+lines.map(l=>l.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n')],{type:'text/csv'}),`รายงานจำนวนเวร-${fileTag()}.csv`);
  toast('ดาวน์โหลดไฟล์ Excel (CSV) แล้ว');
}

/* ---------- PNG: แบบฟอร์มกระดาษของหน่วยงาน (ขาว-ดำ, ส้ม = วันหยุด) ---------- */
const PAPER={ink:'#000000',line:'#000000',offRow:'#F9D5A6',offHead:'#F4B084',offCol:'#F8CBAD',red:'#C00000'};
/* วัดความกว้างข้อความด้วย DOM (แม่นกับภาษาไทยทุกเบราว์เซอร์) แล้วจัดกึ่งกลางเอง ไม่พึ่ง textAlign ของ canvas */
let _ms=null;
function tw(x,t){if(!_ms){_ms=document.createElement('span');_ms.style.cssText='position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;line-height:1';document.body.appendChild(_ms)}
  _ms.style.font=x.font;_ms.textContent=t;return _ms.getBoundingClientRect().width}
function fitText(x,txt,maxW,size,weight){let s=size;x.font=`${weight} ${s}px ${FONT}`;while(tw(x,txt)>maxW&&s>8){s-=0.5;x.font=`${weight} ${s}px ${FONT}`;}}
async function fontsReady(){try{const th='กขคงจฉชซญดตทนบปผพฟมยรลวศสหอฮะาิีึืุูเแโใไ็่้๊๋์ๆ0Aa';await Promise.all([document.fonts.load(`700 20px Sarabun`,th),document.fonts.load(`400 20px Sarabun`,th)]);await document.fonts.ready}catch(e){}}
function paperCanvas(W,H){const S=2.5,cv=document.createElement('canvas');cv.width=Math.round(W*S);cv.height=Math.round(H*S);const x=cv.getContext('2d');x.scale(S,S);x.fillStyle='#fff';x.fillRect(0,0,W,H);x.textBaseline='middle';x.textAlign='center';x.fillStyle=PAPER.ink;x.strokeStyle=PAPER.line;
  const ft=x.fillText.bind(x);x.fillText=(t,px,py)=>{if(x.textAlign==='center'){x.textAlign='left';ft(t,px-tw(x,String(t))/2,py);x.textAlign='center'}else ft(t,px,py)};
  return{cv,x}}
function cellText(x,t,cx,cy,w,size,weight){if(t==null||t==='')return;x.fillStyle=PAPER.ink;fitText(x,String(t),w-6,size,weight||'400');x.fillText(String(t),cx,cy+1)}
function rectLine(x,X,Y,W,H,lw){x.lineWidth=lw||0.8;x.strokeStyle=PAPER.line;x.strokeRect(X,Y,W,H)}
function savePNG(cv,name){cv.toBlob(b=>{downloadBlob(b,name);toast('ดาวน์โหลดรูปแล้ว')},'image/png')}
function namesFor(iso,slot){
  const ids=[];shiftsOf(iso).forEach(sh=>{for(let i=0;i<needFor(iso,slot);i++){const a=state.assign[`${iso}|${sh}|${slot}|${i}`];if(a&&a.id&&!ids.includes(a.id))ids.push(a.id)}});
  return ids.map(firstName).join(' / ');
}
async function exportDaily(){
  await fontsReady();
  const us=usedSlots();const days=monthDays();
  const cDay=48,cDow=52,cS=us.length>4?132:150,RH=30,HH=32,M=36,TT=70;
  const TW=cDay+cDow+cS*us.length,W=TW+M*2,H=TT+HH+RH*days.length+M;
  const {cv,x}=paperCanvas(W,H);
  x.font=`700 21px ${FONT}`;x.fillText(`ตารางเวร${state.dept} ประจำเดือน ${monthTitle()}`,W/2,40);
  let y=TT;
  // header
  rectLine(x,M,y,cDay+cDow,HH);cellText(x,'วันที่',M+(cDay+cDow)/2,y+HH/2,cDay+cDow,16);
  us.forEach((s,i)=>{const X=M+cDay+cDow+i*cS;rectLine(x,X,y,cS,HH);cellText(x,s.short,X+cS/2,y+HH/2,cS,16)});
  y+=HH;
  days.forEach(iso=>{
    if(isOff(iso)){x.fillStyle=PAPER.offRow;x.fillRect(M,y,TW,RH)}
    rectLine(x,M,y,cDay,RH);cellText(x,parseIso(iso).d,M+cDay/2,y+RH/2,cDay,16);
    rectLine(x,M+cDay,y,cDow,RH);cellText(x,DOW_S[dow(iso)],M+cDay+cDow/2,y+RH/2,cDow,16);
    us.forEach((s,i)=>{const X=M+cDay+cDow+i*cS;rectLine(x,X,y,cS,RH);cellText(x,namesFor(iso,s.key),X+cS/2,y+RH/2,cS,16)});
    y+=RH;
  });
  rectLine(x,M,TT,TW,y-TT,1.4);
  savePNG(cv,`ตารางเวร-${fileTag()}.png`);
}
async function exportPeople(){
  await fontsReady();
  const days=monthDays();const idx=buildIndex(state.assign);const P=state.paper;const n=days.length;
  const groups=[{label:'RN',list:state.staff.filter(s=>s.pos!=='pn')},{label:'PN',list:state.staff.filter(s=>s.pos==='pn')}].filter(g=>g.list.length)
    .map(g=>({...g,list:[...g.list.filter(s=>s.oc===false),...g.list.filter(s=>s.oc!==false)],split:g.list.filter(s=>s.oc===false).length}));
  const cNo=24,cPre=38,cFirst=86,cLast=104,cPos=30,cD=24,RH=21,H1=19,H2=19,M=30,HEAD=118,GAP=60;
  const TW=cNo+cPre+cFirst+cLast+cPos+cD*n,W=TW+M*2;
  const pageH=g=>HEAD+H1+H2+RH*g.list.length+24;
  const H=groups.reduce((s,g)=>s+pageH(g),0)+GAP*(groups.length-1)+M;
  const {cv,x}=paperCanvas(W,H);
  let top=M/2;
  const mon=TH_M[state.month],yy=be(state.year);
  groups.forEach((g,gi)=>{
    if(gi){x.strokeStyle='#BBBBBB';x.setLineDash([6,6]);x.beginPath();x.moveTo(0,top-GAP/2);x.lineTo(W,top-GAP/2);x.stroke();x.setLineDash([]);}
    x.fillStyle=PAPER.ink;x.textAlign='center';
    x.font=`700 15px ${FONT}`;x.fillText(P.l1,W/2,top+16);x.fillText(P.l2,W/2,top+38);x.fillText(P.l3,W/2,top+60);
    x.font=`700 15px ${FONT}`;x.fillText(`${P.unitPrefix}${state.dept}      วันที่  1  เดือน ${mon} พ.ศ. ${yy}  ถึง วันที่  ${n}  ${mon} พ.ศ. ${yy}`,W/2,top+86);
    let y=top+HEAD-16;const X0=M;
    // header: ลำดับ | ชื่อ-สกุล (3 cols) | ตำแหน่ง | days
    const hH=H1+H2;
    const vtext=(t,cx,cy)=>{x.save();x.translate(cx,cy);x.rotate(-Math.PI/2);x.font=`400 11px ${FONT}`;x.fillStyle=PAPER.ink;x.fillText(t,0,1);x.restore()};
    rectLine(x,X0,y,cNo,hH);vtext('ลำดับ',X0+cNo/2,y+hH/2);
    rectLine(x,X0+cNo,y,cPre+cFirst+cLast,hH);cellText(x,'ชื่อ-สกุล',X0+cNo+(cPre+cFirst+cLast)/2,y+hH/2,cPre+cFirst+cLast,13);
    const xPos=X0+cNo+cPre+cFirst+cLast;rectLine(x,xPos,y,cPos,hH);vtext('ตำแหน่ง',xPos+cPos/2,y+hH/2);
    const xD=xPos+cPos;
    days.forEach((iso,i)=>{const X=xD+i*cD;const off=isOff(iso);
      if(off){x.fillStyle=PAPER.offHead;x.fillRect(X,y,cD,hH)}
      rectLine(x,X,y,cD,H1);rectLine(x,X,y+H1,cD,H2);
      cellText(x,parseIso(iso).d,X+cD/2,y+H1/2,cD,11.5,off?'700':'400');cellText(x,DOW_S[dow(iso)],X+cD/2,y+H1+H2/2,cD,11,'700');});
    y+=hH;
    g.list.forEach((s,ri)=>{
      const c=monthCounts(idx,s.id);
      days.forEach((iso,i)=>{if(isOff(iso)){x.fillStyle=PAPER.offCol;x.fillRect(xD+i*cD,y,cD,RH)}});
      rectLine(x,X0,y,cNo,RH);cellText(x,ri+1,X0+cNo/2,y+RH/2,cNo,11.5);
      rectLine(x,X0+cNo,y,cPre+cFirst+cLast,RH);
      const [fn,...ln]=s.name.split(' ');x.textAlign='left';
      cellText(x,'',0,0,0);x.font=`400 12px ${FONT}`;x.fillStyle=PAPER.ink;
      x.fillText(s.prefix||'',X0+cNo+4,y+RH/2+1);fitText(x,fn,cFirst-6,12,'400');x.fillText(fn,X0+cNo+cPre,y+RH/2+1);
      fitText(x,ln.join(' '),cLast-6,12,'400');x.fillText(ln.join(' '),X0+cNo+cPre+cFirst,y+RH/2+1);x.textAlign='center';
      rectLine(x,xPos,y,cPos,RH);cellText(x,s.posLabel||POSM[s.pos].sheet,xPos+cPos/2,y+RH/2,cPos,10.5);
      days.forEach((iso,i)=>{const X=xD+i*cD;rectLine(x,X,y,cD,RH);
        const duty=c.list.some(z=>z.iso===iso&&!z.ot);
        if(duty)cellText(x,P.mark,X+cD/2,y+RH/2,cD,9.5,'700');
        else if(isOff(iso)){x.strokeStyle=PAPER.ink;x.lineWidth=0.9;x.beginPath();x.moveTo(X+5,y+RH/2);x.lineTo(X+cD-5,y+RH/2);x.stroke();}
      });
      y+=RH;
      if(g.split&&ri===g.split-1&&g.split<g.list.length){x.strokeStyle=PAPER.red;x.lineWidth=1.6;x.beginPath();x.moveTo(X0,y);x.lineTo(X0+TW,y);x.stroke();}
    });
    rectLine(x,X0,top+HEAD-16,TW,y-(top+HEAD-16),1.2);
    top+=pageH(g)+GAP;
  });
  savePNG(cv,`แผนรายบุคคล-${fileTag()}.png`);
}
async function exportReport(){
  await fontsReady();const rc=reportCols();const groups=reportRows();const showOT=usedSlots().some(s=>s.ot);
  const cols=[{w:220,h:'ชื่อ-สกุล'},{w:56,h:'ตำแหน่ง'},...rc.map(c=>({w:84,h:`${c.h} (${c.sub})`})),{w:70,h:'รวมเวร'},...(showOT?[{w:56,h:'OT'}]:[]),{w:96,h:'วันที่ขึ้นเวร'},{w:70,h:'ชั่วโมง'},{w:60,h:'วันลา'}];
  const M=36,RH=26,HH=34,TT=86,TW=cols.reduce((s,c)=>s+c.w,0),W=TW+M*2;const rows=groups.flatMap(g=>[...g.rows.map(r=>({r,g})),{sum:g}]);
  const H=TT+HH+RH*rows.length+M;const {cv,x}=paperCanvas(W,H);
  x.font=`700 20px ${FONT}`;x.fillText(`สรุปจำนวนเวรรายบุคคล ${state.dept}`,W/2,34);x.font=`400 15px ${FONT}`;x.fillText(`ประจำเดือน ${monthTitle()}`,W/2,60);
  let y=TT,X=M;cols.forEach(c=>{rectLine(x,X,y,c.w,HH);cellText(x,c.h,X+c.w/2,y+HH/2,c.w,13,'700');X+=c.w});y+=HH;
  rows.forEach(o=>{
    let v;if(o.sum){const g=o.sum;const s=f=>g.rows.reduce((a,r)=>a+f(r),0);x.fillStyle='#F2F2F2';x.fillRect(M,y,TW,RH);
      v=[`รวม${g.p.label}`,'',...rc.map((c,i)=>s(r=>r.per[i])),s(r=>r.total),...(showOT?[s(r=>r.ot)]:[]),s(r=>r.days),Math.round(s(r=>r.hours)*10)/10,s(r=>r.leave)||'-'];}
    else{const r=o.r;v=[`${r.s.prefix||''} ${r.s.name}`,r.s.posLabel||POSM[r.s.pos].sheet,...r.per,r.total,...(showOT?[r.ot]:[]),r.days,r.hours,r.leave||'-'];}
    X=M;cols.forEach((c,i)=>{rectLine(x,X,y,c.w,RH);if(i===0){x.textAlign='left';fitText(x,String(v[0]),c.w-10,13.5,o.sum?'700':'400');x.fillStyle=PAPER.ink;x.fillText(String(v[0]),X+6,y+RH/2+1);x.textAlign='center'}else cellText(x,v[i],X+c.w/2,y+RH/2,c.w,13.5,o.sum?'700':'400');X+=c.w});y+=RH;
  });
  rectLine(x,M,TT,TW,y-TT,1.2);savePNG(cv,`สรุปจำนวนเวร-${fileTag()}.png`);
}
