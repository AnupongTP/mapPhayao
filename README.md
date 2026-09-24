# Map Phayao

Web GIS สำหรับตรวจสอบข้อมูลพื้นที่และความเหมาะสมของที่ดิน
สำหรับปลูกข้าวและข้าวโพดในจังหวัดพะเยา

## Features

- เลือกจุดจากแผนที่ ลากหมุด หรือใช้ GPS
- วิเคราะห์ข้อมูลด้วย PostgreSQL/PostGIS
- แสดงความเหมาะสมสำหรับข้าวและข้าวโพด
- วาดพื้นที่แปลงชั่วคราวและวิเคราะห์แบบ Polygon
- แสดงชั้นข้อมูลทั่วไปด้วย GeoJSON แบบ static ที่โหลดเมื่อเปิดใช้; frontend ไม่ต้องพึ่ง GeoServer WMS
- แสดงชั้นข้อมูลน้ำท่วมซ้ำซากและภัยแล้งผ่าน backend API (แผนที่น้ำท่วมใช้ 5 ปีล่าสุดที่มีข้อมูล; รายงานจุดใช้ประวัติ 10 ปี)
- GoogleSatellite เป็นแผนที่พื้นหลังเริ่มต้น
- บันทึกแปลงพร้อมรูปภาพหลายรูปได้ โดย PostgreSQL/PostGIS เก็บข้อมูลผู้ใช้และแปลงเท่านั้น, Google Drive เก็บไฟล์รูป และ Google Sheet เก็บรายการชื่อไฟล์/ลิงก์รูปพร้อม mirror ข้อมูลแปลง

## Project structure

- `frontend/` — Leaflet user interface
- `backend/` — Express API
- `database/` — migrations and SQL queries
- `data/` — GIS source datasets
- `geoserver/` — GeoServer styles

## Frontend

เปิดผ่าน Apache:

`http://localhost/mapphayao1/frontend/index.html`

Production frontend:

`https://mapphayaoliff.netlify.app/`

ระบบ production ใช้ LINE/LIFF ผ่าน Netlify frontend, Render Node/Express backend และ Supabase PostgreSQL/PostGIS; การส่งข้อความ LINE เป็นส่วนเสริม

Netlify static hosting:

- Publish directory: `frontend`
- Build command: `npm run build`

Frontend UI build:

```bash
npm install
npm run build
```

- Tailwind CSS ใช้เฉพาะ UI และปิด Preflight เพื่อไม่รบกวน Leaflet
- Font Awesome Solid ถูก self-host จากไฟล์ที่ build แล้ว
- `frontend/css/map.css` ยังคงดูแลตำแหน่งแผนที่, Leaflet และ map-specific states
- ระหว่างแก้ Tailwind ใช้ `npm run build:css:watch`

LINE Developers LIFF Endpoint URL:

`https://mapphayaoliff.netlify.app/?liff=1`

LIFF ID:

`2010690813-INkgQOS1`

## Backend

```bash
cd backend
npm install
npm start
```

Backend default:

`http://localhost:3000`

Local API: `http://localhost:3000/api`

Production Backend API:

`https://mapphayao-backend.onrender.com/api`

## Environment

คัดลอก:

```text
backend/.env.example
```

เป็น:

```text
backend/.env
```

Production Render values:

```text
PUBLIC_APP_URL=https://mapphayaoliff.netlify.app
CORS_ORIGINS=https://mapphayaoliff.netlify.app
```

แล้วกำหนดค่าการเชื่อม PostgreSQL/PostGIS

ห้าม Commit `.env`, password, token หรือ credential ขึ้น GitHub
