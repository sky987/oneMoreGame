import React, { useState, useEffect } from 'react';

export default function BookingPreview() {
  const [bookings, setBookings] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    loadStations();
    loadBookings();

    // Refresh station status every 30 seconds
    const intervalId = setInterval(loadStations, 30000);
    return () => clearInterval(intervalId);
  }, []);

  async function loadStations() {
    try {
      const res = await fetch('/api/stations');
      const data = await res.json();
      console.log('Loaded stations:', data);
      setStations(data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to load stations:', err);
      setStations([]);
    }
  }

  async function loadBookings() {
    const res = await fetch('/api/bookings');
    const data = await res.json();
    setBookings(data);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const datetime = new Date(form.datetime.value);

    // Check if selected time is in the past
    const now = new Date();
    const selectedDateTime = datetime.getTime();
    const currentDateTime = now.getTime();

    // Allow same day bookings but prevent past times
    if (selectedDateTime < currentDateTime - 1000 * 60) {
      alert('Cannot book for past dates/times');
      return;
    }

    const selectedDate = datetime.toISOString().split('T')[0];
    const selectedTime = datetime.toTimeString().substring(0, 5);

    const selectedStations = Array.from(
      form.querySelectorAll('input[name="station"]:checked')
    ).map((checkbox) => parseInt(checkbox.value, 10));

    if (selectedStations.length === 0) {
      alert('Please select at least one station');
      return;
    }

    // Check for existing bookings
    const existingBooking = bookings.find(
      (b) =>
        b.booking_date === selectedDate &&
        selectedStations.includes(parseInt(b.station_id, 10)) &&
        b.status === 'confirmed' &&
        ((selectedTime >= b.start_time && selectedTime < b.end_time) ||
          (b.start_time >= selectedTime && b.start_time < form.duration.value))
    );

    if (existingBooking) {
      alert('This station is already booked for this time period');
      return;
    }

    // Get duration
    const [durationHours, durationMinutes] = form.duration.value
      .split(':')
      .map(Number);
    const totalHours = durationHours + durationMinutes / 60;

    const startTime = datetime;
    const endTime = new Date(
      startTime.getTime() + (durationHours * 60 + durationMinutes) * 60000
    );

    const successfulBookings = [];
    const failedBookings = [];

    for (const stationId of selectedStations) {
      const selectedStation = stations.find((s) => s.id === stationId);
      const hourlyRate = selectedStation?.specs === 'PS5' ? 100 : 60;
      const stationPrice = Math.round(totalHours * hourlyRate);

      const payload = {
        user_name: form.name.value,
        contact: form.contact.value.replace(/[^0-9+]/g, ''),
        station_id: stationId,
        booking_date: datetime.toISOString().split('T')[0],
        start_time: startTime.toTimeString().substring(0, 5),
        end_time: endTime.toTimeString().substring(0, 5),
        duration_hours: totalHours.toFixed(2),
        total_price: stationPrice,
      };

      try {
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await res.json();

        if (res.ok) {
          successfulBookings.push(selectedStation.station_name);
        } else {
          failedBookings.push({
            station: selectedStation.station_name,
            error: result.error,
          });
        }
      } catch (error) {
        failedBookings.push({
          station: selectedStation.station_name,
          error: 'Network error',
        });
      }
    }

    if (successfulBookings.length > 0) {
      alert(`Successfully booked stations: ${successfulBookings.join(', ')}`);
    }
    if (failedBookings.length > 0) {
      alert(
        `Failed to book stations:\n${failedBookings
          .map((fb) => `${fb.station}: ${fb.error}`)
          .join('\n')}`
      );
    }

    if (successfulBookings.length > 0) {
      form.reset();
      await loadBookings();
      await loadStations();
    }
  }

  async function markComplete(id) {
    const res = await fetch(`/api/bookings/${id}/complete`, { method: 'POST' });
    if (res.ok) {
      await loadBookings();
      await loadStations();
    } else {
      const r = await res.json();
      alert(r.error || 'Failed');
    }
  }

  return (
    <>
      <div className="grid">
        {/* Booking Form */}
        <div className="card">
          <h2>Reserve a Station</h2>
          <form onSubmit={handleSubmit}>
            <input
              name="name"
              className="form-input"
              placeholder="Your name"
              required
            />
            <input
              name="contact"
              className="form-input"
              placeholder="Contact number (optional)"
            />

            <label className="small">Select Stations</label>
            <div
              className="station-selection"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '16px',
              }}
            >
              {stations.map((s) => (
                <label
                  key={s.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '8px 12px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    backgroundColor: 'white',
                    color: 'black',
                  }}
                >
                  <input
                    type="checkbox"
                    name="station"
                    value={s.id}
                    style={{ marginRight: '8px' }}
                  />
                  {s.station_name}
                </label>
              ))}
            </div>

            <label className="small">Duration (hours:minutes)</label>
            <input
              name="duration"
              type="time"
              className="form-input"
              required
              defaultValue="01:00"
              style={{ color: '#000' }}
            />

            <label className="small">Select Date & Time</label>
            <input
              name="datetime"
              type="datetime-local"
              className="form-input"
              required
            />
            <button className="btn" type="submit">
              Confirm Booking
            </button>
          </form>
        </div>

        {/* Right Section */}
        <div>
          {/* Live Station Status */}
          <div className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h2>Live Station Status</h2>
              <div className="small" style={{ color: '#666' }}>
                Last updated: {lastUpdate.toLocaleTimeString()}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 16,
              }}
            >
              {stations.map((s) => (
                <div
                  key={s.id}
                  className={`station ${
                    s.status.toLowerCase() === 'occupied'
                      ? 'occupied'
                      : 'available'
                  }`}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    backgroundColor:
                      s.status.toLowerCase() === 'occupied'
                        ? '#FF000015'
                        : '#00FF0015',
                    border: `2px solid ${
                      s.status.toLowerCase() === 'occupied'
                        ? '#FF0000'
                        : '#00FF00'
                    }`,
                    boxShadow: `0 0 20px ${
                      s.status.toLowerCase() === 'occupied'
                        ? '#FF000030'
                        : '#00FF0030'
                    }`,
                    transition: 'all 0.3s ease',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '4px',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: '700',
                          fontSize: '18px',
                          color:
                            s.status.toLowerCase() === 'occupied'
                              ? '#FF0000'
                              : '#008800',
                        }}
                      >
                        {s.station_name}
                      </div>
                      <div
                        style={{
                          padding: '6px 12px',
                          borderRadius: '20px',
                          fontSize: '14px',
                          fontWeight: '600',
                          backgroundColor:
                            s.status.toLowerCase() === 'occupied'
                              ? '#FF0000'
                              : '#00AA00',
                          color: 'white',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}
                      >
                        {s.status}
                      </div>
                    </div>

                    {s.status.toLowerCase() === 'occupied' && (
                      <div
                        style={{
                          marginTop: '8px',
                          padding: '12px',
                          borderRadius: '8px',
                          backgroundColor: '#FF000015',
                          border: '1px solid #FF000030',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '16px',
                            fontWeight: '600',
                            color: '#FF0000',
                            marginBottom: '8px',
                          }}
                        >
                          {s.currentBooking.userName}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '14px',
                            color: '#FF0000',
                          }}
                        >
                          <strong>Time Left: {s.timeRemaining}</strong>
                          <span>Until: {s.currentBooking.endTime}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* All Bookings Table */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3>All Bookings</h3>
            {loading ? (
              <div className="small">Loading...</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Customer Name</th>
                    <th>Station</th>
                    <th>Booking Details</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id}>
                      <td>{b.id}</td>
                      <td>{b.user_name}</td>
                      <td>{b.station_name}</td>
                      <td>
                        {b.booking_date} {b.start_time}-{b.end_time}
                        <div className="small">
                          Duration: {b.duration_hours}hrs (₹{b.total_price})
                        </div>
                      </td>
                      <td>{b.status}</td>
                      <td>
                        {b.status === 'confirmed' && (
                          <button
                            className="btn"
                            onClick={() => markComplete(b.id)}
                          >
                            Complete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
