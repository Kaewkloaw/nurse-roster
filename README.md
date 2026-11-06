<div align="center">
  <h1>🏥 ระบบจัดเวรพยาบาล (Nurse Roster)</h1>
    <p style="text-align: justify; line-height: 1.6;">
      เว็บแอปจัดเวรพยาบาลสำหรับ<strong>ห้องผ่าตัดและหอผู้ป่วย</strong> ใช้งานภาษาไทย แสดงวันที่เป็น พ.ศ.<br>
      ตรวจกฎการจัดเวรอัตโนมัติ จัดเวรแบบกระจายภาระงาน และส่งออกเป็นแบบฟอร์มกระดาษพร้อมพิมพ์ 🩵
    </p>

  ![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
  ![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
  ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
  ![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
  ![Firestore](https://img.shields.io/badge/Firestore-FF9100?style=for-the-badge&logo=firebase&logoColor=white)

| 1. ตารางเวร | 2. รายคน & วันไม่ว่าง | 3. รายงานจำนวนเวร | 4. ตั้งค่า & กฎ |
| :---: | :---: | :---: | :---: |
| _ใส่ภาพหน้าจอ_ | _ใส่ภาพหน้าจอ_ | _ใส่ภาพหน้าจอ_ | _ใส่ภาพหน้าจอ_ |
</div>

<div>

## ✨ ฟีเจอร์หลัก

* 🗓️ **ตารางเวรรายเดือน:** เวรเช้า/บ่าย พร้อมตรวจกฎอัตโนมัติ (เวรติดกัน, เวรบ่ายต่อเช้า, วันหยุด, เพดานต่อเดือน)
* 🤖 **จัดเวรอัตโนมัติ (Auto-fill):** จัดเวรแบบกระจายภาระงานให้เท่าเทียมกัน
* 🙋 **แจ้งวันไม่ว่าง:** พยาบาลแจ้งเอง หัวหน้าแผนกเห็นแบบเรียลไทม์
* 🖨️ **ส่งออก:** CSV และแบบฟอร์มกระดาษ (PNG) เลียนแบบตารางเวรของโรงพยาบาล
* ↩️ **Undo & ประวัติการแก้ไข:** ย้อนกลับได้ 60 ขั้น และบันทึกการเปลี่ยนแปลงรายเดือน
* 🔐 **สิทธิ์ 3 ระดับ:** แอดมิน / หัวหน้าแผนก / พยาบาล

## 🧩 โครงสร้างโปรเจกต์

```text
nurse-roster-firebase/
├── public/
│   └── index.html        <-- แอปทั้งหมด (HTML/CSS/JS ไฟล์เดียว ไม่มี build step)
├── firestore.rules       <-- สิทธิ์การเข้าถึงข้อมูล (ตัวตัดสินจริง)
├── firebase.json
├── CLAUDE.md             <-- รายละเอียดสถาปัตยกรรม
└── README.md
```

## 🌱 เริ่มต้นใช้งาน

### Step 1: ติดตั้ง Firebase CLI
ต้องมี [Node.js](https://nodejs.org) ก่อน แล้วติดตั้ง
```bash
npm install -g firebase-tools
firebase login
```

### Step 2: Clone โปรเจกต์
```bash
git clone https://github.com/Kaewkloaw/nurse-roster.git
cd nurse-roster
```

### Step 3: รันบนเครื่อง
```bash
firebase serve --only hosting --port 5000
```
เปิด http://localhost:5000

> ⚠️ บน macOS ต้องปิด AirPlay Receiver เพราะใช้พอร์ต 5000
>
> ต้องเพิ่ม `http://localhost:5000/*` ใน HTTP referrer ของ API key ที่ Google Cloud Console
> มิฉะนั้นจะเข้าสู่ระบบไม่ได้ (`auth/requests-from-referer-...-are-blocked`)

*Note: ถ้าตั้ง `apiKey` ใน `FIREBASE_CONFIG` เป็นค่าว่าง แอปจะเข้า **โหมดทดลอง** (ข้อมูลอยู่ในหน่วยความจำ หายเมื่อรีโหลด)*

## 🚀 Deploy

```bash
firebase deploy                          # ทั้งหมด
firebase deploy --only hosting           # เฉพาะเว็บ
firebase deploy --only firestore:rules   # เฉพาะ rules
```

## 🗂️ โครงสร้างข้อมูล (Firestore)

```text
roles/{email}                      role: admin | head | nurse, unitId, staffId, canEditRules, name
units/{unitId}                     name, staff[], rules, shifts, paper, holidayOverrides
units/{unitId}/months/{YYYY-MM}    assign{}, log[]
units/{unitId}/leaves/{staffId}    dates{ 'YYYY-MM-DD': true }
```

| สิทธิ์ | ทำอะไรได้ |
| :--- | :--- |
| **แอดมิน** | ทำได้ทุกอย่าง |
| **หัวหน้าแผนก** | แก้ไขแผนกและตารางเวรของตัวเอง แก้กฎ/กะได้เมื่อได้รับสิทธิ์ `canEditRules` |
| **พยาบาล** | ดูตารางเวร และแจ้งวันไม่ว่างของตัวเองเท่านั้น |

สิทธิ์บังคับใช้ใน `firestore.rules` และซ่อน/ปิด UI ฝั่งไคลเอนต์ให้ตรงกัน ดูรายละเอียดใน [CLAUDE.md](CLAUDE.md)

## 🔒 ข้อมูลส่วนบุคคล

ห้าม commit ไฟล์ CSV/PNG ที่ส่งออกจากระบบ หรือ service account key (ดู `.gitignore`)

</div>
