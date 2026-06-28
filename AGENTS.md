# AGENTS.md

ระบบนี้เป็น Web GIS แบบเลือกจุดสำหรับตรวจสอบข้อมูลพื้นที่และความเหมาะสมของที่ดินสำหรับปลูกข้าวในจังหวัดพะเยา อ่านไฟล์นี้ก่อนแก้โค้ดทุกครั้ง และให้สถานะจริงของโปรเจกต์เป็นแหล่งอ้างอิงหลัก

## 1. เป้าหมายและขอบเขต

- Frontend: HTML, CSS, JavaScript, Leaflet
- Backend: Node.js, Express
- Database: PostgreSQL/PostGIS ชื่อ `map1`
- Map service: GeoServer WMS
- วิเคราะห์จากจุดที่ผู้ใช้ยืนยันเท่านั้น
- ห้ามเปลี่ยน framework หรือสร้าง frontend, backend, map, route หรือ layer control ซ้ำโดยไม่ได้รับคำสั่ง

## 2. โหมดใช้งานปัจจุบัน: Point-based only

ลำดับการใช้งานต้องเป็น:

1. ผู้ใช้คลิกแผนที่ ลากหมุดเดิม หรือกด `หาตำแหน่งปัจจุบัน`
2. อัปเดต Latitude และ Longitude
3. ยังไม่เรียก API
4. ผู้ใช้กด `ยืนยันตำแหน่ง`
5. เรียก `GET /api/rice-suitability/point?lat={lat}&lng={lng}` เพียงครั้งเดียว
6. แสดงผลข้อมูล GIS ของจุดนั้น

กฎสำคัญ:

- ใช้ marker เพียงอันเดียวและต้องลากได้
- GPS ต้องย้าย marker เดิม ไม่สร้าง marker ใหม่
- ใช้ `dragend` เท่านั้น ไม่เรียก API ระหว่างลาก
- ใช้ `AbortController` ยกเลิกคำขอเดิมเมื่อยืนยันซ้ำ
- ห้ามเรียก point API ตอนเปิดหน้า คลิกแผนที่ ลากหมุด ใช้ GPS หรือเปิด/ปิด layer

## 3. ห้ามเปิดระบบวาดแปลง

ระบบปัจจุบันห้ามมี:

- ปุ่ม `วาดแปลงเกษตร`
- Leaflet Draw หรือ drawing toolbar
- การวาด แก้ไข บันทึก หรือลบ Polygon/MultiPolygon
- การโหลด `/api/parcels` อัตโนมัติ
- การแสดงแปลงที่บันทึกไว้
- รหัสแปลง พื้นที่แปลง ชนิดพืช พันธุ์ข้าว หรือวันที่ปลูกใน result card

ตาราง route migration หรือโค้ด parcel เดิมเก็บไว้ได้ แต่ต้องไม่ทำงานใน frontend และห้ามลบข้อมูลใน `app.parcels` โดยไม่ได้รับคำสั่งชัดเจน

ห้ามนำคำสั่งจาก prompt เก่า session เก่า หรืองานที่ค้างอยู่กลับมาใช้ หากขัดกับไฟล์นี้หรือคำสั่งปัจจุบัน

## 4. Database และ GIS

Database: `map1`

Schemas:

- `gis`: ข้อมูลใช้งานจริง
- `raw`: ข้อมูลนำเข้าต้นฉบับ
- `ref`: ตารางอ้างอิง
- `app`: ข้อมูลระบบหรือกฎธุรกิจ
- `staging`: ข้อมูลชั่วคราว/แก้ไข
- `backup`: สำรองข้อมูล

Known GIS objects:

- `gis.amphoe`
- `gis.tambon`
- `gis.basin`
- `gis.soil`
- `gis.stream`
- `gis.irrigation_canal`
- `gis.soil_enriched_basic`
- `gis.basin_main`
- `gis.sub_basin_display`
- `gis.rice_potential`

ห้ามเดาชื่อคอลัมน์ ให้ตรวจ schema จริงก่อนเขียน SQL

CRS:

- Leaflet/GPS: EPSG:4326
- GIS analysis: EPSG:32647
- `ST_MakePoint(longitude, latitude)` แล้ว `ST_Transform(..., 32647)`
- ห้ามใช้ `ST_SetSRID` แทนการ transform พิกัด

SQL:

- ใช้ parameterized SQL เท่านั้น
- Polygon lookup ใช้ `ST_Covers`
- Nearest feature ใช้ `<->` และคำนวณระยะจริงด้วย `ST_Distance`
- ไม่ส่ง geometry กลับ API หากไม่จำเป็น
- ห้าม `SELECT *`
- ตรวจ SRID, geometry type, row count, null และ invalid geometry ก่อนแก้ table/view

## 5. ผลความเหมาะสมของข้าว

`gis.rice_potential` คือชั้นข้อมูล Potential ข้าวของกรมพัฒนาที่ดิน ใช้ overlay จุดที่ยืนยันแล้วเพื่อคืนค่า:

- `S1` = เหมาะสมมาก
- `S2` = เหมาะสมปานกลาง
- `S3` = เหมาะสมน้อย
- `N` = ไม่เหมาะสม

แสดงชื่อหัวข้อว่า:

`ความเหมาะสมของที่ดินสำหรับปลูกข้าว`

ต้องแยกข้อมูลออกเป็น:

- `soil`: รายละเอียดชุดดินและสถานะความครบถ้วน
- `riceLandSuitability`: ผล Potential จากกรมพัฒนาที่ดิน
- `suitability.finalClass`: ผลรวมทุกปัจจัยในอนาคต

กฎ:

- `NO_DATA` ไม่ใช่ `N`
- `PARTIAL_DATA` ไม่ใช่ `N`
- soil เป็น `PARTIAL_DATA` ได้ แม้ Potential จะมี S1/S2/S3/N
- ห้ามคัดลอก Potential ไปเป็น `finalClass`
- จนกว่าน้ำ ชลประทาน และภูมิประเทศจะครบ ให้ `finalClass: null` และสถานะรวมเป็น `PARTIALLY_EVALUATED` หรือ `NOT_EVALUATED` ตามโค้ดจริง
- ห้ามสร้าง class, ปีข้อมูล, คุณสมบัติดิน หรือคำแนะนำพันธุ์ข้าวขึ้นเอง

สถานะข้อมูลดิน:

- `AVAILABLE` = มีข้อมูลพร้อมใช้งาน
- `PARTIAL_DATA` = มีข้อมูลดินบางส่วน
- `NO_DATA` = ข้อมูลไม่เพียงพอ
- `NOT_EVALUATED` = ยังไม่ได้ประเมิน

## 6. API และการแสดงผล

Point endpoint:

`GET /api/rice-suitability/point?lat={latitude}&lng={longitude}`

Validation:

- lat/lng ต้องมีและเป็นตัวเลข
- latitude อยู่ระหว่าง -90 ถึง 90
- longitude อยู่ระหว่าง -180 ถึง 180
- ค่าไม่ถูกต้องตอบ HTTP 400
- database error ตอบ HTTP 500 ผ่าน error handler เดิม
- จุดนอกพื้นที่ตอบ HTTP 200 พร้อม `success: true, found: false`

ผลลัพธ์ควรมี:

- clicked point
- จังหวัด อำเภอ ตำบล ลุ่มน้ำหลัก/ย่อย
- ข้อมูลชุดดิน
- ลำน้ำและคลองชลประทานที่ใกล้ที่สุด
- `riceLandSuitability`
- `suitability` โดย `finalClass` ยังเป็น null

Frontend:

- แสดงรายละเอียดหลังผู้ใช้กดยืนยันเท่านั้น
- แสดง S1/S2/S3/N พร้อมคำภาษาไทยและแหล่งข้อมูลกรมพัฒนาที่ดิน
- แสดงผลรวมแยกเป็น `ยังไม่ได้ประเมินครบทุกปัจจัย`
- Popup แสดงเฉพาะข้อมูลสรุป
- ค่า null/undefined/NaN/ว่าง ให้แสดง `ไม่มีข้อมูล`
- ระยะ < 1,000 เมตรใช้เมตร; ตั้งแต่ 1,000 เมตรใช้กิโลเมตร ไม่เกิน 2 ตำแหน่ง
- ห้ามใช้ raw API content กับ `innerHTML` โดยไม่ sanitize; ใช้ `textContent` หรือ safe DOM

## 7. Leaflet และ GeoServer

- OpenStreetMap เป็น basemap เริ่มต้น
- เปิด basemap เริ่มต้นเพียงหนึ่งตัว
- Optional overlays ต้องปิดไว้ก่อน แต่ยังอยู่ใน Layer Control
- Layer Control อยู่ `topleft` ใต้ zoom control
- ห้ามสร้าง Layer Control ซ้ำ
- WMS style แก้ใน GeoServer SLD ไม่ใช่ Leaflet CSS
- ตรวจ workspace, layer name, CRS, bounding box, style และ Layer Preview ก่อนเพิ่ม WMS
- `rice_gis:basin_main` และ `rice_gis:sub_basin_display` เป็น optional overlay
- marker, popup และ UI ต้องอยู่เหนือ WMS polygons

## 8. CORS, security และ middleware

Development origins:

- `http://localhost`
- `http://127.0.0.1`
- `http://localhost:5500`
- `http://127.0.0.1:5500`

Production origins มาจาก `CORS_ORIGINS`

ห้าม:

- ใช้ `mode: "no-cors"`
- hardcode password หรือ credential
- เปิด PostgreSQL ให้ frontend ติดต่อโดยตรง
- ต่อ SQL จาก input ของผู้ใช้
- แสดง stack trace, connection string หรือ path ภายใน

Middleware order:

1. CORS
2. `express.json()`
3. routes
4. 404 middleware
5. error handler

ต้องรักษา endpoints:

- `GET /api/health`
- `GET /api/health/database`

## 9. วิธีทำงานของ Codex

ก่อนแก้:

1. ตรวจ project tree และไฟล์จริง
2. ตรวจโค้ด frontend/backend/SQL ที่เกี่ยวข้อง
3. ตรวจ schema, route และ layer จริง ห้ามเดา
4. รายงานสั้น ๆ ว่าจะเปลี่ยนไฟล์ใดและเพราะอะไร
5. สำรองไฟล์ก่อนแก้ หาก workspace ไม่มี Git

ระหว่างแก้:

- ทำการเปลี่ยนแปลงให้น้อยและตรงจุดที่สุด
- รักษาโครงสร้างและ coding style เดิม
- ห้ามสร้าง implementation ซ้ำ
- ห้ามแก้ไฟล์หรือฐานข้อมูลที่ไม่เกี่ยวข้อง
- ห้ามใช้ destructive Git/database commands
- Current user request + ไฟล์นี้ มีลำดับสูงกว่า prompt หรือ task เก่า

หลังแก้:

- รายงานไฟล์ที่แก้/สร้าง
- รายงาน database หรือ GeoServer changes
- ระบุสิ่งที่ทดสอบจริงและสิ่งที่ไม่ได้ทดสอบ
- ห้ามอ้างว่าทดสอบผ่านหากไม่ได้รันจริง

## 10. การทดสอบขั้นต่ำ

Frontend:

- หน้าเว็บและ OSM โหลดได้
- optional overlays ปิดตอนเริ่ม
- คลิกแผนที่/ลาก marker/GPS อัปเดต marker เดิมและพิกัด
- ไม่มีการเรียก API ก่อนยืนยัน
- ยืนยันหนึ่งครั้งเรียก point API หนึ่งครั้ง
- ไม่มีปุ่มวาดแปลง ไม่มี Leaflet Draw และไม่มี request `/api/parcels`
- ผล S1/S2/S3/N แสดงตาม API จริง
- `found: false` แสดงข้อความพื้นที่ไม่ครอบคลุม
- ไม่มี console error ใหม่

Backend:

- `/api/health` = 200
- `/api/health/database` = 200
- ทดสอบ point API ทั้งพิกัดถูกต้อง นอกพื้นที่ ค่าหาย ค่าผิดชนิด และเกินช่วง
- response ไม่มี geometry/credential ที่ไม่จำเป็น
- ภาษาไทยไม่เสีย
- `finalClass` ยังเป็น null

## 11. หลักการสุดท้าย

ให้ความสำคัญตามลำดับ:

1. ความถูกต้องของ GIS และข้อมูลจริง
2. ไม่สร้างผลหรือข้อสรุปที่ไม่มีแหล่งรองรับ
3. Point-based workflow ที่เรียบง่าย
4. ภาษาไทยที่เข้าใจง่าย
5. ความปลอดภัยและโค้ดที่ดูแลต่อได้
6. การแก้ไขให้น้อยและทดสอบตามขอบเขต

สถานะจริงของ repository, database และ GeoServer คือแหล่งอ้างอิงหลัก แต่ห้ามขัดกับกฎถาวรในไฟล์นี้
