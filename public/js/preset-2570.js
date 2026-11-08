/* =====================================================================
   ข้อมูลตั้งต้นตารางเวรปี พ.ศ. 2570 (ห้องผ่าตัด) — ใช้ตอนสร้างแผนกใหม่ (แอดมิน)
   รายชื่อ 22 คน + ลำดับคิวหมุนเวร OT และเวรวันนักขัตฤกษ์
   ===================================================================== */
const PRESET_2570={
  label:'ข้อมูลตั้งต้นปี 2570 (22 คน + คิวหมุนเวร OT / นักขัตฤกษ์)',
  start:'2027-01-01', // 1 ม.ค. 2570
  senior:['พิมพ์พจี','วันวิสา','วิภา','สุดา','รัชนก'],
  junior:['ชุติกาญจน์','นงลักษณ์','กาญญารัตน์','ปัญญาพร','พรญาณี','อติกานต์','ธันยพร'],
  pn:['ช่อทิพย์','จีราวัลย์','วราภรณ์','กิตติมา'],
  otOnlyRN:['ศศิกาญจน์','อภิญญา','นรติมา'],
  otOnlyPN:['ปรางค์ทิพย์','จิราภา','กุลณัฐ'],
  otrn:['พิมพ์พจี','วันวิสา','วิภา','สุดา','รัชนก','ชุติกาญจน์','นงลักษณ์','กาญญารัตน์','ปัญญาพร','พรญาณี','อติกานต์','ธันยพร','ศศิกาญจน์','อภิญญา','นรติมา'],
  otpn:['กิตติมา','ปรางค์ทิพย์','จิราภา','กุลณัฐ','ช่อทิพย์','จีราวัลย์','วราภรณ์'],
  // คิวนักขัตฤกษ์: คนแรก = คนที่ได้วันหยุดแรก (1 ม.ค. 2570)
  holStart:{senior:'พิมพ์พจี',junior:'พรญาณี',pn:'ช่อทิพย์'},
  // ตารางเวรวันหยุด 1–3 ม.ค. 2570 กำหนดคนตายตัว [RN Senior, RN Junior, PN] — คิวนักขัตฤกษ์ไล่ต่อจากตารางนี้
  pins:{'2027-01-01':['พิมพ์พจี','พรญาณี','ช่อทิพย์'],'2027-01-02':['วันวิสา','อติกานต์','จีราวัลย์'],'2027-01-03':['วิภา','ธันยพร','วราภรณ์']},
  // 2–3 ม.ค. 2570 เป็นเสาร์-อาทิตย์ แต่จัดเวรแบบวันหยุดนักขัตฤกษ์
  holidays:{'2027-01-02':'วันหยุดปีใหม่','2027-01-03':'วันหยุดปีใหม่'}
};
// แปลงตาราง pins (ชื่อ) เป็น id ด้วยฟังก์ชันหาชื่อที่ส่งเข้ามา
function presetPins(idOf){const out={};for(const iso in PRESET_2570.pins){const [a,b,c]=PRESET_2570.pins[iso].map(idOf);out[iso]={senior:a||null,junior:b||null,pn:c||null};}return out}
function buildPreset2570(){
  const P=PRESET_2570,base='x'+Date.now().toString(36);let n=0;const staff=[];
  const add=(pos,name,o)=>staff.push(Object.assign({id:base+'-'+(++n),name,pos,prefix:'น.ส.',oc:true,ot:true},o||{}));
  P.senior.forEach(nm=>add('senior',nm));P.junior.forEach(nm=>add('junior',nm));P.pn.forEach(nm=>add('pn',nm));
  P.otOnlyRN.forEach(nm=>add('junior',nm,{oc:false}));P.otOnlyPN.forEach(nm=>add('pn',nm,{oc:false}));
  const ids=names=>names.map(nm=>staff.find(s=>s.name===nm).id);
  const from=(list,first)=>{const i=list.indexOf(first);return ids([...list.slice(i),...list.slice(0,i)])};
  const rules=defaultRules();
  rules.rotation={on:true,start:P.start,otrn:ids(P.otrn),otpn:ids(P.otpn),
    hol:{senior:from(P.senior,P.holStart.senior),junior:from(P.junior,P.holStart.junior),pn:from(P.pn,P.holStart.pn)},
    pins:presetPins(nm=>{const s=staff.find(x=>x.name===nm);return s&&s.id})};
  return{staff,rules,holidayOverrides:Object.assign({},P.holidays)};
}
