use aiken/transaction/credential.{Address}

/// CIP-102 Royalty token asset name
pub const royalty_token_asset_name = #"001f4d70526f79616c7479"

/// The CIP-102 defined structure for a royalty recipient
pub type RoyaltyRecipient {
  address: Address,
  /// Variable fee to be collected. Computed as floor(1 / (fee / 10))
  fee: Int,
  /// Minimum fee to be collected as royalties in lovelace
  min_fee: Option<Int>,
  /// Maximum fee to be colleted as royalties in lovelace
  max_fee: Option<Int>,
}

/// The CIP-68 metadata structure with royalty recipients as the metadata
pub type RoyaltyTokenData {
  metadata: List<RoyaltyRecipient>,
  version: Int,
  extra: Data,
}
