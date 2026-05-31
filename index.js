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

const API_KEY = 'e5984821e9d4884d79e40edf4ef24b0b';
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

async function fetchFlight(flightNum) {
  const today = todayHKT();
  const url = `http://api.aviationstack.com/v1/flights?access_key=${API_KEY}&flight_iata=${flightNum}&flight_date=${today}&limit=5`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.data || d.data.length === 0) return null;

  // Filter to flights whose departure date in HKT matches today
  const todayFlights = d.data.filter(f => {
    const dep = f.departure && f.departure.scheduled;
    if (!dep) return false;
    const depHKT = new Date(new Date(dep).getTime() + HKT_OFFSET_MS);
    return depHKT.toISOString().slice(0, 10) === today;
  });

  return todayFlights.length > 0 ? todayFlights[0] : d.data[0];
}

app.get('/flight', async (req, res) => {
  const { num } = req.query;
  if (!num) return res.status(400).json({ error: 'Missing flight number' });
  try {
    const flight = await fetchFlight(num);
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
        const data = await fetchFlight(fn);
        return { flightNum: fn, data };
      } catch { return { flightNum: fn, data: null }; }
    }));

    const active = results.find(r => r.data && (r.data.flight_status === 'active' || r.data.flight_status === 'en-route'));
    if (active) return res.json({ type: 'fly', flightNum: active.flightNum, flightData: active.data, autoSelected: true });

    const scheduled = results
      .filter(r => r.data && r.data.flight_status === 'scheduled')
      .sort((a, b) => new Date(a.data.departure.scheduled || 0) - new Date(b.data.departure.scheduled || 0));
    if (scheduled.length > 0) return res.json({ type: 'fly', flightNum: scheduled[0].flightNum, flightData: scheduled[0].data, autoSelected: true });

    const landed = results.filter(r => r.data && r.data.flight_status === 'landed');
    if (landed.length > 0) {
      const last = landed[landed.length - 1];
      return res.json({ type: 'fly', flightNum: last.flightNum, flightData: last.data, autoSelected: true, allLanded: true });
    }

    return res.json({ type: 'fly', flights, autoSelected: false, message: 'Could not determine current flight' });
  }
});

app.use(express.static('public'));
app.get('/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
