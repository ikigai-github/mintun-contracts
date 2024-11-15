import * as Client from '@web3-storage/w3up-client';
import { Signer } from '@web3-storage/w3up-client/principal/ed25519';
import * as Proof from '@web3-storage/w3up-client/proof';
import { StoreMemory } from '@web3-storage/w3up-client/stores/memory';

import { checkVersionsMatch } from './check-version';

export async function uploadContracts() {
  const versionsMatch = checkVersionsMatch();

  if (!versionsMatch) {
    throw new Error(
      'The aiken.toml and the plutus.json version files do not match.  Did you run build the contracts after bumping the version?'
    );
  }
  
  console.log('Uploading latest contracts to IPFS...');
  const key = process.env.W3_KEY;

  if (!key) {
    throw new Error('key must be set to create a server client to web3.storage');
  }

  // Loading from file because this proof a very large base64 string that gets truncated
  // somewhere (bun or OS) to 4096 characters.
  const proof = await Bun.file('proof.txt').text();
  const principal = Signer.parse(key);
  const store = new StoreMemory();
  const client = await Client.create({ principal, store });
  const parsed = await Proof.parse(proof);
  const space = await client.addSpace(parsed);

  await client.setCurrentSpace(space.did());

  const file = Bun.file('../contracts/plutus.json');
  const link = await client.uploadFile(file);
  const cid = link.toString();

  console.log(`Latest contracts uploaded with cid: ${cid}`);
  const contractFile = Bun.file('../offchain/src/contracts-url.ts');
  Bun.write(contractFile, `export default 'https://${cid}.ipfs.w3s.link'`);
}
