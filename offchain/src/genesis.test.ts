import { expect, test } from 'vitest';

import { TEST_COLLECTION_INFO } from './fixtures.test';
import { GenesisTxBuilder } from './genesis';
import { applyTx, createEmulatorLucid } from './support.test';

test('Minimal minting policy genesis transaction', async () => {
  const { lucid, seedUtxo } = await createEmulatorLucid();
  const { tx, cache } = await GenesisTxBuilder.create(lucid)
    .info({ name: 'No Constraints', nsfw: false })
    .seed(seedUtxo)
    .build();

  // Check the state is on the datum as expected
  const { state, info } = await applyTx(lucid, tx, cache);
  expect(state.info.group).toBeUndefined();
  expect(state.info.mintWindow).toBeUndefined();
  expect(state.info.maxNfts).toBeUndefined();
  expect(state.nfts).toEqual(0);
  expect(state.locked).toEqual(false);
  expect(state.nextSequence).toEqual(0);
  expect(state.info.nftValidatorAddress).toEqual(cache.immutableNft().address);
  expect(info.name).toEqual('No Constraints');
});

test('All configuration genesis transaction', async () => {
  const { lucid, seedUtxo, accounts } = await createEmulatorLucid();
  // Use different address than selected wallet (account 0)
  const ownerAddress = accounts[1].address;
  const royaltyTokenAddress = accounts[3].address;
  const endMs = Date.now() + 1_000_000;
  const groupPolicyId = 'de2340edc45629456bf695200e8ea32f948a653b21ada10bc6f0c554';
  const { tx, cache } = await GenesisTxBuilder.create(lucid)
    .seed(seedUtxo)
    .group(groupPolicyId)
    .maxNfts(1)
    .mintWindow(0, endMs)
    .useImmutableNftValidator()
    .royaltyValidatorAddress(royaltyTokenAddress)
    .ownerAddress(ownerAddress)
    .info(TEST_COLLECTION_INFO)
    .useCip88(true)
    .royalty(accounts[0].address, 4.3)
    .build();

  // Check the state is on the datum as expected
  const { state, info } = await applyTx(lucid, tx, cache);
  expect(info.name === TEST_COLLECTION_INFO.name);
  expect(info.artist === TEST_COLLECTION_INFO.artist);
  expect(info.description === TEST_COLLECTION_INFO.description);
  expect(info.images?.[0].src === TEST_COLLECTION_INFO.images?.[0].src);
  expect(state.info.mintWindow && state.info.mintWindow.fromMs === 0 && state.info.mintWindow.toMs === endMs);
  expect(state.info.maxNfts === 1);
});

test('Builder errors during build', async () => {
  const { lucid } = await createEmulatorLucid();

  // End time <= Start Time
  expect(() => {
    GenesisTxBuilder.create(lucid).mintWindow(0, 0);
  }).toThrowError();

  // Invalid policy id
  expect(() => {
    GenesisTxBuilder.create(lucid).group('This is not a 28 byte hex string');
  }).toThrowError();

  // Same address twice
  expect(() => {
    GenesisTxBuilder.create(lucid).royalty('addr1superlegit', 10).royalty('addr1superlegit', 10);
  }).toThrowError();

  // Greater than 100%
  expect(() => {
    GenesisTxBuilder.create(lucid).royalty('addr1superlegitA', 60).royalty('addr1superlegitB', 60);
  }).toThrowError();

  // Less that 0.1%
  expect(() => {
    GenesisTxBuilder.create(lucid).royalty('addr1superlegit', 0.01);
  }).toThrowError();

  // Invalid bech32 royalty address (well more invalid)
  expect(() => {
    GenesisTxBuilder.create(lucid).royalty('badnotsuperlegit', 0);
  }).toThrowError();

  // Invalid bech32 recipient
  expect(() => {
    GenesisTxBuilder.create(lucid).ownerAddress('badnotsuperlegit');
  }).toThrowError();
});
