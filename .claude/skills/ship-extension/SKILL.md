---
name: ship-extension
description: Test, render, live-check and package a new version of the War Room Chrome extension. Use after changing anything in extension/ or when Tray needs a fresh zip.
---

# Ship the extension

1. `npm test` — all suites pass. Add a test for any new behavior (engine/lock logic in Node, UI in tests/test_ui.js or tests/test_season.js with jsdom).
2. `npm run render` — Playwright loads the real unpacked extension against replica pages. Check the printed geometry: in the classic room the draft panel's rect should equal `.right-panel-wrapper` when waiting and grow to the header when on the clock; on league pages the Lock-In panel sits on `.right-panel`. Look at the screenshots in reports/screens.
3. Live blend check (read-only) in a browser on sleeper.com: open the draft room or league page, read computed colors of the surrounding UI, inject a static copy of the panel into a shadow root, screenshot, then remove it. Never click Sleeper's Draft/Queue/auto-pick or lock controls.
4. Bump `version` in package.json and extension/manifest.json, update extension/README.md (what changed, how to use it).
5. `npm run package` → dist/slot10-war-room-v<version>.zip. Send it with one line on what changed and the reinstall step (chrome://extensions → Remove old → Load unpacked).
