# ระบบจัดเวรพยาบาล (Nurse Roster)

เว็บแอปจัดเวรพยาบาลสำหรับห้องผ่าตัดและหอผู้ป่วย ใช้งานภาษาไทย แสดงวันที่เป็น พ.ศ.
เป็นไฟล์เดียว (`public/index.html`) ไม่มี build step ใช้ Firebase Hosting + Firestore + Authentication

## ฟีเจอร์

- ตารางเวรรายเดือน เวรเช้า/บ่าย พร้อมตรวจกฎอัตโนมัติ (เวรติดกัน, เวรบ่ายต่อเช้า, วันหยุด, เพดานต่อเดือน)
- จัดเวรอัตโนมัติ (auto-fill) แบบกระจายภาระงาน
- แจ้งวันไม่ว่างโดยพยาบาลเอง หัวหน้าแผนกเห็นแบบเรียลไทม์
- ส่งออก CSV และแบบฟอร์มกระดาษ (PNG)
- Undo ย้อนหลัง และบันทึกประวัติการแก้ไข
- สิทธิ์ผู้ใช้ 3 ระดับ: แอดมิน / หัวหน้าแผนก / พยาบาล

## รันบนเครื่อง

```bash
firebase serve --only hosting --port 5000
```

เปิด http://localhost:5000 (บน macOS ต้องปิด AirPlay Receiver เพราะใช้พอร์ต 5000)

ต้องเพิ่ม `http://localhost:5000/*` ใน HTTP referrer ของ API key ที่ Google Cloud Console
มิฉะนั้นจะเข้าสู่ระบบไม่ได้ (`auth/requests-from-referer-...-are-blocked`)

ถ้าตั้ง `apiKey` เป็นค่าว่างใน `FIREBASE_CONFIG` แอปจะเข้าโหมดทดลอง (ข้อมูลในหน่วยความจำ หายเมื่อรีโหลด)

## Deploy

```bash
firebase deploy                          # ทั้งหมด
firebase deploy --only hosting           # เฉพาะเว็บ
firebase deploy --only firestore:rules   # เฉพาะ rules
```

## โครงสร้างข้อมูล

```
roles/{email}                      role: admin | head | nurse, unitId, staffId, canEditRules, name
units/{unitId}                     name, staff[], rules, shifts, paper, holidayOverrides
units/{unitId}/months/{YYYY-MM}    assign{}, log[]
units/{unitId}/leaves/{staffId}    dates{ 'YYYY-MM-DD': true }
```

สิทธิ์บังคับใช้ใน `firestore.rules` และซ่อน/ปิด UI ฝั่งไคลเอนต์ให้ตรงกัน ดูรายละเอียดสถาปัตยกรรมใน [CLAUDE.md](CLAUDE.md)

## ข้อมูลส่วนบุคคล

ห้าม commit ไฟล์ CSV/PNG ที่ส่งออกจากระบบ หรือ service account key (ดู `.gitignore`)
