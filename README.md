# PayMate

Card spending insights, in Hebrew. The same interface ships two ways:

| | Desktop app (Windows, Electron) | Website (static, Cloudflare) |
|---|---|---|
| Data lives in | A SQLite file on the computer | The browser (IndexedDB) |
| Getting data in | Sync from the card company's site, or Excel files | Excel files from Isracard or Max |
| Updates | Installer updates from GitHub releases | Redeploy the site |
| Backup and restore | Settings page | Settings page, **same file format** |

Nothing is sent to any server by the website. Bank passwords are only ever handled by the desktop app's sync, and are never stored.

## Develop

```bash
npm ci
npm run dev        # the interface at http://localhost:5173 (website mode, data in the browser)
npm test           # vitest
npm run typecheck
```

Open `http://localhost:5173/?demo` for synthetic data that is never saved.

### Desktop app

```bash
npm start          # build and run the Electron app
npm run dist       # build the Windows installer into release/
```

Releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed. The installed app finds updates there.

### Website

```bash
npm run build:web      # writes the static site to dist-web/
npm run preview:web    # serve it locally
npx wrangler pages dev dist-web   # serve it like Cloudflare does, including the _headers file
```

## Deploy the website to Cloudflare

The site is plain static files, deployed as a Cloudflare Pages project named `paymate` (address `paymate.pages.dev`). `wrangler.jsonc` points Pages at `dist-web/`.

Command line:

```bash
npm run build:web
npx wrangler pages deploy dist-web --project-name paymate --branch main
```

The project already exists. To create it somewhere else: `npx wrangler pages project create <name> --production-branch main`. Wrangler may offer to create a Worker instead; pass `--force` once to get a Pages project, because only Pages gives an address of the form `<name>.pages.dev` without the account's `workers.dev` name in it. Do not use `npx wrangler deploy` for this site: that publishes a Worker at the account's `workers.dev` address.

Git-connected build: set the build command to `npm ci && npm run build:web` and the output directory to `dist-web`. Set the build variable `ELECTRON_SKIP_BINARY_DOWNLOAD=1` so the build does not download Electron.

`web/public/_headers` sets a strict Content-Security-Policy, including `connect-src 'none'`, so the browser itself refuses to send anything from the page to anywhere. If you ever add a feature that needs the network, that line is the one to change deliberately.

### Things to know about browser storage

- **Data belongs to the exact site address.** Moving from `*.workers.dev` to a custom domain, or opening a preview URL, starts empty. Choose the final address before importing, or carry data across with a backup file.
- **Clearing the site's data erases it.** The site asks the browser to keep its storage when it is low on space, but nothing guarantees it. Download a backup from time to time.
- **It does not sync** between browsers or devices. Use a backup file to move data.
- **Browser storage is not encrypted** on disk. Backup files are: see below.

## Backup file

One JSON file (`paymate-backup`, version 1) is understood by both targets, so data moves freely in either direction: back up in the desktop app and restore on the website, or the other way round. The format is in `shared/backup.ts`, which is also the single place that validates a file before anything is changed.

- Restoring **replaces** everything; it does not merge. A file that is not a valid backup changes nothing.
- It stores category keys, not database ids, and every field both sides need: hand-set categories, the businesses you mapped, ones you chose to leave as "other", budgets, the monthly target and the import history.
- **New backups are always encrypted with a password** the user chooses (at least 8 characters). The password is never stored and cannot be recovered. Only the password is needed to restore: the key is derived from it again, using the salt kept in the file. The format (`paymate-backup-encrypted`, version 1) is in `shared/backupCrypto.ts`: PBKDF2-HMAC-SHA-256 (600,000 iterations, random salt) derives an AES-256-GCM key, with a random IV per file. GCM authenticates the data, so a wrong password and a tampered file are both refused. Encryption runs in the interface, so the password never reaches the desktop app's main process.
- Old unencrypted backups can still be restored.
- A backup from a newer PayMate is refused with a message. A category an older version does not know becomes "other".

## Layout

```
shared/        Used by both targets: categories, insights, the Isracard and Max Excel parsers, the backup format
src/           The interface (React). src/web/ is the website's storage: IndexedDB plus the same queries as the desktop app
electron/      The desktop app: main process, SQLite, bank sync, updates
web/public/    Files copied into the website as they are (headers)
tests/         tests/helpers/stores.ts runs the same scenarios against SQLite and the website's logic
```

`src/api.ts` picks the implementation at runtime: the desktop app's bridge, the browser's storage, or the demo. Everything the interface calls is described by `PayMateApi` in `shared/api.ts`; what only the desktop app can do (sync, updates) sits under its optional `desktop` part, and the interface shows those features only when it is there.
