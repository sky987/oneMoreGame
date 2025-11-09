const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
const PORT = process.env.PORT || 3000;

// Google Sheets setup
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
let CREDS = null;
try {
  CREDS = process.env.GOOGLE_CREDS_JSON ? JSON.parse(process.env.GOOGLE_CREDS_JSON) : null;
} catch (e) {
  console.warn('Invalid GOOGLE_CREDS_JSON');
}

// Sheet references
let doc = null;
let stationsSheet = null;
let bookingsSheet = null;

// Initialize Google Sheets
async function initGoogleSheets() {
  if (!SHEET_ID || !CREDS) {
    throw new Error('Google Sheets configuration missing');
  }

  try {
    doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: CREDS.client_email,
      private_key: CREDS.private_key.replace(/\\n/g, '\n')
    });

    await doc.loadInfo();
    
    // Get or create sheets
    stationsSheet = doc.sheetsByTitle['Stations'] || await doc.addSheet({ 
      title: 'Stations', 
      headerValues: ['id', 'station_name', 'specs', 'status', 'created_at'] 
    });
    
    bookingsSheet = doc.sheetsByTitle['Bookings'] || await doc.addSheet({ 
      title: 'Bookings', 
      headerValues: [
        'id', 'user_name', 'contact', 'station_id', 'booking_date', 
        'start_time', 'end_time', 'duration_hours', 'total_price', 
        'status', 'booking_code', 'created_at'
      ] 
    });

    // Initialize stations if empty
    const stations = await stationsSheet.getRows();
    if (stations.length === 0) {
      for (let i = 1; i <= 6; i++) {
        await stationsSheet.addRow({
          id: i,
          station_name: `Station ${i}`,
          specs: '',
          status: 'available',
          created_at: new Date().toISOString()
        });
      }
    }

    console.log('✅ Google Sheets initialized');
    return true;
  } catch (err) {
    console.error('❌ Google Sheets init error:', err);
    throw err;
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client', 'build')));

// GET stations
app.get('/api/stations', async (req, res) => {
  try {
    const { datetime } = req.query;
    const stations = await stationsSheet.getRows();
    
    if (!datetime) {
      return res.json(stations.map(s => ({
        id: parseInt(s.id),
        station_name: s.station_name,
        specs: s.specs,
        status: s.status
      })));
    }

    // Get bookings for the date
    const bookings = await bookingsSheet.getRows();
    const booked = bookings
      .filter(b => b.booking_date === datetime && b.status === 'confirmed')
      .map(b => parseInt(b.station_id));

    const out = stations.map(s => ({
      id: parseInt(s.id),
      station_name: s.station_name,
      specs: s.specs,
      status: booked.includes(parseInt(s.id)) ? 'Occupied' : 'Available'
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
    const bookings = await bookingsSheet.getRows();
    const stations = await stationsSheet.getRows();
    
    const rows = bookings.map(b => {
      const station = stations.find(s => s.id === b.station_id);
      return {
        id: parseInt(b.id),
        user_name: b.user_name,
        contact: b.contact,
        station_id: parseInt(b.station_id),
        station_name: station ? station.station_name : null,
        booking_date: b.booking_date,
        start_time: b.start_time,
        end_time: b.end_time,
        duration_hours: parseFloat(b.duration_hours),
        total_price: parseFloat(b.total_price),
        status: b.status,
        booking_code: b.booking_code,
        created_at: b.created_at
      };
    });

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

    // Check availability
    const bookings = await bookingsSheet.getRows();
    const existing = bookings.find(
      b => b.station_id === station_id.toString() &&
           b.booking_date === booking_date &&
           b.start_time === start_time &&
           b.status === 'confirmed'
    );

    if (existing) {
      return res.status(400).json({ error: 'Station already booked for this time' });
    }

    // Get next ID
    const nextId = bookings.length > 0 
      ? Math.max(...bookings.map(b => parseInt(b.id))) + 1 
      : 1;

    // Create booking
    const newBooking = {
      id: nextId,
      user_name,
      contact: contact || '',
      station_id: station_id.toString(),
      booking_date,
      start_time,
      end_time,
      duration_hours: duration_hours?.toString() || '',
      total_price: total_price?.toString() || '',
      status: 'confirmed',
      booking_code: `BK${nextId}`,
      created_at: new Date().toISOString()
    };

    await bookingsSheet.addRow(newBooking);
    res.json({ message: 'Booking confirmed', booking: newBooking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// POST mark booking complete
app.post('/api/bookings/:id/complete', async (req, res) => {
  try {
    const id = req.params.id;
    const bookings = await bookingsSheet.getRows();
    const booking = bookings.find(b => b.id === id);

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    booking.status = 'completed';
    await booking.save();

    res.json({ message: 'Booking completed', booking: {
      id: parseInt(booking.id),
      user_name: booking.user_name,
      status: booking.status
    }});
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
  try {
    console.log('Starting application...');
    console.log('Environment check:');
    console.log('- GOOGLE_SHEET_ID:', process.env.GOOGLE_SHEET_ID ? 'Set' : 'Missing');
    console.log('- GOOGLE_CREDS_JSON:', process.env.GOOGLE_CREDS_JSON ? 'Set' : 'Missing');

    // Initialize Google Sheets - this is critical
    await initGoogleSheets();
    
    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log('📑 Google Sheets: Connected');
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    console.error('Error details:', {
      name: err.name,
      message: err.message,
      stack: err.stack
    });
    process.exit(1);
  }
})();
