'use strict';

// Fictional demo operators and fleet. Rates are illustrative, in INR per block hour.
// Operator pricing policy fields:
//   ferry_rate_factor     share of the hourly rate billed for empty positioning/return flights
//   charges_return_ferry  whether a one-way trip is billed for flying the aircraft home
//   min_hours_per_day     minimum billable flying hours on any day the aircraft flies
//   night_halt_charge     crew + parking charge per night the aircraft waits away from base

const operators = [
  {
    slug: 'aerowing', name: 'Aerowing Charters', base: 'BOM', nsop_permit: 'NSOP/DEMO/01',
    phone: '+91 22 0000 0001', email: 'ops@aerowing.example', rating: 4.6,
    ferry_rate_factor: 1.0, charges_return_ferry: 1, min_hours_per_day: 2, night_halt_charge: 60000,
    api_key: 'demo-aerowing-key',
  },
  {
    slug: 'northstar', name: 'Northstar Air', base: 'DEL', nsop_permit: 'NSOP/DEMO/02',
    phone: '+91 11 0000 0002', email: 'charter@northstar.example', rating: 4.4,
    ferry_rate_factor: 0.9, charges_return_ferry: 1, min_hours_per_day: 2, night_halt_charge: 50000,
    api_key: 'demo-northstar-key',
  },
  {
    slug: 'deccan', name: 'Deccan Skyways', base: 'BLR', nsop_permit: 'NSOP/DEMO/03',
    phone: '+91 80 0000 0003', email: 'fly@deccan.example', rating: 4.7,
    ferry_rate_factor: 0.85, charges_return_ferry: 1, min_hours_per_day: 1.5, night_halt_charge: 45000,
    api_key: 'demo-deccan-key',
  },
  {
    slug: 'himalayan', name: 'Himalayan Heli Services', base: 'DED', nsop_permit: 'NSOP/DEMO/04',
    phone: '+91 135 000 0004', email: 'book@himalayanheli.example', rating: 4.5,
    ferry_rate_factor: 1.0, charges_return_ferry: 1, min_hours_per_day: 1, night_halt_charge: 30000,
    api_key: 'demo-himalayan-key',
  },
  {
    slug: 'coromandel', name: 'Coromandel Aviation', base: 'MAA', nsop_permit: 'NSOP/DEMO/05',
    phone: '+91 44 0000 0005', email: 'ops@coromandel.example', rating: 4.3,
    ferry_rate_factor: 0.8, charges_return_ferry: 0, min_hours_per_day: 2, night_halt_charge: 40000,
    api_key: 'demo-coromandel-key',
  },
  {
    slug: 'eastern', name: 'Eastern Rotors & Jets', base: 'CCU', nsop_permit: 'NSOP/DEMO/06',
    phone: '+91 33 0000 0006', email: 'hello@easternrotors.example', rating: 4.2,
    ferry_rate_factor: 0.9, charges_return_ferry: 1, min_hours_per_day: 1.5, night_halt_charge: 40000,
    api_key: 'demo-eastern-key',
  },
  {
    slug: 'westjet', name: 'Western Jet Club', base: 'AMD', nsop_permit: 'NSOP/DEMO/07',
    phone: '+91 79 0000 0007', email: 'trips@westernjet.example', rating: 4.5,
    ferry_rate_factor: 0.85, charges_return_ferry: 1, min_hours_per_day: 2, night_halt_charge: 50000,
    api_key: 'demo-westjet-key',
  },
];

// category: helicopter | turboprop | light_jet | midsize_jet | heavy_jet
const aircraft = [
  // Aerowing (Mumbai)
  { operator: 'aerowing', model: 'Hawker 850XP', category: 'midsize_jet', registration: 'VT-DM1', seats: 8, cruise_kmh: 800, range_km: 4600, hourly_rate: 320000, year: 2009, base: 'BOM', current: 'BOM' },
  { operator: 'aerowing', model: 'Embraer Legacy 650', category: 'heavy_jet', registration: 'VT-DM2', seats: 13, cruise_kmh: 830, range_km: 7200, hourly_rate: 600000, year: 2014, base: 'BOM', current: 'BOM' },
  { operator: 'aerowing', model: 'Bell 407', category: 'helicopter', registration: 'VT-DM3', seats: 6, cruise_kmh: 246, range_km: 600, hourly_rate: 160000, year: 2012, base: 'H-JUH', current: 'H-JUH' },
  { operator: 'aerowing', model: 'Cessna Citation XLS+', category: 'midsize_jet', registration: 'VT-DM4', seats: 9, cruise_kmh: 795, range_km: 3400, hourly_rate: 290000, year: 2016, base: 'BOM', current: 'GOI' },

  // Northstar (Delhi)
  { operator: 'northstar', model: 'Embraer Phenom 300', category: 'light_jet', registration: 'VT-DN1', seats: 7, cruise_kmh: 830, range_km: 3600, hourly_rate: 260000, year: 2017, base: 'DEL', current: 'DEL' },
  { operator: 'northstar', model: 'Bombardier Challenger 605', category: 'heavy_jet', registration: 'VT-DN2', seats: 12, cruise_kmh: 850, range_km: 7400, hourly_rate: 550000, year: 2011, base: 'DEL', current: 'DEL' },
  { operator: 'northstar', model: 'Beechcraft King Air B200', category: 'turboprop', registration: 'VT-DN3', seats: 7, cruise_kmh: 500, range_km: 2800, hourly_rate: 160000, year: 2010, base: 'DEL', current: 'JAI' },
  { operator: 'northstar', model: 'Airbus H130', category: 'helicopter', registration: 'VT-DN4', seats: 6, cruise_kmh: 240, range_km: 600, hourly_rate: 180000, year: 2015, base: 'H-RHN', current: 'H-RHN' },

  // Deccan (Bengaluru)
  { operator: 'deccan', model: 'Cessna Citation CJ2+', category: 'light_jet', registration: 'VT-DD1', seats: 6, cruise_kmh: 760, range_km: 2900, hourly_rate: 220000, year: 2013, base: 'HAL', current: 'HAL' },
  // Bengaluru-based jet that has just dropped clients in Delhi and is waiting there.
  { operator: 'deccan', model: 'Embraer Phenom 300', category: 'light_jet', registration: 'VT-DD2', seats: 7, cruise_kmh: 830, range_km: 3600, hourly_rate: 250000, year: 2019, base: 'BLR', current: 'DEL' },
  { operator: 'deccan', model: 'Pilatus PC-12', category: 'turboprop', registration: 'VT-DD3', seats: 8, cruise_kmh: 500, range_km: 3000, hourly_rate: 140000, year: 2018, base: 'BLR', current: 'HYD' },
  { operator: 'deccan', model: 'Airbus H125', category: 'helicopter', registration: 'VT-DD4', seats: 5, cruise_kmh: 245, range_km: 600, hourly_rate: 150000, year: 2016, base: 'HAL', current: 'HAL' },

  // Himalayan (Dehradun)
  { operator: 'himalayan', model: 'Airbus H125', category: 'helicopter', registration: 'VT-DH1', seats: 5, cruise_kmh: 245, range_km: 600, hourly_rate: 145000, year: 2014, base: 'H-SHD', current: 'H-SHD' },
  { operator: 'himalayan', model: 'Bell 407', category: 'helicopter', registration: 'VT-DH2', seats: 6, cruise_kmh: 246, range_km: 600, hourly_rate: 155000, year: 2011, base: 'H-SHD', current: 'H-PHT' },
  { operator: 'himalayan', model: 'Robinson R44', category: 'helicopter', registration: 'VT-DH3', seats: 3, cruise_kmh: 200, range_km: 550, hourly_rate: 65000, year: 2015, base: 'DED', current: 'DED' },
  { operator: 'himalayan', model: 'Beechcraft King Air C90', category: 'turboprop', registration: 'VT-DH4', seats: 6, cruise_kmh: 450, range_km: 2000, hourly_rate: 120000, year: 2008, base: 'DED', current: 'DED' },

  // Coromandel (Chennai) – does not bill return ferries
  { operator: 'coromandel', model: 'Dassault Falcon 2000', category: 'heavy_jet', registration: 'VT-DC1', seats: 10, cruise_kmh: 850, range_km: 6000, hourly_rate: 520000, year: 2010, base: 'MAA', current: 'MAA' },
  { operator: 'coromandel', model: 'Beechcraft King Air B200', category: 'turboprop', registration: 'VT-DC2', seats: 7, cruise_kmh: 500, range_km: 2800, hourly_rate: 150000, year: 2012, base: 'MAA', current: 'COK' },
  { operator: 'coromandel', model: 'Leonardo AW139', category: 'helicopter', registration: 'VT-DC3', seats: 12, cruise_kmh: 290, range_km: 1000, hourly_rate: 450000, year: 2017, base: 'MAA', current: 'MAA' },

  // Eastern (Kolkata)
  { operator: 'eastern', model: 'Cessna Citation XLS+', category: 'midsize_jet', registration: 'VT-DE1', seats: 9, cruise_kmh: 795, range_km: 3400, hourly_rate: 280000, year: 2012, base: 'CCU', current: 'CCU' },
  { operator: 'eastern', model: 'Bell 412', category: 'helicopter', registration: 'VT-DE2', seats: 13, cruise_kmh: 230, range_km: 700, hourly_rate: 350000, year: 2009, base: 'GAU', current: 'GAU' },
  { operator: 'eastern', model: 'Airbus H130', category: 'helicopter', registration: 'VT-DE3', seats: 6, cruise_kmh: 240, range_km: 600, hourly_rate: 170000, year: 2018, base: 'IXB', current: 'IXB' },

  // Western Jet Club (Ahmedabad)
  { operator: 'westjet', model: 'Gulfstream G550', category: 'heavy_jet', registration: 'VT-DW1', seats: 14, cruise_kmh: 900, range_km: 12500, hourly_rate: 900000, year: 2013, base: 'AMD', current: 'AMD' },
  { operator: 'westjet', model: 'Embraer Phenom 300', category: 'light_jet', registration: 'VT-DW2', seats: 7, cruise_kmh: 830, range_km: 3600, hourly_rate: 255000, year: 2020, base: 'AMD', current: 'AMD' },
  { operator: 'westjet', model: 'Airbus H125', category: 'helicopter', registration: 'VT-DW3', seats: 5, cruise_kmh: 245, range_km: 600, hourly_rate: 150000, year: 2019, base: 'AMD', current: 'H-KVD' },
];

module.exports = { operators, aircraft };
