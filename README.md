# PayMate

Card spending insights, in Hebrew. The same interface ships two ways:

| | Desktop app (Windows, Electron) | Website (static, Cloudflare) |
|---|---|---|
| Data lives in | A SQLite file on the computer | The browser (IndexedDB) |
| Getting data in | Sync from the card company's site, or Excel files | Excel files from Isracard |
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
npx wrangler dev       # serve it like Cloudflare does, including web/public/_headers
```

## Deploy the website to Cloudflare

The site is plain static files. `wrangler.jsonc` points Workers static assets at `dist-web/`.

Command line:

```bash
npm run build:web
npx wrangler deploy
```

Git-connected build (Workers Builds): set the build command to `npm ci && npm run build:web` and the deploy command to `npx wrangler deploy`. Set the build variable `ELECTRON_SKIP_BINARY_DOWNLOAD=1` so the build does not download Electron.

`web/public/_headers` sets a strict Content-Security-Policy, including `connect-src 'none'`, so the browser itself refuses to send anything from the page to anywhere. If you ever add a feature that needs the network, that line is the one to change deliberately.

### Things to know about browser storage

- **Data belongs to the exact site address.** Moving from `*.workers.dev` to a custom domain, or opening a preview URL, starts empty. Choose the final address before importing, or carry data across with a backup file.
- **Clearing the site's data erases it.** The site asks the browser to keep its storage when it is low on space, but nothing guarantees it. Download a backup from time to time.
- **It does not sync** between browsers or devices. Use a backup file to move data.
- **It is not encrypted** on disk, and neither are backup files.

## Backup file

One JSON file (`paymate-backup`, version 1) is understood by both targets, so data moves freely in either direction: back up in the desktop app and restore on the website, or the other way round. The format is in `shared/backup.ts`, which is also the single place that validates a file before anything is changed.

- Restoring **replaces** everything; it does not merge. A file that is not a valid backup changes nothing.
- It stores category keys, not database ids, and every field both sides need: hand-set categories, the businesses you mapped, ones you chose to leave as "other", budgets and the import history.
- A backup from a newer PayMate is refused with a message. A category an older version does not know becomes "other".

## Layout

```
shared/        Used by both targets: categories, insights, the Isracard Excel parser, the backup format
src/           The interface (React). src/web/ is the website's storage: IndexedDB plus the same queries as the desktop app
electron/      The desktop app: main process, SQLite, bank sync, updates
web/public/    Files copied into the website as they are (headers)
tests/         tests/helpers/stores.ts runs the same scenarios against SQLite and the website's logic
```

`src/api.ts` picks the implementation at runtime: the desktop app's bridge, the browser's storage, or the demo. Everything the interface calls is described by `PayMateApi` in `shared/api.ts`; what only the desktop app can do (sync, updates) sits under its optional `desktop` part, and the interface shows those features only when it is there.
