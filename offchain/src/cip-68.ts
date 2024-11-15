// Schema for cip-68 reference token metadata
import { Data } from './data';

export const REFERENCE_DATA_VERSION = 1n;
export const REFERENCE_TOKEN_LABEL = 100;
export const NFT_TOKEN_LABEL = 222;

/// Creates reference data from given metadata. Any strings will be hex encoded unless they start with 0x
export function createReferenceData<T>(metadata: T, extra: Data = '') {
  return {
    metadata: metadata,
    version: REFERENCE_DATA_VERSION,
    extra: extra,
  };
}

export type CollectionReferenceData<T> = ReturnType<typeof createReferenceData<T>>;

// TODO: Check if it would be better to not assume a map at all and use an array of tuples
export const NftMetadataFileSchema = Data.Map(Data.Bytes(), Data.Any());
export type NftMetadataFileType = Data.Static<typeof NftMetadataFileSchema>;
export const NftMetadataFileShape = NftMetadataFileSchema as unknown as NftMetadataFileType;

export const NftMetadataSchema = Data.Map(Data.Bytes(), Data.Any());
export type NftMetadataType = Data.Static<typeof NftMetadataSchema>;
export const NftMetadataShape = NftMetadataSchema as unknown as NftMetadataType;

export const NftMetadataWrappedSchema = Data.Object({
  metadata: NftMetadataSchema,
  version: Data.Integer({ minimum: 1 }),
  extra: Data.Any(),
});
export type NftMetadataWrappedType = Data.Static<typeof NftMetadataWrappedSchema>;
export const NftMetadataWrappedShape = NftMetadataWrappedSchema as unknown as NftMetadataWrappedType;
