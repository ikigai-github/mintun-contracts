import { SemVer, type ReleaseType } from 'semver';
import * as TOML from 'smol-toml';

export async function bumpVersion(release: ReleaseType) {
  const file = Bun.file('../contracts/aiken.toml');
  const original = await file.text();
  const parsed = TOML.parse(original);

  const version = new SemVer(parsed.version.toString());
  version.inc(release);
  parsed.version = version.format();
  const updated = TOML.stringify(parsed);
  Bun.write(file, updated);
}
