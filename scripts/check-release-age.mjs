// Fails when any npm package version in the given lockfiles was published
// less than RELEASE_AGE_DAYS (default 7) days ago.
//
//   npm run check:release-age
//
// Opt-in: this fork does not enforce a cooldown. npm's min-release-age
// setting only affects resolving new versions; npm ci installs a lockfile
// as-is, so checking the lockfiles is the way to see what a build pulls in.
import { readFileSync } from "node:fs";

const days = Number(process.env.RELEASE_AGE_DAYS ?? 7);
const cutoff = Date.now() - days * 86400e3;
const lockfiles = process.argv.slice(2);
if (lockfiles.length === 0) {
  console.error("usage: node scripts/check-release-age.mjs <package-lock.json>...");
  process.exit(2);
}

const pkgs = new Map();
for (const file of lockfiles) {
  const lock = JSON.parse(readFileSync(file, "utf8"));
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (!path || meta.link || !meta.version) continue;
    if (!meta.resolved?.startsWith("https://registry.npmjs.org/")) continue;
    const name = meta.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    pkgs.set(`${name}@${meta.version}`, { name, version: meta.version });
  }
}

const young = [];
const failed = [];
const list = [...pkgs.values()];
for (let i = 0; i < list.length; i += 16) {
  await Promise.all(list.slice(i, i + 16).map(async ({ name, version }) => {
    try {
      const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const published = (await res.json()).time?.[version];
      if (!published) throw new Error("no publish time");
      if (Date.parse(published) > cutoff) young.push(`${name}@${version} (published ${published})`);
    } catch (e) {
      failed.push(`${name}@${version}: ${e.message}`);
    }
  }));
}

console.log(`${list.length} packages checked in ${lockfiles.join(", ")}`);
for (const f of failed) console.error(`could not check ${f}`);
for (const y of young.sort()) console.error(`younger than ${days} days: ${y}`);
process.exit(young.length || failed.length ? 1 : 0);
