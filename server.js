// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Postgres pool via DATABASE_URL (Render uses this env var)
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Google Sheets setup
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
let CREDS = null;
try {
  CREDS = process.env.GOOGLE_CREDS_JSON ? JSON.parse(process.env.GOOGLE_CREDS_JSON) : null;
} catch (e) {
  console.warn('Invalid GOOGLE_CREDS_JSON');
}
let sheet = null;

async function initGoogleSheet() {
  if (!SHEET_ID || !CREDS) {
    console.warn('Google Sheets not configured: skipping');
    return;
  }
  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(CREDS);
    await doc.loadInfo();
    sheet = doc.sheetsByIndex[0];
    console.log('Google Sheet initialized');
  } catch (err) {
    console.error('Google Sheet init error:', err);
    sheet = null;
  }
}

// Init DB schema according to your provided tables + rate_per_hour
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100),
        email VARCHAR(255),
        password_hash VARCHAR(255),
        phone VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      DROP TABLE IF EXISTS bookings CASCADE;
      DROP TABLE IF EXISTS stations CASCADE;

      CREATE TABLE IF NOT EXISTS stations (
        id SERIAL PRIMARY KEY,
        station_name VARCHAR(100) NOT NULL,
        specs TEXT,
        status VARCHAR(20) DEFAULT 'available',
        rate_per_hour DECIMAL(10,2) DEFAULT 100.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        station_id INTEGER REFERENCES stations(id),
        booking_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        duration_hours DECIMAL(5,2),
        total_price DECIMAL(10,2),
        status VARCHAR(20) DEFAULT 'confirmed',
        booking_code VARCHAR(50) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default stations if none exist (with sample rates)
    const stationsCount = await pool.query('SELECT COUNT(*) FROM stations');
    if (parseInt(stationsCount.rows[0].count, 10) === 0) {
      await pool.query(`
        INSERT INTO stations (station_name, specs, rate_per_hour) VALUES
        ('Bekal Station', 'RTX 4080, i9-13900K, 32GB RAM, 240Hz Monitor', 200.00),
        ('Mattancherry Station', 'RTX 4070, i7-13700K, 32GB RAM, 165Hz Monitor', 180.00),
        ('Padmanabha Station', 'RTX 4060 Ti, Ryzen 7 7800X3D, 16GB RAM, 144Hz Monitor', 150.00),
        ('Athirapally Station', 'RTX 4060, i5-13600K, 16GB RAM, 144Hz Monitor', 130.00),
        ('Munnar Station', 'RTX 3060, Ryzen 5 5600X, 16GB RAM, 144Hz Monitor', 100.00),
        ('Coorg Station', 'GTX 1660, i5, 16GB RAM, 60Hz Monitor', 80.00)
      `);
    }

    console.log('Database ready');
  } catch (err) {
    console.error('DB init error', err);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client', 'build')));

// Helper: parse "HH:MM" into minutes since midnight
function timeToMinutes(t) {
  if (!t) return null;
  const [hh, mm] = t.split(':').map(Number);
  return hh * 60 + mm;
}

// Helper: compute hours difference (decimal, 2dp) given start_time and end_time strings "HH:MM"
function computeDurationHours(start_time, end_time) {
  const s = timeToMinutes(start_time);
  const e = timeToMinutes(end_time);
  if (s === null || e === null) return 0;
  // If end is earlier than start, assume crossing midnight is not allowed for simplicity
  const minutes = e - s;
  return Math.round((minutes / 60) * 100) / 100; // 2 decimal places
}

// Push booking to Google Sheet (non-blocking)
async function pushBookingToSheet(row) {
  if (!sheet) return;
  try {
    await sheet.addRow(row);
  } catch (err) {
    console.error('Failed to push to sheet', err);
  }
}

// API Routes

// GET /api/stations
// Optional query params: date=YYYY-MM-DD, start_time=HH:MM, end_time=HH:MM
// If date+start_time+end_time provided, return availability for that slot
app.get('/api/stations', async (req, res) => {
  try {
    const { date, start_time, end_time } = req.query;
    const stations = (await pool.query('SELECT id, station_name, specs, status, rate_per_hour FROM stations ORDER BY id')).rows;

    if (!date || !start_time || !end_time) {
      // no slot requested — return stations as-is
      return res.json(stations.map(s => ({ ...s, available: true })));
    }

    // Check overlap: bookings where NOT (existing.end_time <= new.start_time OR existing.start_time >= new.end_time)
    const conflictRows = (await pool.query(`
      SELECT station_id FROM bookings
      WHERE booking_date = $1
        AND status IN ('confirmed', 'Active')
        AND NOT (end_time <= $2 OR start_time >= $3)
    `, [date, start_time, end_time])).rows;

    const bookedIds = conflictRows.map(r => r.station_id);
    const out = stations.map(s => ({ ...s, available: !bookedIds.includes(s.id) }));
    res.json(out);
  } catch (err) {
    console.error('Failed to load stations', err);
    res.status(500).json({ error: 'Failed to load stations' });
  }
});

// GET /api/bookings
// returns bookings joined with station_name
app.get('/api/bookings', async (req, res) => {
  try {
    const rows = (await pool.query(`
      SELECT b.*, s.station_name, s.rate_per_hour
      FROM bookings b
      LEFT JOIN stations s ON b.station_id = s.id
      ORDER BY b.booking_date DESC, b.start_time DESC
    `)).rows;
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch bookings', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// POST /api/bookings
// Body: { name, contact, station_id, booking_date (YYYY-MM-DD), start_time (HH:MM), end_time (HH:MM), user_id (optional) }
app.post('/api/bookings', async (req, res) => {
  try {
    const { name, contact, station_id, booking_date, start_time, end_time, user_id } = req.body;

    // Basic validation
    if (!name || !station_id || !booking_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate time order
    const dur = computeDurationHours(start_time, end_time);
    if (dur <= 0) return res.status(400).json({ error: 'end_time must be after start_time' });

    // Check overlapping bookings for same station on same date
    const conflicts = (await pool.query(`
      SELECT id FROM bookings
      WHERE station_id = $1
        AND booking_date = $2
        AND status IN ('confirmed', 'Active')
        AND NOT (end_time <= $3 OR start_time >= $4)
    `, [station_id, booking_date, start_time, end_time])).rows;

    if (conflicts.length > 0) {
      return res.status(400).json({ error: 'Station already booked for this time range' });
    }

    // Get station rate
    const station = (await pool.query('SELECT station_name, rate_per_hour FROM stations WHERE id=$1', [station_id])).rows[0];
    if (!station) return res.status(400).json({ error: 'Invalid station' });

    const duration_hours = dur;
    const total_price = Math.round((Number(duration_hours) * Number(station.rate_per_hour) + Number.EPSILON) * 100) / 100;

    // Create booking_code
    const booking_code = 'KB' + Date.now().toString() + crypto.randomBytes(3).toString('hex');

    const insertResult = (await pool.query(`
      INSERT INTO bookings (user_id, station_id, booking_date, start_time, end_time, duration_hours, total_price, status, booking_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [user_id || null, station_id, booking_date, start_time, end_time, duration_hours, total_price, 'confirmed', booking_code])).rows[0];

    // Push to Google Sheet (async), include station name and readable fields
    pushBookingToSheet({
      BookingCode: booking_code,
      Name: name,
      Contact: contact || '',
      Station: station.station_name,
      BookingDate: booking_date,
      StartTime: start_time,
      EndTime: end_time,
      DurationHours: duration_hours,
      TotalPrice: total_price,
      Status: 'confirmed'
    });

    res.json({ message: 'Booking created successfully', booking: insertResult });
  } catch (err) {
    console.error('Failed to create booking', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// POST /api/bookings/:id/complete
app.post('/api/bookings/:id/complete', async (req, res) => {
  try {
    const id = req.params.id;
    const updated = (await pool.query(`
      UPDATE bookings SET status = $1
      WHERE id = $2
      RETURNING *
    `, ['completed', id])).rows[0];

    if (!updated) return res.status(404).json({ error: 'Booking not found' });

    // Try to update matching row in Google Sheet (best-effort)
    if (sheet) {
      try {
        const rows = await sheet.getRows();
        // Heuristic match: booking_code if present (we stored it), else match by date+time+station_name
        let match = rows.find(r => (r.BookingCode && r.BookingCode === updated.booking_code));
        if (!match) {
          match = rows.find(r => r.Station === updated.station_id || r.Station === updated.station_name || (r.BookingDate === updated.booking_date && r.StartTime === updated.start_time && r.Name === updated.name));
        }
        if (match) {
          match.Status = 'completed';
          await match.save();
        }
      } catch (sheetErr) {
        console.error('Failed updating sheet row for completion', sheetErr);
      }
    }

    res.json({ message: 'Booking marked completed', booking: updated });
  } catch (err) {
    console.error('Failed to complete booking', err);
    res.status(500).json({ error: 'Failed to complete booking' });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  // if client build exists, serve it; otherwise respond with simple message
  const indexPath = path.join(__dirname, 'client', 'build', 'index.html');
  res.sendFile(indexPath, err => {
    if (err) {
      res.status(200).send('Kali Kalari Booking API running.');
    }
  });
});

// Start the server: initialize DB and sheet then listen
(async () => {
  await initDatabase();
  await initGoogleSheet();
  app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
})();
