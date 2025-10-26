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
    const res = await fetch('/api/stations');
    const data = await res.json();
    setStations(data);
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
    const payload = {
      name: form.name.value,
      contact: form.contact.value,
      station_id: parseInt(form.station.value, 10),
      datetime: form.datetime.value
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
            <select name="station" className="form-input">
              {stations.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
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
                <div key={s.id} className={`station ${s.status === 'Occupied' ? 'occupied' : 'available'}`}>
                  <div style={{fontWeight:700}}>{s.name}</div>
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
                  <tr><th>ID</th><th>Name</th><th>Station</th><th>DateTime</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {bookings.map(b => (
                    <tr key={b.id}>
                      <td>{b.id}</td>
                      <td>{b.name}</td>
                      <td>{b.station_name || b.station_id}</td>
                      <td>{new Date(b.datetime).toLocaleString()}</td>
                      <td>{b.status}</td>
                      <td>{b.status==='Active' && <button className="btn" onClick={()=>markComplete(b.id)}>Complete</button>}</td>
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
