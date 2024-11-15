//// Utils for searching through inputs for various use cases.

use aiken/list
use aiken/transaction.{Input}
use aiken/transaction/value.{AssetName, PolicyId}

pub fn find_asset(
  inputs: List<Input>,
  policy_id: PolicyId,
  asset_name: AssetName,
) {
  list.find(
    inputs,
    fn(input) {
      value.quantity_of(input.output.value, policy_id, asset_name) > 0
    },
  )
}
