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

const AIRLABS_KEY = '13f88a25-56f7-4851-98bf-484a13aa12ce';
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
  '2026-06-01': { type: 'off', label: 'YK' },
  '2026-06-02': { type: 'fly', flights: ['BR198','BR197'], dest: 'NRT', sameDay: true },
  '2026-06-03': { type: 'standby', label: 'LCS', time: '17:00-20:00' },
  '2026-06-04': { type: 'off', label: 'ADO' },
  '2026-06-05': { type: 'standby', label: 'LCS', time: '17:00-20:00' },
  '2026-06-06': { type: 'standby', label: 'SCS', time: '14:00-17:00' },
  '2026-06-07': { type: 'fly', flights: ['BR132','BR131'], dest: 'KIX', sameDay: true },
  '2026-06-08': { type: 'off', label: 'ADO' },
  '2026-06-09': { type: 'fly', flights: ['BR12'], dest: 'LAX', returnFlight: 'BR11', returnDate: 'Jun 12' },
  '2026-06-10': { type: 'layover', label: 'LAX' },
  '2026-06-11': { type: 'layover', label: 'LAX' },
  '2026-06-12': { type: 'fly', flights: ['BR11'], dest: 'TPE' },
  '2026-06-13': { type: 'off', label: 'ADO' },
  '2026-06-14': { type: 'off', label: 'DO' },
  '2026-06-15': { type: 'off', label: 'DO' },
  '2026-06-16': { type: 'fly', flights: ['BR16'], dest: 'LAX', returnFlight: 'BR5', returnDate: 'Jun 18-19' },
  '2026-06-17': { type: 'layover', label: 'LAX' },
  '2026-06-18': { type: 'fly', flights: ['BR5'], dest: 'TPE' },
  '2026-06-19': { type: 'fly', flights: ['BR5'], dest: 'TPE' },
  '2026-06-20': { type: 'off', label: 'ADO' },
  '2026-06-21': { type: 'off', label: 'DO' },
  '2026-06-22': { type: 'fly', flights: ['BR116'], dest: 'CTS', returnFlight: 'BR115', returnDate: 'Jun 23' },
  '2026-06-23': { type: 'fly', flights: ['BR115'], dest: 'TPE' },
  '2026-06-24': { type: 'off', label: 'DO' },
  '2026-06-25': { type: 'off', label: 'DO' },
  '2026-06-26': { type: 'standby', label: 'SCS', time: '06:45-09:45' },
  '2026-06-27': { type: 'fly', flights: ['BR281','BR282'], dest: 'CEB', sameDay: true },
  '2026-06-28': { type: 'fly', flights: ['BR215'], dest: 'SIN', returnFlight: 'BR216', returnDate: 'Jun 29' },
  '2026-06-29': { type: 'fly', flights: ['BR216'], dest: 'TPE' },
  '2026-06-30': { type: 'off', label: 'ADO' },
};

// Use /flight (singular) endpoint — returns full schedule + live position + eta
async function fetchFlight(flightNum) {
  const url = `https://airlabs.co/api/v9/flight?flight_iata=${flightNum}&api_key=${AIRLABS_KEY}`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.response) return null;
  return d.response;
}

function buildFlightData(raw) {
  if (!raw) return null;

  // ETA: use airlabs eta field (minutes from now) if available
  let estimatedArrival = null;
  if (raw.eta && raw.status === 'en-route') {
    estimatedArrival = new Date(Date.now() + raw.eta * 60 * 1000).toISOString();
  } else if (raw.arr_estimated_utc) {
    estimatedArrival = raw.arr_estimated_utc.replace(' ', 'T') + 'Z';
  } else if (raw.arr_time_utc) {
    estimatedArrival = raw.arr_time_utc.replace(' ', 'T') + 'Z';
  }

  // Actual arrival
  let actualArrival = null;
  if (raw.arr_actual_utc) {
    actualArrival = raw.arr_actual_utc.replace(' ', 'T') + 'Z';
  }

  // Departure times
  const depActual = raw.dep_actual_utc ? raw.dep_actual_utc.replace(' ', 'T') + 'Z' : null;
  const depScheduled = raw.dep_time_utc ? raw.dep_time_utc.replace(' ', 'T') + 'Z' : null;
  const arrScheduled = raw.arr_time_utc ? raw.arr_time_utc.replace(' ', 'T') + 'Z' : null;

  let status = 'unknown';
  const s = (raw.status || '').toLowerCase();
  if (s === 'en-route') status = 'active';
  else if (s === 'landed') status = 'landed';
  else if (s === 'scheduled') status = 'scheduled';
  else if (s === 'cancelled') status = 'cancelled';

  return {
    flight_status: status,
    flight_number: raw.flight_iata,
    percent: raw.percent || 0,
    etaMins: raw.eta || null,
    departure: {
      iata: raw.dep_iata,
      scheduled: depScheduled,
      actual: depActual,
    },
    arrival: {
      iata: raw.arr_iata,
      scheduled: arrScheduled,
      estimated: estimatedArrival,
      actual: actualArrival,
    },
    aircraft: raw.model ? { iata: raw.model } : null,
    live: {
      altitude: raw.alt ? Math.round(raw.alt * 3.28084) : null,
      speed_horizontal: raw.speed || null,
      lat: raw.lat,
      lng: raw.lng,
    },
  };
}

app.get('/flight', async (req, res) => {
  const { num } = req.query;
  if (!num) return res.status(400).json({ error: 'Missing flight number' });
  try {
    const raw = await fetchFlight(num);
    const flight = buildFlightData(raw);
    res.json({ data: flight ? [flight] : [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
        const data = buildFlightData(raw);
        return { flightNum: fn, data };
      } catch (e) {
        return { flightNum: fn, data: null, error: e.message };
      }
    }));

    const active = results.find(r => r.data && r.data.flight_status === 'active');
    if (active) return res.json({ type: 'fly', flightNum: active.flightNum, flightData: active.data, autoSelected: true });

    const scheduled = results.filter(r => r.data && r.data.flight_status === 'scheduled');
    if (scheduled.length > 0) return res.json({ type: 'fly', flightNum: scheduled[0].flightNum, flightData: scheduled[0].data, autoSelected: true });

    const landed = results.filter(r => r.data && r.data.flight_status === 'landed');
    if (landed.length > 0) {
      const last = landed[landed.length - 1];
      return res.json({ type: 'fly', flightNum: last.flightNum, flightData: last.data, autoSelected: true, allLanded: true });
    }

    return res.json({ type: 'fly', flights, autoSelected: false, debug: results });
  }
});

app.get('/debug', async (req, res) => {
  const { num } = req.query;
  if (!num) return res.status(400).json({ error: 'provide ?num=BR256' });
  try {
    const raw = await fetchFlight(num);
    const built = buildFlightData(raw);
    res.json({ raw, built });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.use(express.static('public'));
app.get('/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
