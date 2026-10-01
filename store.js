// JSON persistence for notes, positions, and dismissals.
// Lives in Electron userData, so the app works when a source is unreachable.
// Note shapes are documented in types.js.
const fs = require('fs');
const path = require('path');

const DISMISS_RETENTION_DAYS = 45;

const { todayLocal } = require('./connectors/util');

// Fields the user owns or the layout owns; a refresh never overwrites them.
const KEEP_ON_REFRESH = new Set(['text', 'summary', 'deadline', 'kind', 'pos', 'pinned', 'userMoved',
  'userEdited', 'userDeadline', 'createdDate', 'startEditing']);

class Store {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'stickies-store.json');
    this.data = { notes: {}, dismissed: {} };
    this.load();
  }

  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!this.data.notes) this.data.notes = {};
      if (!this.data.dismissed) this.data.dismissed = {};
      if (!this.data.completed) this.data.completed = [];
    } catch (err) {
      // A corrupt store must not silently wipe positions/dismissals: keep the
      // bad file for recovery and start fresh.
      if (fs.existsSync(this.file)) {
        const backup = `${this.file}.corrupt-${Date.now()}`;
        try { fs.copyFileSync(this.file, backup); console.error(`[store] corrupt store backed up to ${backup}:`, String(err)); }
        catch { /* backup is best-effort */ }
      }
      this.data = { notes: {}, dismissed: {}, completed: [] };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  /** @returns {Object<string, import('./types').Note>} live note map, keyed by id */
  get notes() { return this.data.notes; }

  /**
   * Insert a freshly-ingested note or refresh an existing one. User edits
   * (`userEdited`) and user-set deadlines (`userDeadline`) always win over
   * the source's version.
   * @param {import('./types').Note} note
   * @returns {import('./types').Note} the stored note
   */
  upsert(note) {
    const existing = this.data.notes[note.id];
    if (existing) {
      // Never clobber user edits; refresh source text only if untouched.
      if (!existing.userEdited) { existing.text = note.text; existing.summary = note.summary; }
      if (!existing.userDeadline) existing.deadline = note.deadline;
      if (!existing.userDeadline) existing.kind = note.kind;
      // Connector bookkeeping (source file, external id, raw line) follows the source.
      for (const [k, v] of Object.entries(note)) if (!KEEP_ON_REFRESH.has(k)) existing[k] = v;
      return existing;
    }
    this.data.notes[note.id] = note;
    return note;
  }

  /**
   * Remove the note and remember its id so re-ingest skips it. Ids from
   * stable sources keep the dismissal; date-scoped ids reset daily.
   * @param {string} id
   */
  dismiss(id) {
    delete this.data.notes[id];
    this.data.dismissed[id] = todayLocal();
    this.prune();
    this.save();
  }

  /** @param {string} id */
  isDismissed(id) { return !!this.data.dismissed[id]; }

  // "Done at source" suppression for connectors with date-scoped ids
  // (suppressByContent): the same open task re-surfaces daily with a new id, so we
  // match on content. Word-set Jaccard absorbs day-to-day drift like
  // "now 3 days overdue" → "now 4 days overdue".
  static wordSet(text) {
    return new Set(text.toLowerCase().replace(/[^a-z0-9$/ ]+/g, ' ').split(/\s+/).filter(w => w.length > 2));
  }

  /**
   * Record a date-scoped item as done-at-source so tomorrow's regenerated
   * board (new ids, drifted wording) doesn't resurrect it.
   * @param {string} text the note's full text at close time
   */
  addCompleted(text) {
    this.data.completed.push({ text, date: todayLocal() });
    this.save();
  }

  /**
   * Fuzzy match against completed entries (word-set Jaccard >= 0.6), so
   * "now 3 days overdue" still matches tomorrow's "now 4 days overdue".
   * @param {string} text
   */
  isCompleted(text) {
    const a = Store.wordSet(text);
    if (a.size === 0) return false;
    for (const c of this.data.completed) {
      const b = Store.wordSet(c.text);
      let inter = 0;
      for (const w of a) if (b.has(w)) inter++;
      if (inter / (a.size + b.size - inter) >= 0.6) return true;
    }
    return false;
  }

  undismissToday() {
    const today = todayLocal();
    const revived = [];
    for (const [id, date] of Object.entries(this.data.dismissed)) {
      if (date === today) { delete this.data.dismissed[id]; revived.push(id); }
    }
    this.save();
    return revived;
  }

  /** @param {Object<string, number>} [expireDays] source -> max age of untouched cards */
  prune(expireDays = this.expireDays || {}) {
    const cutoff = Date.now() - DISMISS_RETENTION_DAYS * 86400000;
    for (const [id, date] of Object.entries(this.data.dismissed)) {
      if (new Date(date).getTime() < cutoff) delete this.data.dismissed[id];
    }
    this.data.completed = this.data.completed.filter(c => new Date(c.date).getTime() >= Date.now() - 90 * 86400000);
    // Daily-scoped cards the user never touched expire (connector expireDays),
    // so yesterday's board doesn't linger forever.
    for (const [id, n] of Object.entries(this.data.notes)) {
      const days = expireDays[n.source];
      if (days && !n.userEdited) {
        const age = Date.now() - new Date(n.createdDate).getTime();
        if (age > days * 86400000) delete this.data.notes[id];
      }
    }
  }
}

module.exports = Store;
