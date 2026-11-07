/* =====================================================================
   1) ตั้งค่า Firebase — โปรเจกต์ nurseroster-df4d8
   ถ้าลบ apiKey หรือใส่ค่าที่ขึ้นต้นด้วย "ใส่" ระบบจะใช้โหมดทดลองแบบไม่บันทึกข้อมูล
   ===================================================================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA6Jgx5bEd39bMDjWR4zM7LXlGF8I32BCs",
  authDomain: "nurseroster-df4d8.firebaseapp.com",
  projectId: "nurseroster-df4d8",
  storageBucket: "nurseroster-df4d8.firebasestorage.app",
  messagingSenderId: "43881805557",
  appId: "1:43881805557:web:a3956ec1ea40b7f923f7bc"
};
const FB_VER = '10.12.2';
const DEMO = !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith('ใส่');

