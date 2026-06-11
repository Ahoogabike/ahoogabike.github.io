/* =====================================================================
   Ahooga MAX Production Suite — shared login gate + auto-sync
   ---------------------------------------------------------------------
   Add this ONE line inside the <head> of EVERY page (apps AND index.html):

       <script src="mxp-auth.js"></script>

   What it does:
   - index.html (the login page): shows ONLY the login form until the user
     is logged in. Once Odoo credentials are saved, the homepage (hero,
     app cards, etc.) is revealed. If the user had been bounced here from a
     specific app, they're sent back to that app instead.
   - App pages: if not logged in, the user is bounced to index.html to log
     in (and afterwards returned to the app they wanted).
   - App pages stay "connected" and re-sync with Odoo every 5 minutes
     (300 s). A sync cycle is skipped while the user is typing/editing or
     has a dialog open, so in-progress work is never wiped.

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
    // Hide the homepage content until logged in — only the login form shows.
    // (Class is added to <html> the moment credentials exist.)
    try {
      var css =
        "html:not(.mxp-authed) .hero," +
        "html:not(.mxp-authed) .apps-section," +
        "html:not(.mxp-authed) .cc-band," +
        "html:not(.mxp-authed) footer{display:none!important}" +
        "html:not(.mxp-authed) .connect-section{min-height:60vh;display:flex;" +
        "align-items:center;justify-content:center}";
      var st = document.createElement("style");
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}

    function reveal() {
      document.documentElement.classList.add("mxp-authed");
    }

    // If the user was bounced here from an app, send them back after login.
    function maybeReturn() {
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

    if (hasCreds()) reveal(); // already logged in -> show homepage immediately

    // Watch for the moment credentials get saved, then reveal / redirect.
    var ticks = 0;
    var iv = setInterval(function () {
      ticks++;
      if (hasCreds()) {
        reveal();
        maybeReturn();      // jumps to the app they came from, if any
        clearInterval(iv);
      } else if (ticks > 600) {
        clearInterval(iv);  // give up polling after ~5 min
      }
    }, 500);
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
