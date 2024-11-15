import { fromText, toText, type Lucid, type UTxO } from 'lucid-cardano';

import { toBech32Address } from './aiken';
import { createReferenceData } from './cip-68';
import { fromChainVariableFee, RoyaltyInfoShape, RoyaltyInfoType, toRoyaltyUnit } from './cip-102';
import { Data } from './data';
import { IMAGE_PURPOSE, ImageDimension, ImagePurpose } from './image';
import { Royalty } from './royalty';
import { ScriptCache } from './script';
import { asChunkedHex, toJoinedText } from './utils';

/// On chain data schema for image purpose
export const CollectionImagePurposeSchema = Data.Enum([
  Data.Literal(IMAGE_PURPOSE.Thumbnail),
  Data.Literal(IMAGE_PURPOSE.Banner),
  Data.Literal(IMAGE_PURPOSE.Brand),
  Data.Literal(IMAGE_PURPOSE.Gallery),
  Data.Literal(IMAGE_PURPOSE.General),
]);

/// Onchain data schema for image dimensions
export const CollectionImageDimensionsSchema = Data.Object({
  width: Data.Integer({ minimum: 1 }),
  height: Data.Integer({ minimum: 1 }),
});

// On chain data schema for a collection image with hints
export const CollectionImageSchema = Data.Object({
  purpose: Data.Nullable(CollectionImagePurposeSchema),
  dimension: Data.Nullable(CollectionImageDimensionsSchema),
  media_type: Data.Nullable(Data.Bytes()),
  src: Data.Array(Data.Bytes()),
});

export type CollectionImageType = Data.Static<typeof CollectionImageSchema>;
export const CollectionImageShape = CollectionImageSchema as unknown as CollectionImageType;

/// On chain schema for the collection market information.
export const CollectionInfoSchema = Data.Object({
  name: Data.Bytes(),
  artist: Data.Nullable(Data.Bytes()),
  project: Data.Nullable(Data.Bytes()),
  nsfw: Data.Boolean(),
  description: Data.Array(Data.Bytes()),
  images: Data.Array(CollectionImageSchema),
  links: Data.Map(Data.Bytes(), Data.Array(Data.Bytes())),
  traits: Data.Array(Data.Bytes()),
  extra: Data.Map(Data.Bytes(), Data.Any()),
});

export type CollectionInfoType = Data.Static<typeof CollectionInfoSchema>;
export const CollectionInfoShape = CollectionInfoSchema as unknown as CollectionInfoType;

export const CollectionInfoMetadataSchema = Data.Object({
  metadata: CollectionInfoSchema,
  version: Data.Integer({ minimum: 1 }),
  extra: Data.Any(),
});
export type CollectionInfoMetadataType = Data.Static<typeof CollectionInfoMetadataSchema>;
export const CollectionInfoMetadataShape = CollectionInfoMetadataSchema as unknown as CollectionInfoMetadataType;

/// An image with hints for its format, purpose, and dimensions
export type CollectionImage = {
  purpose?: ImagePurpose;
  dimension?: ImageDimension;
  mediaType?: string;
  src: string;
};

/// The collection information in offchain format.
export type CollectionInfo = {
  name: string;
  artist?: string;
  project?: string;
  nsfw: boolean;
  description?: string;
  images?: CollectionImage[];
  traits?: string[];
  links?: Record<string, string>;
  extra?: Record<string, unknown>;
};

export function asChainCollectionImage(image: CollectionImage): CollectionImageType {
  const purpose = image.purpose ?? null;
  const dimension = image.dimension
    ? { width: BigInt(image.dimension.width), height: BigInt(image.dimension.height) }
    : null;
  const media_type = image.mediaType ? fromText(image.mediaType) : null;
  const src = asChunkedHex(image.src);

  return {
    purpose,
    dimension,
    media_type,
    src,
  };
}

export function toCollectionImage(chainImage: CollectionImageType): CollectionImage {
  const purpose = chainImage.purpose ?? undefined;
  const dimension = chainImage.dimension
    ? { width: Number(chainImage.dimension.width), height: Number(chainImage.dimension.height) }
    : undefined;
  const mediaType = chainImage.media_type ? toText(chainImage.media_type) : undefined;
  const src = toJoinedText(chainImage.src);

  return {
    purpose,
    dimension,
    mediaType,
    src,
  };
}

export function asChainCollectionInfo(info: CollectionInfo): CollectionInfoMetadataType {
  const name = fromText(info.name);
  const artist = info.artist ? fromText(info.artist) : null;
  const project = info.project ? fromText(info.project) : null;
  const nsfw = info.nsfw ? true : false;
  const description = info.description ? asChunkedHex(info.description) : [];
  const images = info.images ? info.images.map(asChainCollectionImage) : [];
  const traits = info.traits ? info.traits.map(fromText) : [];
  const links = new Map<string, string[]>();

  if (info.links) {
    for (const [key, value] of Object.entries(info.links)) {
      links.set(fromText(key), asChunkedHex(value));
    }
  }

  const extra = new Map<string, Data>();

  const metadata = {
    name,
    artist,
    project,
    nsfw,
    description,
    images,
    links,
    traits,
    extra,
  };

  return createReferenceData(metadata);
}

export function toCollectionInfo(chainInfo: CollectionInfoMetadataType): CollectionInfo {
  const { metadata } = chainInfo;
  const name = toText(metadata.name);
  const artist = metadata.artist ? toText(metadata.artist) : undefined;
  const project = metadata.project ? toText(metadata.project) : undefined;
  const nsfw = metadata.nsfw;
  const description = metadata.description.length ? toJoinedText(metadata.description) : undefined;
  const images = metadata.images.length ? metadata.images.map(toCollectionImage) : undefined;
  const traits = metadata.traits.length ? metadata.traits.map(toText) : undefined;

  let links: Record<string, string> | undefined = undefined;
  if (metadata.links) {
    links = {};

    for (const [key, value] of metadata.links) {
      links[toText(key)] = toJoinedText(value);
    }
  }

  let extra: Record<string, Data> | undefined = undefined;
  if (chainInfo.extra) {
    extra = {};

    for (const [key, value] of metadata.extra) {
      extra[toText(key)] = value;
    }
  }

  return {
    name,
    artist,
    project,
    nsfw,
    description,
    images,
    links,
    traits,
    extra,
  };
}

// Decode CBOR datum of passed in UTxO and then convert the plutus data into offchain data
export async function extractCollectionInfo(lucid: Lucid, utxo: UTxO) {
  const chainInfo = await lucid.datumOf(utxo, CollectionInfoMetadataShape);
  return toCollectionInfo(chainInfo);
}

export function toRoyaltyInfo(lucid: Lucid, chainInfo: RoyaltyInfoType): Royalty[] {
  const { metadata } = chainInfo;
  let royalties: Royalty[] = [];
  metadata.forEach((royalty) => {
    royalties.push({
      address: toBech32Address(lucid, royalty.address),
      variableFee: fromChainVariableFee(royalty.variableFee),
      minFee: royalty.minFee ? Number(royalty.minFee) : undefined,
      maxFee: royalty.maxFee ? Number(royalty.maxFee) : undefined,
    });
  });

  return royalties;
}

export async function extractRoyaltyInfo(lucid: Lucid, policy: string) {
  try {
    const utxo = await lucid.utxoByUnit(toRoyaltyUnit(policy));
    if (utxo) {
      const chainInfo = await lucid.datumOf(utxo, RoyaltyInfoShape);
      return toRoyaltyInfo(lucid, chainInfo);
    } else return undefined;
  } catch (err) {
    console.log('Error getting royalties');
    console.log(err);
  }
  return undefined;
}

export async function fetchCollectionInfo(cache: ScriptCache) {
  const lucid = cache.lucid();
  const unit = cache.unit().info;
  const utxo = await lucid.utxoByUnit(unit);
  if (utxo) {
    return extractCollectionInfo(lucid, utxo);
  } else {
    return undefined;
  }
}
