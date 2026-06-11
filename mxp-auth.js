/* =====================================================================
   Ahooga MAX Production Suite — shared login gate + auto-sync
   ---------------------------------------------------------------------
   Add this ONE line inside the <head> of EVERY page (apps AND index.html):

       <script src="mxp-auth.js"></script>

   What it does:
   - App pages: if the user is not logged in (no Odoo credentials saved),
     it remembers which app they tried to open and bounces them to
     index.html to log in. After they save their credentials it sends
     them straight back to that app.
   - Every page that loads an app stays "connected" and re-syncs with
     Odoo every 5 minutes (300 s). The sync is skipped for that cycle if
     the user is actively typing/editing, so in-progress work is never
     wiped.
   - index.html itself is never gated (it IS the login page).

   Credentials are read from localStorage key "mxp_cfg" = {user, key},
   exactly as index.html already saves them. Nothing else changes.
   ===================================================================== */
(function () {
  "use strict";

  var SYNC_MS = 300000;          // 5 minutes
  var REDIRECT_TTL_MS = 600000;  // honour a "return to app" request for 10 min

  function hasCreds() {
    try {
      var c = localStorage.getItem("mxp_cfg");
      if (!c) return false;
      var g = JSON.parse(c);
      return !!(g && g.user && g.key);
    } catch (e) {
      return false;
    }
  }

  function pageName() {
    return (location.pathname.split("/").pop() || "").toLowerCase();
  }

  var page = pageName();
  var isLoginPage = page === "" || page === "index.html";

  /* ---------------- Login page (index.html) ---------------- */
  if (isLoginPage) {
    // After the user saves their credentials on the homepage, if they were
    // bounced here from a specific app, send them back to it.
    function maybeReturn() {
      if (!hasCreds()) return false;
      try {
        var raw = localStorage.getItem("mxp_redirect");
        if (!raw) return false;
        var r = JSON.parse(raw);
        localStorage.removeItem("mxp_redirect");
        if (r && r.to && (Date.now() - (r.ts || 0)) < REDIRECT_TTL_MS) {
          location.replace(r.to);
          return true;
        }
      } catch (e) {
        try { localStorage.removeItem("mxp_redirect"); } catch (e2) {}
      }
      return false;
    }
    // Don't redirect away the instant the page opens if already logged in and
    // there's a stale target — maybeReturn clears stale targets and only acts
    // on fresh ones. Poll briefly to catch the moment credentials are saved.
    if (!maybeReturn()) {
      var ticks = 0;
      var iv = setInterval(function () {
        ticks++;
        if (maybeReturn() || ticks > 600) clearInterval(iv); // up to ~5 min
      }, 500);
    }
    return;
  }

  /* ---------------- App pages: require login ---------------- */
  if (!hasCreds()) {
    try {
      localStorage.setItem(
        "mxp_redirect",
        JSON.stringify({ to: page + location.search, ts: Date.now() })
      );
    } catch (e) {}
    // Hide the page immediately to avoid a flash of the app before redirect.
    try { document.documentElement.style.display = "none"; } catch (e) {}
    location.replace("index.html");
    return;
  }

  /* ---------------- Auto-sync every 5 minutes ---------------- */
  function userIsEditing() {
    try {
      var ae = document.activeElement;
      if (ae) {
        var tag = (ae.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ae.isContentEditable) {
          return true;
        }
      }
      // Skip if an open dialog/modal is on screen (likely mid-action).
      if (document.querySelector("dialog[open], .modal.show, .modal.open, .modal.is-open")) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function runSync() {
    if (userIsEditing()) return;        // protect in-progress work
    if (document.hidden) return;        // don't sync a backgrounded tab
    if (!hasCreds()) {                   // credentials cleared elsewhere -> re-gate
      location.replace("index.html");
      return;
    }
    // Call whichever refresh function this particular app defines.
    var fns = ["loadData", "syncOdoo", "connectAndLoad", "refresh",
               "refreshSerials", "loadAll", "reload", "syncAll"];
    for (var i = 0; i < fns.length; i++) {
      if (typeof window[fns[i]] === "function") {
        try { window[fns[i]](); } catch (e) {}
        return;
      }
    }
  }

  if (window.__mxpSyncTimer) clearInterval(window.__mxpSyncTimer);
  window.__mxpSyncTimer = setInterval(runSync, SYNC_MS);
})();
