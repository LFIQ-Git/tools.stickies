// Shared shape documentation. Plain-JS project; these JSDoc typedefs are the
// contract every module works against. Keep this file in sync when a field is
// added — it is the only place the full Note shape is written down.

/**
 * A single sticky note. Created by an ingest source or manually; persisted in
 * the store keyed by `id`.
 *
 * @typedef {Object} Note
 * @property {string} id            Stable identity, prefixed with the connector
 *   key. Built-ins: `ics:<date>:<hash>`, `todoist:<task-id>`, `reminders:<id>`,
 *   `md:<file-hash>:<text-hash>`, `todotxt:<line-hash>`, `manual:<ts>`. Private
 *   connectors: `tax:<item-id>`, `sticks:<task-id>`, `commit:<uuid>`,
 *   `feed:<group-hash>:<date>`, `cal:<date>:<hash>`, `primer:<date>:<hash>`,
 *   `kit:<date>:<section>:<hash>`.
 *   Dismissals key off this, so stability decides whether a close sticks.
 * @property {string} source        Connector key (see connectors/index.js).
 * @property {string} text          Full statement shown when expanded.
 * @property {string} [summary]     Collapsed face text; derived client-side
 *   for manual/edited notes.
 * @property {?string} deadline     Local calendar date (YYYY-MM-DD) or null.
 * @property {?string} [kind]       Tax only: 'hard' | 'asap' | 'overdue' —
 *   drives the PAST DUE / ASAP chip when deadline is null.
 * @property {?string} sourceFile   File opened by the source chip (markdown
 *   viewer), or null when the source has no file.
 * @property {string} [sourceUrl]   https URL the chip opens instead (Todoist).
 * @property {string} [externalId]  The item's id at the source (Todoist, Reminders).
 * @property {number} [sortKey]     Order within a source (calendar start time).
 * @property {?string} [dataFile]   Tax only: the WRITABLE canonical
 *   deadlines.json; null when only the read-only mirror was reachable.
 * @property {string} [taxItemId]   Tax only: item id inside deadlines.json.
 * @property {string} [sticksTaskId] Sticks only: items.tasks row id.
 * @property {string} [commitId]    Commit only: items.commitments row id.
 * @property {string} [commitText]  Commit only: promise_text, used to close
 *   the us/them twin row.
 * @property {string[]} [feedIds]   Feed only: every agent_feed row id behind
 *   the card (repeating alerts group into one), all dismissed together.
 * @property {string} [raw]         File-backed sources: the exact source line,
 *   matched again on ✓ so only that line is changed.
 * @property {string} createdDate   ISO date the note first appeared.
 * @property {{x: number, y: number}} [pos]  Last window position.
 * @property {boolean} [pinned]     false = sent to background. Default true.
 * @property {boolean} [userMoved]  User dragged it out of the column; layout
 *   leaves it alone until "Restack column".
 * @property {boolean} [userEdited] User edited the text; ingest refresh and
 *   retro-removal both leave the note alone.
 * @property {boolean} [userDeadline] User set the deadline; ingest keeps hands off.
 * @property {boolean} [startEditing] Manual notes only: open in edit mode.
 */

/**
 * Result of one source's ingest pass.
 * @typedef {Object} IngestResult
 * @property {Note[]} notes
 * @property {string} [error]  Human-readable reason the source produced
 *   nothing (surfaced in the tray); absent on success.
 */

module.exports = {};
