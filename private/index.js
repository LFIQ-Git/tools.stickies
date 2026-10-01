// Justin's private connectors: tax deadlines, the M365 calendar, Sticks tasks,
// commitments, the agent feed, the daily primer and the morning brief. They
// read private paths, Neon and Keychain, so they are excluded from the
// packaged app (see "build.files" in package.json) and load only when Stickies
// runs from this source checkout, or when this folder is set as the custom
// connectors folder in Settings.
const fs = require('fs');
const config = require('./config.json');
const { ingestTax, ingestPrimer, ingestKit, todayPT } = require('./routines');
const { ingestSticks, closeSticksTask, ingestCommitments, fulfillCommitment, ingestAgentFeed, dismissAgentFeedItem } = require('./sticks');
const { ingestCalendar } = require('./m365-calendar');

const db = key => ({ ...config.db, ...config[key] });

// Strike the line in today's routine file (cosmetic) and remember the text so
// tomorrow's regenerated board, with new ids and drifted wording, stays clear.
async function routineDone(note, cfg, ctx) {
  ctx.store.addCompleted(note.text);
  if (!note.raw || !note.sourceFile) return;
  try {
    const content = fs.readFileSync(note.sourceFile, 'utf8');
    if (content.includes(note.raw)) {
      const struck = note.raw.replace(/^([-*]\s+|\d+\.\s+)?(.*)$/s, (m, p, rest) => `${p || ''}~~${rest}~~ ✅`);
      fs.writeFileSync(note.sourceFile, content.replace(note.raw, struck));
    }
  } catch { /* strikethrough is cosmetic */ }
}

const connectors = [
  {
    key: 'tax', label: 'Tax deadlines', chip: 'Tax', color: '#FFCC94', order: 1, defaultEnabled: true,
    defaults: config.tax,
    window: { field: 'includeDueWithinDays', label: 'Tax deadlines', choices: [7, 14, 30, 60, 90], default: config.tax.includeDueWithinDays },
    ingest: ingestTax,
    async done(note) {
      if (!note.dataFile) {
        throw new Error('Dropbox canonical deadlines.json is unreachable. The SSD copy is a read-only mirror, so the item was not marked done at the source. The note stays until Dropbox is back.');
      }
      const doc = JSON.parse(fs.readFileSync(note.dataFile, 'utf8'));
      const item = (doc.items || []).find(i => i.id === note.taxItemId);
      if (!item) throw new Error(`item ${note.taxItemId} not found in deadlines.json`);
      item.done = true;
      item.note = `[closed ${todayPT()} by Justin via Stickies] ` + (item.note || '');
      fs.writeFileSync(note.dataFile, JSON.stringify(doc, null, 2) + '\n');
    },
  },
  {
    key: 'cal', label: "Today's calendar (M365)", chip: 'Cal', color: '#E9E9E9', order: 2, defaultEnabled: true, live: true,
    defaults: db('cal'),
    ingest: ingestCalendar,
  },
  {
    key: 'sticks', label: 'Sticks needs-attention', chip: 'Sticks', color: '#E4CCF7', order: 3, defaultEnabled: true, derivative: true,
    defaults: db('sticks'),
    window: { field: 'dueWithinDays', label: 'Sticks tasks', choices: [3, 7, 14, 30], default: config.sticks.dueWithinDays },
    ingest: ingestSticks,
    done: (note, cfg) => closeSticksTask(cfg, note.sticksTaskId),
  },
  {
    key: 'commit', label: 'Commitments', chip: 'Commit', color: '#BFEBDD', order: 4, defaultEnabled: true, derivative: true,
    defaults: db('commit'),
    window: { field: 'dueWithinDays', label: 'Commitments', choices: [7, 14, 30], default: config.commit.dueWithinDays },
    ingest: ingestCommitments,
    done: (note, cfg) => fulfillCommitment(cfg, note.commitId, note.commitText),
  },
  {
    // Feed titles are templated, so feed-vs-feed fuzzy matching would merge
    // different people's alerts; repeats are grouped upstream instead.
    key: 'feed', label: 'Agent feed escalations', chip: 'Alert', color: '#F6C4C4', order: 5, defaultEnabled: true,
    derivative: true, dedupeWithinSource: false,
    defaults: db('feed'),
    window: { field: 'maxAgeDays', label: 'Alerts max age', choices: [1, 3, 7, 14], default: config.feed.maxAgeDays, retroRemove: false },
    ingest: ingestAgentFeed,
    done: (note, cfg) => dismissAgentFeedItem(cfg, note.feedIds || note.feedId),
  },
  {
    key: 'primer', label: 'Your Daily Primer', chip: 'Primer', color: '#FFF9A6', order: 6, defaultEnabled: true,
    suppressByContent: true, expireDays: 3,
    defaults: config.primer,
    ingest: ingestPrimer,
    done: routineDone,
  },
  {
    key: 'kit', label: 'Company Morning Brief', chip: 'Kit', color: '#BFE0FF', order: 7, defaultEnabled: true,
    suppressByContent: true, expireDays: 3,
    defaults: config.kit,
    ingest: ingestKit,
    done: routineDone,
  },
];

module.exports = { connectors };
