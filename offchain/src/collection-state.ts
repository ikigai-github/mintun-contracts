/// On chain schema for the collection state data. For more details on the purpose of the

import { type Lucid, type UTxO } from 'lucid-cardano';

import {
  asChainAddress,
  asChainTimeWindow,
  ChainAddressSchema,
  OutputReferenceSchema,
  PolicyIdSchema,
  PosixTimeIntervalSchema,
  toBech32Address,
  toTimeWindow,
} from './aiken';
import { createReferenceData } from './cip-68';
import { SEQUENCE_MAX_VALUE } from './collection';
import { TimeWindow } from './common';
import { Data } from './data';
import { asChunkedHex, toJoinedText } from './utils';

const CollectionStateInfoSchema = Data.Object({
  contracts_url: Data.Array(Data.Bytes()),
  seed: OutputReferenceSchema,
  group: Data.Nullable(PolicyIdSchema),
  mint_window: Data.Nullable(PosixTimeIntervalSchema),
  max_nfts: Data.Nullable(Data.Integer({ minimum: 1, maximum: SEQUENCE_MAX_VALUE })),
  nft_validator_address: Data.Nullable(ChainAddressSchema),
  script_reference_policy_id: PolicyIdSchema,
});

/// fields see smart contract library docs.
const CollectionStateSchema = Data.Object({
  info: CollectionStateInfoSchema,
  force_locked: Data.Boolean(),
  nfts: Data.Integer({ minimum: 0, maximum: SEQUENCE_MAX_VALUE }),
  next_sequence: Data.Integer({ minimum: 0, maximum: SEQUENCE_MAX_VALUE }),
});

export const COLLECTION_STATE_TOKEN_LABEL = 1;
export const COLLECTION_TOKEN_ASSET_NAME = '00000070436f6c6c656374696f6e';

export type CollectionStateType = Data.Static<typeof CollectionStateSchema>;
export const CollectionStateShape = CollectionStateSchema as unknown as CollectionStateType;

// Wrap state data in CIP-68 reference token schema
export const CollectionStateMetadataSchema = Data.Object({
  metadata: CollectionStateSchema,
  version: Data.Integer({ minimum: 1 }),
  extra: Data.Any(),
});

export type CollectionStateMetadataType = Data.Static<typeof CollectionStateMetadataSchema>;
export const CollectionStateMetadataShape = CollectionStateMetadataSchema as unknown as CollectionStateMetadataType;

export type CollectionStateInfo = {
  contractsUrl: string;
  seed: { hash: string; index: number };
  group?: string;
  mintWindow?: TimeWindow;
  maxNfts?: number;
  nftValidatorAddress?: string;
  scriptReferencePolicyId: string;
};

/// The collection state in offchain format.
export type CollectionState = {
  info: CollectionStateInfo;
  locked: boolean;
  nfts: number;
  nextSequence: number;
};

export function toStateUnit(policyId: string) {
  return policyId + COLLECTION_TOKEN_ASSET_NAME;
}

// Decode CBOR datum of passed in UTxO and then convert the plutus data into offchain data
export async function extractCollectionState(lucid: Lucid, utxo: UTxO) {
  const chainState = await lucid.datumOf(utxo, CollectionStateMetadataShape);
  return toCollectionState(lucid, chainState);
}

/// Convert from on chain plutus data to off chain data structure
export function toCollectionState(lucid: Lucid, chainState: CollectionStateMetadataType): CollectionState {
  const { metadata } = chainState;
  const chainInfo = metadata.info;

  const info: CollectionStateInfo = {
    contractsUrl: toJoinedText(chainInfo.contracts_url),
    seed: { hash: chainInfo.seed.transaction_id.hash, index: Number(chainInfo.seed.output_index) },
    group: chainInfo.group ?? undefined,
    mintWindow: chainInfo.mint_window ? toTimeWindow(chainInfo.mint_window) : undefined,
    maxNfts: chainInfo.max_nfts ? Number(chainInfo.max_nfts) : undefined,
    nftValidatorAddress: chainInfo.nft_validator_address
      ? toBech32Address(lucid, chainInfo.nft_validator_address)
      : undefined,
    scriptReferencePolicyId: chainInfo.script_reference_policy_id,
  };

  const locked = metadata.force_locked;
  const nfts = Number(metadata.nfts);
  const nextSequence = Number(metadata.next_sequence);

  return {
    info,
    locked,
    nfts,
    nextSequence,
  };
}

// Given the initial state creates the genesis data.
export function createGenesisStateData(state: Partial<CollectionState>) {
  const info = asChainStateInfo(state.info);

  const metadata: CollectionStateType = {
    info,
    force_locked: false,
    nfts: 0n,
    next_sequence: 0n,
  };

  return createReferenceData(metadata);
}

function asChainStateInfo(info?: CollectionStateInfo) {
  if (!info) {
    throw new Error('Collection state information must be specified.');
  }

  const contracts_url = asChunkedHex(info.contractsUrl);

  const seed = {
    transaction_id: {
      hash: info.seed.hash,
    },
    output_index: BigInt(info.seed.index),
  };
  const group = info.group ?? null;
  const mint_window = info.mintWindow ? asChainTimeWindow(info.mintWindow.fromMs, info.mintWindow.toMs) : null;
  const max_nfts = info.maxNfts ? BigInt(info.maxNfts) : null;
  const nft_validator_address = info.nftValidatorAddress ? asChainAddress(info.nftValidatorAddress) : null;
  const script_reference_policy_id = info.scriptReferencePolicyId;

  return {
    contracts_url,
    seed,
    group,
    mint_window,
    max_nfts,
    nft_validator_address,
    script_reference_policy_id,
  };
}

// Given the initial state creates the genesis data.
export function asChainStateData(state: CollectionState) {
  const info = asChainStateInfo(state.info);
  const force_locked = state.locked;
  const nfts = BigInt(state.nfts);
  const next_sequence = BigInt(state.nextSequence);

  const metadata: CollectionStateType = {
    info,
    force_locked,
    nfts,
    next_sequence,
  };

  return createReferenceData(metadata);
}

/// Update state and validate the state constraints would not be violated
export function addMintsToCollectionState(state: CollectionState, numMints: number) {
  if (state.locked) {
    throw new Error('The state locked flag is set to true so it cannot be udpated with new mints');
  }

  const now = Date.now();
  if (state.info?.mintWindow && (state.info.mintWindow.fromMs > now || state.info.mintWindow.toMs < now)) {
    throw new Error('The valid mint window for this minting policy has passed. Cannot mint new NFTs.');
  }

  const nextState = {
    ...state,
    nfts: state.nfts + numMints,
    nextSequence: state.nextSequence + numMints,
  };

  if (state.info?.maxNfts && nextState.nfts > state.info.maxNfts) {
    throw new Error('The number of NFTs being minted would exceed the maximum allowed NFTs for this minting policy');
  }

  return nextState;
}
