use aiken/bytearray
use aiken/dict
use aiken/list
use aiken/option
use aiken/transaction.{Output}
use aiken/transaction/value.{AssetName, PolicyId}

/// Finds an output where the value includes at least one of the asset.
pub fn find_asset(
  outputs: List<Output>,
  policy_id: PolicyId,
  asset_name: AssetName,
) {
  list.find(
    outputs,
    fn(output) { value.quantity_of(output.value, policy_id, asset_name) > 0 },
  )
}

/// Match outputs that contain assets with the given policy_id and asset name label
pub fn match_label(
  outputs: List<Output>,
  policy_id: PolicyId,
  label: ByteArray,
) -> List<Output> {
  trace @"Finding outputs by label"
  list.filter(
    outputs,
    fn(output) {
      value.tokens(output.value, policy_id)
        |> dict.keys()
        |> list.find(fn(asset_name) { bytearray.take(asset_name, 4) == label })
        |> option.is_some()
    },
  )
}
