import { parseArgs } from 'util';
import { semver } from 'bun';
import * as TOML from 'smol-toml';

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    version: {
      short: 'v',
      type: 'string',
    },
  },
  strict: true,
  allowPositionals: true,
});

if (!values.version) {
  console.log('Must specify a version');
  console.log('Example: `bun run bump-contract-version.ts -v 3.2.3`');
  throw new Error('Must Specify a version');
}

console.log('Updating contract version...');

const newVersion = values.version;
const file = Bun.file('../contracts/aiken.toml');
const original = await file.text();
const parsed = TOML.parse(original);
const oldVersion = parsed.version;
if (semver.order(newVersion, oldVersion) <= 0) {
  throw new Error('Must increment the version.');
}
parsed.version = newVersion;
const updated = TOML.stringify(parsed);
Bun.write(file, updated);

console.log(`Old Version: ${oldVersion}, New version: ${newVersion}`);
