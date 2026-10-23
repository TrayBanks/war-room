/* War Room styles — built from Sleeper's own design tokens: the beta draftboard's DLS dark theme and the classic room's theme-dark (both read live on Oct 17, 2026),
   so the panel reads as part of the room: same surfaces, borders, type, cyan accent, pill buttons and position colors.
   Rendered inside a shadow root, so Sleeper's CSS and ours never collide. Fonts are the ones Sleeper already loads. */
var WR_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.wr {
  --base: #05091D; --surface: #0B1028; --card: #131B38; --chip: #2D3650; --line: #2D3650; --divider: #4E586F;
  --hover: color-mix(in srgb, #2D3650 60%, #131B38); --selected: #093447;
  --text: #F0F2F6; --body: #E6EAF0; --secondary: #B7C5D4; --muted: #8996AA; --disabled: #6C768A;
  --accent: #00FFF9; --accent2: #03C3C5; --accent-ink: #05091D;
  --pos: #28E757; --neg: #FF8075; --warn: #FFAB0E; --live: #FF005C;
  --pg: #FF6482; --sg: #FFAB0E; --sf: #28E757; --pf: #00D7FF; --c: #C96CFF;
  --ui: "Google Sans Flex", "Inter Tight", Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  --num: "Inter Tight", Inter, system-ui, sans-serif;
  --sel-bg: var(--text); --sel-ink: var(--base);
  position: fixed; top: var(--top, 64px); bottom: 12px; right: 12px; width: var(--w, 380px); z-index: 2147483000;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--surface); color: var(--body); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 12px 16px -4px rgba(13,13,18,.35), 0 4px 6px -2px rgba(13,13,18,.2);
  font: 400 13px/1.35 var(--ui); font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
}
.wr[data-dock="left"] { right: auto; left: 12px; }
/* Classic draft room (theme-dark). Tokens read from the live room on Oct 17, 2026: page #030616, side panel #283244,
   tabs #3A465B, chips #2A2E3D with #A3BBD3 text, NBA orange #FFAE58 for selected filters, indigo #6E7DF5 for selected tabs,
   Lato body, Muli labels and numbers, Poppins titles. */
.wr[data-theme="classic"] {
  --base: #030616; --surface: #283244; --card: #2F3A50; --chip: #3A465B; --line: rgba(163,187,211,.16); --divider: #3A465B;
  --hover: #2F3A4F; --selected: #2B3263;
  --text: #FFFFFF; --body: #E8EEF5; --secondary: #A3BBD3; --muted: #8A9BB8; --disabled: #677897;
  --accent: #6E7DF5; --accent2: #A4ACFF; --accent-ink: #FFFFFF; --sel-bg: #FFAE58; --sel-ink: #022047;
  --ui: Lato, Muli, Arial, sans-serif; --num: Muli, Lato, Arial, sans-serif;
  border-color: transparent; box-shadow: 0 8px 24px rgba(3,6,22,.45);
}
.wr[data-theme="classic"] .ttl { font-family: Poppins, Lato, sans-serif; font-weight: 600; }
.wr[data-theme="classic"] .tabs button { font-family: Muli, Lato, sans-serif; }
.wr[data-theme="classic"] .tabs button[aria-selected="true"] { color: var(--accent); }
.wr[data-theme="classic"] .take .lbl, .wr[data-theme="classic"] .sec { font-family: Poppins, Lato, sans-serif; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; font-size: 11px; color: var(--accent2); }
.wr[data-theme="classic"] .row .nm { font-weight: 700; font-size: 13px; }
/* side dock: sits exactly on Sleeper's Queue / Roster / Chat column and grows up over the board when you're close to picking */
.wr.anchored { right: 0; bottom: 0; border-radius: 10px 0 0 0; border-right: 0; border-bottom: 0; }
.wr.short .take, .wr.short .chips, .wr.short .ft { display: none; }
.wr.lg { border-radius: 16px; }
.wr.anchored.lg { border-radius: 16px; border: 0; }
.wr:not(.anchored) [data-act="tall"] { display: none; }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* header: same rhythm as Sleeper's panel headers */
.hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--card); border-bottom: 1px solid var(--line); }
.mark { width: 22px; height: 22px; border-radius: 6px; background: var(--chip); display: grid; place-items: center; flex: none; }
.mark i { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.mark i.live { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
.mark i.stale { background: var(--warn); } .mark i.err { background: var(--neg); }
.ttl { font-weight: 700; font-size: 14px; color: var(--text); white-space: nowrap; }
.sub { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grow { flex: 1; min-width: 0; }
.ib { width: 28px; height: 28px; border-radius: 8px; border: 0; background: transparent; color: var(--secondary); display: grid; place-items: center; font-size: 14px; }
.ib:hover { background: var(--chip); color: var(--text); }
.seg { display: inline-flex; background: var(--base); border: 1px solid var(--line); border-radius: 999px; padding: 2px; }
.seg button { border: 0; background: transparent; color: var(--secondary); border-radius: 999px; padding: 3px 9px; font-size: 11.5px; font-weight: 600; }
.seg button[aria-pressed="true"] { background: var(--sel-bg); color: var(--sel-ink); }

/* clock */
.bn { margin: 10px 10px 0; padding: 10px 12px; border-radius: 10px; background: var(--card); border: 1px solid var(--line);
  display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 1px 10px; align-items: center; }
.bn .big { font-size: 15px; font-weight: 700; color: var(--text); }
.bn .t { grid-row: span 2; font: 700 24px/1 var(--num); color: var(--text); letter-spacing: -0.02em; }
.bn .sub { grid-column: 1; white-space: normal; }
.bn.me { background: var(--selected); border-color: var(--accent2); box-shadow: inset 3px 0 0 var(--accent); }
.bn.me .t { color: var(--accent); }
.bn.soon { box-shadow: inset 3px 0 0 var(--warn); }
.bn.err { box-shadow: inset 3px 0 0 var(--neg); }

/* take now */
.take { margin: 8px 10px 0; display: grid; gap: 6px; }
.take .lbl { font-size: 12px; color: var(--muted); font-weight: 600; }
.rec { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 2px 8px; align-items: center; padding: 8px 10px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); }
.rec .nm { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rec .why { grid-column: 1 / -1; color: var(--secondary); font-size: 12px; }
.rec.alt { padding: 5px 10px; background: transparent; border-color: transparent; }
.rec.alt .nm { font-size: 12.5px; font-weight: 500; color: var(--body); }
.rec.alt .sub { font-weight: 400; }
.acts { display: flex; gap: 4px; align-items: center; }

/* pill buttons, Sleeper style */
.b { border: 0; border-radius: 999px; height: 26px; padding: 0 12px; font-size: 11px; font-weight: 600; letter-spacing: .48px; text-transform: uppercase;
  background: var(--chip); color: var(--body); white-space: nowrap; box-shadow: inset 0 -1px 0 1px rgba(19,27,56,.4); }
.b:hover { filter: brightness(1.15); }
.b.pri { background: var(--accent); color: var(--accent-ink); }
.b.pri.off { background: var(--chip); color: var(--disabled); }
.b.arm { background: var(--live); color: #fff; animation: pulse .8s infinite alternate; }
.b.on { background: var(--selected); color: var(--accent); }
.b.ghost { background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
@keyframes pulse { to { filter: brightness(1.25); } }

/* tabs: uppercase like ROSTER / QUEUE / CHAT, cyan pill underline */
.tabs { display: flex; margin-top: 8px; border-bottom: 1px solid var(--line); padding: 0 6px; }
.tabs button { position: relative; flex: 1; background: transparent; border: 0; padding: 10px 2px 11px; font-size: 12px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }
.tabs button[aria-selected="true"] { color: var(--text); }
.tabs button[aria-selected="true"]::after { content: ""; position: absolute; left: 50%; bottom: 0; width: 40px; height: 3px; transform: translateX(-50%); border-radius: 3px 3px 0 0; background: var(--accent); }
.tabs .n { color: var(--accent); margin-left: 3px; }

/* toolbar */
.tb { display: grid; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.tb input[type=search] { width: 100%; height: 32px; background: var(--card); border: 1px solid var(--line); color: var(--text); border-radius: 8px; padding: 0 10px; font: 13px var(--ui); }
.tb input::placeholder { color: var(--muted); }
.chips { display: flex; gap: 4px; flex-wrap: wrap; }
.chip { border: 0; background: var(--card); color: var(--secondary); border-radius: 999px; height: 24px; padding: 0 10px; font-size: 11px; font-weight: 600; box-shadow: inset 0 0 0 1px var(--line); }
.chip[aria-pressed="true"] { background: var(--sel-bg); color: var(--sel-ink); box-shadow: none; }

/* main list */
.main { flex: 1; overflow-y: auto; overscroll-behavior: contain; }
.main::-webkit-scrollbar { width: 6px; } .main::-webkit-scrollbar-thumb { background: var(--chip); border-radius: 3px; }
.row { display: grid; grid-template-columns: 24px minmax(0,1fr) auto; gap: 1px 8px; padding: 7px 10px; align-items: center; position: relative; border-bottom: 1px solid var(--line); }
.row:nth-child(even) { background: rgba(11,16,40,.0); }
.row:hover { background: var(--hover); }
.row .rk { color: var(--muted); font: 600 11.5px var(--num); text-align: right; }
.row .who { min-width: 0; }
.row .nm { font-weight: 500; font-size: 14px; color: var(--body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.row .meta { color: var(--secondary); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 5px; }
.row .nums { grid-column: 2 / -1; display: flex; gap: 8px; align-items: center; font: 12px var(--num); color: var(--secondary); white-space: nowrap; min-width: 0; }
.row .nums .sp { flex: 1; }
.row .nums .ib { width: 24px; height: 22px; font-size: 12px; }
.row .v { font: 700 13px var(--num); color: var(--text); }
.row.starred { box-shadow: inset 2px 0 0 var(--accent); }
.dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex: none; background: var(--muted); }
.dot.PG { background: var(--pg); } .dot.SG { background: var(--sg); } .dot.SF { background: var(--sf); } .dot.PF { background: var(--pf); } .dot.C { background: var(--c); }
.tier { position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; }
.tag { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px; margin-left: 5px; vertical-align: 1px; background: var(--chip); letter-spacing: .02em; }
.tag.inj { color: var(--neg); } .tag.dtd { color: var(--warn); } .tag.fade { color: var(--muted); } .tag.gap { color: var(--pos); } .tag.q { color: var(--accent); }
.tag.sits { color: var(--neg); background: transparent; box-shadow: inset 0 0 0 1px currentColor; } .tag.conly { color: var(--warn); background: transparent; box-shadow: inset 0 0 0 1px currentColor; }
.odds { font: 700 11px var(--num); padding: 1px 7px; border-radius: 999px; background: var(--chip); white-space: nowrap; }
.odds.hi { color: var(--pos); } .odds.mid { color: var(--warn); } .odds.lo { color: var(--neg); }
.detail { grid-column: 2 / -1; color: var(--secondary); font-size: 12px; display: grid; gap: 4px; padding-top: 3px; }
.mini { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--chip); }
.mini i { display: block; height: 100%; }
.more { width: 100%; padding: 10px; background: transparent; border: 0; color: var(--accent); font-weight: 600; }

/* grades */
.g { font-size: 10.5px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--chip); white-space: nowrap; letter-spacing: .02em; }
.g.strong { color: var(--pos); } .g.solid { color: var(--secondary); } .g.q { color: var(--warn); } .g.reach { color: var(--neg); }

/* sections */
.blk { padding: 10px; border-bottom: 1px solid var(--line); display: grid; gap: 7px; }
.sec { font-size: 12px; font-weight: 700; color: var(--text); }
.hint { color: var(--muted); font-size: 11.5px; }
.lineup { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 4px; }
.slot { background: var(--card); border-radius: 8px; padding: 5px 7px; min-width: 0; border: 1px solid var(--line); }
.slot b { display: block; font-size: 10px; color: var(--muted); font-weight: 700; }
.slot span { display: block; font-size: 12.5px; font-weight: 600; color: var(--body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slot.need { border-style: dashed; border-color: var(--divider); background: transparent; }
.slot.need span { color: var(--muted); font-weight: 500; }
.pk { display: grid; grid-template-columns: 36px minmax(0,1fr) auto; gap: 1px 8px; align-items: center; font-size: 12.5px; }
.pk .r { color: var(--muted); font: 600 11.5px var(--num); }
.pk .alt { grid-column: 2 / -1; color: var(--muted); font-size: 11.5px; }
.db { display: grid; grid-template-columns: 92px minmax(0,1fr) 40px; gap: 6px; align-items: center; font-size: 12px; }
.db .ax { position: relative; height: 8px; }
.db .ax::before { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1px; background: var(--divider); }
.db .sg { position: absolute; top: 0; bottom: 0; border-radius: 2px; }
.db .d { text-align: right; color: var(--secondary); font-family: var(--num); }
.bar { height: 6px; background: var(--chip); border-radius: 3px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--divider); border-radius: 3px; }
.pw { display: grid; grid-template-columns: 118px minmax(0,1fr) 34px; gap: 6px; align-items: center; font-size: 12px; }
.pw span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pw.me span:first-child { color: var(--accent); font-weight: 700; } .pw.me .bar i { background: var(--accent); }
.pw span:last-child { text-align: right; font-family: var(--num); color: var(--secondary); }
.note { color: var(--body); font-size: 12.5px; background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--accent); padding: 7px 9px; border-radius: 8px; }
.alert { font-size: 12.5px; padding: 6px 9px; border-radius: 8px; background: var(--card); border: 1px solid var(--line); }
.alert.run, .alert.news { border-left: 3px solid var(--neg); } .alert.fall { border-left: 3px solid var(--pos); } .alert.cap, .alert.warn { border-left: 3px solid var(--warn); }
.qrow { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 6px; align-items: center; font-size: 12.5px; }

/* room leaderboard */
.mgr { display: grid; grid-template-columns: 18px minmax(0,1fr) 92px 38px; gap: 2px 8px; align-items: center; padding: 7px 10px; border-bottom: 1px solid rgba(45,54,80,.55); font-size: 12.5px; }
.mgr.me { background: rgba(9,52,71,.55); }
.mgr .rk { color: var(--muted); font: 600 11px var(--num); }
.mgr .nm { font-weight: 600; color: var(--body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mgr .sc { font: 700 13px var(--num); color: var(--text); text-align: right; }
.mgr .ln { grid-column: 2 / -1; display: flex; gap: 8px; flex-wrap: wrap; color: var(--muted); font-size: 11.5px; align-items: center; }
.meter { height: 6px; background: var(--chip); border-radius: 3px; overflow: hidden; position: relative; }
.meter i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--accent2); }
.meter.sharp i { background: var(--accent); } .meter.adp i { background: var(--divider); }
.lab { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--chip); }
.lab.Sharp { color: var(--accent); } .lab.Mixed { color: var(--secondary); } .lab.ADP-driven { color: var(--warn); } .lab.New { color: var(--muted); }
.soonchip { font-size: 10.5px; font-weight: 700; color: var(--accent-ink); background: var(--accent); padding: 1px 7px; border-radius: 999px; }

/* feed */
.feed { display: grid; grid-template-columns: 38px minmax(0,1fr) auto; gap: 1px 8px; padding: 6px 10px; border-bottom: 1px solid rgba(45,54,80,.55); align-items: center; font-size: 12.5px; }
.feed .r { color: var(--muted); font: 600 11px var(--num); }
.feed .m { color: var(--muted); font-size: 11.5px; grid-column: 2 / -1; }
.feed.mine { background: rgba(9,52,71,.55); }
.empty { padding: 20px 14px; color: var(--muted); text-align: center; font-size: 12.5px; }

/* lock-in cards (season panel) */
.lk { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 3px 8px; padding: 9px 10px; border-bottom: 1px solid rgba(45,54,80,.55); }
.lk .nm { font-size: 14px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px; min-width: 0; }
.lk .nm span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lk .txt { grid-column: 1 / -1; color: var(--secondary); font-size: 12px; }
.lk .tl { grid-column: 1 / -1; display: flex; gap: 4px; flex-wrap: wrap; }
.gm { font: 600 10.5px var(--num); padding: 2px 6px; border-radius: 6px; background: var(--card); border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.gm.played { color: var(--body); border-color: var(--divider); } .gm.best { color: var(--accent); border-color: var(--accent2); } .gm.dnp { text-decoration: line-through; } .gm.live { color: var(--live); border-color: var(--live); }
.vd { font-size: 11px; font-weight: 700; letter-spacing: .48px; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; background: var(--chip); color: var(--secondary); white-space: nowrap; }
.vd.lock { background: var(--accent); color: var(--accent-ink); } .vd.hold { color: var(--warn); } .vd.wait { color: var(--secondary); }
.vd.final { color: var(--body); } .vd.none { color: var(--neg); } .vd.locked { background: var(--selected); color: var(--accent); } .vd.live { color: var(--live); }
.lk .acts { grid-column: 1 / -1; }
.lk .txt.sub { font-size: 11px; color: var(--muted); }
.sumrow { display: flex; gap: 6px; flex-wrap: wrap; }
.calc { display: grid; gap: 8px; padding: 10px; }
.calc label { display: grid; gap: 4px; font-size: 12px; color: var(--secondary); }
.calc input, .calc select { height: 32px; background: var(--card); border: 1px solid var(--line); color: var(--text); border-radius: 8px; padding: 0 10px; font: 13px var(--ui); }
.calc .res { font-size: 13px; color: var(--body); }

/* footer, toast, settings */
.ft { padding: 7px 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; display: flex; gap: 10px; flex-wrap: wrap; background: var(--card); }
.ft kbd { font: 600 10.5px var(--num); color: var(--body); background: var(--chip); border-radius: 4px; padding: 0 5px; }
.toasts { position: absolute; left: 10px; right: 10px; bottom: 40px; display: grid; gap: 6px; pointer-events: none; }
.toast { background: #F0F2F6; color: #05091D; border: 1px solid #C7D0DC; padding: 8px 11px; border-radius: 10px; font-size: 12.5px; font-weight: 600; box-shadow: 0 8px 20px rgba(0,0,0,.35); }
.toast.good { box-shadow: inset 4px 0 0 #029855, 0 8px 20px rgba(0,0,0,.35); } .toast.bad { box-shadow: inset 4px 0 0 #D54033, 0 8px 20px rgba(0,0,0,.35); } .toast.warn { box-shadow: inset 4px 0 0 #FFAB0E, 0 8px 20px rgba(0,0,0,.35); }
.set { position: absolute; inset: 49px 0 0 0; background: var(--surface); z-index: 2; overflow-y: auto; padding: 14px 12px; display: grid; gap: 14px; align-content: start; }
.set label { display: grid; gap: 4px; font-size: 13px; color: var(--body); }
.set .ck { display: flex; gap: 8px; align-items: center; }
.set input[type=checkbox] { accent-color: #03C3C5; }
.set select { height: 30px; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 0 8px; }

/* collapsed rail */
.rail { display: none; }
.wr.collapsed { width: 52px; bottom: auto; }
.wr.collapsed > :not(.rail) { display: none; }
.wr.collapsed .rail { display: grid; gap: 6px; justify-items: center; padding: 10px 4px; cursor: pointer; text-align: center; background: var(--card); }
.rail .k { font-size: 9.5px; font-weight: 700; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
.rail .n { font: 800 20px/1 var(--num); color: var(--accent); }
.rail .t { font: 700 12px var(--num); color: var(--text); }
.rail .p { font-size: 10.5px; color: var(--secondary); writing-mode: vertical-rl; transform: rotate(180deg); max-height: 120px; overflow: hidden; }
.wr.collapsed.me .rail { background: var(--selected); box-shadow: inset 0 0 0 1px var(--accent2); }
@media (prefers-reduced-motion: reduce) { .b.arm { animation: none; } }
`;
