// Suno traffic logger — paste into DevTools Console on suno.com, then use the site normally.
// It only OBSERVES fetch/XHR calls the page itself makes. It changes nothing,
// sends nothing anywhere, and stores the log only in this tab's memory.
// Authorization / Cookie values are redacted; captcha tokens in bodies are redacted.
// Helpers when you're done:
//   __sunoTrafficSummary()   -> counts by host + path, in the console
//   __sunoTrafficDownload()  -> downloads the log as a JSON file
//   __sunoTrafficClear()     -> clears the log
(() => {
  if (!/(^|\.)suno\.com$/.test(location.hostname)) {
    console.warn("[SUNO-LOG] Not on suno.com — not installing. Go to https://suno.com/create first.");
    return;
  }
  if (window.__sunoLogInstalled) {
    console.log("[SUNO-LOG] Already installed in this tab. Log so far:", window.__sunoTraffic.length, "calls");
    return;
  }
  window.__sunoLogInstalled = true;
  const log = (window.__sunoTraffic = []);

  const SECRET_KEYS = /^(authorization|cookie|set-cookie|token|access_token|refresh_token)$/i;
  function redact(value, keyHint) {
    if (keyHint && SECRET_KEYS.test(keyHint)) return "<redacted>";
    if (Array.isArray(value)) return value.map((v) => redact(v));
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
      return out;
    }
    if (typeof value === "string" && value.length > 500) return value.slice(0, 500) + "…<truncated>";
    return value;
  }
  function parseBody(body) {
    if (body == null) return null;
    if (typeof body === "string") {
      try { return redact(JSON.parse(body)); } catch { return body.slice(0, 500); }
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) return "<FormData — see Network tab>";
    return "<non-string body — see Network tab>";
  }
  function parseResponse(text) {
    if (!text) return null;
    try {
      const j = JSON.parse(text);
      return redact(j);
    } catch { return text.slice(0, 500); }
  }
  function record(entry) {
    log.push(entry);
    const interesting = /studio-api|auth\.suno|\/api\//.test(entry.url);
    console.log(
      (interesting ? "%c[SUNO-LOG]%c" : "[suno-log]"),
      interesting ? "color:#e90;font-weight:bold" : "",
      entry.method, entry.status ?? "…", entry.url,
      entry.requestBody ? { body: entry.requestBody } : ""
    );
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    const entry = { time: new Date().toISOString(), via: "fetch", method, url, requestBody: parseBody(init.body ?? null), status: null };
    try {
      const res = await origFetch.apply(this, arguments);
      entry.status = res.status;
      try {
        const text = await res.clone().text();
        entry.response = parseResponse(text);
      } catch { entry.response = "<unreadable>"; }
      record(entry);
      return res;
    } catch (err) {
      entry.status = "FAILED";
      entry.error = String(err);
      record(entry);
      throw err;
    }
  };

  // ---- XMLHttpRequest ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__sunoEntry = { time: new Date().toISOString(), via: "xhr", method: String(method).toUpperCase(), url: String(url), status: null };
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const entry = this.__sunoEntry || { time: new Date().toISOString(), via: "xhr", method: "?", url: "?", status: null };
    entry.requestBody = parseBody(body ?? null);
    this.addEventListener("load", () => {
      entry.status = this.status;
      try {
        if (!this.responseType || this.responseType === "text" || this.responseType === "json") {
          entry.response = parseResponse(typeof this.response === "string" ? this.response : JSON.stringify(this.response));
        } else entry.response = `<${this.responseType} response — see Network tab>`;
      } catch { entry.response = "<unreadable>"; }
      record(entry);
    });
    this.addEventListener("error", () => { entry.status = "FAILED"; record(entry); });
    return origSend.apply(this, arguments);
  };

  window.__sunoTrafficSummary = () => {
    const counts = {};
    for (const e of log) {
      let key = e.url;
      try { const u = new URL(e.url, location.origin); key = `${e.method} ${u.host}${u.pathname}`; } catch {}
      counts[key] = (counts[key] || 0) + 1;
    }
    console.table(counts);
    return counts;
  };
  window.__sunoTrafficDownload = () => {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `suno-traffic-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    console.log("[SUNO-LOG] Downloaded", log.length, "calls. NOTE: request bodies can include your prompts/lyrics — check before sharing.");
  };
  window.__sunoTrafficClear = () => { log.length = 0; console.log("[SUNO-LOG] Cleared."); };

  console.log("%c[SUNO-LOG] Installed on " + location.href + " — now use Suno normally. " +
    "API calls (studio-api / auth / /api/) are highlighted. When done: __sunoTrafficSummary() or __sunoTrafficDownload()",
    "color:#e90;font-weight:bold");
})();
