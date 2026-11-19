'use strict';

// Demo dataset of Indian airports and heliports. Coordinates are approximate.
// type: 'metro' (major airport, higher fees), 'airport', 'helipad' (rotorcraft only)
module.exports = [
  // Metro airports
  { code: 'DEL', name: 'Indira Gandhi International', city: 'New Delhi', state: 'Delhi', type: 'metro', lat: 28.5562, lon: 77.1 },
  { code: 'BOM', name: 'Chhatrapati Shivaji Maharaj International', city: 'Mumbai', state: 'Maharashtra', type: 'metro', lat: 19.0896, lon: 72.8656 },
  { code: 'BLR', name: 'Kempegowda International', city: 'Bengaluru', state: 'Karnataka', type: 'metro', lat: 13.1986, lon: 77.7066 },
  { code: 'MAA', name: 'Chennai International', city: 'Chennai', state: 'Tamil Nadu', type: 'metro', lat: 12.9941, lon: 80.1709 },
  { code: 'CCU', name: 'Netaji Subhas Chandra Bose International', city: 'Kolkata', state: 'West Bengal', type: 'metro', lat: 22.6547, lon: 88.4467 },
  { code: 'HYD', name: 'Rajiv Gandhi International', city: 'Hyderabad', state: 'Telangana', type: 'metro', lat: 17.2403, lon: 78.4294 },

  // Other airports
  { code: 'HAL', name: 'HAL Airport (business aviation)', city: 'Bengaluru', state: 'Karnataka', type: 'airport', lat: 12.95, lon: 77.6682 },
  { code: 'AMD', name: 'Sardar Vallabhbhai Patel International', city: 'Ahmedabad', state: 'Gujarat', type: 'airport', lat: 23.0772, lon: 72.6347 },
  { code: 'PNQ', name: 'Pune Airport', city: 'Pune', state: 'Maharashtra', type: 'airport', lat: 18.5821, lon: 73.9197 },
  { code: 'GOI', name: 'Goa (Dabolim)', city: 'Goa', state: 'Goa', type: 'airport', lat: 15.3808, lon: 73.8314 },
  { code: 'JAI', name: 'Jaipur International', city: 'Jaipur', state: 'Rajasthan', type: 'airport', lat: 26.8242, lon: 75.8122 },
  { code: 'UDR', name: 'Maharana Pratap Airport', city: 'Udaipur', state: 'Rajasthan', type: 'airport', lat: 24.6177, lon: 73.8961 },
  { code: 'LKO', name: 'Chaudhary Charan Singh International', city: 'Lucknow', state: 'Uttar Pradesh', type: 'airport', lat: 26.7606, lon: 80.8893 },
  { code: 'VNS', name: 'Lal Bahadur Shastri International', city: 'Varanasi', state: 'Uttar Pradesh', type: 'airport', lat: 25.4524, lon: 82.8593 },
  { code: 'COK', name: 'Cochin International', city: 'Kochi', state: 'Kerala', type: 'airport', lat: 10.152, lon: 76.4019 },
  { code: 'TRV', name: 'Thiruvananthapuram International', city: 'Thiruvananthapuram', state: 'Kerala', type: 'airport', lat: 8.4821, lon: 76.9201 },
  { code: 'CJB', name: 'Coimbatore International', city: 'Coimbatore', state: 'Tamil Nadu', type: 'airport', lat: 11.03, lon: 77.0434 },
  { code: 'IXE', name: 'Mangaluru International', city: 'Mangaluru', state: 'Karnataka', type: 'airport', lat: 12.9613, lon: 74.8901 },
  { code: 'TIR', name: 'Tirupati Airport', city: 'Tirupati', state: 'Andhra Pradesh', type: 'airport', lat: 13.6325, lon: 79.5433 },
  { code: 'VGA', name: 'Vijayawada Airport', city: 'Vijayawada', state: 'Andhra Pradesh', type: 'airport', lat: 16.5304, lon: 80.7968 },
  { code: 'IXC', name: 'Chandigarh International', city: 'Chandigarh', state: 'Chandigarh', type: 'airport', lat: 30.6735, lon: 76.7885 },
  { code: 'ATQ', name: 'Sri Guru Ram Dass Jee International', city: 'Amritsar', state: 'Punjab', type: 'airport', lat: 31.7096, lon: 74.7973 },
  { code: 'IXJ', name: 'Jammu Airport', city: 'Jammu', state: 'Jammu & Kashmir', type: 'airport', lat: 32.6891, lon: 74.8374 },
  { code: 'SXR', name: 'Sheikh ul-Alam International', city: 'Srinagar', state: 'Jammu & Kashmir', type: 'airport', lat: 33.9871, lon: 74.7742 },
  { code: 'DED', name: 'Jolly Grant Airport', city: 'Dehradun', state: 'Uttarakhand', type: 'airport', lat: 30.1897, lon: 78.1803 },
  { code: 'IXB', name: 'Bagdogra Airport', city: 'Siliguri', state: 'West Bengal', type: 'airport', lat: 26.6812, lon: 88.3286 },
  { code: 'PYG', name: 'Pakyong Airport', city: 'Gangtok', state: 'Sikkim', type: 'airport', lat: 27.2329, lon: 88.585 },
  { code: 'GAU', name: 'Lokpriya Gopinath Bordoloi International', city: 'Guwahati', state: 'Assam', type: 'airport', lat: 26.1061, lon: 91.5859 },
  { code: 'BBI', name: 'Biju Patnaik International', city: 'Bhubaneswar', state: 'Odisha', type: 'airport', lat: 20.2444, lon: 85.8178 },
  { code: 'PAT', name: 'Jay Prakash Narayan Airport', city: 'Patna', state: 'Bihar', type: 'airport', lat: 25.5913, lon: 85.088 },
  { code: 'IXR', name: 'Birsa Munda Airport', city: 'Ranchi', state: 'Jharkhand', type: 'airport', lat: 23.3143, lon: 85.3217 },
  { code: 'RPR', name: 'Swami Vivekananda Airport', city: 'Raipur', state: 'Chhattisgarh', type: 'airport', lat: 21.1804, lon: 81.7388 },
  { code: 'NAG', name: 'Dr. Babasaheb Ambedkar International', city: 'Nagpur', state: 'Maharashtra', type: 'airport', lat: 21.0922, lon: 79.0472 },
  { code: 'IDR', name: 'Devi Ahilyabai Holkar Airport', city: 'Indore', state: 'Madhya Pradesh', type: 'airport', lat: 22.7218, lon: 75.8011 },
  { code: 'BHO', name: 'Raja Bhoj Airport', city: 'Bhopal', state: 'Madhya Pradesh', type: 'airport', lat: 23.2875, lon: 77.3374 },
  { code: 'STV', name: 'Surat Airport', city: 'Surat', state: 'Gujarat', type: 'airport', lat: 21.1141, lon: 72.7418 },
  { code: 'SAG', name: 'Shirdi Airport', city: 'Shirdi', state: 'Maharashtra', type: 'airport', lat: 19.6886, lon: 74.3789 },
  { code: 'IXZ', name: 'Veer Savarkar International', city: 'Port Blair', state: 'Andaman & Nicobar', type: 'airport', lat: 11.6412, lon: 92.7297 },

  // Heliports / helipads (helicopters only)
  { code: 'H-RHN', name: 'Rohini Heliport', city: 'New Delhi', state: 'Delhi', type: 'helipad', lat: 28.7415, lon: 77.073 },
  { code: 'H-JUH', name: 'Juhu Aerodrome', city: 'Mumbai', state: 'Maharashtra', type: 'helipad', lat: 19.0981, lon: 72.8342 },
  { code: 'H-SHD', name: 'Sahastradhara Helipad', city: 'Dehradun', state: 'Uttarakhand', type: 'helipad', lat: 30.3856, lon: 78.1314 },
  { code: 'H-PHT', name: 'Phata Helipad', city: 'Phata (Kedarnath)', state: 'Uttarakhand', type: 'helipad', lat: 30.5795, lon: 79.041 },
  { code: 'H-KED', name: 'Kedarnath Helipad', city: 'Kedarnath', state: 'Uttarakhand', type: 'helipad', lat: 30.7346, lon: 79.0669 },
  { code: 'H-BDR', name: 'Badrinath Helipad', city: 'Badrinath', state: 'Uttarakhand', type: 'helipad', lat: 30.7433, lon: 79.4938 },
  { code: 'H-KTR', name: 'Katra Helipad', city: 'Katra (Vaishno Devi)', state: 'Jammu & Kashmir', type: 'helipad', lat: 32.9916, lon: 74.932 },
  { code: 'H-GTK', name: 'Burtuk Helipad', city: 'Gangtok', state: 'Sikkim', type: 'helipad', lat: 27.3389, lon: 88.6161 },
  { code: 'H-KVD', name: 'Statue of Unity Helipad', city: 'Kevadia', state: 'Gujarat', type: 'helipad', lat: 21.838, lon: 73.7191 },
  { code: 'H-AMB', name: 'Aamby Valley Helipad', city: 'Lonavala', state: 'Maharashtra', type: 'helipad', lat: 18.6, lon: 73.39 },
];
