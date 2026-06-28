<<<<<<< HEAD
# mapPhayao
=======
# Map Phayao

Project structure for a Leaflet frontend and Express/PostgreSQL backend.

## Frontend

Open `frontend/index.html` through Apache or another local web server.

## Backend

```bash
cd backend
npm install
npm run dev
```

Copy `.env.example` to `.env` and update the database connection values before running the backend.

For production CORS, set explicit origins:

```env
NODE_ENV=production
CORS_ORIGINS=https://example.com,https://www.example.com
```
>>>>>>> 2b49873 (first commit)
