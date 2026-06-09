# Ledger Tracker — project setup

A single-file personal finance tracker (`index.html`). No build step, no dependencies.
Data is saved in the browser's `localStorage`, tied to the site's URL.

---

## 1. Create the project locally

Run this in Terminal (assumes the app downloaded to `~/Downloads/index.html`):

```bash
# create the folder
mkdir -p ~/Projects/ledger-tracker
cd ~/Projects/ledger-tracker

# move the downloaded app in (adjust the name if it saved as ledger-tracker.html)
mv ~/Downloads/index.html ./index.html

# Netlify: serve the single file from the repo root
cat > netlify.toml <<'EOF'
[build]
  publish = "."
EOF

# ignore macOS cruft
cat > .gitignore <<'EOF'
.DS_Store
EOF

# first commit
git init -b main
git add .
git commit -m "Initial commit: ledger tracker (single-file HTML)"
```

## 2. Push to GitHub

If you have the GitHub CLI:

```bash
gh repo create ledger-tracker --public --source=. --remote=origin --push
```

Otherwise create an empty repo at https://github.com/new (name it `ledger-tracker`), then:

```bash
git remote add origin https://github.com/<your-username>/ledger-tracker.git
git push -u origin main
```

## 3. Connect Netlify — to your EXISTING site (this is the part that protects your data)

Your saved expenses are tied to the site's URL. To keep them, attach the repo to the
site your phone already uses instead of making a new one.

- Open your **existing** Netlify site.
- Go to **Project configuration > Build & deploy > Continuous deployment > Repository**.
- Select **Link repository** and choose `ledger-tracker`.
- Build command: leave empty. Publish directory: `.` (or leave default).

DO NOT use "Add new project / Import an existing project" — that creates a new site at a
new URL and your existing data will not follow it. Also avoid testing on deploy-preview or
branch URLs (e.g. `deploy-preview-1--yoursite.netlify.app`); those are different origins.
Always use your main site URL.

## 4. Protect the data during the switch

1. On your **current live app**, tap **Copy backup** and paste the text into a note/email.
   Also tap **Export CSV** as a second copy.
2. After Netlify redeploys, open the app at the **same URL** and hard-refresh
   (Cmd/Ctrl + Shift + R). Your transactions should already be there.
3. If they're missing (or you ended up on a new URL), tap **Restore**, paste the backup,
   confirm.

## 5. Shipping future changes

When you get an updated `index.html`:

```bash
cd ~/Projects/ledger-tracker
cp ~/Downloads/index.html ./index.html   # overwrite with the new version
git add -A
git commit -m "Update tracker"
git push
```

Netlify auto-redeploys to the same URL, so your saved data stays intact.

---

## Note on persistence

This data lives on the device's browser, not in the cloud. Mobile Safari can evict a
site's storage after ~7 days of no use, and "Clear website data" wipes it. Keep a weekly
**Copy backup**. Backups are full snapshots (transactions, budgets, starting cash), so any
future move is lossless via Copy backup -> Restore.
