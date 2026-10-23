# Slot 10 War Room

Sleeper NBA overlay and model for **NBA League Revamped** (H2H points, Lock-In, slot 10).

- **Draft room panel**: Lock-In rankings, live pick grades, learned sharpness per manager, "will he last" odds, one-click Draft/Queue through Sleeper's own buttons. Docks on Sleeper's queue column and grows when you're up.
- **Lock-In coach**: Lock or Hold for each starter after every game, with lock lines, risk modes and a calculator.
- **Model**: `model/` turns Sleeper projections, 2025-26 game logs and the 2026 schedule into lock values → `reports/top120.md`.

Install the extension: `npm run package`, unzip, chrome://extensions → Developer mode → Load unpacked → `war-room-extension`. Details in `extension/README.md`. Working notes for Claude Code are in `CLAUDE.md`.

```
npm install        # jsdom for the tests
npm test           # engine, lock, bridge, draft UI, Lock-In UI
npm run build      # rebuild rankings + extension/data.js
npm run lock -- "Jokić" 43 2
```
