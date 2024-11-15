//// 

use aiken/bytearray
use aiken/interval.{Interval}
use aiken/time.{PosixTime}
use aiken/transaction.{Datum, OutputReference, Transaction}
use aiken/transaction/credential.{Address}
use aiken/transaction/value.{AssetName, PolicyId}
use mintun/cip68.{ReferenceTokenData}
use mintun/int

/// (001)Collection State token used by stateful minting contract to track mint count
pub const state_asset_name = #"00000070436f6c6c656374696f6e"

/// Collection managmenent reference token that holds collection metadata in its datum
/// (100)(Management)Collection reference token asset name
pub const reference_asset_name = #"000643b000436f6c6c656374696f6e"

/// (111)(Management)Collection owner/beacon token asset name
/// Note: Picked 111 to indicate new standard user token (vs 222, 444, 333, 500)
pub const owner_asset_name = #"0006f0a000436f6c6c656374696f6e"

/// The sequence number is 3 bytes so any sequence >= 256^3 will overflow.
pub const overflow_sequence = 16_777_216

/// Pixel width and height of an image. 
pub type ImageDimensions {
  /// Pixel width dimension of an image
  width: Int,
  /// Pixel height dimension of an image
  height: Int,
}

/// Hints to marketplaces how this image is intended to be used. 
pub type ImagePurpose {
  /// The image is intended to be displayed as a thumbnail
  Thumbnail
  /// The image is intended to be displayed as a banner
  Banner
  /// The image is intended to be displayed as a Brand Image
  Brand
  /// The image is intended to be displayed in a Gallery
  Gallery
  /// The image has no specific purpose
  General
}

/// Slightly more robust image type that includes a hint at the purpose and dimension of an image
pub type CollectionImage {
  /// A hint at the intend purpose/usage for the image
  purpose: Option<ImagePurpose>,
  /// The dimensions of the image. Can also be used to infer aspect ratio and decide which image to use.
  /// For example, given two banner images a web3 app can pick based on display aspect ratio. 
  dimensions: Option<ImageDimensions>,
  /// The media type of the image should usually start with 'image/'. Not sure it is needed honestly.
  media_type: Option<ByteArray>,
  /// The source of the image. Usually a HTTP URL, though could be a CID or base64 encoded data.  Broken into 64 byte chunks.
  src: List<ByteArray>,
}

/// Datum containing collection information to be used by markets when displaying the collection
pub type CollectionInfo {
  /// The display name of the collection 
  name: ByteArray,
  /// The name of the artist that created the collection
  artist: Option<ByteArray>,
  /// The name of a project that created the collection. Sometimes used in place of a specific artist
  project: Option<ByteArray>,
  /// Flag indicating if the collection is not safe for work
  nsfw: Bool,
  /// Description of the collection in 64 byte chunks
  description: List<ByteArray>,
  /// Supporting images to be used to display the collection 
  images: List<CollectionImage>,
  /// Links to social media and website associated with the project or artist
  links: Pairs<ByteArray, List<ByteArray>>,
  /// Declared traits that NFTs in the collection will contain
  traits: List<ByteArray>,
  /// Anything else not defined in the standard
  extra: Pairs<ByteArray, Data>,
}

pub type CollectionStateInfo {
  // The url for the resource containing the corresponding smart contracts used for this collection.
  contracts_url: List<ByteArray>,
  // The original seed utxo used to create this minting policy.
  seed: OutputReference,
  /// The group that this collection claims to be a part of.
  group: Option<PolicyId>,
  /// The time range in which mints are possible for this collection
  mint_window: Option<Interval<PosixTime>>,
  /// The maximum number of NFTs this collection can contain (by limitation of 3 byte sequence implicit max is 16.7 million)
  max_nfts: Option<Int>,
  /// The address all minted reference tokens must be sent to
  nft_validator_address: Option<Address>,
  /// The policy id that holds script references such as the minting policy and state spending validator.
  script_reference_policy_id: PolicyId,
}

/// State used by the spending validator on the reference token created by collection minting policy 
pub type CollectionState {
  /// All the immutable information about the collection state that will never be modified
  info: CollectionStateInfo,
  /// If true the policy can no longer be used to mint new NFTs though burning is still allowed.
  force_locked: Bool,
  /// The current number of NFTs this collection contains
  nfts: Int,
  /// A monotonically increasing sequence number that increases for every minted NFT. (Used in asset name to Guarantee each NFT is unique)
  next_sequence: Int,
}

/// 
/// Mostly just to give collection management token its own namespace so
/// there is no conflict. It prevents minting a collectable that overlaps 
/// in name with the management token since they both use (100) Reference tokens
pub type CollectionTokenPurpose {
  Management
  NFT
}

/// The asset name split and parsed into it's constiuent parts.
/// For example '000643b0010000024d7920436f6f6c204173736574' is split into: 
///  label = 000643b0 = 100 (plus 0 pads and crc-8 byte) = Reference Token
///  purpose = 01 = NFT
///  sequence = 000002 = 2 
///  content = 4d7920436f6f6c204173736574 = "My Cool Asset"
pub type CollectionName {
  /// The CIP-68 Label part of the asset name
  label: ByteArray,
  /// A reserved 1 byte for flags currently indicating what type (0 -> Management Nft, 1 -> Collectable NFT)
  purpose: CollectionTokenPurpose,
  /// The 3 byte unique sequence number for the asset (meaning there is implicit max of 256^3 Mints)
  sequence: Int,
  /// A UTF-8 string used to make the asset name partially human readable
  content: ByteArray,
}

/// Extracts the data from the given datum and casts it to the reference token shape.
/// Then casts the metadata field of that shape into the collection state shape.
pub fn state_from_datum(
  transaction: Transaction,
  datum: Datum,
) -> CollectionState {
  let reference_token_data =
    cip68.from_general_reference_datum(transaction, datum)
  expect collection_state_data: CollectionState = reference_token_data.metadata

  collection_state_data
}

/// Extracts the data from the given datum to casts it to the reference token shape
/// Then casts the metadata field of that shape into the collection information shape.
pub fn info_from_datum(transaction: Transaction, datum: Datum) -> CollectionInfo {
  let reference_token_data =
    cip68.from_general_reference_datum(transaction, datum)
  expect collection_info_data: CollectionInfo = reference_token_data.metadata

  collection_info_data
}

/// Convert an asset name into its constiuent parts which are the label, sequence number, and content name
pub fn parse_name(name: AssetName) -> CollectionName {
  let label = bytearray.take(name, 4)

  // Right now just bit 40 is set or not set indicates if the purpose is management or nft
  let purpose =
    if bytearray.test_bit(name, 40) == False {
      NFT
    } else {
      Management
    }
  // 3 byte sequence number
  let sequence = int.from_hex_bytes(bytearray.slice(name, 5, 7))

  // Remainder of the array is the content usually just a human readable name for the asset
  let content = bytearray.drop(name, 7)

  CollectionName { label, purpose, sequence, content }
}
