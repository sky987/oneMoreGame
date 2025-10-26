const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
const PORT = process.env.PORT || 3000;

// Postgres pool via DATABASE_URL (Render)
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
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
        status VARCHAR(20) DEFAULT 'Active',
        booking_code VARCHAR(50) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default stations if none exist
    const { rows } = await pool.query('SELECT COUNT(*) FROM stations');
    if (parseInt(rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO stations (station_name, specs) VALUES
        ('Bekal Station', 'RTX 4080, i9-13900K, 32GB RAM, 240Hz Monitor'),
        ('Mattancherry Station', 'RTX 4070, i7-13700K, 32GB RAM, 165Hz Monitor'),
        ('Padmanabha Station', 'RTX 4060 Ti, Ryzen 7 7800X3D, 16GB RAM, 144Hz Monitor'),
        ('Athirapally Station', 'RTX 4060, i5-13600K, 16GB RAM, 144Hz Monitor'),
        ('Munnar Station', 'RTX 3060, Ryzen 5 5600X, 16GB RAM, 144Hz Monitor')
      `);
    }

    console.log('✅ PostgreSQL database ready');
  } catch (err) {
    console.error('❌ DB init error', err);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client', 'build')));

// Push booking to Google Sheet (async)
async function pushBookingToSheet(booking) {
  if (!sheet) return;
  try {
    await sheet.addRow({
      Name: booking.user_name,
      Contact: booking.contact || '',
      Station: booking.station_name || booking.station_id,
      Date: booking.booking_date,
      StartTime: booking.start_time,
      EndTime: booking.end_time,
      Duration: booking.duration_hours,
      Price: booking.total_price,
      Status: booking.status
    });
  } catch (err) {
    console.error('❌ Failed to push booking to Google Sheet', err);
  }
}

// Routes

// Get all stations with optional availability for date/time
app.get('/api/stations', async (req, res) => {
  try {
    const { date, start_time } = req.query;
    const stations = (await pool.query('SELECT * FROM stations ORDER BY id')).rows;

    if (!date || !start_time) return res.json(stations);

    const booked = (await pool.query(
      'SELECT station_id FROM bookings WHERE booking_date=$1 AND start_time=$2 AND status=$3',
      [date, start_time, 'Active']
    )).rows.map(r => r.station_id);

    const result = stations.map(s => ({
      ...s,
      status: booked.includes(s.id) ? 'Occupied' : 'Available'
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stations' });
  }
});

// Get all bookings
app.get('/api/bookings', async (req, res) => {
  try {
    const bookings = (await pool.query(`
      SELECT b.*, s.station_name
      FROM bookings b
      LEFT JOIN stations s ON b.station_id = s.id
      ORDER BY b.booking_date DESC, b.start_time DESC
    `)).rows;
    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Create booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { user_name, contact, station_id, booking_date, start_time, end_time, duration_hours, total_price } = req.body;
    if (!user_name || !station_id || !booking_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check availability
    const existing = (await pool.query(
      'SELECT * FROM bookings WHERE station_id=$1 AND booking_date=$2 AND start_time=$3 AND status=$4',
      [station_id, booking_date, start_time, 'Active']
    )).rows;

    if (existing.length > 0) return res.status(400).json({ error: 'Station already booked for this time' });

    // Insert booking
    const booking_code = `KB${Date.now()}`;
    const result = (await pool.query(
      `INSERT INTO bookings 
      (user_name, contact, station_id, booking_date, start_time, end_time, duration_hours, total_price, status, booking_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [user_name, contact, station_id, booking_date, start_time, end_time, duration_hours, total_price, 'Active', booking_code]
    )).rows[0];

    // Include station name for sheet
    const station = (await pool.query('SELECT station_name FROM stations WHERE id=$1', [station_id])).rows[0];
    result.station_name = station?.station_name || station_id;

    // Push to Google Sheet (async)
    pushBookingToSheet(result);

    res.json({ message: 'Booking confirmed', booking: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Complete booking
app.post('/api/bookings/:id/complete', async (req, res) => {
  try {
    const id = req.params.id;
    const result = (await pool.query(
      'UPDATE bookings SET status=$1 WHERE id=$2 RETURNING *',
      ['Completed', id]
    )).rows[0];

    // Update sheet row (best-effort)
    if (sheet && result) {
      const rows = await sheet.getRows();
      const match = rows.find(r => r.booking_code == result.booking_code);
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

// Serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

// Start server
(async () => {
  await initDatabase();
  await initGoogleSheet();
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
})();
