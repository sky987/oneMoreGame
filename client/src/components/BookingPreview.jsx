import React, { useState, useEffect } from "react";

export default function BookingPreview() {
  const [bookings, setBookings] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    refreshData();

    // auto-refresh every 30 seconds
    const intervalId = setInterval(refreshData, 30000);

    // trigger countdown updates every 30s
    const localTimer = setInterval(() => {
      setLastUpdate(new Date());
    }, 30000);

    return () => {
      clearInterval(intervalId);
      clearInterval(localTimer);
    };
  }, []);

  async function refreshData() {
    await Promise.all([loadStations(), loadBookings()]);
    setLastUpdate(new Date());
  }

  async function loadStations() {
    try {
      const res = await fetch("/api/stations");
      const data = await res.json();
      setStations(data);
    } catch (err) {
      console.error("Failed to load stations:", err);
      setStations([]);
    }
  }

  async function loadBookings() {
    try {
      const res = await fetch("/api/bookings");
      const data = await res.json();
      setBookings(data);
      setLoading(false);
    } catch (err) {
      console.error("Failed to load bookings:", err);
      setBookings([]);
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const datetime = new Date(form.datetime.value);
    const now = new Date();

    if (datetime.getTime() < now.getTime() - 60000) {
      alert("Cannot book for past dates/times");
      return;
    }

    const selectedStations = Array.from(
      form.querySelectorAll('input[name="station"]:checked')
    ).map((checkbox) => parseInt(checkbox.value, 10));

    if (selectedStations.length === 0) {
      alert("Please select at least one station");
      return;
    }

    const [durationHours, durationMinutes] = form.duration.value
      .split(":")
      .map(Number);
    const totalHours = durationHours + durationMinutes / 60;
    const startTime = datetime;
    const endTime = new Date(startTime.getTime() + totalHours * 3600000);

    const successful = [];
    const failed = [];

    for (const stationId of selectedStations) {
      const selectedStation = stations.find((s) => s.id === stationId);
      const hourlyRate = selectedStation?.specs === "PS5" ? 100 : 60;
      const stationPrice = Math.round(totalHours * hourlyRate);

      const payload = {
        user_name: form.name.value,
        contact: form.contact.value.replace(/[^0-9+]/g, ""),
        station_id: stationId,
        booking_date: datetime.toISOString().split("T")[0],
        start_time: startTime.toTimeString().substring(0, 5),
        end_time: endTime.toTimeString().substring(0, 5),
        duration_hours: totalHours.toFixed(2),
        total_price: stationPrice,
      };

      try {
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await res.json();

        if (res.ok) successful.push(selectedStation.station_name);
        else failed.push({ station: selectedStation.station_name, error: result.error });
      } catch {
        failed.push({ station: selectedStation.station_name, error: "Network error" });
      }
    }

    if (successful.length > 0) {
      alert(`Successfully booked stations: ${successful.join(", ")}`);
      form.reset();
      await refreshData();
    }
    if (failed.length > 0) {
      alert(
        `Failed to book:\n${failed
          .map((f) => `${f.station}: ${f.error}`)
          .join("\n")}`
      );
    }
  }

  async function markComplete(id) {
    const res = await fetch(`/api/bookings/${id}/complete`, { method: "POST" });
    if (res.ok) await refreshData();
    else alert("Failed to mark complete");
  }

  // --- compute current status dynamically ---
  const computeStationStatus = (station) => {
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    const activeBooking = bookings.find((b) => {
      if (b.station_id !== station.id || b.booking_date !== today) return false;
      const start = new Date(`${b.booking_date}T${b.start_time}`);
      const end = new Date(`${b.booking_date}T${b.end_time}`);

      // ✅ ignore if marked completed early
      if (b.status === "completed") return false;

      return now >= start && now <= end;
    });

    if (activeBooking) {
      const end = new Date(`${activeBooking.booking_date}T${activeBooking.end_time}`);
      const diffMs = end - now;
      const mins = Math.max(0, Math.floor(diffMs / 60000));
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      const timeRemaining = `${hrs > 0 ? `${hrs}h ` : ""}${rem}m`;

      return {
        status: "OCCUPIED",
        currentBooking: activeBooking,
        timeRemaining,
      };
    }
    return { status: "AVAILABLE" };
  };

  return (
    <div className="grid">
      {/* Booking Form */}
      <div className="card">
        <h2>Reserve a Station</h2>
        <form onSubmit={handleSubmit}>
          <input name="name" className="form-input" placeholder="Your name" required />
          <input
            name="contact"
            className="form-input"
            placeholder="Contact number (optional)"
          />

          <label className="small">Select Stations</label>
          <div
            className="station-selection"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            {stations.map((s) => (
              <label
                key={s.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "8px 12px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  cursor: "pointer",
                  backgroundColor: "white",
                  color: "black",
                }}
              >
                <input
                  type="checkbox"
                  name="station"
                  value={s.id}
                  style={{ marginRight: "8px" }}
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
            style={{ color: "#000" }}
          />

          <label className="small">Select Date & Time</label>
          <input name="datetime" type="datetime-local" className="form-input" required />

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
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <h2>Live Station Status</h2>
            <div className="small" style={{ color: "#666" }}>
              Last updated: {lastUpdate.toLocaleTimeString()}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 16,
            }}
          >
            {stations.map((s) => {
              const computed = computeStationStatus(s);
              return (
                <div
                  key={s.id}
                  style={{
                    padding: "16px",
                    borderRadius: "12px",
                    backgroundColor:
                      computed.status === "OCCUPIED" ? "#FF000015" : "#00FF0015",
                    border: `2px solid ${
                      computed.status === "OCCUPIED" ? "#FF0000" : "#00FF00"
                    }`,
                    boxShadow: `0 0 20px ${
                      computed.status === "OCCUPIED" ? "#FF000030" : "#00FF0030"
                    }`,
                    transition: "all 0.3s ease",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "4px",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: "700",
                          fontSize: "18px",
                          color:
                            computed.status === "OCCUPIED" ? "#FF0000" : "#00AA00",
                        }}
                      >
                        {s.station_name}
                      </div>
                      <div
                        style={{
                          padding: "6px 12px",
                          borderRadius: "20px",
                          fontSize: "14px",
                          fontWeight: "600",
                          backgroundColor:
                            computed.status === "OCCUPIED" ? "#FF0000" : "#00AA00",
                          color: "white",
                          textTransform: "uppercase",
                        }}
                      >
                        {computed.status}
                      </div>
                    </div>

                    {computed.status === "OCCUPIED" && computed.currentBooking && (
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "12px",
                          borderRadius: "8px",
                          backgroundColor: "#FF000015",
                          border: "1px solid #FF000030",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "16px",
                            fontWeight: "600",
                            color: "#FF0000",
                            marginBottom: "8px",
                          }}
                        >
                          {computed.currentBooking.user_name}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "14px",
                            color: "#FF0000",
                          }}
                        >
                          <strong>Time Left: {computed.timeRemaining}</strong>
                          <span>Until: {computed.currentBooking.end_time}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
                  <th>Customer</th>
                  <th>Station</th>
                  <th>Time</th>
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
                    <td
                      style={{
                        color:
                          b.status === "completed"
                            ? "green"
                            : b.status === "confirmed"
                            ? "orange"
                            : "black",
                        fontWeight: 600,
                      }}
                    >
                      {b.status}
                    </td>
                    <td>
                      {b.status === "confirmed" && (
                        <button className="btn" onClick={() => markComplete(b.id)}>
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
  );
}
