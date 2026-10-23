---
title: Slot 10 War Room — Sleeper NBA overlay (v1.2)
tags: [fantasy, nba, draft, lock-in, tools]
built: 2026-10-17
---

# Slot 10 War Room (v1.2)

## What's new in 1.2 (after your first mock)

- **No more center pile-ups.** Picks are scored by what a player adds to *your* lineup. A center-only player can fill just C or UTIL (3 of 9 slots), so once those are covered another one mostly sits, and the panel says so ("Sits"). Players who fit more slots (PF/C, SG/SF, PG/SG) get credit for flexibility, on the bench too. In replayed drafts following the panel, center-only picks dropped from 3–4 to 1–2 with the same starting-lineup strength.
- **Board → "For my team"** (on by default): sorted by value to your lineup, with the raw Lock value next to it. Each row shows how many lineup slots he fits ("3 slots" for a C-only, "6 slots" for a SG/SF). Tags: **Sits** (his slots are filled), **C only** (you already have one).
- **Team tab** shows position coverage: how many players can play guard, forward, center, and how many are center-only.
- **Much faster.** The "will he last" simulation was blocking the page for 100–300 ms on every pick. It's now about 5 ms, results are reused until a new pick lands, and the panel only redraws what changed. In a 24-pick test in Chrome, frozen frames went from 22 (3.9 s total) to 1–2 (under 0.12 s). New picks are fetched with one round trip instead of two.

Two panels that sit on top of Sleeper and look like part of it:

- **Draft room** (`sleeper.com/draft/nba/...`): rankings for this league's points scoring *under Lock-In*, every pick graded live, each manager's sharpness learned from his picks, "will he last to my pick" odds, and Draft / Queue buttons that drive Sleeper's own buttons.
- **League pages** (`sleeper.com/leagues/...`): the **Lock-In coach**. After every game it tells you, per starter, **Lock** or **Hold**.

## Install (2 minutes, desktop Chrome / Edge / Brave)

1. Unzip `slot10-war-room-v1.2.zip`. You get a folder named `war-room-extension`.
2. Go to `chrome://extensions`, turn on **Developer mode** (top right).
3. If an older version is installed, click **Remove** on it first. Then **Load unpacked** and pick the new `war-room-extension` folder.
4. Pin it: puzzle-piece icon → pin **Slot 10 War Room**. Clicking the icon shows or hides whichever panel is on the page.

## Draft room

**Where it sits.** By default it docks exactly on Sleeper's Queue / Roster / Chat column: same width, same corner, same colors, so the whole draft board stays visible, your column included. When you're two picks away or on the clock it grows to full height. `⤢` pins it full height; `` ` `` hides it so you can use Sleeper's queue/chat. ⚙ → Position switches to a classic right or left dock. It picks up Sleeper's classic room colors, or the new draftboard's colors if you switch to that.

| Area | What it tells you |
|---|---|
| Banner | Who's on the clock, your next pick, the countdown. Highlights when you're up. |
| Take now / Plan for #N | Best move for your lineup with a two-pick lookahead. If a better player will probably last to your next turn, it says take the other one first. If the top-ranked player would crowd your lineup, it says that too. |
| Board | Ranked by **Lock** (default): the expected score of a starter when you lock his best game each week. **Floor** = FPPG × games played. **Ceiling** = raw FPPG. Second line: FPPG, game-to-game swing (±%), odds he's there at your next pick. `+N` = how far Sleeper's ADP undersells him. ★ target, ✕ hide. |
| Plan | Game-plan note for this pick window, odds board, your ★ targets, alerts (runs, fallers, center cap, injuries, a sharp room ahead of you), Sleeper queue mirror with **Queue my top 6** and **Remove fades**. |
| Room | Sharpness leaderboard. Every manager starts at 65 (cash-league assumption) and moves with each pick: 0 = drafts straight off Sleeper ADP, 100 = drafts by value. Shows value captured, reaches, steals, and which managers pick before you. One blunder barely moves a score; a pattern does. |
| Team | Lineup slots, your picks graded **Strong / Solid / Questionable / Reach** with "could've had", where your points come from vs the room, power ranking. |
| Feed | Every pick, graded live. Filter to mine, steals or reaches. |

**Why Lock changes the board.** You keep one game per starter per week, so a player's spread matters: a volatile 30-point guy gives you more 45s to lock than a steady 30. That's why Clingan (+38 vs ADP), Edey, Lillard and AD rise and steady scorers like Randle and Pritchard fall. Full list: `top120.md`.

**How the "will he last" odds work.** For each manager the panel keeps a probability over sharpness (0–100) and updates it after every pick, using how far that pick sat from both Sleeper's ADP order and the value order (with an 8% "random blunder" allowance). Then it simulates the picks between now and your turn 400 times, each manager drafting with his own sharpness. Sharp managers ahead of you = value targets won't fall, so reach. ADP managers ahead of you = you can wait.

### Hotkeys (ignored while you're typing)

`` ` `` hide/show · `/` search · `Q` queue the top recommendation · `D` then `D` (or `Enter`) draft it · `Esc` cancel

### Tonight: 10-minute dress rehearsal

- Start an NBA mock in Sleeper and open it. The panel picks up any `/draft/nba/<id>` page.
- On the clock: click **Draft** (it turns to "Confirm"), click again. Watch Sleeper make the pick.
- Click **+ Queue** on a player and check he shows up in Sleeper's queue.
- Before the real draft, open **Plan → Remove fades** (Garland, Paul George, Ty Jerome are in your queue), then **Queue my top 6**. Auto-pick drafts from that queue if you disconnect.

## Lock-In coach (league pages)

Open your league on sleeper.com. A small rail shows on the right: how many games to lock right now. Open it and it sits on the chat column.

- **Lock / Hold** for each starter after every game, with the reason: "Lock 43.0. Waiting is worth about 40.3 with 1 game left."
- **Lock lines**: the score at which locking beats waiting, by games left. The line drops as games run out.
- **Risk**: **Even** maximizes expected points. **Chase** (you're the underdog) holds out for bigger games. **Protect** (you're favored) locks good games sooner.
- **Live** and **Final soon**: it never calls a lock from a game in progress, or before Sleeper posts the final stat line.
- **I locked this in Sleeper**: tracks it in the panel. It does not lock anything in Sleeper; do that there.
- **Calculator**: any player, any score, any games left.
- A toast fires when a new Lock call appears. It refreshes every minute while games are on.

Backtest on a real week (Nov 17–23, 2025, your mock roster): following the calls scored **399** vs **353** letting every last game ride (+46).

## Settings (⚙, draft room)

- **Position**: on Sleeper's queue column (default), right full height, or left full height.
- **Auto-confirm** Sleeper's popup after you confirm in the panel.
- **Beep** at one pick away and when you're on the clock (click the panel once so Chrome allows sound).
- **Open the panel when I'm on the clock**, even if hidden.
- **Make room** shrinks Sleeper instead of covering it. Experimental.
- **My draft slot**: auto-detected from your Sleeper login.

## How it stays current

- Picks: Sleeper's public draft API about every second, plus an instant refresh when Sleeper's board changes.
- Projections, ADP, injuries: every 5 minutes. A player newly listed Out triggers an alert and his value is halved.
- Lock-In: roster, schedule and stats every minute during games, every few minutes otherwise.

## Limits

- It only acts when you click or press a key. It never drafts on its own and never locks anything.
- It reads your Sleeper user id to find your team. It never reads your login token.
- Draft and queue buttons are wired to Sleeper's draft room as of Oct 17, 2026. If Sleeper changes its markup, pick tracking keeps working (it uses the API) but those buttons may need an update.
- Desktop browsers only, not the Sleeper phone app.
- Availability and rest-day estimates (Kyrie, Lillard, LeBron, Edey and others) are judgment calls. Flip to Ceiling for the healthy-case board.
