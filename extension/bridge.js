/* War Room bridge — drives Sleeper's own draft-room controls.
   Mapped from the live room on Oct 17, 2026:
   classic  /draft/nba/<id>       rows .player-rank-item2 · draft .draft-button(.disable) · queue .queue-action(.selected)
                                  search input[placeholder^="Find player"] · queue panel .draft-queue-player-item
   beta     /beta/draft/nba/<id>  rows <tr> with button[aria-label="Open <Name>"] · draft button text "DRAFT" (disabled)
                                  queue button[aria-label="Add|Remove <Name> to|from queue"] · search input[placeholder^="Search Player"]
   Every action is started by a click or key press in the overlay. Nothing here picks on its own. */
(function (root) {
  "use strict";
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z]/g, "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const HOST_ID = "wr-overlay-host";
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const outsideOverlay = (el) => !el.closest("#" + HOST_ID);

  function fire(el) {
    const o = { bubbles: true, cancelable: true, view: window, button: 0 };
    const P = window.PointerEvent || MouseEvent;
    el.dispatchEvent(new P("pointerdown", o));
    el.dispatchEvent(new MouseEvent("mousedown", o));
    el.dispatchEvent(new P("pointerup", o));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.dispatchEvent(new MouseEvent("click", o));
  }

  function layout() {
    if (document.querySelector(".player-rank-item2, .queue-wrapper, .draft-queue")) return "classic";
    if (document.querySelector('button[aria-label^="Open "], input[placeholder^="Search Player"]')) return "beta";
    return "unknown";
  }
  function searchInput() {
    return document.querySelector('input[placeholder^="Find player"]') ||
      document.querySelector('input[placeholder^="Search Player"]');
  }
  function setInput(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function rows() {
    const out = [];
    document.querySelectorAll(".player-rank-item2").forEach((row) => {
      const nw = row.querySelector(".name-wrapper");
      const name = nw && nw.childNodes[0] ? nw.childNodes[0].nodeValue : "";
      if (name) out.push({ row, name: name.trim(), kind: "classic" });
    });
    document.querySelectorAll('button[aria-label^="Open "]').forEach((btn) => {
      const tr = btn.closest("tr");
      if (!tr || !tr.querySelector('button[aria-label$=" to queue"], button[aria-label$=" from queue"]')) return;
      out.push({ row: tr, name: btn.getAttribute("aria-label").slice(5).trim(), kind: "beta" });
    });
    return out;
  }
  function findRow(name) {
    const k = norm(name);
    return rows().find((r) => norm(r.name) === k) || null;
  }
  async function ensureRow(name) {
    let hit = findRow(name);
    if (hit) return { ...hit, restore: () => {} };
    const input = searchInput();
    if (!input) return null;
    const prev = input.value;
    const restore = () => { try { setInput(input, prev); } catch (e) { /* ignore */ } };
    const tries = [name, name.split(" ").slice(-1)[0]];
    for (const term of tries) {
      setInput(input, term);
      for (let i = 0; i < 50; i++) {
        await sleep(i < 10 ? 15 : 40);
        hit = findRow(name);
        if (hit) return { ...hit, restore };
      }
    }
    restore();
    return null;
  }

  function draftButton(hit) {
    if (hit.kind === "classic") {
      const b = hit.row.querySelector(".draft-button");
      return b ? { el: b, disabled: b.classList.contains("disable") } : null;
    }
    const b = [...hit.row.querySelectorAll("button")].find((x) => /^\s*draft\s*$/i.test(x.textContent || ""));
    return b ? { el: b, disabled: !!b.disabled || b.getAttribute("aria-disabled") === "true" } : null;
  }
  function queueButton(hit) {
    if (hit.kind === "classic") {
      const b = hit.row.querySelector(".queue-action");
      return b ? { el: b, queued: b.classList.contains("selected") } : null;
    }
    const b = hit.row.querySelector('button[aria-label$=" to queue"], button[aria-label$=" from queue"]');
    return b ? { el: b, queued: b.getAttribute("aria-pressed") === "true" || /^Remove /.test(b.getAttribute("aria-label") || "") } : null;
  }

  /* Sleeper may ask to confirm. Only click a plainly labelled button inside a dialog-like container. */
  async function confirmDialog(timeout) {
    const t0 = Date.now();
    const okText = /^(draft|confirm|draft player|yes|yes, draft|make pick)$/i;
    const dialogSel = '[role="dialog"], [aria-modal="true"], .modal, [class*="modal" i], [class*="popup" i], [class*="confirm" i], [data-state="open"]';
    while (Date.now() - t0 < timeout) {
      // v1.2: look inside dialog containers only (the whole page has hundreds of row buttons; scanning them janks the pick)
      for (const dlg of document.querySelectorAll(dialogSel)) {
        if (!outsideOverlay(dlg)) continue;
        for (const el of dlg.querySelectorAll('button, [role="button"], div[class*="button" i]')) {
          if (!okText.test((el.textContent || "").trim()) || el.closest(".player-rank-item2, tr, .draft-queue-player-item") || !visible(el)) continue;
          fire(el); return true;
        }
      }
      await sleep(60);
    }
    return false;
  }

  async function draft(name, opts) {
    const hit = await ensureRow(name);
    if (!hit) return { ok: false, reason: "not-found" };
    const b = draftButton(hit);
    if (!b) { hit.restore(); return { ok: false, reason: "no-button" }; }
    if (b.disabled) { hit.restore(); return { ok: false, reason: "not-your-turn" }; }
    fire(b.el);
    let confirmed = false;
    if (!opts || opts.autoConfirm !== false) confirmed = await confirmDialog(1500);
    setTimeout(hit.restore, 400);
    return { ok: true, confirmed, layout: hit.kind };
  }

  async function queue(name) {
    const hit = await ensureRow(name);
    if (!hit) return { ok: false, reason: "not-found" };
    const q = queueButton(hit);
    if (!q) { hit.restore(); return { ok: false, reason: "no-button" }; }
    if (q.queued) { hit.restore(); return { ok: true, already: true }; }
    fire(q.el);
    setTimeout(hit.restore, 350);
    return { ok: true };
  }

  async function unqueue(name) {
    const k = norm(name);
    const item = [...document.querySelectorAll(".draft-queue-player-item")].find((i) => norm((i.querySelector(".name") || {}).textContent) === k);
    if (item && item.querySelector(".delete-button")) { fire(item.querySelector(".delete-button")); return { ok: true }; }
    const hit = await ensureRow(name);
    if (!hit) return { ok: false, reason: "not-found" };
    const q = queueButton(hit);
    if (!q || !q.queued) { hit.restore(); return { ok: false, reason: "not-queued" }; }
    fire(q.el);
    setTimeout(hit.restore, 350);
    return { ok: true };
  }

  /* Names in Sleeper's queue. Classic shows full names; beta shows "D. Garland" style. */
  function readQueue() {
    const classic = [...document.querySelectorAll(".draft-queue-player-item .meta-container .name, .draft-queue-player-item .name")]
      .map((n) => n.textContent.trim()).filter(Boolean);
    if (classic.length || document.querySelector(".queue-wrapper")) return { names: [...new Set(classic)], abbrev: false, visible: !!document.querySelector(".queue-wrapper") };
    const removeBtns = [...document.querySelectorAll('button[aria-label="Remove from queue"]')];
    const names = removeBtns.map((btn) => {
      let c = btn.parentElement;
      for (let i = 0; i < 6 && c; i++) { if ((c.textContent || "").includes("•")) break; c = c.parentElement; }
      const txt = c ? (c.textContent || "").trim().replace(/^(?:draft|remove|queue)+\s*/i, "") : "";
      const m = txt.match(/[A-Z]\.\s?[^•]+?(?=(?:PG|SG|SF|PF|C)(?:[,\s•]|$))/);
      return (m ? m[0] : txt.split(/(?:PG|SG|SF|PF|C)(?=[,\s•]|$)/)[0]).trim();
    }).filter(Boolean);
    // also full names of queued rows currently rendered in the table
    document.querySelectorAll('button[aria-label^="Remove "][aria-label$=" from queue"]').forEach((b) => {
      const nm = b.getAttribute("aria-label").replace(/^Remove /, "").replace(/ from queue$/, "");
      if (nm && nm !== "from queue") names.push(nm);
    });
    return { names: [...new Set(names)], abbrev: true, visible: removeBtns.length > 0 };
  }

  function autopickOn() {
    const c = document.querySelector(".autopick-toggle input[type=checkbox]");
    if (c) return !!c.checked;
    const b = document.querySelector('button[aria-label="Auto-pick"]');
    if (b) {
      const v = b.getAttribute("aria-pressed") || b.getAttribute("aria-checked");
      if (v != null) return v === "true";
    }
    return null;
  }
  function myTurnDom() {
    if (document.querySelector(".player-rank-item2 .draft-button:not(.disable)")) return true;
    const b = [...document.querySelectorAll("tr button")].find((x) => /^\s*draft\s*$/i.test(x.textContent || "") && !x.disabled);
    return !!b;
  }

  root.WR_BRIDGE = { layout, searchInput, setInput, rows, findRow, ensureRow, draftButton, queueButton, draft, queue, unqueue, readQueue, autopickOn, myTurnDom, confirmDialog, norm, HOST_ID };
})(typeof window !== "undefined" ? window : this);
