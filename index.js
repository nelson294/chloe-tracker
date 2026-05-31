const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors({ origin: '*' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

const RAPIDAPI_KEY = '0ee7c674damsh24dacf33db0356fp16cd45jsn9960ceedeb4d';
const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;

function todayHKT() {
  const hkt = new Date(Date.now() + HKT_OFFSET_MS);
  return hkt.toISOString().slice(0, 10);
}

function nowHKTMins() {
  const hkt = new Date(Date.now() + HKT_OFFSET_MS);
  return hkt.getUTCHours() * 60 + hkt.getUTCMinutes();
}

const ROSTER = {
  '2026-05-30': { type: 'fly', flights: ['BR255'], note: 'Departs TPE — overnight stay' },
  '2026-05-31': { type: 'fly', flights: ['BR256'], note: 'Returns to TPE' },
  '2026-06-01': { type: 'off', label: 'Day off (YK)' },
  '2026-06-02': { type: 'fly', flights: ['BR198','BR197'], note: 'Same-day turnaround' },
  '2026-06-03': { type: 'standby', label: 'LCS Standby', time: '17:00-20:00' },
  '2026-06-04': { type: 'off', label: 'Day off (ADO)' },
  '2026-06-05': { type: 'standby', label: 'LCS Standby', time: '17:00-20:00' },
  '2026-06-06': { type: 'standby', label: 'SCS Standby', time: '14:00-17:00' },
  '2026-06-07': { type: 'fly', flights: ['BR132','BR131'], note: 'Same-day turnaround' },
  '2026-06-08': { type: 'off', label: 'Day off (ADO)' },
  '2026-06-09': { type: 'fly', flights: ['BR12'], note: 'Departs TPE → LAX' },
  '2026-06-10': { type: 'layover', label: 'LAX layover' },
  '2026-06-11': { type: 'layover', label: 'LAX layover' },
  '2026-06-12': { type: 'fly', flights: ['BR11'], note: 'Returns LAX → TPE' },
  '2026-06-13': { type: 'off', label: 'Day off (ADO)' },
  '2026-06-14': { type: 'off', label: 'Day off' },
  '2026-06-15': { type: 'off', label: 'Day off (DO)' },
  '2026-06-16': { type: 'fly', flights: ['BR16'], note: 'Departs TPE → LAX' },
  '2026-06-17': { type: 'layover', label: 'LAX layover' },
  '2026-06-18': { type: 'fly', flights: ['BR5'], note: 'In flight LAX → TPE' },
  '2026-06-19': { type: 'fly', flights: ['BR5'], note: 'Arrives TPE' },
  '2026-06-20': { type: 'off', label: 'Day off (ADO)' },
  '2026-06-21': { type: 'off', label: 'Day off' },
  '2026-06-22': { type: 'off', label: 'Day off' },
  '2026-06-23': { type: 'off', label: 'Day off' },
  '2026-06-24': { type: 'off', label: 'Day off (DO)' },
  '2026-06-25': { type: 'off', label: 'Day off (DO)' },
  '2026-06-26': { type: 'standby', label: 'SCS Standby', time: '06:45-09:45', alsoFly: ['BR281','BR282'] },
  '2026-06-27': { type: 'fly', flights: ['BR281','BR282'], note: 'Same-day turnaround' },
  '2026-06-28': { type: 'off', label: 'Day off' },
  '2026-06-29': { type: 'off', label: 'Day off' },
  '2026-06-30': { type: 'off', label: 'Day off (ADO)' },
};

// AeroDataBox: fetch flight by number and today's date
async function fetchFlight(flightNum) {
  const today = todayHKT();
  // AeroDataBox uses flight number without airline prefix for the path
  const url = `https://aerodatabox.p.rapidapi.com/flights/number/${flightNum}/${today}`;
  const r = await fetch(url, {
    headers: {
      'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
      'x-rapidapi-key': RAPIDAPI_KEY
    }
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`AeroDataBox error ${r.status}: ${text}`);
  }
  const d = await r.json();
  // AeroDataBox returns an array of flights
  if (Array.isArray(d) && d.length > 0) return d[0];
  if (d && d.departures) return d; // airport format fallback
  return null;
}

// Normalise AeroDataBox response to our internal format
function normalise(raw, flightNum) {
  if (!raw) return null;

  const dep = raw.departure || {};
  const arr = raw.arrival || {};

  // AeroDataBox status: Landed, EnRoute, Scheduled, Cancelled, Unknown
  let status = 'unknown';
  const s = (raw.status || '').toLowerCase();
  if (s === 'landed') status = 'landed';
  else if (s === 'enroute' || s === 'en-route') status = 'active';
  else if (s === 'scheduled') status = 'scheduled';
  else if (s === 'cancelled') status = 'cancelled';
  else if (s.includes('route') || s.includes('air')) status = 'active';

  return {
    flight_status: status,
    flight_number: flightNum,
    departure: {
      iata: dep.airport && dep.airport.iata,
      scheduled: dep.scheduledTime && dep.scheduledTime.utc,
      actual: dep.actualTime && dep.actualTime.utc,
      timezone: dep.airport && dep.airport.timeZone
    },
    arrival: {
      iata: arr.airport && arr.airport.iata,
      scheduled: arr.scheduledTime && arr.scheduledTime.utc,
      estimated: arr.predictedTime && arr.predictedTime.utc,
      actual: arr.actualTime && arr.actualTime.utc,
      timezone: arr.airport && arr.airport.timeZone
    },
    aircraft: raw.aircraft ? { iata: raw.aircraft.model } : null,
    live: raw.position ? {
      altitude: raw.position.altitude,
      speed_horizontal: raw.position.speedH
    } : null,
    _raw: raw
  };
}

// Proxy endpoint
app.get('/flight', async (req, res) => {
  const { num } = req.query;
  if (!num) return res.status(400).json({ error: 'Missing flight number' });
  try {
    const raw = await fetchFlight(num);
    const flight = normalise(raw, num);
    res.json({ data: flight ? [flight] : [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Smart status endpoint
app.get('/status', async (req, res) => {
  const key = todayHKT();
  const day = ROSTER[key];
  const nowMins = nowHKTMins();

  if (!day) return res.json({ type: 'unknown', key, message: 'No roster data for today' });
  if (day.type === 'off') return res.json({ type: 'off', label: day.label });
  if (day.type === 'layover') return res.json({ type: 'layover', label: day.label });

  if (day.type === 'standby') {
    const [startH, startM] = day.time.split('-')[0].split(':').map(Number);
    const [endH, endM] = day.time.split('-')[1].split(':').map(Number);
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;
    const phase = nowMins < startMins ? 'before' : nowMins < endMins ? 'active' : 'released';
    return res.json({ type: 'standby', label: day.label, time: day.time, phase, alsoFly: day.alsoFly || [] });
  }

  if (day.type === 'fly') {
    const flights = day.flights || [];
    const results = await Promise.all(flights.map(async (fn) => {
      try {
        const raw = await fetchFlight(fn);
        const data = normalise(raw, fn);
        return { flightNum: fn, data };
      } catch (e) {
        return { flightNum: fn, data: null, error: e.message };
      }
    }));

    // Priority 1: actively in the air
    const active = results.find(r => r.data && r.data.flight_status === 'active');
    if (active) return res.json({ type: 'fly', flightNum: active.flightNum, flightData: active.data, autoSelected: true });

    // Priority 2: next scheduled departure
    const scheduled = results
      .filter(r => r.data && r.data.flight_status === 'scheduled')
      .sort((a, b) => new Date(a.data.departure.scheduled || 0) - new Date(b.data.departure.scheduled || 0));
    if (scheduled.length > 0) return res.json({ type: 'fly', flightNum: scheduled[0].flightNum, flightData: scheduled[0].data, autoSelected: true });

    // Priority 3: most recently landed
    const landed = results.filter(r => r.data && r.data.flight_status === 'landed');
    if (landed.length > 0) {
      const last = landed[landed.length - 1];
      return res.json({ type: 'fly', flightNum: last.flightNum, flightData: last.data, autoSelected: true, allLanded: true });
    }

    // Fallback: show what we got with errors for debugging
    return res.json({
      type: 'fly', flights, autoSelected: false,
      message: 'Could not determine current flight',
      debug: results.map(r => ({ flightNum: r.flightNum, status: r.data && r.data.flight_status, error: r.error }))
    });
  }
});

app.get('/debug', async (req, res) => {
  const { num } = req.query;
  if (!num) return res.status(400).json({ error: 'provide ?num=BR256' });
  try {
    const today = todayHKT();
    const url = `https://aerodatabox.p.rapidapi.com/flights/number/${num}/${today}`;
    const r = await fetch(url, {
      headers: {
        'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });
    const text = await r.text();
    res.json({ status: r.status, today, raw: text });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.use(express.static('public'));
app.get('/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
