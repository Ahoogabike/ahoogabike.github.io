/* =====================================================================
   Ahooga MAX Production Suite — shared login gate + auto-sync
   ---------------------------------------------------------------------
   Add this ONE line inside the <head> of EVERY page (apps AND index.html):

       <script src="mxp-auth.js"></script>

   What it does:
   - index.html (login page): shows ONLY the login form until logged in,
     then reveals the homepage. If the user had been bounced here from an
     app, sends them back to that app after login.
   - App pages: if not logged in, bounce to index.html to log in (and
     return afterwards). Once logged in, the page is fed the shared Odoo
     login automatically, connects itself, and HIDES its own connection /
     settings tab (so nobody has to type credentials in each app).
   - App pages re-sync with Odoo every 5 minutes (300 s), skipping a cycle
     while the user is typing/editing so in-progress work is never wiped.

   Credentials live in localStorage key "mxp_cfg" = {user, key}, exactly as
   index.html already saves them.
   ===================================================================== */
(function () {
  "use strict";

  var SYNC_MS = 300000;          // 5 minutes
  var REDIRECT_TTL_MS = 600000;  // honour a "return to app" request for 10 min

  function getCfg() {
    try {
      var c = localStorage.getItem("mxp_cfg");
      if (!c) return null;
      var g = JSON.parse(c);
      return (g && g.user && g.key) ? g : null;
    } catch (e) {
      return null;
    }
  }
  function hasCreds() { return !!getCfg(); }

  function pageName() {
    return (location.pathname.split("/").pop() || "").toLowerCase();
  }

  var page = pageName();
  var isLoginPage = page === "" || page === "index.html";

  /* =================================================================
     LOGIN PAGE (index.html)
     ================================================================= */
  if (isLoginPage) {
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

    if (hasCreds()) reveal();
    var ticks = 0;
    var iv = setInterval(function () {
      ticks++;
      if (hasCreds()) {
        reveal();
        maybeReturn();
        clearInterval(iv);
      } else if (ticks > 600) {
        clearInterval(iv);
      }
    }, 500);
    return;
  }

  /* =================================================================
     APP PAGES — require login
     ================================================================= */
  if (!hasCreds()) {
    try {
      localStorage.setItem(
        "mxp_redirect",
        JSON.stringify({ to: page + location.search, ts: Date.now() })
      );
    } catch (e) {}
    try { document.documentElement.style.display = "none"; } catch (e) {}
    location.replace("index.html");
    return;
  }

  /* ---- Hide each app's own connection / settings UI (flash-free) ---- */
  try {
    var hideCss =
      "#view-settings,#nav-settings,#conn-panel,#gear,#settings{display:none!important}";
    var hs = document.createElement("style");
    hs.textContent = hideCss;
    (document.head || document.documentElement).appendChild(hs);
  } catch (e) {}

  // Push the shared login into whatever credential fields the app uses.
  function fillCreds() {
    var g = getCfg();
    if (!g) return;
    var map = { "cfg-user": g.user, "cfg-key": g.key };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && map[id] != null && el.value !== map[id]) {
        el.value = map[id];
        try {
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (e) {}
      }
    });
  }

  // Save the shared login into the app's OWN saved config. Some apps (custom
  // colours, planner, traceability) read credentials from an in-memory cfg that
  // is only populated by their Settings "Save" — not from the live fields — so
  // filling the fields isn't enough. Run their save routine so syncs see creds.
  function saveAppSettings() {
    var fns = ["saveSettings", "saveCfg", "saveConfig", "saveAllSettings",
               "applySettings", "saveAll"];
    for (var i = 0; i < fns.length; i++) {
      if (typeof window[fns[i]] === "function") {
        try { window[fns[i]](); } catch (e) {}
        return true;
      }
    }
    return false;
  }

  // Trigger the app's own connect/load routine (covers every app variant).
  function initialConnect() {
    var fns = ["connectAndLoad", "loadData", "syncOdoo", "testConnection",
               "loadAll", "syncAll"];
    for (var i = 0; i < fns.length; i++) {
      if (typeof window[fns[i]] === "function") {
        try { window[fns[i]](); } catch (e) {}
        return;
      }
    }
  }

  // Hide the connection panel / settings tab / gear button everywhere.
  function hideConnectionUI() {
    try {
      var u = document.getElementById("cfg-user");
      if (u) {
        var p = u.closest("#view-settings, #settings, #conn-panel, .connect, .conn-panel");
        if (p) p.style.display = "none";
      }
      var tabs = document.querySelectorAll(".nav-btn, .tab, .tab-btn, [role='tab'], nav button");
      for (var i = 0; i < tabs.length; i++) {
        var t = (tabs[i].textContent || "").replace(/[^a-z]/gi, "").toLowerCase();
        if (t === "settings" || t === "connection") tabs[i].style.display = "none";
      }
      var gear = document.getElementById("gear");
      if (gear) gear.style.display = "none";
      // If a now-hidden settings view was the active one, switch to a real tab.
      var active = document.querySelector("#view-settings.active, #view-settings.show, #settings.active");
      if (active) {
        var first = document.querySelector(".nav-btn:not(#nav-settings), .tab:not(#nav-settings)");
        if (first) { try { first.click(); } catch (e) {} }
      }
    } catch (e) {}
  }

  // Run hide as early as possible (no flash), fill creds early too.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      hideConnectionUI();
      fillCreds();
    });
  } else {
    hideConnectionUI();
    fillCreds();
  }

  // After the app has fully initialised, re-assert credentials, connect, and
  // re-hide (in case the app re-rendered its nav). Delay lets the app's own
  // startup run first so our values win.
  window.addEventListener("load", function () {
    setTimeout(function () {
      fillCreds();
      saveAppSettings();
      initialConnect();
      hideConnectionUI();
    }, 800);
  });

  /* ---- Auto-sync every 5 minutes ---- */
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
    if (userIsEditing()) return;
    if (document.hidden) return;
    if (!hasCreds()) { location.replace("index.html"); return; }
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

  /* =================================================================
     "SYNC EVERYWHERE" — one Sync click refreshes every open app
     Pages are separate, so apps that aren't open can't be refreshed; but
     every app that IS open (other tabs / the embedded panels) re-syncs.
     ================================================================= */
  function syncNow(force) {
    if (!force && userIsEditing()) return;          // never wipe in-progress edits
    if (!hasCreds()) { location.replace("index.html"); return; }
    var fns = ["loadData", "syncOdoo", "connectAndLoad", "refresh",
               "refreshSerials", "loadAll", "reload", "syncAll"];
    for (var i = 0; i < fns.length; i++) {
      if (typeof window[fns[i]] === "function") {
        try { window[fns[i]](); } catch (e) {}
        return;
      }
    }
  }
  // Another tab/app asked everyone to sync.
  window.addEventListener("storage", function (e) {
    if (e.key === "mxp_sync_ping" && e.newValue) {
      setTimeout(function () { syncNow(false); }, 200);
    }
  });
  // The user clicked a Sync control in THIS app -> tell every other open app.
  document.addEventListener("click", function (e) {
    try {
      var el = e.target && e.target.closest ? e.target.closest("button, a, [onclick]") : null;
      if (!el) return;
      var sig = (el.getAttribute("onclick") || "") + " " + (el.textContent || "");
      if (/sync/i.test(sig)) {
        try { localStorage.setItem("mxp_sync_ping", String(Date.now())); } catch (e2) {}
      }
    } catch (e3) {}
  }, true);
})();
