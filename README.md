# Kali Kalari - Gaming Cafe Booking (Postgres + Google Sheets)

This repository contains a React frontend and an Express backend. Bookings are stored in PostgreSQL and backed up to Google Sheets.

## Quickstart (local)

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies: `npm install`
3. Install client and build (postinstall will run automatically on deploy): `npm run postinstall`
4. Start server: `npm start`

## Deploy on Render

- Connect repo, set environment variables (DATABASE_URL, GOOGLE_SHEET_ID, GOOGLE_CREDS_JSON).
- Build Command: `npm install && npm run postinstall`
- Start Command: `npm start`
