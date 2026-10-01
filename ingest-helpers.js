// Shared between ingest.js and sticks.js (kept separate to avoid a require cycle).
function todayPT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}
module.exports = { todayPT };
