import { fromText, toLabel, toUnit } from 'lucid-cardano';

import { NFT_TOKEN_LABEL, REFERENCE_TOKEN_LABEL } from './cip-68';

/// Speical collection owner token label.
/// Selected because it has similar pattern to other labels, there is no standard.
export const COLLECTION_OWNER_TOKEN_LABEL = 111;

/// Number of bytes in asset name allocated for a sequence number
export const SEQUENCE_NUM_BYTES = 3;
export const SEQUENCE_MAX_VALUE = Math.pow(256, SEQUENCE_NUM_BYTES);

export const ASSET_NAME_MAX_BYTES = 32;
export const LABEL_NUM_BYTES = 4;
export const PURPOSE_NUM_BYTES = 1;
export const ASSET_NAME_PREFIX_BYTES = SEQUENCE_NUM_BYTES + LABEL_NUM_BYTES + PURPOSE_NUM_BYTES;
export const CONTENT_NAME_MAX_BYTES = ASSET_NAME_MAX_BYTES - ASSET_NAME_PREFIX_BYTES;

/// Currently there are two purposes for a token minted in a collection
/// Management - Management of collection state and minting
/// NFT - A regular minted NFT in the collection with a sequence number
export const COLLECTION_TOKEN_PURPOSE = {
  Management: 'Management',
  NFT: 'NFT',
} as const;

export type CollectionTokenPurpose = keyof typeof COLLECTION_TOKEN_PURPOSE;

/// Convert the sequence number to its on chain hex string
export function toSequenceHex(sequence: number) {
  if (sequence < 0 || sequence > SEQUENCE_MAX_VALUE) {
    throw new Error('Sequence value out of valid range');
  }

  // Return a 3 byte hex string in range (0x000000, 0xFFFFFF)
  return sequence.toString(16).padStart(2 * SEQUENCE_NUM_BYTES, '0');
}

/// Convert the enumerated purpose type to its on chain hex value
export function toPurposeHex(purpose: CollectionTokenPurpose) {
  switch (purpose) {
    case COLLECTION_TOKEN_PURPOSE.Management:
      return '00';
    case COLLECTION_TOKEN_PURPOSE.NFT:
      return '01';
  }
}

/// Construct an asset name from label, sequence, and content name
function toNftAssetName(label: number, sequence: number, content: string) {
  if (content.length > CONTENT_NAME_MAX_BYTES) {
    content = content.substring(0, CONTENT_NAME_MAX_BYTES);
  }

  return `${toLabel(label)}${toPurposeHex(COLLECTION_TOKEN_PURPOSE.NFT)}${toSequenceHex(sequence)}${fromText(content)}`;
}

/// Construct a unit from the collection specific parts that compose the unit name
function toNftUnit(policyId: string, label: number, sequence: number, content: string) {
  return policyId + toNftAssetName(label, sequence, content);
}

/// Construct NFT asset name from label, sequence number, and content label string
export function toNftReferenceAssetName(sequence: number, content: string) {
  return toNftAssetName(REFERENCE_TOKEN_LABEL, sequence, content);
}

/// Construct NFT reference unit from the parts that compose the unit name
export function toNftReferenceUnit(policyId: string, sequence: number, content: string) {
  return toNftUnit(policyId, REFERENCE_TOKEN_LABEL, sequence, content);
}

/// Construct NFT asset name from label, sequence number, and content label string
export function toNftUserAssetName(sequence: number, content: string) {
  return toNftAssetName(NFT_TOKEN_LABEL, sequence, content);
}

/// Construct NFT user unit from the parts that compose the unit name
export function toNftUserUnit(policyId: string, sequence: number, content: string) {
  return toNftUnit(policyId, NFT_TOKEN_LABEL, sequence, content);
}

/// Construct management token unit from policy id and label
function toManageUnit(policyId: string, label: number) {
  const name = `${toPurposeHex(COLLECTION_TOKEN_PURPOSE.Management)}${fromText('Collection')}`;
  return toUnit(policyId, name, label);
}

/// Construct management reference unit from policy id with (100) label
export function toInfoUnit(policyId: string) {
  return toManageUnit(policyId, REFERENCE_TOKEN_LABEL);
}

/// Construct management owner unit from policy id with (111) label
export function toOwnerUnit(policyId: string) {
  return toManageUnit(policyId, COLLECTION_OWNER_TOKEN_LABEL);
}
