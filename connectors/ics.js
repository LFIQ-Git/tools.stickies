// Calendar feeds in iCalendar (.ics) format: the private/secret address that
// Google Calendar, Outlook, iCloud and Fastmail all publish. Shows today's
// meetings that have not ended yet. Read-only; ✓ just dismisses the card.
//
// Recurrence support covers what calendars actually emit for meetings:
// FREQ DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY
// (incl. ordinals like 2TU / -1FR), BYMONTHDAY, BYMONTH, plus EXDATE,
// moved/cancelled instances (RECURRENCE-ID) and STATUS:CANCELLED.
const { todayLocal, localDate, hash, clip, lines } = require('./util');

// Outlook/Exchange feeds use Windows zone names in TZID.
const WINDOWS_TZ = {
  'Dateline Standard Time': 'Etc/GMT+12', 'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage', 'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix', 'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago', 'Eastern Standard Time': 'America/New_York',
  'Atlantic Standard Time': 'America/Halifax', 'Newfoundland Standard Time': 'America/St_Johns',
  'SA Pacific Standard Time': 'America/Bogota', 'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires', 'Mexico Standard Time': 'America/Mexico_City',
  'Central Standard Time (Mexico)': 'America/Mexico_City', 'UTC': 'UTC', 'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw', 'E. Europe Standard Time': 'Europe/Chisinau',
  'GTB Standard Time': 'Europe/Bucharest', 'FLE Standard Time': 'Europe/Kiev', 'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg', 'Russian Standard Time': 'Europe/Moscow',
  'Arabian Standard Time': 'Asia/Dubai', 'India Standard Time': 'Asia/Kolkata', 'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore', 'Taipei Standard Time': 'Asia/Taipei', 'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane', 'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland',
};

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---- parsing ----

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(v) {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

/** VEVENT blocks as arrays of {name, params, value}. */
function parseEvents(icsText) {
  const events = [];
  let cur = null;
  for (const line of unfold(icsText).split('\n')) {
    if (line === 'BEGIN:VEVENT') { cur = []; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    if (colon < 0) continue;
    const [name, ...paramParts] = line.slice(0, colon).split(';');
    const params = {};
    for (const p of paramParts) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    }
    cur.push({ name: name.toUpperCase(), params, value: line.slice(colon + 1) });
  }
  return events.map(props => {
    const get = n => props.find(p => p.name === n);
    const all = n => props.filter(p => p.name === n);
    return { get, all };
  });
}

/** Offset in ms of `tz` from UTC at instant `ms`. */
function tzOffset(ms, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

function resolveTz(tzid) {
  if (!tzid) return null;
  const tz = WINDOWS_TZ[tzid] || tzid.replace(/^\/[^/]+\/[^/]+\//, ''); // strip "/mozilla.org/20050126_1/" prefixes
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
}

/** Wall-clock fields in a zone (or floating local when tz is null) → epoch ms. */
function wallToEpoch(y, mo, d, h, mi, s, tz) {
  if (!tz) return new Date(y, mo - 1, d, h, mi, s).getTime();
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz); // second pass settles DST edges
  return t;
}

/**
 * Parse a DATE or DATE-TIME property.
 * @returns {{allDay:boolean, y:number, mo:number, d:number, h:number, mi:number, s:number, tz:?string, utc:boolean}}
 */
function parseDateProp(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const allDay = !m[4] || prop.params.VALUE === 'DATE';
  return {
    allDay, y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0),
    utc: !!m[7], tz: m[7] ? 'UTC' : resolveTz(prop.params.TZID),
  };
}

function dateKey(y, mo, d) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDuration(v) {
  const m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function parseRRule(v) {
  const r = {};
  for (const part of v.split(';')) {
    const [k, val] = part.split('=');
    if (k) r[k.toUpperCase()] = val;
  }
  return r;
}

// ---- recurrence: does a rule produce an occurrence on calendar day (y, mo, d)? ----

const dayNum = (y, mo, d) => Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
const weekday = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

function byDayMatches(spec, y, mo, d, scope) {
  // spec like "MO", "2TU", "-1FR". scope 'month' or 'year' for ordinals.
  const m = spec.match(/^([+-]?\d+)?([A-Z]{2})$/);
  if (!m) return false;
  if (DAY_CODES[weekday(y, mo, d)] !== m[2]) return false;
  if (!m[1]) return true;
  const n = +m[1];
  if (scope === 'year') {
    const doy = dayNum(y, mo, d) - dayNum(y, 1, 1);
    const total = dayNum(y + 1, 1, 1) - dayNum(y, 1, 1);
    return n > 0 ? Math.floor(doy / 7) + 1 === n : Math.floor((total - 1 - doy) / 7) + 1 === -n;
  }
  return n > 0 ? Math.floor((d - 1) / 7) + 1 === n : Math.floor((daysInMonth(y, mo) - d) / 7) + 1 === -n;
}

function monthDayMatches(list, y, mo, d) {
  return list.some(x => {
    const n = +x;
    return n > 0 ? n === d : daysInMonth(y, mo) + n + 1 === d;
  });
}

/** True when the rule (ignoring COUNT/UNTIL) hits the given day. Exported for tests. */
function ruleHitsDay(rule, start, y, mo, d) {
  const diffDays = dayNum(y, mo, d) - dayNum(start.y, start.mo, start.d);
  if (diffDays < 0) return false;
  const interval = Math.max(1, +rule.INTERVAL || 1);
  const byDay = rule.BYDAY ? rule.BYDAY.split(',') : null;
  const byMonthDay = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',') : null;
  const byMonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : null;
  if (byMonth && !byMonth.includes(mo)) return false;
  switch (rule.FREQ) {
    case 'DAILY':
      if (byDay && !byDay.some(s => byDayMatches(s, y, mo, d, 'month'))) return false;
      if (byMonthDay && !monthDayMatches(byMonthDay, y, mo, d)) return false;
      return diffDays % interval === 0;
    case 'WEEKLY': {
      const wkst = DAY_CODES.indexOf(rule.WKST || 'MO');
      const startOfWeek = (yy, mm, dd) => dayNum(yy, mm, dd) - ((weekday(yy, mm, dd) - wkst + 7) % 7);
      const weeks = Math.round((startOfWeek(y, mo, d) - startOfWeek(start.y, start.mo, start.d)) / 7);
      if (weeks % interval !== 0) return false;
      const days = byDay || [DAY_CODES[weekday(start.y, start.mo, start.d)]];
      return days.some(s => DAY_CODES[weekday(y, mo, d)] === s.replace(/^[+-]?\d+/, ''));
    }
    case 'MONTHLY': {
      const months = (y - start.y) * 12 + (mo - start.mo);
      if (months % interval !== 0) return false;
      if (byDay || byMonthDay) {
        if (byDay && !byDay.some(s => byDayMatches(s, y, mo, d, 'month'))) return false;
        if (byMonthDay && !monthDayMatches(byMonthDay, y, mo, d)) return false;
        return true;
      }
      return d === start.d;
    }
    case 'YEARLY': {
      if ((y - start.y) % interval !== 0) return false;
      if (byDay) {
        const scope = byMonth ? 'month' : 'year';
        if (!byDay.some(s => byDayMatches(s, y, mo, d, scope))) return false;
        return !byMonthDay || monthDayMatches(byMonthDay, y, mo, d);
      }
      if (byMonthDay) return (byMonth || [start.mo]).includes(mo) && monthDayMatches(byMonthDay, y, mo, d);
      return mo === (byMonth ? mo : start.mo) && d === start.d;
    }
    default:
      return false;
  }
}

/** Is the day an occurrence, honoring COUNT and UNTIL? */
function occursOn(rule, start, untilMs, y, mo, d) {
  if (!ruleHitsDay(rule, start, y, mo, d)) return false;
  if (untilMs != null) {
    const occStart = wallToEpoch(y, mo, d, start.h, start.mi, start.s, start.tz);
    if (occStart > untilMs) return false;
  }
  if (rule.COUNT) {
    const count = +rule.COUNT;
    let n = 0;
    const end = dayNum(y, mo, d);
    for (let k = dayNum(start.y, start.mo, start.d); k <= end; k++) {
      const dt = new Date(k * 86400000);
      if (ruleHitsDay(rule, start, dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())) {
        n++;
        if (n > count) return false;
      }
    }
  }
  return true;
}

// ---- occurrences for today ----

function exdateKeys(ev) {
  const keys = new Set();
  for (const p of ev.all('EXDATE')) {
    for (const v of p.value.split(',')) {
      const dp = parseDateProp({ value: v, params: p.params });
      if (dp) keys.add(dateKey(dp.y, dp.mo, dp.d));
    }
  }
  return keys;
}

/**
 * Today's occurrences across all events, as {uid, title, location, startMs, endMs, allDay}.
 * `now` is injectable for tests.
 */
function occurrencesToday(icsText, now = new Date()) {
  const today = localDate(now);
  const events = parseEvents(icsText);
  // Instances overridden by a RECURRENCE-ID event are skipped on the master.
  const overridden = new Set();
  for (const ev of events) {
    const rid = parseDateProp(ev.get('RECURRENCE-ID'));
    const uid = ev.get('UID')?.value;
    if (rid && uid) overridden.add(`${uid}|${dateKey(rid.y, rid.mo, rid.d)}`);
  }
  const out = [];
  for (const ev of events) {
    if ((ev.get('STATUS')?.value || '').toUpperCase() === 'CANCELLED') continue;
    const start = parseDateProp(ev.get('DTSTART'));
    if (!start) continue;
    const uid = ev.get('UID')?.value || '';
    const title = unescapeText(ev.get('SUMMARY')?.value || '(no title)');
    const location = unescapeText(ev.get('LOCATION')?.value || '');
    const startEpoch = start.allDay ? null : wallToEpoch(start.y, start.mo, start.d, start.h, start.mi, start.s, start.tz);
    const endProp = parseDateProp(ev.get('DTEND'));
    let durationMs = parseDuration(ev.get('DURATION')?.value);
    if (durationMs == null) {
      if (endProp && start.allDay) durationMs = (dayNum(endProp.y, endProp.mo, endProp.d) - dayNum(start.y, start.mo, start.d)) * 86400000;
      else if (endProp) durationMs = wallToEpoch(endProp.y, endProp.mo, endProp.d, endProp.h, endProp.mi, endProp.s, endProp.tz) - startEpoch;
      else durationMs = start.allDay ? 86400000 : 0;
    }
    const rrule = ev.get('RRULE') && !ev.get('RECURRENCE-ID') ? parseRRule(ev.get('RRULE').value) : null;
    const untilProp = rrule?.UNTIL ? parseDateProp({ value: rrule.UNTIL, params: {} }) : null;
    const untilMs = untilProp
      ? (untilProp.allDay ? wallToEpoch(untilProp.y, untilProp.mo, untilProp.d, 23, 59, 59, start.tz) : wallToEpoch(untilProp.y, untilProp.mo, untilProp.d, untilProp.h, untilProp.mi, untilProp.s, untilProp.utc ? 'UTC' : start.tz))
      : null;
    const exdates = exdateKeys(ev);

    // Candidate wall dates in the event's zone: yesterday..tomorrow covers any
    // zone difference with the local machine.
    const base = new Date(today + 'T12:00:00');
    for (const delta of [-1, 0, 1]) {
      const c = new Date(base.getTime() + delta * 86400000);
      const y = c.getFullYear(), mo = c.getMonth() + 1, d = c.getDate();
      const key = dateKey(y, mo, d);
      if (start.allDay) {
        // All-day spans are date-based, not instant-based: today only.
        if (delta !== 0) continue;
        const spanDays = Math.max(1, Math.round(durationMs / 86400000));
        let hit = false;
        if (rrule) {
          for (let back = 0; back < spanDays && !hit; back++) {
            const s = new Date(base.getTime() - back * 86400000);
            const sk = dateKey(s.getFullYear(), s.getMonth() + 1, s.getDate());
            hit = !exdates.has(sk) && !overridden.has(`${uid}|${sk}`)
              && occursOn(rrule, start, untilMs, s.getFullYear(), s.getMonth() + 1, s.getDate());
          }
        } else {
          const off = dayNum(y, mo, d) - dayNum(start.y, start.mo, start.d);
          hit = off >= 0 && off < spanDays;
        }
        if (hit) out.push({ uid, title, location, allDay: true, startMs: null, endMs: null });
        continue;
      }
      let occStart;
      if (rrule) {
        if (exdates.has(key) || overridden.has(`${uid}|${key}`)) continue;
        if (!occursOn(rrule, start, untilMs, y, mo, d)) continue;
        occStart = wallToEpoch(y, mo, d, start.h, start.mi, start.s, start.tz);
      } else {
        // Single event: only its own start instant matters.
        if (delta !== 0) continue;
        occStart = startEpoch;
      }
      if (localDate(new Date(occStart)) !== today) continue;
      if (out.some(o => o.uid === uid && o.startMs === occStart)) continue;
      out.push({ uid, title, location, allDay: false, startMs: occStart, endMs: occStart + durationMs });
    }
  }
  return out.sort((a, b) => (a.startMs ?? -1) - (b.startMs ?? -1));
}

// ---- connector ----

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function ingest(cfg) {
  const urls = lines(cfg.urls).map(u => u.replace(/^webcal:\/\//i, 'https://'));
  if (!urls.length) return { notes: [], error: 'no calendar addresses (Settings)' };
  const date = todayLocal();
  const now = Date.now();
  const notes = [];
  const errors = [];
  await Promise.all(urls.map(async (url, i) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'text/calendar' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (!body.includes('BEGIN:VCALENDAR')) throw new Error('not an iCalendar feed');
      for (const o of occurrencesToday(body)) {
        if (o.allDay && cfg.showAllDay === false) continue;
        if (!o.allDay && o.endMs <= now) continue; // already over
        const when = o.allDay ? 'All day' : `${fmtTime(o.startMs)}–${fmtTime(o.endMs)}`;
        const text = clip([`${when} ${o.title}`, o.location].filter(Boolean).join(' | '));
        notes.push({
          id: `ics:${date}:${hash(`${o.uid}|${o.startMs}|${o.title}`)}`,
          source: 'ics',
          text,
          summary: `${o.allDay ? 'All day' : fmtTime(o.startMs)} ${o.title}`.slice(0, 90),
          deadline: date,
          sourceFile: null,
          sortKey: o.startMs ?? 0,
          createdDate: date,
        });
      }
    } catch (e) {
      errors.push(`calendar ${i + 1}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
    }
  }));
  notes.sort((a, b) => a.sortKey - b.sortKey);
  return { notes, error: errors.length ? errors.join('; ') : undefined };
}

module.exports = {
  key: 'ics',
  label: 'Calendar (iCal link)',
  chip: 'Cal',
  color: '#E9E9E9',
  order: 10,
  live: true,
  description: "Today's remaining meetings from any calendar's private iCal (.ics) address. Read-only.",
  fields: [
    { name: 'urls', label: 'Calendar addresses', type: 'textarea', secret: true,
      help: 'One per line. Google: Settings → your calendar → "Secret address in iCal format". Outlook: Settings → Calendar → Shared calendars → Publish → ICS. iCloud: share calendar as Public → copy link.' },
    { name: 'showAllDay', label: 'Show all-day events', type: 'boolean', default: true },
  ],
  ingest,
  occurrencesToday,
  ruleHitsDay,
};
