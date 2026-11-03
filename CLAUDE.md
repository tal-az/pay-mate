# PayMate

## Releases

Whenever a change touches the Electron app (`electron/`, `shared/`, or the renderer in `src/`, since the desktop build ships all of it), bump the app version when it is merged to `main`:

- Run `npm version <next> --no-git-tag-version` (patch by default; minor for a new feature the user asks to call one). This updates `package.json` and `package-lock.json`, which sets the exe version.
- Commit it as its own commit named `Release <version>`, the way earlier releases were done.
- Changes that only affect the website (`web/`) or docs need no bump.

The installer is built by GitHub Actions, not locally. `.github/workflows/release.yml` builds the Windows exe and publishes a GitHub release when a `v*` tag is pushed, and installed apps update from that release. `ci.yml` only checks that both targets build; it does not produce an installer.

So every merge to `main` that bumped the version must also be tagged and the tag pushed, right after the merge is pushed:

```bash
git tag v<version> <merge commit> && git push origin v<version>
```

The tag must match `package.json`'s version. If the release did not start, run it by hand with `gh workflow run release.yml -f tag=v<version>`.
