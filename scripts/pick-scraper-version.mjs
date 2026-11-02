// Picks the israeli-bank-scrapers version the app should adopt next.
// Rules: same major version as the pinned one, a stable release, newer than the pinned one, and published at
// least MIN_AGE_DAYS ago. The delay gives the community time to notice a compromised or broken release
// before it reaches a machine where card-site passwords are typed.
import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MIN_AGE_DAYS = 7;
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

const parse = (v) => v.match(STABLE).slice(1).map(Number);

function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * @param {{ pinned: string, times: Record<string, string>, now?: Date, minAgeDays?: number }} input
 * @returns {string | null} the version to adopt, or null when nothing qualifies
 */
export function pickVersion({ pinned, times, now = new Date(), minAgeDays = MIN_AGE_DAYS }) {
  if (!STABLE.test(pinned)) return null;
  const [major] = parse(pinned);
  const cutoff = now.getTime() - minAgeDays * 86_400_000;
  const candidates = Object.entries(times)
    .filter(([version]) => STABLE.test(version))
    .filter(([version]) => parse(version)[0] === major && compare(version, pinned) > 0)
    .filter(([, published]) => Date.parse(published) <= cutoff)
    .map(([version]) => version)
    .sort(compare);
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function main() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
  const pinned = pkg.dependencies['israeli-bank-scrapers'];
  const times = JSON.parse(
    execFileSync('npm', ['view', 'israeli-bank-scrapers', 'time', '--json'], { encoding: 'utf-8', shell: process.platform === 'win32' }),
  );
  const version = pickVersion({ pinned, times });
  console.log(version ? `adopt ${version} (pinned ${pinned})` : `nothing to adopt (pinned ${pinned})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version ?? ''}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
