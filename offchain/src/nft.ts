import { fromText, Lucid, toLabel, UTxO, type Address, type Assets } from 'lucid-cardano';

import {
  createReferenceData,
  NftMetadataShape,
  NftMetadataType,
  NftMetadataWrappedShape,
  NftMetadataWrappedType,
  REFERENCE_TOKEN_LABEL,
} from './cip-68';
import { COLLECTION_TOKEN_PURPOSE, toNftReferenceAssetName, toNftUserAssetName, toPurposeHex } from './collection';
import { TxMetadataPrimitive } from './common';
import { Data } from './data';
import { IMAGE_PURPOSE, ImageDimension, ImagePurpose } from './image';
import { chunk, removeEmpty } from './utils';

// Expands on CIP-25/68 File with dimension and purpose fields
type MintunFile = {
  name?: string;
  mediaType: string;
  src: string;
  dimension?: ImageDimension;
  purpose?: ImagePurpose;
};

type MintunChainFile = Omit<MintunFile, 'src'> & { src: string[] };

export type MintunNftTraits = Record<string, TxMetadataPrimitive>;

// Exands on CIP/25 metadata with id, attributes, and tags.
export type MintunNft = {
  name: string;
  image: string;
  mediaType?: string;
  description?: string;
  files?: MintunFile[];
  id?: string;
  traits?: MintunNftTraits;
  tags?: string[];
};

type MintunChainNft = Omit<MintunNft, 'description' | 'files'> & {
  description?: string[];
  files?: MintunChainFile[];
};

export type AddressedNft = { metadata: MintunNft; recipient?: string };

type ReferencePayout = {
  unit: string;
  address: string;
  chainData: NftMetadataWrappedType;
};

type UserPayouts = {
  [address: string]: string[];
};

type Cip25Metadata = Record<string, MintunNft>;

type PreparedAssets = {
  userMints: Assets;
  userPayouts: UserPayouts;
  referenceMints: Assets;
  referencePayouts: ReferencePayout[];
  cip25Metadata: Cip25Metadata;
};

// Not sure on the usefulness of this builder but eh I made it.
export class NftBuilder {
  #nft: Partial<MintunNft> = {};

  private constructor() {}

  static nft(name: string) {
    const builder = new NftBuilder();
    builder.#nft.name = name;
    return builder;
  }

  thumbnail(src: string, mediaType: string, dimension: ImageDimension | undefined = undefined) {
    return this.image(src, mediaType, IMAGE_PURPOSE.Thumbnail, dimension);
  }

  image(
    src: string,
    mediaType: string,
    purpose: ImagePurpose | undefined = undefined,
    dimension: ImageDimension | undefined = undefined
  ) {
    if (purpose === IMAGE_PURPOSE.Thumbnail) {
      this.#nft.image = src;
      this.#nft.mediaType = mediaType;
    }

    const files = this.#nft.files || [];
    files.push({
      src,
      mediaType,
      purpose,
      dimension,
    });

    this.#nft.files = files;
    return this;
  }

  id(id: string) {
    this.#nft.id = id;
    return this;
  }

  trait(key: string, value: TxMetadataPrimitive) {
    const traits = this.#nft.traits || {};
    traits[key] = value;
    return this.traits(traits);
  }

  traits(traits: MintunNftTraits) {
    this.#nft.traits = traits;
    return this;
  }

  tag(tag: string) {
    const tags = this.#nft.tags || [];
    tags.push(tag);
    return this.tags(tags);
  }

  tags(tags: string[]) {
    this.#nft.tags = tags;
    return this;
  }
}

// Just splits > 64 length strings for cip-25
function asChainNftData(nft: MintunNft) {
  const description = nft.description ? chunk(nft.description) : [];
  const files = nft.files ? nft.files.map((file) => ({ ...file, src: chunk(file.src) })) : [];
  const metadata = { ...nft, description, files };

  // Data.fromJson chokes on null/undefined so remove the empty keys
  removeEmpty(metadata);
  return Data.castFrom<NftMetadataType>(Data.fromJson(metadata), NftMetadataShape);
}

export async function fetchNftReferenceUtxos(lucid: Lucid, policyId: string, address: string) {
  const addressUtxos = await lucid.utxosAt(address);
  const unit = `${policyId}${toLabel(REFERENCE_TOKEN_LABEL)}${toPurposeHex(COLLECTION_TOKEN_PURPOSE.NFT)}`;
  const utxos = [];
  for (const utxo of addressUtxos) {
    if (Object.keys(utxo.assets).find((asset) => asset.startsWith(unit))) {
      utxos.push(utxo);
    }
  }

  return utxos;
}

export async function toNftData(lucid: Lucid, utxo: UTxO): Promise<MintunNft> {
  const { metadata } = await lucid.datumOf(utxo, NftMetadataWrappedShape);
  const nft = Data.toJson(metadata) as MintunChainNft;
  const description = Array.isArray(nft.description) ? nft.description.join('') : undefined;
  const files = nft.files ? nft.files.map((file) => ({ ...file, src: file.src.join('') })) : [];

  return { ...nft, description, files };
}

/// Get NFT units, group them by address
export function prepareAssets(
  nfts: AddressedNft[],
  policyId: string,
  sequence: number,
  defaultRecipientAddress: Address,
  hasRoyalty: boolean,
  nftValidatorAddress?: Address
): PreparedAssets {
  const userMints: Assets = {};
  const userPayouts: UserPayouts = {};
  const referenceMints: Assets = {};
  const cip25Metadata: Cip25Metadata = {};
  const referencePayouts: ReferencePayout[] = [];
  let extra: Data = '';
  if (hasRoyalty) {
    extra = new Map<string, Data>();
    extra.set(fromText('royalty_included'), 1n);
  }

  for (const nft of nfts) {
    const { metadata, recipient } = nft;
    const userAssetName = toNftUserAssetName(sequence, metadata.name);
    const userUnit = policyId + userAssetName;
    const referenceAssetName = toNftReferenceAssetName(sequence, metadata.name);
    const referenceUnit = policyId + referenceAssetName;
    const chainMetadata = asChainNftData(metadata);
    const chainData = createReferenceData(chainMetadata, extra);
    const recipientAdress = recipient ? recipient : defaultRecipientAddress;
    const referencePayoutAddress = nftValidatorAddress ? nftValidatorAddress : recipientAdress;
    const userPayout = userPayouts[recipientAdress] || [];

    userMints[userUnit] = 1n;
    userPayout.push(userUnit);
    userPayouts[recipientAdress] = userPayout;

    referenceMints[referenceUnit] = 1n;
    referencePayouts.push({ unit: referenceUnit, address: referencePayoutAddress, chainData });
    cip25Metadata[userAssetName] = metadata;

    sequence += 1;
  }

  return {
    userMints,
    userPayouts,
    referenceMints,
    referencePayouts,
    cip25Metadata,
  };
}
