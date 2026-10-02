# Bebe Pro 2.2

Self-hosted play hub: built-in games, a tabbed browser with a proxy, and chat.

## Run it

Requires Node.js 18 or newer (`node -v` to check).

```
npm install
npm start
```

Then open http://localhost:8080 (or your server's address). Don't open `index.html`
by double-clicking it: the proxy and chat only work when the page comes from the server.

## Updating from an older version

Replace **both** `server.mjs` and `public/index.html`, then **stop the old server**
(Ctrl+C, or `pkill -f server.mjs`) before running `npm start` again. If the old server
is still running, the new one can't start ("address already in use") and you'll keep
seeing the old behavior. The sidebar shows "Proxy server online" when everything is right.

## Proxy modes

All three run on your own server; there's nothing extra to install.

- **Ultraviolet (full):** rewrites links, images, styles, forms, redirects and the page's own requests.
- **Scramjet (no scripts):** removes JavaScript. Fast and readable, good for articles.
- **Epoxy (basic):** rewrites links and images and leaves the page's scripts alone.
- **Direct:** no proxy. Many sites refuse to load this way.

Sign-ins, video streaming and heavy web apps (YouTube, Discord, etc.) usually won't
work through this built-in proxy. For security, it refuses private network addresses
unless you set `ALLOW_PRIVATE=1`.
