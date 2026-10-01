// Column layout engine: a single tight column flush to the right edge of the
// primary display, packed by each card's actual height. When the stack
// outgrows the screen the column scrolls (wheel or step arrows) and cards
// clipped off the edge hide until scrolled back. Notes the user dragged keep
// their spot until "Restack column" clears the flag.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const ARROW = { w: 44, h: 22, pad: 4 };

/**
 * @param {Object} deps
 * @param {{width:number,minHeight:number,maxHeight:number,gap:number,edgeMargin:number}} deps.note
 * @param {Map<string, Electron.BrowserWindow>} deps.wins  note id -> window
 * @param {() => import('./types').Note[]} deps.notesOrdered  display order
 */
function createColumn({ note: NOTE, wins, notesOrdered }) {
  let lastLayoutAt = 0;
  let layoutTimer;
  let scrollOffset = 0;
  let arrowWins = null;

  // Step arrows: small transparent click targets above and below the column,
  // shown only on overflow. relativeLevel 1 keeps them above the cards.
  function ensureArrows() {
    if (arrowWins) return arrowWins;
    const mk = dir => {
      const win = new BrowserWindow({
        width: ARROW.w, height: ARROW.h,
        frame: false, transparent: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, hasShadow: false, focusable: false, show: false,
        acceptFirstMouse: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
      });
      win.setAlwaysOnTop(true, 'screen-saver', 1);
      if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.loadFile(path.join(__dirname, 'arrow.html'), { query: { dir } });
      return win;
    };
    arrowWins = { up: mk('up'), down: mk('down') };
    return arrowWins;
  }

  /** Stacked (column-managed) notes with their live window heights. */
  function stackGeometry() {
    const stacked = notesOrdered().filter(n => {
      const w = wins.get(n.id);
      return w && !w.isDestroyed() && !n.userMoved;
    });
    const heights = stacked.map(n => wins.get(n.id).getSize()[1]);
    const total = heights.length ? heights.reduce((a, b) => a + b + NOTE.gap, 0) - NOTE.gap : 0;
    return { stacked, heights, total };
  }

  /** Reposition every stacked card and both arrows for the current state. */
  function layoutStack() {
    lastLayoutAt = Date.now();
    const wa = screen.getPrimaryDisplay().workArea;
    const x = wa.x + wa.width - NOTE.width - NOTE.edgeMargin;

    const { stacked, heights, total } = stackGeometry();
    const baseViewport = wa.height - 2 * NOTE.edgeMargin;
    const canScroll = total > baseViewport;
    const arrowPad = canScroll ? ARROW.h + ARROW.pad : 0;
    const viewport = baseViewport - 2 * arrowPad;
    const maxOffset = canScroll ? Math.max(0, total - viewport) : 0;
    scrollOffset = Math.min(Math.max(0, scrollOffset), maxOffset);

    const top = wa.y + NOTE.edgeMargin + arrowPad;
    const bottom = top + viewport;
    let y = top - scrollOffset;
    stacked.forEach((note, i) => {
      const win = wins.get(note.id);
      const h = heights[i];
      const yy = Math.round(y);
      const visiblePx = Math.min(yy + h, bottom) - Math.max(yy, top);
      if (visiblePx < 24) {
        if (win.isVisible()) win.hide();
      } else {
        win.setPosition(x, yy);
        if (!win.isVisible()) win.showInactive();
      }
      note.pos = { x, y: yy };
      y += h + NOTE.gap;
    });

    const arrows = ensureArrows();
    const ax = Math.round(x + (NOTE.width - ARROW.w) / 2);
    const place = (win, ay, show) => {
      if (win.isDestroyed()) return;
      if (show) {
        win.setPosition(ax, Math.round(ay));
        if (!win.isVisible()) win.showInactive();
        win.moveTop();
      } else if (win.isVisible()) win.hide();
    };
    place(arrows.up, wa.y + NOTE.edgeMargin - 2, canScroll && scrollOffset > 0);
    place(arrows.down, wa.y + wa.height - NOTE.edgeMargin - ARROW.h + 2, canScroll && scrollOffset < maxOffset);
    // No persistence here: layout runs on every scroll tick and positions are
    // recomputed anyway. The store saves on real state changes and at quit.
  }

  function scheduleLayout(delay = 90) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(layoutStack, delay);
  }

  /** Advance the column to the next (+1) or previous (-1) card boundary. */
  function stepColumn(dir) {
    const { heights } = stackGeometry();
    const cums = [0];
    for (const h of heights) cums.push(cums[cums.length - 1] + h + NOTE.gap);
    if (dir > 0) {
      const next = cums.find(c => c > scrollOffset + 2);
      scrollOffset = next != null ? next : scrollOffset + NOTE.minHeight;
    } else {
      const prevs = cums.filter(c => c < scrollOffset - 2);
      scrollOffset = prevs.length ? prevs[prevs.length - 1] : 0;
    }
    layoutStack();
  }

  return {
    layoutStack,
    scheduleLayout,
    stepColumn,
    /** Wheel input: shift the column by dy pixels (clamped at next layout). */
    scrollBy: dy => { scrollOffset += dy; scheduleLayout(25); },
    /** Jump back to the top of the stack. */
    resetScroll: () => { scrollOffset = 0; },
    /** Timestamp of the last programmatic layout (drag-detection guard). */
    lastLayoutAt: () => lastLayoutAt,
    /** The column's inside edge in absolute screen coords (edge guard limit). */
    insideEdge: margin => {
      const wa = screen.getPrimaryDisplay().workArea;
      return wa.x + wa.width - NOTE.width - NOTE.edgeMargin - margin;
    },
  };
}

module.exports = { createColumn };
