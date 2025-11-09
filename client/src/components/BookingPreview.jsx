import React, { useState, useEffect } from 'react';

export default function BookingPreview(){
  const [bookings, setBookings] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    loadStations();
    loadBookings();
  },[]);

  async function loadStations(){
    try {
      const res = await fetch('/api/stations');
      const data = await res.json();
      console.log('Loaded stations:', data);
      setStations(data);
    } catch (err) {
      console.error('Failed to load stations:', err);
      setStations([]);
    }
  }

  async function loadBookings(){
    const res = await fetch('/api/bookings');
    const data = await res.json();
    setBookings(data);
    setLoading(false);
  }

  async function handleSubmit(e){
    e.preventDefault();
    const form = e.target;
    const datetime = new Date(form.datetime.value);
    
    // Get duration in hours and minutes
    const [durationHours, durationMinutes] = form.duration.value.split(':').map(Number);
    const totalHours = durationHours + (durationMinutes / 60);
    
    // Get station details for pricing
    const selectedStation = stations.find(s => s.id === parseInt(form.station.value, 10));
    const hourlyRate = selectedStation?.specs === 'PS5' ? 100 : 60;
    const totalPrice = Math.round(totalHours * hourlyRate);
    
    // Calculate end time
    const startTime = datetime;
    const endTime = new Date(startTime.getTime() + (durationHours * 60 + durationMinutes) * 60000);
    
    const payload = {
      user_name: form.name.value,
      contact: form.contact.value.replace(/[^0-9+]/g, ''), // Clean phone number
      station_id: parseInt(form.station.value, 10),
      booking_date: datetime.toISOString().split('T')[0],
      start_time: startTime.toTimeString().substring(0, 5),
      end_time: endTime.toTimeString().substring(0, 5),
      duration_hours: totalHours.toFixed(2),
      total_price: totalPrice
    };
    const res = await fetch('/api/bookings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const result = await res.json();
    if (res.ok) {
      alert('Booking confirmed');
      form.reset();
      await loadBookings();
      await loadStations();
    } else {
      alert(result.error || 'Failed to book');
    }
  }

  async function markComplete(id){
    const res = await fetch(`/api/bookings/${id}/complete`, { method: 'POST' });
    if (res.ok) { await loadBookings(); await loadStations(); }
    else {
      const r = await res.json();
      alert(r.error || 'Failed');
    }
  }

  return (
    <div>
      <div className="grid">
        <div className="card">
          <h2>Reserve a Station</h2>
          <form onSubmit={handleSubmit}>
            <input name="name" className="form-input" placeholder="Your name" required />
            <input name="contact" className="form-input" placeholder="Contact number" required />
            <label className="small">Select Station</label>
            <select name="station" className="form-input" required style={{color: '#000'}}>
              <option value="">Select a station...</option>
              {stations.map(s=> (
                <option key={s.id} value={s.id} style={{color: '#000'}}>
                  {s.station_name}
                </option>
              ))}
            </select>
            
            <label className="small">Duration (hours:minutes)</label>
            <input 
              name="duration" 
              type="time" 
              className="form-input" 
              required 
              defaultValue="01:00"
              style={{color: '#000'}}
            />
            <label className="small">Select Date & Time</label>
            <input name="datetime" type="datetime-local" className="form-input" required />
            <button className="btn" type="submit">Confirm Booking</button>
          </form>
        </div>

        <div>
          <div className="card">
            <h2>Live Station Availability</h2>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
              {stations.map(s => (
                <div key={s.id} className={`station ${s.status.toLowerCase() === 'occupied' ? 'occupied' : 'available'}`}>
                  <div style={{fontWeight:700}}>{s.station_name}</div>
                  <div className="small">{s.status}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{marginTop:16}}>
            <h3>All Bookings</h3>
            {loading ? <div className="small">Loading...</div> : (
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
                  {bookings.map(b => (
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
                          <button className="btn" onClick={()=>markComplete(b.id)}>
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
    </div>
  );
}
