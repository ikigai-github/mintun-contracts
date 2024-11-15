import * as TOML from 'smol-toml';

export async function getBuildVersion() {
  const file = Bun.file('../contracts/aiken.toml');
  const text = await file.text();
  const parsed = TOML.parse(text);

  return parsed.version;
}

export async function getContractVersion() {
  const file = Bun.file('../contracts/plutus.json');
  const json = await file.json();

  const version = json.preamble.version;

  if (version) {
    return version;
  } else {
    throw new Error('Failed to read plutus.json version');
  }
}

export async function checkVersionsMatch() {
  const buildVersion = getBuildVersion();
  const contractVersion = getContractVersion();

  return buildVersion === contractVersion;
}
