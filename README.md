# Map Phayao

Web GIS สำหรับตรวจสอบข้อมูลพื้นที่และความเหมาะสมของที่ดิน
สำหรับปลูกข้าวและข้าวโพดในจังหวัดพะเยา

## Features

- เลือกจุดจากแผนที่ ลากหมุด หรือใช้ GPS
- วิเคราะห์ข้อมูลด้วย PostgreSQL/PostGIS
- แสดงความเหมาะสมสำหรับข้าวและข้าวโพด
- วาดพื้นที่แปลงชั่วคราวและวิเคราะห์แบบ Polygon
- แสดงชั้นข้อมูลผ่าน Leaflet และ GeoServer WMS
- GoogleSatellite เป็นแผนที่พื้นหลังเริ่มต้น

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

Netlify static hosting:

- Publish directory: `frontend`
- Build command: none

LINE Developers LIFF Endpoint URL:

`https://mapphayaoliff.netlify.app/?liff=1`

LIFF ID:

`2010690813-INkgQOS1`

## Backend

```bash
cd backend
npm install
npm run dev
```

Backend default:

`http://localhost:3000`

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
