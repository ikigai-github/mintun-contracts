/// Off chain representation of a NFT royalty
export type Royalty = {
  /// Bech32 address of the beneficiary of the royalty
  address: string;
  /// Variable fee percentage applied if it is within any defined min/max bounds.
  /// Percent is a value between 0 and 100 inclusive.
  variableFee: number;
  /// Minimum lovelace to be paid as royalty
  minFee?: number;
  /// Maximum lovelace to be paid as royalty
  maxFee?: number;
};
