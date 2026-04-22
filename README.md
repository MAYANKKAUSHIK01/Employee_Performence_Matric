# Developer Productivity MVP

Small full-stack MVP built from the assignment workbook.

## What this includes

- React frontend (served as static files) with:
  - Login and signup screen
  - Individual Contributor view
  - Metric interpretation (likely story)
  - 1-2 practical next-step recommendations
  - Lightweight manager summary table
- Node/Express backend that reads the Excel workbook and computes:
  - Lead Time for Changes
  - Cycle Time
  - Bug Rate
  - Deployment Frequency
  - PR Throughput

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## API endpoints

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/overview`
- `GET /api/ic/:developerId?month=YYYY-MM`
- `GET /api/manager-summary?month=YYYY-MM`

## Auth notes

- App uses session-based authentication (`express-session`).
- Signed-up users are stored in `users.json` at project root.
