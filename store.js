// JSON persistence for notes, positions, and dismissals.
// Lives in Electron userData so the app works even if the SSD is unmounted.
// Note shapes are documented in types.js.
const fs = require('fs');
const path = require('path');

const DISMISS_RETENTION_DAYS = 45;

function todayPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

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
      existing.sourceFile = note.sourceFile;
      existing.raw = note.raw;
      existing.dataFile = note.dataFile;
      existing.taxItemId = note.taxItemId;
      return existing;
    }
    this.data.notes[note.id] = note;
    return note;
  }

  /**
   * Remove the note and remember its id so re-ingest skips it. Tax/sticks ids
   * are stable, so their dismissals persist; primer/kit ids are date-scoped
   * and reset daily.
   * @param {string} id
   */
  dismiss(id) {
    delete this.data.notes[id];
    this.data.dismissed[id] = todayPT();
    this.prune();
    this.save();
  }

  /** @param {string} id */
  isDismissed(id) { return !!this.data.dismissed[id]; }

  // "Done at source" suppression for primer/kit items, whose ids are
  // date-scoped: the same open task re-surfaces daily with a new id, so we
  // match on content. Word-set Jaccard absorbs day-to-day drift like
  // "now 3 days overdue" → "now 4 days overdue".
  static wordSet(text) {
    return new Set(text.toLowerCase().replace(/[^a-z0-9$/ ]+/g, ' ').split(/\s+/).filter(w => w.length > 2));
  }

  /**
   * Record a primer/kit item as done-at-source so tomorrow's regenerated
   * board (new ids, drifted wording) doesn't resurrect it.
   * @param {string} text the note's full text at close time
   */
  addCompleted(text) {
    this.data.completed.push({ text, date: todayPT() });
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
    const today = todayPT();
    const revived = [];
    for (const [id, date] of Object.entries(this.data.dismissed)) {
      if (date === today) { delete this.data.dismissed[id]; revived.push(id); }
    }
    this.save();
    return revived;
  }

  prune() {
    const cutoff = Date.now() - DISMISS_RETENTION_DAYS * 86400000;
    for (const [id, date] of Object.entries(this.data.dismissed)) {
      if (new Date(date).getTime() < cutoff) delete this.data.dismissed[id];
    }
    this.data.completed = this.data.completed.filter(c => new Date(c.date).getTime() >= Date.now() - 90 * 86400000);
    // Drop stale daily-scoped notes (primer/kit) older than 3 days that the
    // user never touched — yesterday's board shouldn't linger forever.
    for (const [id, n] of Object.entries(this.data.notes)) {
      if ((n.source === 'primer' || n.source === 'kit') && !n.userEdited) {
        const age = Date.now() - new Date(n.createdDate).getTime();
        if (age > 3 * 86400000) delete this.data.notes[id];
      }
    }
  }
}

module.exports = Store;
