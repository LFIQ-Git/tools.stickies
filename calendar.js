// Today's calendar via Microsoft Graph, using the same app-only credentials
// Keystone's briefing uses (PKM_SECRET_M365_LFI in keystone .env.local:
// {client_id, tenant_id, client_secret}). Read-only; ✓ on a calendar card
// just dismisses it — there is nothing to correct at the source.
const fs = require('fs');
const crypto = require('crypto');
const { todayPT } = require('./ingest-helpers');

let tokenCache = { token: null, exp: 0 };

function creds(cfg) {
  const env = fs.readFileSync(cfg.envFile, 'utf8');
  const m = env.match(/^PKM_SECRET_M365_LFI=(.+)$/m);
  if (!m) throw new Error('PKM_SECRET_M365_LFI not found');
  return JSON.parse(m[1].trim().replace(/^['"]|['"]$/g, ''));
}

async function graphToken(cfg) {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const c = creds(cfg);
  const res = await fetch(`https://login.microsoftonline.com/${c.tenant_id}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.client_id,
      client_secret: c.client_secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = await res.json();
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in - 300) * 1000 };
  return tokenCache.token;
}

function ptOffset() {
  const s = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset' });
  return s.match(/GMT([+-]\d{2}:\d{2})/)[1];
}

function hhmm(dt) { return dt.slice(11, 16); }

async function ingestCalendar(cfg) {
  const notes = [];
  try {
    const date = todayPT();
    const off = ptOffset();
    const token = await graphToken(cfg);
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.user)}/calendarView` +
      `?startDateTime=${date}T00:00:00${off}&endDateTime=${date}T23:59:59${off}` +
      `&$select=subject,start,end,location,organizer,isCancelled,isAllDay&$orderby=start/dateTime&$top=25`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="America/Los_Angeles"' },
    });
    if (!res.ok) throw new Error(`graph ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const events = (await res.json()).value || [];
    const nowPT = new Date().toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' }).replace(' ', 'T');
    for (const ev of events) {
      if (ev.isCancelled) continue;
      if (!ev.isAllDay && ev.end?.dateTime && ev.end.dateTime < nowPT) continue; // already over
      const when = ev.isAllDay ? 'All day' : `${hhmm(ev.start.dateTime)}–${hhmm(ev.end.dateTime)}`;
      const parts = [`${when} ${ev.subject || '(no subject)'}`];
      if (ev.location?.displayName) parts.push(ev.location.displayName);
      if (ev.organizer?.emailAddress?.name) parts.push(`org: ${ev.organizer.emailAddress.name}`);
      const text = parts.join(' | ').slice(0, 300);
      const summary = `${ev.isAllDay ? 'All day' : hhmm(ev.start.dateTime)} ${ev.subject || ''}`.trim().slice(0, 90);
      const key = crypto.createHash('sha1').update(`${ev.subject}${ev.start?.dateTime}`).digest('hex').slice(0, 10);
      notes.push({
        id: `cal:${date}:${key}`,
        source: 'cal',
        text,
        summary,
        deadline: date,
        sourceFile: null,
        createdDate: date,
      });
    }
    return { notes };
  } catch (e) { return { notes, error: e.message }; }
}

module.exports = { ingestCalendar };
