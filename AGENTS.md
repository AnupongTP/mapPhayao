# AGENTS.md

ระบบนี้เป็น Web GIS สำหรับตรวจสอบข้อมูลพื้นที่และความเหมาะสมของที่ดิน
สำหรับปลูกข้าวและข้าวโพดในจังหวัดพะเยา ให้อ่านไฟล์นี้ก่อนแก้โค้ดทุกครั้ง
และใช้สถานะจริงของ repository เป็นแหล่งอ้างอิงหลัก

## 1. เป้าหมายและขอบเขต

- Frontend: HTML, CSS, JavaScript, Leaflet, Leaflet Draw
- Backend: Node.js, Express
- Database: PostgreSQL/PostGIS ชื่อ `map1`
- Map service: GeoServer WMS
- Leaflet/GPS CRS: EPSG:4326
- Analysis CRS: EPSG:32647
- ห้ามเปลี่ยน framework หรือสร้าง frontend, backend, map, route, handler, renderer หรือ Layer Control ซ้ำโดยไม่ได้รับคำสั่ง

## 2. Workflow ปัจจุบันของระบบ

ระบบปัจจุบันรองรับ 2 workflow ที่ทำงานคู่กัน:

1. Point analysis จากตำแหน่งที่ผู้ใช้ยืนยัน
2. Temporary polygon analysis จากพื้นที่แปลงชั่วคราวใน frontend

หากคำสั่งใหม่ขัดกับไฟล์นี้ ให้ยึดสถานะจริงของโค้ดปัจจุบันร่วมกับคำสั่งผู้ใช้รอบนั้นเป็นหลัก

## 3. Point Workflow

ลำดับการใช้งานต้องเป็น:

1. ผู้ใช้คลิกแผนที่ ลาก marker เดิม หรือกด `หาตำแหน่งปัจจุบัน`
2. อัปเดต Latitude และ Longitude
3. ยังไม่เรียก API
4. ผู้ใช้กด `ยืนยันตำแหน่ง`
5. Frontend เรียก `GET /api/rice-suitability/point?lat={lat}&lng={lng}`
6. แสดงผล suitability ของข้าวและข้าวโพดแยกกัน

กฎสำคัญ:

- ใช้ marker เพียงอันเดียวและต้องลากได้
- GPS ต้องย้าย marker เดิม ไม่สร้าง marker ใหม่
- ใช้ `dragend` เท่านั้น ไม่เรียก API ระหว่างลาก
- ใช้ `AbortController` ยกเลิกคำขอเดิมเมื่อยืนยันซ้ำ
- ห้ามเรียก point API ตอนเปิดหน้า คลิกแผนที่ ลาก marker ใช้ GPS หรือเปิด/ปิด layer

## 4. Temporary Parcel Workflow

ระบบปัจจุบันเปิดใช้ temporary parcel drawing และต้องถือว่าเป็นพฤติกรรมที่ถูกต้องของโปรเจกต์

Current behavior:

- ใช้ Leaflet Draw Polygon
- รองรับหลาย temporary parcels
- ตั้งชื่อแปลงอัตโนมัติและเปลี่ยนชื่อได้
- เลือกแปลง, focus แปลง, เปิดรายละเอียด, edit, delete และ retry analysis ได้
- มี concise parcel popup
- มี drawing toggle
- กด `Escape` เพื่อยกเลิกการวาดที่ยังไม่เสร็จได้

Parcel analysis endpoint:

`POST /api/area-analysis/polygon`

กฎสำคัญ:

- parcels อยู่ใน frontend JavaScript memory เท่านั้น
- refresh หรือปิดหน้าเว็บแล้ว parcels หายทั้งหมด
- ห้ามใช้ `localStorage`
- ห้ามใช้ `sessionStorage`
- ห้ามใช้ `IndexedDB`
- ห้าม persist parcels ลงฐานข้อมูลโดยอัตโนมัติ
- Frontend ปัจจุบันต้องไม่เรียก `/api/parcels` หากไม่มีคำสั่งใหม่ชัดเจน
- การยกเลิก unfinished drawing ต้องไม่ลบ completed parcels

Backend code ของ `/api/parcels` อาจยังอยู่ใน repository ได้ แต่ temporary parcel frontend ปัจจุบันต้องไม่ผูกกับ route นี้

## 5. Database และ GIS

Database: `map1`

Schemas:

- `gis`: ข้อมูลใช้งานจริง
- `raw`: ข้อมูลนำเข้าต้นฉบับ
- `ref`: ตารางอ้างอิง
- `app`: ข้อมูลระบบหรือกฎธุรกิจ
- `staging`: ข้อมูลชั่วคราวหรือใช้แก้ไข
- `backup`: ข้อมูลสำรอง

Known GIS objects:

- `gis.amphoe`
- `gis.tambon`
- `gis.basin`
- `gis.stream`
- `gis.irrigation_canal`
- `gis.soil`
- `gis.soil_enriched_basic`
- `gis.basin_main`
- `gis.sub_basin_display`
- `gis.rice_potential`
- `gis.maize_potential`

ห้ามเดาชื่อคอลัมน์ ให้ตรวจ schema จริงก่อนเขียน SQL

CRS rules:

- รับพิกัดจาก Leaflet/GPS เป็น EPSG:4326
- สร้างจุดด้วย `ST_MakePoint(longitude, latitude)`
- transform ไป EPSG:32647 ก่อนใช้วิเคราะห์ GIS
- ห้ามใช้ `ST_SetSRID` แทนการ transform พิกัด

SQL rules:

- ใช้ parameterized SQL เท่านั้น
- Polygon lookup ใช้ `ST_Covers`
- nearest candidate ordering ใช้ `<->`
- ระยะจริงใช้ `ST_Distance`
- ไม่ส่ง geometry กลับ API หากไม่จำเป็น
- ห้าม `SELECT *`
- ตรวจ schema จริง, SRID, geometry type, row count, null และ invalid geometry ก่อนแก้ SQL สำคัญ

## 6. Suitability Results

Point และ polygon result ต้องรองรับทั้ง:

- `riceLandSuitability`
- `maizeLandSuitability`

Classes:

- `S1` = เหมาะสมมาก
- `S2` = เหมาะสมปานกลาง
- `S3` = เหมาะสมน้อย
- `N` = ไม่เหมาะสม

กฎสำคัญ:

- `NO_DATA` ไม่ใช่ `N`
- `NO_COVERAGE` ไม่ใช่ `N`
- ต้องแสดง rice และ maize แยกกัน
- ห้ามสร้าง combined crop score
- ห้ามแนะนำว่าควรปลูกพืชชนิดใด
- ห้ามสร้างค่าข้อมูล GIS ที่ไม่มีจริง
- ต้องคง source attribution ให้มองเห็นได้

## 7. API และการแสดงผล

Current endpoints:

- `GET /api/health`
- `GET /api/health/database`
- `GET /api/rice-suitability/point`
- `POST /api/area-analysis/polygon`

Validation สำหรับ point endpoint:

- `lat` และ `lng` ต้องมีและเป็นตัวเลข
- `latitude` อยู่ระหว่าง -90 ถึง 90
- `longitude` อยู่ระหว่าง -180 ถึง 180
- ค่าไม่ถูกต้องตอบ HTTP 400
- database error ตอบ HTTP 500 ผ่าน error handler เดิม
- จุดนอกพื้นที่ตอบ HTTP 200 พร้อม `success: true, found: false`

Frontend rules:

- แสดงรายละเอียดหลังผู้ใช้กดยืนยันตำแหน่งหรือเลือก parcel ที่มีผลวิเคราะห์แล้วเท่านั้น
- แสดง suitability ของข้าวและข้าวโพดแยกกัน
- Popup ของจุดและ parcel ต้องเป็นข้อมูลสรุปเท่านั้น
- ค่า `null`, `undefined`, `NaN` หรือค่าว่าง ให้แสดง `ไม่มีข้อมูล`
- ระยะ < 1,000 เมตรใช้เมตร
- ระยะ >= 1,000 เมตรใช้กิโลเมตร ไม่เกิน 2 ตำแหน่ง
- ห้ามใช้ raw API content กับ `innerHTML` โดยไม่ sanitize
- ใช้ `textContent` หรือ safe DOM เป็นหลัก

## 8. Leaflet และ GeoServer

Basemap ปัจจุบัน:

- `GoogleSatellite` เป็น basemap ที่ active ตอนเริ่ม
- `GoogleSatellite` อยู่ลำดับแรกใน Layer Control
- `OpenStreetMap` อยู่ลำดับที่สอง
- ตอนเริ่มต้องมี active basemap เพียงหนึ่งตัว

Overlay rules:

- Optional WMS overlays ควรปิดไว้ก่อน ยกเว้นโค้ดปัจจุบันเปิดใช้อย่างชัดเจน
- Layer Control อยู่ `topleft`
- ห้ามสร้าง Layer Control ซ้ำ
- WMS style แก้ใน GeoServer SLD ไม่ใช่ Leaflet CSS
- ตรวจ workspace, layer name, CRS, bounding box, style และ Layer Preview ก่อนเพิ่ม WMS
- marker, popup และ UI ต้องอยู่เหนือ WMS polygons

## 9. CORS, Security และ Middleware

Development origins:

- `http://localhost`
- `http://127.0.0.1`
- `http://localhost:5500`
- `http://127.0.0.1:5500`

Production origins มาจาก `CORS_ORIGINS`

ห้าม:

- ใช้ `mode: "no-cors"`
- hardcode password, token หรือ credential
- เปิด PostgreSQL ให้ frontend ติดต่อโดยตรง
- ต่อ SQL จาก input ผู้ใช้
- แสดง stack trace, connection string หรือ path ภายในใน response

Middleware order:

1. CORS
2. `express.json()`
3. routes
4. 404 middleware
5. error handler

## 10. วิธีทำงานของ Codex

ก่อนแก้:

1. ตรวจ project tree และไฟล์จริง
2. ตรวจโค้ด frontend, backend, SQL, route และ layer ที่เกี่ยวข้อง
3. ใช้สถานะจริงของ repository เป็น source of truth
4. รายงานสั้น ๆ ว่าจะเปลี่ยนไฟล์ใดและเพราะอะไร

ระหว่างแก้:

- ทำการเปลี่ยนแปลงให้น้อยและตรงจุดที่สุด
- รักษาโครงสร้างและ coding style เดิม
- ห้ามสร้าง implementation ซ้ำ
- ห้าม duplicate map, Layer Control, event handler, route หรือ renderer
- ห้ามแก้ไฟล์หรือฐานข้อมูลที่ไม่เกี่ยวข้อง
- ห้ามทำ whole-file encoding conversion
- ต้องรักษา UTF-8 ภาษาไทยให้ถูกต้อง
- ใช้ Git diff เป็น backup หลักสำหรับ source change ปกติ
- ห้ามสร้าง tracked backup files
- หากมีคำสั่งให้ทำ manual backup โดยชัดเจน ให้เก็บไว้ใต้ path ที่ถูก ignore เท่านั้น
- ห้ามใช้ destructive Git/database commands โดยไม่มีคำสั่งชัดเจน

หลังแก้:

- รายงานไฟล์ที่แก้
- รายงาน database หรือ GeoServer changes ถ้ามี
- ระบุสิ่งที่ทดสอบจริง
- ระบุสิ่งที่ไม่ได้ทดสอบและเหตุผล
- ห้ามอ้างว่าทดสอบผ่านหากไม่ได้รันจริง

## 11. การทดสอบขั้นต่ำ

Frontend:

- หน้าเว็บโหลดได้ และ GoogleSatellite active ตอนเริ่ม
- Layer Control เรียง `GoogleSatellite` ก่อน `OpenStreetMap`
- optional overlays มีสถานะตรงกับโค้ดจริง
- คลิกแผนที่, ลาก marker และ GPS อัปเดต marker เดิมและพิกัด
- ไม่มี point API call ก่อนกดยืนยัน
- กดยืนยันหนึ่งครั้งเรียก point API หนึ่งครั้ง
- ผล point แสดงข้าวและข้าวโพดแยกกัน
- วาด temporary polygon ได้
- draw toggle ทำงาน และกด `Escape` เพื่อยกเลิก unfinished drawing ได้
- completed temporary parcels ต้องไม่หายเมื่อยกเลิก unfinished drawing
- polygon analysis ผ่าน `POST /api/area-analysis/polygon`
- refresh clears temporary parcels
- frontend ต้องไม่เรียก `/api/parcels`
- ไม่มี duplicate handlers หรือ duplicate Layer Control
- ไม่มี console error ใหม่
- ภาษาไทยยังเป็น UTF-8 ถูกต้อง

Backend:

- `/api/health` = 200
- `/api/health/database` = 200
- ทดสอบ point API ทั้งพิกัดถูกต้อง, นอกพื้นที่, ค่าหาย, ค่าผิดชนิด และเกินช่วง
- ทดสอบ polygon API ด้วย payload ที่ถูกต้องและ payload ที่ผิดรูปแบบ
- response ไม่มี geometry หรือ credential ที่ไม่จำเป็น

## 12. หลักการสุดท้าย

ให้ความสำคัญตามลำดับ:

1. ความถูกต้องของ GIS และข้อมูลจริง
2. ไม่สร้างผลหรือข้อสรุปที่ไม่มีแหล่งรองรับ
3. ความแยกชัดเจนระหว่าง point workflow กับ temporary parcel workflow
4. ภาษาไทยที่เข้าใจง่ายและ UTF-8 ไม่เสีย
5. ความปลอดภัยและโค้ดที่ดูแลต่อได้
6. การแก้ไขให้น้อยและทดสอบตามขอบเขต

สถานะจริงของ repository, database และ GeoServer คือแหล่งอ้างอิงหลัก
