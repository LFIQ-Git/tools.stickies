#!/bin/zsh
# Manual launcher. Mirrors what ~/Applications/Stickies.app does at login:
# hand Electron to LaunchServices as a standalone app (never exec it as a
# child — RunningBoard reaps those) and never kill a running instance
# (Electron holds a single-instance lock; duplicates exit on their own).
APP_DIR="${0:a:h}"
if pgrep -f "^$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" >/dev/null; then
  echo "Stickies is already running."
  exit 0
fi
exec /usr/bin/open -na "$APP_DIR/node_modules/electron/dist/Electron.app" --args "$APP_DIR"
