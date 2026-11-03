# PayMate

## Releases

Whenever a change touches the Electron app (`electron/`, `shared/`, or the renderer in `src/`, since the desktop build ships all of it), bump the app version when it is merged to `main`:

- Run `npm version <next> --no-git-tag-version` (patch by default; minor for a new feature the user asks to call one). This updates `package.json` and `package-lock.json`, which sets the exe version.
- Commit it as its own commit named `Release <version>`, the way earlier releases were done.
- Changes that only affect the website (`web/`) or docs need no bump.
