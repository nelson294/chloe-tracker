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

// Proxy a single flight lookup to AviationStack
app.get('/flight', async (req, res) => {
  const { num } = req.query;
  if (!num) return res.status(400).json({ error: 'Missing flight number' });

  try {
    const url = `http://api.aviationstack.com/v1/flights?access_key=${API_KEY}&flight_iata=${num}&limit=1`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Smart status endpoint — returns what Chloe is doing right now
app.get('/status', async (req, res) => {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const day = ROSTER[key];

  if (!day) return res.json({ type: 'unknown', key, message: 'No roster data for today' });

  if (day.type === 'off') return res.json({ type: 'off', label: day.label });
  if (day.type === 'layover') return res.json({ type: 'layover', label: day.label });

  if (day.type === 'standby') {
    const [startH, startM] = day.time.split('-')[0].split(':').map(Number);
    const [endH, endM] = day.time.split('-')[1].split(':').map(Number);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;
    let phase = nowMins < startMins ? 'before' : nowMins < endMins ? 'active' : 'released';
    return res.json({ type: 'standby', label: day.label, time: day.time, phase, alsoFly: day.alsoFly || [] });
  }

  if (day.type === 'fly') {
    const flights = day.flights || [];

    // Fetch all flights in parallel
    const results = await Promise.all(flights.map(async (fn) => {
      try {
        const url = `http://api.aviationstack.com/v1/flights?access_key=${API_KEY}&flight_iata=${fn}&limit=1`;
        const r = await fetch(url);
        const d = await r.json();
        return { flightNum: fn, data: d.data && d.data[0] ? d.data[0] : null };
      } catch { return { flightNum: fn, data: null }; }
    }));

    // Pick the right flight by status priority: active > scheduled soonest > landed last
    let active = results.find(r => r.data && (r.data.flight_status === 'active' || r.data.flight_status === 'en-route'));
    if (active) return res.json({ type: 'fly', flightNum: active.flightNum, flightData: active.data, autoSelected: true });

    let scheduled = results
      .filter(r => r.data && r.data.flight_status === 'scheduled')
      .sort((a, b) => {
        const ta = new Date(a.data.departure.scheduled || 0);
        const tb = new Date(b.data.departure.scheduled || 0);
        return ta - tb;
      });
    if (scheduled.length > 0) return res.json({ type: 'fly', flightNum: scheduled[0].flightNum, flightData: scheduled[0].data, autoSelected: true });

    // All landed — return the last one
    let landed = results.filter(r => r.data && r.data.flight_status === 'landed');
    if (landed.length > 0) {
      const last = landed[landed.length - 1];
      return res.json({ type: 'fly', flightNum: last.flightNum, flightData: last.data, autoSelected: true, allLanded: true });
    }

    return res.json({ type: 'fly', flights, autoSelected: false, message: 'Could not determine current flight' });
  }
});

app.get('/', (req, res) => res.send('Chloe tracker API is running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
