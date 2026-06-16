# Ledger Tracker — project setup

A single-file personal finance tracker (`index.html`). No build step, no dependencies.
Data is saved in the browser's `localStorage` and synced across devices via a
Cloudflare Pages Function backed by Cloudflare KV.

---

## 1. Project layout

```
index.html            the whole app
functions/api/sync.js  Cloudflare Pages Function — /api/sync (GET pull / PUT push)
```

The sync key is `SHA-256(your sync code)`, so the server never sees the plain code.

## 2. Deploy on Cloudflare Pages

The app is hosted on **Cloudflare Pages**, connected to this Git repo, so a `git push`
to `main` triggers an automatic redeploy to the same URL.

```bash
cd ~/Projects/ledger-tracker
cp ~/Downloads/index.html ./index.html   # if you got an updated build
git add -A
git commit -m "Update tracker"
git push
```

Pages config: build command empty, output directory `.` (the repo root). Always use your
main site URL — preview/branch URLs are different origins and won't see your data.

### KV binding (one-time)

The sync function needs a KV namespace bound as `LEDGER_SYNC`:
Cloudflare Dashboard → Pages project → Settings → Functions → KV namespace bindings →
add binding `LEDGER_SYNC` → your KV namespace.

## 3. Sync across devices

Tap **Sync**, enter the **same secret code** on every device. Matching codes share data;
different codes stay separate. Data pulls on load and when you refocus the tab, and pushes
a couple of seconds after any change.

## 4. Updating the app — beat the cache

It's a single HTML file, so browsers (especially mobile Safari) can hold an **old cached
copy** after a deploy. The footer shows a `build` date — if two devices show different
build values, the older one is stale. To force the latest:

- **Desktop:** hard refresh — Cmd/Ctrl + Shift + R.
- **Mobile Safari:** pull-to-refresh usually isn't enough. Close the tab and reopen, or
  Settings → Safari → Advanced → Website Data → remove the site, then reopen.

A device running old code can keep pushing stale data back, so make sure **both** devices
show the same build before trusting a sync.

## 5. Protect the data

1. Tap **Copy backup** weekly and paste it somewhere safe (it's a full snapshot —
   transactions, budgets, cards, groups, starting cash). **Export CSV** is a second copy.
2. After a redeploy, open at the **same URL** and hard-refresh. Your data should be there.
3. If it's missing, tap **Restore**, paste the backup, confirm.

---

## Note on persistence

Local data lives in the device's browser. Cloudflare KV keeps the synced copy. Mobile
Safari can evict a site's storage after long inactivity, and "Clear website data" wipes the
local copy — so keep a weekly **Copy backup**. Backups are lossless via Copy backup → Restore.
