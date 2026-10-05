'use strict';

// Published-to-web CSV of the "main" sheet (read-only, does not reveal the editable sheet's URL).
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQoOtK9dwGaxrPLO9GW_RYNyXoTJdTaf9YASp2pOaIt4rH40NbjtVNWB7YcSwcX_eq4DX3McaiC_zdx/pub?gid=0&single=true&output=csv';

const COL_DATE = 'datum_strojovy';
const COL_DECISION = 'Konsenzus';
const COL_PROGRAM = 'Juli program';

const DAYS_AHEAD = 7;   // how many upcoming days to list
const STALE_DAYS = 3;   // warn when the last successful download is older than this
const STORE_KEY = 'schedule-v1';

// Values of the Konsenzus column → how to display them.
const PEOPLE = {
  'Pája': { name: 'Helios', place: "Helios's", cls: 'mum' },
  'Dan':  { name: 'Mia & Yori', place: "Mia & Yori's", cls: 'dad' },
};

// ---------- dates ----------

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function isWeekend(d) {
  return d.getDay() === 0 || d.getDay() === 6;
}

const fmtLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtStamp = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// ---------- data ----------

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Returns { 'YYYY-MM-DD': { k: decision, p: program } } for yesterday onwards, or throws.
function extractSchedule(csvText) {
  const rows = parseCSV(csvText);
  const header = rows[0] || [];
  const iDate = header.indexOf(COL_DATE);
  const iDecision = header.indexOf(COL_DECISION);
  const iProgram = header.indexOf(COL_PROGRAM);
  if (iDate < 0 || iDecision < 0) throw new Error('The sheet is missing expected columns.');

  const from = isoDate(addDays(new Date(), -1));
  const days = {};
  let count = 0;
  for (const r of rows.slice(1)) {
    const d = (r[iDate] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    count++;
    if (d < from) continue;
    const k = (r[iDecision] || '').trim();
    const entry = { k };
    // Program notes are shown only for days that aren't a plain mum/dad decision (trips, camps…).
    if (k && !parseDecision(k).people && iProgram >= 0) entry.p = (r[iProgram] || '').trim();
    days[d] = entry;
  }
  if (count === 0) throw new Error('The sheet has no dated rows.');
  return days;
}

function parseDecision(k) {
  if (!k) return { kind: 'unknown' };
  const parts = k.split('->').map(s => s.trim());
  if (parts.length === 2 && PEOPLE[parts[0]] && PEOPLE[parts[1]]) {
    return { kind: 'switch', from: PEOPLE[parts[0]], to: PEOPLE[parts[1]], people: true };
  }
  if (PEOPLE[k]) return { kind: 'stay', to: PEOPLE[k], people: true };
  return { kind: 'other', text: k };
}

function loadStored() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY));
  } catch (e) {
    return null;
  }
}

function saveStored(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) { /* storage unavailable; the app still works for this session */ }
}

// ---------- rendering ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderToday(date, entry) {
  const box = document.getElementById('today');
  box.replaceChildren();
  const weekend = isWeekend(date);
  const add = (cls, text) => { if (text) box.appendChild(el('div', cls, text)); };

  if (!entry) {
    box.className = 'today none';
    add('who', '?');
    add('sentence', "I don't have a plan for today.");
    add('detail', 'Ask Helios or Mia & Yori.');
    return;
  }

  const dec = parseDecision(entry.k);
  if (dec.kind === 'stay') {
    box.className = 'today ' + dec.to.cls;
    add('who', dec.to.name);
    add('sentence', weekend ? "Today you're at " + dec.to.place + '.' : 'After school, go to ' + dec.to.place + '.');
  } else if (dec.kind === 'switch') {
    box.className = 'today ' + dec.to.cls;
    add('who', dec.to.name);
    if (weekend) {
      add('sentence', 'Today you move to ' + dec.to.place + '.');
      add('detail', "In the morning you're still at " + dec.from.place + '.');
    } else {
      add('sentence', 'After school, go to ' + dec.to.place + '.');
      add('detail', 'In the morning you leave from ' + dec.from.place + '.');
    }
  } else if (dec.kind === 'other') {
    box.className = 'today other';
    add('who', dec.text === 'Special' ? 'Special day' : dec.text);
    add('sentence', entry.p);
    add('detail', 'Ask Helios or Mia & Yori where to go.');
  } else {
    box.className = 'today none';
    add('who', '?');
    add('sentence', 'Not decided yet.');
    add('detail', 'Ask Helios or Mia & Yori.');
  }
}

function chip(person) {
  return el('span', 'chip ' + person.cls, person.name);
}

function renderUpcoming(today, days) {
  const list = document.getElementById('upcoming');
  list.replaceChildren();
  for (let i = 1; i <= DAYS_AHEAD; i++) {
    const date = addDays(today, i);
    const entry = days[isoDate(date)];
    const li = el('li');
    li.appendChild(el('span', 'day', fmtShort.format(date)));
    const chips = el('span', 'chips');
    const dec = parseDecision(entry ? entry.k : '');
    if (!entry) {
      chips.appendChild(el('span', 'chip none', 'no data · ask Helios or Mia & Yori'));
    } else if (dec.kind === 'stay') {
      chips.appendChild(chip(dec.to));
    } else if (dec.kind === 'switch') {
      chips.append(chip(dec.from), el('span', 'arrow', '→'), chip(dec.to));
    } else if (dec.kind === 'other') {
      chips.appendChild(el('span', 'chip other', (entry.p || dec.text) + ' · ask Helios or Mia & Yori'));
    } else {
      chips.appendChild(el('span', 'chip none', 'ask Helios or Mia & Yori'));
    }
    li.appendChild(chips);
    list.appendChild(li);
  }
}

function render(stored, fetchError) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = (stored && stored.days) || {};
  const todayEntry = days[isoDate(today)];

  document.getElementById('today-date').textContent = 'Today is ' + fmtLong.format(today);
  renderToday(today, todayEntry);
  renderUpcoming(today, days);

  const banners = document.getElementById('banners');
  banners.replaceChildren();
  const status = document.getElementById('status');

  if (!stored) {
    banners.appendChild(el('div', 'banner err',
      "Couldn't download the plan yet. Connect to the internet and open the app again."));
    status.textContent = fetchError ? 'Error: ' + fetchError : '';
    return;
  }

  const ageDays = (now - stored.fetchedAt) / 86400000;
  if (!todayEntry) {
    banners.appendChild(el('div', 'banner err',
      "The plan is out of date and has nothing for today. Connect to the internet, or ask Helios or Mia & Yori."));
  } else if (ageDays > STALE_DAYS) {
    banners.appendChild(el('div', 'banner warn',
      'The plan is ' + Math.floor(ageDays) + ' days old and may have changed. Open the app again when you are online.'));
  }

  let text = 'Plan downloaded ' + fmtStamp.format(new Date(stored.fetchedAt));
  if (fetchError) text += ' · offline now';
  status.textContent = text;
}

// ---------- update loop ----------

const REFRESH_MINUTES = 15;  // background re-download while the app stays open

const button = document.getElementById('refresh');
let busy = false;
let lastError = null;
let buttonTimer = null;

function setButton(text, disabled) {
  button.textContent = text;
  button.disabled = disabled;
}

async function refresh() {
  if (busy) return;
  busy = true;
  clearTimeout(buttonTimer);
  setButton('Refreshing…', true);
  lastError = null;
  try {
    const res = await fetch(CSV_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const days = extractSchedule(await res.text());
    saveStored({ fetchedAt: Date.now(), days });
  } catch (e) {
    lastError = e.message || String(e);
  }
  busy = false;
  render(loadStored(), lastError);
  setButton(lastError ? 'Offline, try again later' : 'Updated ✓', false);
  buttonTimer = setTimeout(() => setButton('Refresh', false), 3000);
}

render(loadStored(), null);
refresh();

button.addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
setInterval(() => {
  if (document.visibilityState === 'visible') refresh();
}, REFRESH_MINUTES * 60000);
// Keep the displayed day correct if the app stays open past midnight.
setInterval(() => render(loadStored(), lastError), 60000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
}
