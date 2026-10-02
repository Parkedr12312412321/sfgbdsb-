// Bebe Pro server: static hub + built-in rewriting web proxy + chat.
// Requires Node 18+ (uses the built-in fetch). Only dependency: express.
import express from "express";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8080);
const VERSION = "2.2";
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === "1"; // let the proxy reach local network addresses (off by default)
const MODES = ["ultraviolet", "scramjet", "epoxy"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

app.disable("x-powered-by");

// ---------------------------------------------------------------- helpers
const wrap = (url, mode) => `/p/${mode}/${encodeURIComponent(url)}`;
const SKIP = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;

function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (net.isIP(h) === 4) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIP(h) === 6) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  return false;
}

function resolve(value, base) {
  const v = value.trim().replace(/&amp;/g, "&");
  if (!v || SKIP.test(v) || v.startsWith("/p/")) return null;
  try { return new URL(v, base).href; } catch { return null; }
}

function rewriteCss(css, base, mode) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => { const r = resolve(u, base); return r ? `url(${q}${wrap(r, mode)}${q})` : m; })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => { const r = resolve(u, base); return r ? `@import ${q}${wrap(r, mode)}${q}` : m; });
}

function clientScript(base, mode) {
  // Runs inside proxied pages ("ultraviolet" mode) so requests made by the page's own JavaScript stay in the proxy.
  return `<script>(function(){var B=${JSON.stringify(base)},M=${JSON.stringify(mode)},O=location.origin;
function w(u){if(u==null)return u;u=String(u);if(/^(data:|blob:|javascript:|about:|#)/i.test(u))return u;
if(u.indexOf('/p/')===0||u.indexOf(O+'/p/')===0)return u;
try{var a=new URL(u,B);if(a.origin===O)a=new URL(a.pathname+a.search+a.hash,B);return '/p/'+M+'/'+encodeURIComponent(a.href)}catch(e){return u}}
var f=window.fetch;if(f)window.fetch=function(i,o){try{if(typeof i==='string'||i instanceof URL)i=w(i.toString());else if(i&&i.url)i=new Request(w(i.url),i)}catch(e){}return f.call(this,i,o)};
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=w(u);return xo.apply(this,arguments)};
var wo=window.open;window.open=function(u,n,s){return wo.call(window,w(u),n,s)};
['src','href','action','poster'].forEach(function(p){[HTMLImageElement,HTMLScriptElement,HTMLLinkElement,HTMLAnchorElement,HTMLIFrameElement,HTMLFormElement,HTMLSourceElement,HTMLVideoElement,HTMLAudioElement].forEach(function(C){
var d=Object.getOwnPropertyDescriptor(C.prototype,p);if(!d||!d.set)return;Object.defineProperty(C.prototype,p,{get:d.get,set:function(v){d.set.call(this,w(v))},configurable:true})})});
var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){var k=String(n).toLowerCase();if(k==='src'||k==='href'||k==='action'||k==='poster')v=w(v);return sa.call(this,n,v)};
document.addEventListener('submit',function(e){var fm=e.target;if((fm.method||'get').toLowerCase()!=='get')return;e.preventDefault();
var t;try{t=new URL(fm.getAttribute('action')||B,B)}catch(x){return}if(t.origin===O&&t.pathname.indexOf('/p/')!==0)t=new URL(t.pathname,B);
if(t.pathname.indexOf('/p/')===0){var m=t.pathname.match(/^\\/p\\/\\w+\\/(.*)$/);t=new URL(decodeURIComponent(m[1]))}
t.search=new URLSearchParams(new FormData(fm)).toString();location.href=w(t.href)},true);
})();<\/script>`;
}

function rewriteHtml(html, pageUrl, mode) {
  let base = pageUrl;
  const baseTag = html.match(/<base\s[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>/i);
  if (baseTag) { try { base = new URL(baseTag[2], pageUrl).href; } catch {} html = html.replace(baseTag[0], ""); }

  html = html
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?(content-security-policy|refresh)["']?[^>]*>/gi, "")
    .replace(/\s(integrity|nonce)\s*=\s*(["']).*?\2/gi, "");

  if (mode === "scramjet") {
    html = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<\/?noscript[^>]*>/gi, "");
  }

  html = html.replace(/(\s(?:href|src|action|poster|data-src|formaction)\s*=\s*)(["'])(.*?)\2/gi, (m, attr, q, val) => {
    const r = resolve(val, base); return r ? `${attr}${q}${wrap(r, mode)}${q}` : m;
  });
  html = html.replace(/(\s(?:srcset|imagesrcset)\s*=\s*)(["'])(.*?)\2/gi, (m, attr, q, val) => {
    const out = val.split(",").map(part => { const [u, ...rest] = part.trim().split(/\s+/); const r = resolve(u || "", base); return [r ? wrap(r, mode) : u, ...rest].join(" "); }).join(", ");
    return `${attr}${q}${out}${q}`;
  });
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, c) => a + rewriteCss(css, base, mode) + c);
  html = html.replace(/(\sstyle\s*=\s*)(["'])(.*?)\2/gi, (m, a, q, css) => a + q + rewriteCss(css, base, mode) + q);

  if (mode === "ultraviolet") {
    const inject = clientScript(base, mode);
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, h => h + inject) : inject + html;
  }
  return html;
}

function errorPage(title, detail) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
body{display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.c{max-width:440px;padding:26px 28px;border-radius:22px;background:rgba(20,22,32,.55);border:1px solid rgba(255,255,255,.2);color:#fff;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{margin:0;color:rgba(255,255,255,.75);font-size:14.5px;line-height:1.5}</style>
<div class="c"><h1>${title}</h1><p>${detail}</p></div>`;
}

// ---------------------------------------------------------------- proxy
async function handleProxy(req, res) {
  const m = req.originalUrl.match(/^\/p\/(\w+)\/([^?]*)(\?.*)?$/);
  if (!m) return res.status(400).send(errorPage("That address isn’t valid", "Enter a full website address like example.com."));
  const mode = MODES.includes(m[1]) ? m[1] : "ultraviolet";
  let target;
  try {
    target = new URL(decodeURIComponent(m[2]));
    if (m[3]) target.search = m[3]; // a GET form submitted its fields
    if (!/^https?:$/.test(target.protocol)) throw new Error();
  } catch {
    return res.status(400).send(errorPage("That address isn’t valid", "Enter a full website address like example.com."));
  }
  if (!ALLOW_PRIVATE && isPrivateHost(target.hostname)) {
    return res.status(403).send(errorPage("That address is blocked", "The proxy doesn’t open addresses on your private network."));
  }

  const headers = { "user-agent": UA, accept: req.get("accept") || "*/*", "accept-language": req.get("accept-language") || "en-US,en;q=0.9" };
  const hasBody = !["GET", "HEAD"].includes(req.method);
  if (hasBody && req.get("content-type")) headers["content-type"] = req.get("content-type");

  let upstream;
  try {
    upstream = await fetch(target, { method: req.method, headers, body: hasBody ? req.body : undefined, redirect: "manual", signal: AbortSignal.timeout(20000) });
  } catch (e) {
    const timeout = e.name === "TimeoutError";
    return res.status(502).send(errorPage(timeout ? "The site took too long" : "The site couldn’t be reached",
      timeout ? "It didn’t answer within 20 seconds. Try again in a moment." : `Your server couldn’t connect to ${target.hostname}. Check the address, or try again later.`));
  }

  const loc = upstream.headers.get("location");
  if (upstream.status >= 300 && upstream.status < 400 && loc) {
    try { return res.redirect(302, wrap(new URL(loc, target).href, mode)); } catch {}
  }

  const type = upstream.headers.get("content-type") || "application/octet-stream";
  res.status(upstream.status);
  res.set("content-type", type);
  res.set("cache-control", upstream.headers.get("cache-control") || "no-cache");
  res.set("access-control-allow-origin", "*");

  if (/text\/html|application\/xhtml/i.test(type)) return res.send(rewriteHtml(await upstream.text(), upstream.url || target.href, mode));
  if (/text\/css/i.test(type)) return res.send(rewriteCss(await upstream.text(), upstream.url || target.href, mode));
  res.send(Buffer.from(await upstream.arrayBuffer()));
}

app.all(/^\/p\/\w+\//, express.raw({ type: () => true, limit: "20mb" }), handleProxy);

// Requests a proxied page makes to its own site's root paths (e.g. "/logo.png") land here; send them back through the proxy.
app.use((req, res, next) => {
  const ref = req.get("referer") || "";
  const m = ref.match(/\/p\/(\w+)\/([^?#]*)/);
  if (!m || req.path.startsWith("/p/") || req.path === "/api/health" || req.path === "/api/chat") return next();
  try {
    const original = new URL(decodeURIComponent(m[2]));
    return res.redirect(307, wrap(new URL(req.originalUrl, original.origin).href, MODES.includes(m[1]) ? m[1] : "ultraviolet"));
  } catch { next(); }
});

// ---------------------------------------------------------------- API
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, version: VERSION, proxy: MODES }));

const chat = [];
app.get("/api/chat", (_req, res) => res.json({ messages: chat.slice(-100) }));
app.post("/api/chat", (req, res) => {
  const message = String(req.body?.message || "").trim().slice(0, 500);
  if (!message) return res.status(400).json({ error: "Message is empty" });
  const msg = { id: Date.now(), user: String(req.body?.user || "Guest").slice(0, 30), message, timestamp: new Date().toISOString() };
  chat.push(msg); if (chat.length > 500) chat.shift();
  res.json(msg);
});

// ---------------------------------------------------------------- static
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, file) { if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); }
}));
app.get(/.*/, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`Bebe Pro ${VERSION} running at http://localhost:${PORT}`));
