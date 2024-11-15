//// CIP-68 standard defined types and constants along with some utility functions

use aiken/bytearray.{drop, take}
use aiken/transaction.{Datum, Transaction}
use aiken/transaction/value.{AssetName}
use mintun/data

/// CIP-68 reference token label (100)
pub const reference_token_label = #"000643b0"

/// CIP-68 NFT user token label (222)
pub const nft_user_token_label = #"000de140"

/// Private use token label indicated general purpose token
pub const general_token_label = #"00000000"

/// CIP-102 Royalty token asset_name (500)Royalty
pub const royalty_token_asset_name = #"001f4d70526f79616c7479"

/// CIP-68 Datum base shape for all types of reference tokens
pub type ReferenceTokenData {
  metadata: Data,
  version: Int,
  extra: Data,
}

/// The regular asset name split into label and content parts.
pub type Cip68AssetName {
  label: ByteArray,
  content: ByteArray,
}

/// 222 reference token specific shape.
/// metadata is Pairs<ByteArray, Data> because spec allows including arbitrary extra 
/// data in addition to the standard defined data. 
/// For example, 'name' is in standard but 'traits' is not so we can't have a well 
/// defined index of that field in the metadata.
pub type Reference222TokenData {
  /// A map of metadata field and their values
  metadata: Pairs<ByteArray, Data>,
  /// Version of the reference token metadata
  version: Int,
  /// Any custom data not defined in base standard (ie royalty_included flag from cip-102)
  extra: Data,
}

/// Splits the asset name into label and name without converting to int since usually just 
/// checking the full prefix with 0 pad and crc-8 is sufficient.
pub fn parse_name(name: AssetName) {
  Cip68AssetName { label: take(name, 4), content: drop(name, 4) }
}

/// Checks if the given name starts with the specified label
pub fn has_label(name: AssetName, label: ByteArray) {
  take(name, 4) == label
}

/// Extracts the data from the given datum which must match the general reference token shape
pub fn from_general_reference_datum(
  transaction: Transaction,
  datum: Datum,
) -> ReferenceTokenData {
  expect Some(maybe_reference_token_data) = data.extract(transaction, datum)
  expect reference_token_data: ReferenceTokenData = maybe_reference_token_data
  reference_token_data
}

/// Extracts the data from the given datum which must match the 222 shape.
pub fn from_222_reference_datum(
  transaction: Transaction,
  datum: Datum,
) -> Reference222TokenData {
  expect Some(maybe_reference_token_data) = data.extract(transaction, datum)
  expect reference_token_data: Reference222TokenData =
    maybe_reference_token_data
  reference_token_data
}
