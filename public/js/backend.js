/* =====================================================================
   2) Backend — Firebase (ใช้งานจริง) หรือ Demo (เก็บในหน่วยความจำ)
   ===================================================================== */
async function makeFirebaseBackend(){
  const base=`https://www.gstatic.com/firebasejs/${FB_VER}/`;
  const [A,U,F]=await Promise.all([import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-firestore.js')]);
  const app=A.initializeApp(FIREBASE_CONFIG);const auth=U.getAuth(app);const db=F.getFirestore(app);
  const d=(...p)=>F.doc(db,...p);
  const watch=(ref,cb)=>F.onSnapshot(ref,s=>{if(!s.metadata.hasPendingWrites)cb(s.exists()?s.data():null)},e=>console.error(e));
  return{
    onAuth:cb=>U.onAuthStateChanged(auth,u=>cb(u?{email:(u.email||'').toLowerCase(),uid:u.uid}:null)),
    signIn:async(e,p,remember=true)=>{
      await U.setPersistence(auth,remember?U.browserLocalPersistence:U.browserSessionPersistence);
      return U.signInWithEmailAndPassword(auth,e,p);
    },
    resetPw:e=>U.sendPasswordResetEmail(auth,e),
    signOut:()=>U.signOut(auth),
    getRole:async e=>{const s=await F.getDoc(d('roles',e));return s.exists()?s.data():null},
    listRoles:async()=>(await F.getDocs(F.collection(db,'roles'))).docs.map(x=>({email:x.id,...x.data()})),
    setRole:(e,v)=>F.setDoc(d('roles',e),v),
    delRole:e=>F.deleteDoc(d('roles',e)),
    listUnits:async()=>(await F.getDocs(F.collection(db,'units'))).docs.map(x=>({id:x.id,...x.data()})),
    getUnit:async id=>{const s=await F.getDoc(d('units',id));return s.exists()?s.data():null},
    saveUnit:(id,v)=>F.setDoc(d('units',id),v),
    delUnit:id=>F.deleteDoc(d('units',id)),
    getMonth:async(u,ym)=>{const s=await F.getDoc(d('units',u,'months',ym));return s.exists()?s.data():null},
    listMonths:async u=>Object.fromEntries((await F.getDocs(F.collection(db,'units',u,'months'))).docs.map(x=>[x.id,x.data()])),
    saveMonth:(u,ym,v)=>F.setDoc(d('units',u,'months',ym),v),
    listLeaves:async u=>Object.fromEntries((await F.getDocs(F.collection(db,'units',u,'leaves'))).docs.map(x=>[x.id,x.data()])),
    getLeave:async(u,s)=>{const x=await F.getDoc(d('units',u,'leaves',s));return x.exists()?x.data():null},
    saveLeave:(u,s,v)=>F.setDoc(d('units',u,'leaves',s),v),
    delLeave:(u,s)=>F.deleteDoc(d('units',u,'leaves',s)),
    purgeStaff:async(u,unit,months,ids)=>{
      const entries=Object.entries(months);const ops=1+entries.length+ids.length;
      if(ops>500)throw new Error('รายการลบมากเกินขีดจำกัด 500 รายการ');
      const batch=F.writeBatch(db);batch.set(d('units',u),unit);
      entries.forEach(([ym,v])=>batch.set(d('units',u,'months',ym),v));
      ids.forEach(id=>batch.delete(d('units',u,'leaves',id)));
      await batch.commit();
    },
    watchUnit:(u,cb)=>watch(d('units',u),cb),
    watchMonth:(u,ym,cb)=>watch(d('units',u,'months',ym),cb),
    watchLeaves:(u,cb)=>F.onSnapshot(F.collection(db,'units',u,'leaves'),qs=>{if(!qs.metadata.hasPendingWrites)cb(Object.fromEntries(qs.docs.map(x=>[x.id,x.data()])))},e=>console.error(e)),
    watchLeave:(u,s,cb)=>watch(d('units',u,'leaves',s),v=>cb(v?{[s]:v}:{}))
  };
}
function makeDemoBackend(){
  const db={roles:{},units:{},months:{},leaves:{}};let authCb=()=>{};
  const cl=v=>v==null?null:JSON.parse(JSON.stringify(v));
  return{
    _db:db,
    onAuth:cb=>{authCb=cb;setTimeout(()=>cb(null),0)},
    signIn:async(e,p,remember=true)=>{e=e.toLowerCase();if(!db.roles[e]){const er=new Error('x');er.code='auth/invalid-credential';throw er}authCb({email:e,uid:'demo-'+e})},
    resetPw:async()=>{},
    signOut:async()=>authCb(null),
    getRole:async e=>cl(db.roles[e]),
    listRoles:async()=>Object.entries(db.roles).map(([email,v])=>({email,...cl(v)})),
    setRole:async(e,v)=>{db.roles[e]=cl(v)},
    delRole:async e=>{delete db.roles[e]},
    listUnits:async()=>Object.entries(db.units).map(([id,v])=>({id,...cl(v)})),
    getUnit:async id=>cl(db.units[id]),
    saveUnit:async(id,v)=>{db.units[id]=cl(v)},
    delUnit:async id=>{delete db.units[id]},
    getMonth:async(u,ym)=>cl(db.months[u+'/'+ym]),
    listMonths:async u=>Object.fromEntries(Object.entries(db.months).filter(([k])=>k.startsWith(u+'/')).map(([k,v])=>[k.split('/')[1],cl(v)])),
    saveMonth:async(u,ym,v)=>{db.months[u+'/'+ym]=cl(v)},
    listLeaves:async u=>Object.fromEntries(Object.entries(db.leaves).filter(([k])=>k.startsWith(u+'/')).map(([k,v])=>[k.split('/')[1],cl(v)])),
    getLeave:async(u,s)=>cl(db.leaves[u+'/'+s]),
    saveLeave:async(u,s,v)=>{db.leaves[u+'/'+s]=cl(v)},
    delLeave:async(u,s)=>{delete db.leaves[u+'/'+s]},
    purgeStaff:async(u,unit,months,ids)=>{
      db.units[u]=cl(unit);Object.entries(months).forEach(([ym,v])=>db.months[u+'/'+ym]=cl(v));
      ids.forEach(id=>delete db.leaves[u+'/'+id]);
    },
    watchUnit:()=>()=>{},watchMonth:()=>()=>{},watchLeaves:()=>()=>{},watchLeave:()=>()=>{}
  };
}
async function seedDemo(B){
  const mk=(p,list)=>list.map(([pos,name,o],i)=>Object.assign({id:p+pos[0]+(i+1),name,pos,prefix:'น.ส.',oc:true,ot:true,mock:true},o||{}));
  const ent=mk('e',[
    ['senior','กนกพร ศรีสวัสดิ์',{prefix:'นาง',posLabel:'Sup.',oc:false,ot:false}],
    ['senior','วิไลวรรณ ทองประเสริฐ',{posLabel:'CLA',oc:false,ot:false}],
    ['senior','ดารารัตน์ สุขสว่าง'],['senior','พิมพ์ชนก ศรีวงศ์'],['senior','วันเพ็ญ ทองดี'],['senior','สุดารัตน์ มานะกุล'],['senior','วิภาวรรณ แสงทอง'],['senior','กนกวรรณ รุ่งเรือง'],
    ['junior','ชุติมา ใจดี'],['junior','นงนุช บุญมา'],['junior','กัญญารัตน์ สืบสาย'],['junior','ปัณณพร ดวงดี'],['junior','พรรณี มีสุข'],['junior','ธิดารัตน์ แก้วใส'],['junior','ศศิธร พรหมมา'],['junior','อรอุมา ชัยวัฒน์'],['junior','ณัฐธิดา วงศ์ใหญ่'],['junior','เบญจมาศ สายทอง'],
    ['junior','อภิสรา นาคสวัสดิ์',{oc:false}],['junior','นันทนา พรหมดี',{oc:false}],
    ['pn','อำไพ ชื่นจิต',{prefix:'นาง',oc:false}],['pn','ปิยวรรณ เหล่าดี',{oc:false}],
    ['pn','จีรนันท์ ทองคำ'],['pn','วรารัตน์ คำแก้ว',{prefix:'นาง'}],['pn','กิตติยา ประเสริฐ'],['pn','สุนิสา แสนดี'],['pn','ปิยะนุช ศรีสุข'],['pn','อัมพร อ่อนศรี']]);
  // แก้ id ให้อ่านง่าย
  ent.forEach((s,i)=>s.id='e'+(i+1));
  const med=mk('m',[['senior','รัตนา พูลสวัสดิ์'],['senior','สมใจ แก้วมณี',{prefix:'นาง'}],['senior','อรพิน ชื่นบาน'],['senior','มาลัย ศรีทอง'],['senior','จันทร์เพ็ญ วงศ์ดี'],['senior','ประภา สุขเจริญ'],
    ['junior','กมลชนก ทองมา'],['junior','ศิริพร ใจงาม'],['junior','พัชรี บุญเกิด'],['junior','ลลิตา สมบูรณ์'],['junior','นภัสสร แสงดาว'],['junior','ปวีณา มณีรัตน์'],['junior','สุภาวดี คงดี'],['junior','อัญชลี พรมมา'],['junior','วรรณภา ศรีสุข'],['junior','ชนิดา ทองสุข'],['junior','ภัทรา ใจเย็น'],['junior','จิราพร ดีงาม'],
    ['pn','บุษบา คำดี'],['pn','สมพร แก้วกาญจน์',{prefix:'นาง'}],['pn','ละเอียด ทองใบ'],['pn','มยุรี สายบุญ'],['pn','อุไร ศรีเมือง'],['pn','ทองใบ มีชัย'],['pn','นิตยา พึ่งบุญ'],['pn','เยาวลักษณ์ คำมา']]);
  med.forEach((s,i)=>s.id='m'+(i+1));
  await B.setRole('admin@demo.local',{role:'admin',name:'ฝ่ายการพยาบาล'});
  await B.setRole('head.ent@demo.local',{role:'head',unitId:'ent-or',canEditRules:false,name:'หัวหน้าห้องผ่าตัดโสตฯ'});
  await B.setRole('nurse.ent@demo.local',{role:'nurse',unitId:'ent-or',staffId:'e9',name:'ชุติมา ใจดี'});
  await B.saveUnit('ent-or',{name:'ห้องผ่าตัดโสตฯ',staff:ent,rules:defaultRules(),shifts:defaultShifts(),paper:defaultPaper(),holidayOverrides:{},updatedAt:1});
  const r2=Object.assign(defaultRules(),{weekdayShifts:['M','A'],offShifts:['M','A'],holidaySame:false,noSameShiftConsec:false,
    need:{senior:1,junior:2,pn:1,otrn:0,otpn:0},needOff:{senior:1,junior:2,pn:1,otrn:0,otpn:0}});
  await B.saveUnit('med-w',{name:'หอผู้ป่วยอายุรกรรมหญิง',staff:med,rules:r2,shifts:Object.assign(defaultShifts(),{A:{label:'บ่าย',time:'16:00–24:00',letter:'บ'}}),paper:Object.assign(defaultPaper(),{l2:'ฝ่ายการพยาบาล งานการพยาบาลอายุรศาสตร์'}),holidayOverrides:{},updatedAt:1});
  const nm=nextMonthFromToday();
  applyUnit(await B.getUnit('ent-or'));state.year=nm.y;state.month=nm.m;state.assign={};state.unavail={};
  [['e3',[14,15,16]],['e9',[24,25]],['e23',[28]]].forEach(([id,ds])=>{state.unavail[id]={};ds.forEach(d=>state.unavail[id][isoOf(nm.y,nm.m,d)]=true)});
  for(const id in state.unavail)await B.saveLeave('ent-or',id,{dates:state.unavail[id],updatedAt:1});
  autoFill('all');state.log=[{t:'สร้างตารางตัวอย่างอัตโนมัติ',at:'—'}];
  await B.saveMonth('ent-or',ymOf(nm.y,nm.m),{...monthPayload(),updatedAt:1});
}

