/// Well defined Cardano policy id length in bytes
export const POLICY_ID_BYTE_LENGTH = 28;

export type TimeWindow = {
  fromMs: number;
  toMs: number;
};

// Transaction metdata can be
//   integer: -(2^64 - 1) to 2^65 -1
//   string: utf8
//   byte string: hex encoded string with 0x prefix
//   list: []
//   map: {}
// It can't be a boolean can use 1 or 0 for that though.
// It can't have null so those should just become undefined (optional fields)
export type TxMetadataPrimitive = number | string;
export type TxMetadataArray = number[] | string[];
export type TxMetadataRecord = Record<string, TxMetadataPrimitive> | Record<string, TxMetadataArray>;
export type TxMetadata = TxMetadataPrimitive | TxMetadataRecord | Record<string, TxMetadataRecord>;
