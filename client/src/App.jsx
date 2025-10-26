import React from 'react';
import BookingPreview from './components/BookingPreview';

export default function App(){
  return (
    <div className="container">
      <div className="header">
        <div className="logo">Kali Kalari</div>
        <div className="small">Gaming Cafe Booking</div>
      </div>
      <BookingPreview />
    </div>
  );
}
