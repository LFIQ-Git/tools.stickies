// Edge guard: macOS offers no public API to reserve screen space, so while
// any stacked note is pinned and visible, the frontmost app's windows get
// their right edge clamped to the column's inside edge via Accessibility
// scripting. Snapped or maximized windows therefore stop at the stickies.
//
// Scheduling is adaptive: the AppleScript reports the frontmost app and
// whether it resized anything; after three quiet ticks with the same app in
// front, the interval backs off 4x until the frontmost app changes or a
// resize happens. Requires Accessibility + Automation grants for Electron;
// errors surface through onStateChange (rendered in the tray).
const { execFile } = require('child_process');

const BACKOFF_AFTER_QUIET_TICKS = 3;
const BACKOFF_FACTOR = 4;

/**
 * @param {Object} deps
 * @param {() => boolean} deps.isActive     guard should run right now
 * @param {() => number}  deps.getLimit     absolute x of the column's inside edge
 * @param {() => number}  deps.getScreenX   left edge of the primary display
 * @param {() => void}    deps.onStateChange error state changed; refresh the tray
 * @param {number}        deps.intervalMs   base tick interval
 */
function createGuard({ isActive, getLimit, getScreenX, onStateChange, intervalMs }) {
  let busy = false;
  let error = null;
  let lastFront = '';
  let quietTicks = 0;
  let timer;

  function script() {
    const limit = getLimit();
    return `
tell application "System Events"
  set p to first application process whose frontmost is true
  set didResize to "0"
  if name of p is not "Electron" then
    repeat with w in windows of p
      try
        set xx to item 1 of (get position of w)
        set sz to get size of w
        set ww to item 1 of sz
        set hh to item 2 of sz
        if xx is greater than or equal to ${getScreenX()} and xx < ${limit} and (xx + ww) > ${limit} then
          set size of w to {${limit} - xx, hh}
          set didResize to "1"
        end if
      end try
    end repeat
  end if
  return (name of p) & "|" & didResize
end tell`;
  }

  function tick() {
    if (busy || !isActive()) { schedule(intervalMs); return; }
    busy = true;
    execFile('osascript', ['-e', script()], (err, stdout, stderr) => {
      busy = false;
      const msg = err ? (stderr || String(err)) : null;
      if (msg !== error) {
        error = msg;
        if (msg) console.error('[edge-guard]', msg.trim());
        onStateChange();
      }
      let delay = intervalMs;
      if (!err) {
        const [front, resized] = String(stdout).trim().split('|');
        if (front === lastFront && resized !== '1') quietTicks++;
        else quietTicks = 0;
        lastFront = front || '';
        if (quietTicks >= BACKOFF_AFTER_QUIET_TICKS) delay = intervalMs * BACKOFF_FACTOR;
      }
      schedule(delay);
    });
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(tick, delay);
  }

  return {
    start: () => schedule(intervalMs),
    /** current error string or null */
    getError: () => error,
  };
}

module.exports = { createGuard };
