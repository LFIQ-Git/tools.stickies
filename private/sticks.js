// Sticks needs-attention source. Reads the SAME live store Sticks (and Kit's
// priority stack) use: items.tasks in Neon. "Needs attention" = open tasks
// that are high-priority or dated near today, ranked the way Sticks ranks
// them (priority_score desc). Marking done here closes the task for real.
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Client } = require('pg');
const { todayPT } = require('./helpers');

let cachedUrl = null;

function databaseUrl(cfg) {
  if (cachedUrl) return cachedUrl;
  try {
    const fromKeychain = execFileSync('security', ['find-generic-password', '-w', '-s', cfg.keychainService], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (fromKeychain) { cachedUrl = normalizeSsl(fromKeychain); return cachedUrl; }
  } catch { /* no keychain entry; fall through */ }
  try {
    const env = fs.readFileSync(cfg.envFile, 'utf8');
    const m = env.match(/^DATABASE_URL=(.+)$/m);
    if (m) { cachedUrl = normalizeSsl(m[1].trim().replace(/^"|"$/g, '')); return cachedUrl; }
  } catch { /* unreadable */ }
  return null;
}

// Neon URLs carry sslmode=require; pg v8 logs a deprecation warning on every
// connect unless libpq-compat semantics are requested explicitly.
function normalizeSsl(url) {
  if (url.includes('sslmode=') && !url.includes('uselibpqcompat=')) {
    return url.replace('sslmode=', 'uselibpqcompat=true&sslmode=');
  }
  return url;
}

async function withClient(cfg, fn) {
  const url = databaseUrl(cfg);
  if (!url) throw new Error('no DATABASE_URL (keychain or keystone .env.local)');
  const client = new Client({ connectionString: url, statement_timeout: 8000 });
  await client.connect();
  try { return await fn(client); }
  finally { await client.end(); }
}

async function fetchHideRules(client) {
  try {
    const r = await client.query("SELECT value FROM items.user_settings WHERE key = 'task_rules' LIMIT 1");
    const v = r.rows[0]?.value;
    const rules = typeof v === 'string' ? JSON.parse(v) : v;
    return (rules?.hide_rules || []).map(s => String(s).toLowerCase());
  } catch { return []; }
}

async function ingestSticks(cfg) {
  const notes = [];
  try {
    const rows = await withClient(cfg, async client => {
      const hide = await fetchHideRules(client);
      const r = await client.query(
        `SELECT COALESCE(metadata->>'legacy_pkm_id', id::text) AS id,
                title, priority_score,
                to_char(due_date::date, 'YYYY-MM-DD') AS due,
                metadata->>'project' AS project,
                metadata->>'description' AS description
         FROM items.tasks
         WHERE lower(coalesce(status,'open')) NOT IN ('done','cancelled')
           AND ((due_date IS NOT NULL
                 AND due_date::date BETWEEN CURRENT_DATE - $2::int AND CURRENT_DATE + $3::int)
                OR (priority_score >= $1
                    AND (due_date IS NULL OR due_date::date >= CURRENT_DATE - $2::int)))
         ORDER BY priority_score DESC NULLS LAST, due_date ASC NULLS LAST
         LIMIT $4`,
        [cfg.minPriority, cfg.overdueGraceDays, cfg.dueWithinDays, cfg.cap * 3]
      );
      return r.rows.filter(row => {
        const hay = `${row.title} ${row.description || ''} ${row.project || ''}`.toLowerCase();
        return !hide.some(p => p && hay.includes(p));
      }).slice(0, cfg.cap);
    });
    const date = todayPT();
    for (const row of rows) {
      const desc = (row.description || '').replace(/\s+/g, ' ').trim();
      const text = desc ? `${row.title} — ${desc}`.slice(0, 300) : row.title;
      notes.push({
        id: `sticks:${row.id}`,
        source: 'sticks',
        text,
        summary: row.title.length > 90 ? row.title.slice(0, 87) + '…' : row.title,
        deadline: row.due || null,
        sourceFile: null,
        sticksTaskId: row.id,
        createdDate: date,
      });
    }
    return { notes };
  } catch (e) {
    return { notes, error: e.message };
  }
}

// Close the task in the live store — same effect as completing it in Sticks.
async function closeSticksTask(cfg, taskId) {
  await withClient(cfg, client =>
    client.query(
      `UPDATE items.tasks
       SET status = 'done', completed_at = NOW(),
           metadata = coalesce(metadata, '{}'::jsonb) || '{"completed_by": "stickies"}'::jsonb
       WHERE COALESCE(metadata->>'legacy_pkm_id', id::text) = $1
         AND lower(coalesce(status,'open')) NOT IN ('done','cancelled')`,
      [taskId]
    )
  );
}

// ---- Commitments (items.commitments — the LIVE store; the pkm_get_commitments
// MCP tool reads a dead table, so we query directly) ----
async function ingestCommitments(cfg) {
  const notes = [];
  try {
    const rows = await withClient(cfg, client => client.query(
      `SELECT id::text AS id, promised_to, promise_text,
              to_char(deadline::date, 'YYYY-MM-DD') AS due,
              metadata->>'direction' AS direction
       FROM items.commitments
       WHERE fulfilled_at IS NULL
         AND lower(coalesce(metadata->>'status','open')) NOT IN ('done','promoted','dismissed','closed')
         AND deadline IS NOT NULL
         AND deadline::date BETWEEN CURRENT_DATE - $1::int AND CURRENT_DATE + $2::int
       ORDER BY deadline ASC
       LIMIT $3`,
      [cfg.overdueGraceDays, cfg.dueWithinDays, cfg.cap * 2]
    ).then(r => r.rows));
    const date = todayPT();
    const seen = [];
    for (const row of rows) {
      // The extractor writes us/them twin rows for one promise; keep one card.
      const norm = row.promise_text.toLowerCase().replace(/\W+/g, ' ').trim();
      if (seen.some(s => s === norm)) continue;
      seen.push(norm);
      const who = row.promised_to || 'someone';
      const text = row.direction === 'them'
        ? `${who} owes: ${row.promise_text}`
        : `Owed to ${who}: ${row.promise_text}`;
      notes.push({
        id: `commit:${row.id}`,
        source: 'commit',
        text: text.slice(0, 300),
        summary: text.length > 90 ? text.slice(0, 87) + '…' : text,
        deadline: row.due,
        sourceFile: null,
        commitId: row.id,
        commitText: row.promise_text,
        createdDate: date,
      });
      if (notes.length >= cfg.cap) break;
    }
    return { notes };
  } catch (e) { return { notes, error: e.message }; }
}

// Fulfill the commitment AND its us/them twin (same promise text + deadline).
async function fulfillCommitment(cfg, commitId, promiseText) {
  await withClient(cfg, client => client.query(
    `UPDATE items.commitments
     SET fulfilled_at = NOW(),
         metadata = coalesce(metadata, '{}'::jsonb) || '{"status": "done", "completed_by": "stickies"}'::jsonb
     WHERE fulfilled_at IS NULL
       AND (id::text = $1 OR (promise_text = $2 AND deadline::date =
            (SELECT deadline::date FROM items.commitments WHERE id::text = $1)))`,
    [commitId, promiseText]
  ));
}

// ---- Agent feed escalations (public.agent_feed) ----

// The feed is machine-written and repeats itself: a failing cron writes a row
// every run, and the daily reconcile digest re-titles itself each pass. Titles
// are therefore never equal, so rows are grouped by a normalized family key
// instead. Everything in a family becomes one card, and closing that card
// dismisses every row behind it.
const FEED_FAMILIES = [
  [/^cron (?:failure|error)\s*:\s*(.+)$/i, m => `cron:${m[1].trim().toLowerCase()}`],
  [/reconcile/i, () => 'reconcile-digest'],
  [/commitment (?:sweep|auto-close)/i, () => 'commitment-sweep'],
  [/report import stale/i, () => 'report-import-stale'],
];

// `recurring` marks the routine digests and job chatter that rewrite themselves
// on a schedule. They are the newest rows almost every hour, so ranking by
// recency alone buries the one-off alerts (a loan maturity, a passed cure
// deadline) that actually need a decision. Cards sort one-offs first.
function classifyFeedTitle(title) {
  const raw = String(title || '').trim();
  for (const [re, fn] of FEED_FAMILIES) {
    const m = raw.match(re);
    if (m) return { key: fn(m), recurring: true };
  }
  // Fallback: strip the parts that churn between runs (dates, counts, emoji)
  // so "3 flags cleared" and "5 flags cleared" land on the same key.
  const stripped = raw.toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2}\b/g, ' ')
    .replace(/[\d,]+/g, ' ')
    .replace(/[^\p{L} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { key: stripped || raw.toLowerCase(), recurring: false };
}

function feedGroupKey(title) { return classifyFeedTitle(title).key; }

function feedKeyHash(key) {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
}

async function ingestAgentFeed(cfg) {
  const notes = [];
  const exclude = (cfg.excludeTypes || []).map(s => String(s).toLowerCase());
  try {
    const rows = await withClient(cfg, client => client.query(
      `SELECT id::text AS id, title, body_text, item_type,
              to_char(created_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AS created
       FROM public.agent_feed
       WHERE status IN ('pending', 'UNREAD', 'unread')
         AND created_at >= NOW() - ($1::int || ' days')::interval
       ORDER BY created_at DESC
       LIMIT 500`,
      [cfg.maxAgeDays]
    ).then(r => r.rows));
    // rows are newest-first, so the first row of a group titles the card and
    // the group order is newest-first too.
    const groups = new Map();
    for (const row of rows) {
      if (exclude.includes(String(row.item_type || '').toLowerCase())) continue;
      const { key, recurring } = classifyFeedTitle(row.title);
      const g = groups.get(key);
      if (g) { g.ids.push(row.id); continue; }
      groups.set(key, { key, recurring, ids: [row.id], title: row.title, body: row.body_text, created: row.created });
    }
    // One-off alerts outrank the routine digests; recency breaks ties within
    // each band. Without this the cap fills with digests before it ever
    // reaches an item that needs a decision.
    const ranked = [...groups.values()].sort((a, b) =>
      (a.recurring === b.recurring) ? b.created.localeCompare(a.created) : (a.recurring ? 1 : -1)
    );
    const date = todayPT();
    for (const g of ranked.slice(0, cfg.cap)) {
      const count = g.ids.length;
      const label = count > 1 ? `${g.title} (${count}×)` : g.title;
      const body = (g.body || '').replace(/\s+/g, ' ').trim();
      const text = body ? `${label} — ${body}`.slice(0, 300) : label;
      notes.push({
        // Date-scoped like primer/kit: dismissing today's batch closes those
        // rows at the source, and a genuinely new batch tomorrow comes back.
        id: `feed:${feedKeyHash(g.key)}:${g.created}`,
        source: 'feed',
        text,
        summary: label.length > 90 ? label.slice(0, 87) + '…' : label,
        deadline: null,
        sourceFile: null,
        feedIds: g.ids,
        createdDate: date,
      });
    }
    return { notes };
  } catch (e) { return { notes, error: e.message }; }
}

// Dismiss every row behind the card, not just the one that titled it —
// otherwise the siblings resurface on the next refresh under new ids.
async function dismissAgentFeedItem(cfg, feedIds) {
  const ids = (Array.isArray(feedIds) ? feedIds : [feedIds]).filter(Boolean).map(String);
  if (!ids.length) return;
  await withClient(cfg, client => client.query(
    `UPDATE public.agent_feed SET status = 'DISMISSED' WHERE id::text = ANY($1::text[])`, [ids]
  ));
}

module.exports = { ingestSticks, closeSticksTask, ingestCommitments, fulfillCommitment, ingestAgentFeed, dismissAgentFeedItem, feedGroupKey, classifyFeedTitle };
