import { Emulator, generateSeedPhrase, type Assets, type Lucid, type Tx } from 'lucid-cardano';
import { expect } from 'vitest';

import { extractCollectionInfo } from './collection-info';
import { extractCollectionState } from './collection-state';
import {
  createMintingPolicyReference,
  createStateValidatorReference,
  fetchMintingPolicyReferenceUtxo,
  fetchStateValidatorReferenceUtxo,
} from './contract';
import { MintunNft } from './nft';
import { fetchInfoUtxo, fetchOwnerUtxo, fetchStateUtxo, ScriptCache } from './script';
import { submit } from './utils';

/// Creates a new emulator account with the given assets, if any.
export async function generateEmulatorAccount(lucid: Lucid, assets: Assets = {}) {
  const seedPhrase = generateSeedPhrase();

  lucid.selectWalletFromSeed(seedPhrase);
  const address = await lucid.wallet.address();

  return {
    seedPhrase,
    address,
    assets,
  };
}

/// Instantiates an instace of Lucid with an Emulator as the provider.  The emulator is seeded with two starting accounts with one of them preselected.
export async function createEmulatorLucid() {
  const { Lucid } = await import('lucid-cardano');

  const customLucid = await Lucid.new(undefined, 'Custom');

  const ACCOUNT_0 = await generateEmulatorAccount(customLucid, { lovelace: 7_500_0000_000n });
  const ACCOUNT_1 = await generateEmulatorAccount(customLucid, { lovelace: 100_000_000n });
  const ACCOUNT_2 = await generateEmulatorAccount(customLucid, { lovelace: 10_000_000n });
  const ACCOUNT_3 = await generateEmulatorAccount(customLucid, { lovelace: 10_000_000n });

  const emulator = new Emulator([ACCOUNT_0, ACCOUNT_1]);
  const lucid = await Lucid.new(emulator);
  lucid.selectWalletFromSeed(ACCOUNT_0.seedPhrase);

  const utxos = await lucid.wallet.getUtxos();
  expect(utxos.length > 0, 'Wallet must have at least one UTXO for this test');
  const seedUtxo = utxos[0];

  return {
    lucid,
    emulator,
    accounts: [ACCOUNT_0, ACCOUNT_1, ACCOUNT_2, ACCOUNT_3],
    seedUtxo,
  };
}

export async function applyScriptRefTx(lucid: Lucid, cache: ScriptCache) {
  const mintReferenceTx = await createMintingPolicyReference(lucid, cache);
  const mintReferenceTxHash = await submit(mintReferenceTx);
  await lucid.awaitTx(mintReferenceTxHash);

  const stateReferenceTx = await createStateValidatorReference(lucid, cache);
  const stateReferenceTxHash = await submit(stateReferenceTx);
  await lucid.awaitTx(stateReferenceTxHash);

  // Use cache utils to check to tokens were distributed as expected
  const mintScriptReferenceUtxo = await fetchMintingPolicyReferenceUtxo(cache);
  expect(mintScriptReferenceUtxo, 'Failed to create a minting policy script reference utxo');

  const stateScriptReferenceUtxo = await fetchStateValidatorReferenceUtxo(cache);
  expect(stateScriptReferenceUtxo, 'Failed to create a state validator script reference utxo');

  // NOTE: Typescript won't detect that the vitest expect will terminate the
  //       function early so we use ! to manually indicate that is the case
  return {
    mintReferenceTxHash,
    stateReferenceTxHash,
    mintScriptReferenceUtxo: mintScriptReferenceUtxo!,
    stateScriptReferenceUtxo: stateScriptReferenceUtxo!,
  };
}

export async function applyTx(lucid: Lucid, tx: Tx, cache: ScriptCache) {
  const txHash = await submit(tx);
  await lucid.awaitTx(txHash);

  // Use cache utils to check to tokens were distributed as expected
  const stateUtxo = await fetchStateUtxo(cache);
  expect(stateUtxo, 'Must be a state utxo');

  const infoUtxo = await fetchInfoUtxo(cache);
  expect(infoUtxo, 'Must be an info utxo.');

  const { utxo: ownerUtxo } = await fetchOwnerUtxo(cache);
  expect(ownerUtxo, 'Must have found the owner utxo');

  // NOTE: Typescript won't detect that the vitest expect will terminate the
  //       function early so we use ! to manually indicate that is the case
  const state = await extractCollectionState(lucid, stateUtxo!);
  const info = await extractCollectionInfo(lucid, infoUtxo!);

  return { txHash, stateUtxo: stateUtxo!, ownerUtxo: ownerUtxo!, infoUtxo: infoUtxo!, state, info };
}

let nftId = 0;
export function generateNft(): MintunNft {
  const id = '#' + nftId.toString().padStart(4, '0');
  nftId += 1;

  return {
    name: `Generated ${id}`,
    image: `https://picsum.photos/200`,
    description: 'This is a generated test NFT',
    id,
    files: [
      {
        name: `Image ${id}`,
        mediaType: 'image/jpeg',
        src: 'https://picsum.photos/200',
        dimension: { width: 200, height: 200 },
        purpose: 'General',
      },
    ],
    traits: {
      test: 1,
    },
    tags: ['generated', 'test'],
  };
}
