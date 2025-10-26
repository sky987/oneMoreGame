const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
const PORT = process.env.PORT || 3000;

// Postgres pool via DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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

    // v4 auth method
    await doc.useServiceAccountAuth({
      client_email: CREDS.client_email,
      private_key: CREDS.private_key.replace(/\\n/g, '\n'),
    });

    await doc.loadInfo();
    sheet = doc.sheetsByIndex[0];
    console.log('✅ Google Sheet initialized');
  } catch (err) {
    console.error('❌ Google Sheet init error:', err);
    sheet = null;
  }
}

// Initialize DB tables
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stations (
        id SERIAL PRIMARY KEY,
        station_name VARCHAR(100) NOT NULL,
        specs TEXT,
        status VARCHAR(20) DEFAULT 'available',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_name VARCHAR(150) NOT NULL,
        contact VARCHAR(80),
        station_id INTEGER REFERENCES stations(id),
        booking_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        duration_hours DECIMAL(3,1),
        total_price DECIMAL(10,2),
        status VARCHAR(20) DEFAULT 'confirmed',
        booking_code VARCHAR(50) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const { rows } = await pool.query('SELECT COUNT(*) FROM stations');
    if (parseInt(rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO stations (station_name) VALUES
        ('Station 1'),('Station 2'),('Station 3'),('Station 4'),('Station 5'),('Station 6')
      `);
    }
    console.log('✅ Database ready');
  } catch (err) {
    console.error('DB init error', err);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client', 'build')));

// Push booking to Google Sheet (non-blocking)
async function pushBookingToSheet(row) {
  if (!sheet) return;
  try {
    await sheet.addRow(row);
  } catch (err) {
    console.error('Failed to push booking to Google Sheet', err);
  }
}

// GET stations (optionally ?datetime=YYYY-MM-DD)
app.get('/api/stations', async (req, res) => {
  try {
    const { datetime } = req.query;
    const stations = (await pool.query('SELECT * FROM stations ORDER BY id')).rows;

    if (!datetime) return res.json(stations);

    const booked = (
      await pool.query(
        `SELECT station_id FROM bookings WHERE booking_date=$1 AND status='confirmed'`,
        [datetime]
      )
    ).rows.map(r => r.station_id);

    const out = stations.map(s => ({
      ...s,
      status: booked.includes(s.id) ? 'Occupied' : 'Available',
    }));

    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stations' });
  }
});

// GET bookings
app.get('/api/bookings', async (req, res) => {
  try {
    const rows = (
      await pool.query(`
        SELECT b.*, s.station_name
        FROM bookings b
        LEFT JOIN stations s ON b.station_id = s.id
        ORDER BY b.booking_date DESC, b.start_time DESC
      `)
    ).rows;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// POST create booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { user_name, contact, station_id, booking_date, start_time, end_time, duration_hours, total_price } = req.body;
    if (!user_name || !station_id || !booking_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // check availability
    const existing = (
      await pool.query(
        `SELECT * FROM bookings WHERE station_id=$1 AND booking_date=$2 AND start_time=$3 AND status='confirmed'`,
        [station_id, booking_date, start_time]
      )
    ).rows;

    if (existing.length > 0) return res.status(400).json({ error: 'Station already booked for this time' });

    const result = (
      await pool.query(
        `INSERT INTO bookings
        (user_name, contact, station_id, booking_date, start_time, end_time, duration_hours, total_price)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *`,
        [user_name, contact, station_id, booking_date, start_time, end_time, duration_hours || null, total_price || null]
      )
    ).rows[0];

    // push to Google Sheet async
    const stationRow = (await pool.query('SELECT station_name FROM stations WHERE id=$1', [station_id])).rows[0];
    pushBookingToSheet({
      Name: user_name,
      Contact: contact || '',
      Station: stationRow?.station_name || station_id,
      Date: booking_date,
      StartTime: start_time,
      EndTime: end_time,
      Status: 'confirmed',
    });

    res.json({ message: 'Booking confirmed', booking: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// POST mark booking complete
app.post('/api/bookings/:id/complete', async (req, res) => {
  try {
    const id = req.params.id;
    const result = (
      await pool.query('UPDATE bookings SET status=$1 WHERE id=$2 RETURNING *', ['completed', id])
    ).rows[0];

    // Update Google Sheet
    if (sheet && result) {
      const rows = await sheet.getRows();
      const match = rows.find(
        r => r.Name === result.user_name && r.Station === result.station_id && r.Status === 'confirmed'
      );
      if (match) {
        match.Status = 'completed';
        await match.save();
      }
    }

    res.json({ message: 'Booking completed', booking: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// Serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

// Start
(async () => {
  await initDatabase();
  await initGoogleSheet();
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
})();
