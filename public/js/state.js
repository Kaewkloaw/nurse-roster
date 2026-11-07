/* ---------- constants ---------- */
// ตำแหน่งของพนักงาน
const POS=[
  {key:'senior',label:'พยาบาลซีเนียร์',sheet:'RN',color:'#1C6DB0'},
  {key:'junior',label:'พยาบาลจูเนียร์',sheet:'RN',color:'#0E8A93'},
  {key:'pn',label:'ผู้ช่วยพยาบาล',sheet:'PN',color:'#C27C0E'}
];
const POSM=Object.fromEntries(POS.map(p=>[p.key,p]));
// ช่องในตารางเวร (คอลัมน์) — OC = เวรประจำ, OT = ล่วงเวลา
const SLOTS=[
  {key:'senior',label:'พยาบาลซีเนียร์',short:'RN senior',elig:['senior'],ot:false,color:'#1C6DB0',cls:'p-senior',dot:'#9CC5EC'},
  {key:'junior',label:'พยาบาลจูเนียร์',short:'RN junior',elig:['junior'],ot:false,color:'#0E8A93',cls:'p-junior',dot:'#92D3D7'},
  {key:'pn',label:'ผู้ช่วยพยาบาล',short:'PN',elig:['pn'],ot:false,color:'#C27C0E',cls:'p-pn',dot:'#EBC68C'},
  {key:'otrn',label:'OT พยาบาล',short:'OT RN',elig:['senior','junior'],ot:true,color:'#6A4FB3',cls:'p-ot',dot:'#C9B8F0'},
  {key:'otpn',label:'OT ผู้ช่วยพยาบาล',short:'OT PN',elig:['pn'],ot:true,color:'#6A4FB3',cls:'p-ot',dot:'#C9B8F0'}
];
const SLOTM=Object.fromEntries(SLOTS.map(s=>[s.key,s]));
const PREFIXES=['น.ส.','นาง','นาย'];
const SH_ORDER=['M','A'];
const SH_COLOR={M:['#FFF4CF','#7A5B00'],A:['#FFE1D2','#8A3B12']};
const TH_M=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_MS=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const DOW_S=['อา','จ','อ','พ','พฤ','ศ','ส'];
const DOW_L=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const FIXED_HOL=[[1,1,'วันขึ้นปีใหม่'],[4,6,'วันจักรี'],[4,13,'วันสงกรานต์'],[4,14,'วันสงกรานต์'],[4,15,'วันสงกรานต์'],[5,1,'วันแรงงาน'],[5,4,'วันฉัตรมงคล'],[6,3,'วันเฉลิมฯ พระราชินี'],[7,28,'วันเฉลิมฯ ร.10'],[8,12,'วันแม่แห่งชาติ'],[10,13,'วันนวมินทรมหาราช'],[10,23,'วันปิยมหาราช'],[12,5,'วันพ่อแห่งชาติ'],[12,10,'วันรัฐธรรมนูญ'],[12,31,'วันสิ้นปี']];
const FONT="Sarabun, 'Noto Sans Thai', Tahoma, sans-serif";
const ICON_LOCK='<svg class="lock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const ICON_WARN='<svg class="warn" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 3 2 21h20Z"/><path d="M12 10v5M12 18v.01"/></svg>';
const ICON_EDIT='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 20h4L19 9l-4-4L4 16Z"/></svg>';

const defaultRules=()=>({evNextMorning:true,holidaySame:true,noSameDay:true,noSameShiftConsec:true,noConsecDays:false,maxPer:0,maxOffPer:0,
  weekdayShifts:['A'],offShifts:['M','A'],need:{senior:1,junior:1,pn:1,otrn:1,otpn:1},needOff:{senior:1,junior:1,pn:1,otrn:0,otpn:0}});
const defaultShifts=()=>({M:{label:'เช้า',time:'08:00–16:00',letter:'ช'},A:{label:'เย็น',time:'16:00–24:00',letter:'ย'}});
const defaultPaper=()=>({l1:'คณะแพทยศาสตร์โรงพยาบาลรามาธิบดี',l2:'ฝ่ายการพยาบาลโรงพยาบาลรามาธิบดี งานการพยาบาลห้องผ่าตัด',l3:'จำนวนวัน และเวลาทำงานประจำเดือน',unitPrefix:'แผนกงานการพยาบาล',mark:'OC'});

/* ---------- state ---------- */
const state={dept:'',year:2026,month:11,staff:[],unavail:{},holidayOverrides:{},assign:{},rules:defaultRules(),shifts:defaultShifts(),paper:defaultPaper(),log:[]};
let legacyAssign={}; // เก็บเวร N เดิมไว้โดยไม่นำมาแสดง/คำนวณในระบบ 2 กะ
let SHIFTS=state.shifts;
let rawLocked={rules:null,shifts:null,name:''};
let undoStack=[];
let B=null, session=null, unitId=null, unsubs=[];
let saveTimer=null, saving=false, lastUnitJson='', lastMonthJson='', lastUnitAt=0, lastMonthAt=0, lastLeave={};

