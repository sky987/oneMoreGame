const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');

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

// Initialize DB tables
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        contact VARCHAR(80),
        station_id INTEGER REFERENCES stations(id),
        datetime TIMESTAMP NOT NULL,
        status VARCHAR(30) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const { rows } = await pool.query('SELECT COUNT(*) FROM stations');
    if (parseInt(rows[0].count) === 0) {
      await pool.query(`INSERT INTO stations (name) VALUES
        ('Station 1'),('Station 2'),('Station 3'),('Station 4'),('Station 5'),('Station 6')`);
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

// Push booking to Google Sheet (non-blocking)
async function pushBookingToSheet(row) {
  if (!sheet) return;
  try {
    await sheet.addRow(row);
  } catch (err) {
    console.error('Failed to push to sheet', err);
  }
}

// Routes
// GET stations (optionally pass ?datetime=ISO)
app.get('/api/stations', async (req, res) => {
  try {
    const { datetime } = req.query;
    const stations = (await pool.query('SELECT * FROM stations ORDER BY id')).rows;
    if (!datetime) return res.json(stations);

    const booked = (await pool.query('SELECT station_id FROM bookings WHERE datetime=$1 AND status=$2', [datetime, 'Active'])).rows.map(r => r.station_id);
    const out = stations.map(s => ({ ...s, status: booked.includes(s.id) ? 'Occupied' : 'Available' }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stations' });
  }
});

// GET bookings
app.get('/api/bookings', async (req, res) => {
  try {
    const rows = (await pool.query(`
      SELECT b.*, s.name as station_name
      FROM bookings b
      LEFT JOIN stations s ON b.station_id = s.id
      ORDER BY b.datetime DESC
    `)).rows;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// POST create booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { name, contact, station_id, datetime } = req.body;
    if (!name || !station_id || !datetime) return res.status(400).json({ error: 'Missing fields' });

    // check availability
    const existing = (await pool.query('SELECT * FROM bookings WHERE station_id=$1 AND datetime=$2 AND status=$3', [station_id, datetime, 'Active'])).rows;
    if (existing.length > 0) return res.status(400).json({ error: 'Station already booked for this time' });

    const result = (await pool.query('INSERT INTO bookings (name, contact, station_id, datetime) VALUES ($1,$2,$3,$4) RETURNING *', [name, contact, station_id, datetime])).rows[0];

    // push to Google Sheet async (include station name)
    const stationRow = (await pool.query('SELECT name FROM stations WHERE id=$1', [station_id])).rows[0];
    pushBookingToSheet({ Name: name, Contact: contact || '', Station: stationRow?.name || station_id, DateTime: datetime, Status: 'Active' });

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
    const result = (await pool.query('UPDATE bookings SET status=$1 WHERE id=$2 RETURNING *', ['Completed', id])).rows[0];

    // Update sheet row (best-effort): find by matching DateTime+Station+Name — this is heuristic
    if (sheet && result) {
      const rows = await sheet.getRows();
      const match = rows.find(r => (r.DateTime === result.datetime.toISOString() || r.DateTime === result.datetime) && (r.Station === result.station_id || r.Station === result.station_name || r.Name === result.name));
      if (match) {
        match.Status = 'Completed';
        await match.save();
      }
    }

    res.json({ message: 'Booking completed', booking: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

// Start
(async () => {
  await initDatabase();
  await initGoogleSheet();
  app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
})();
