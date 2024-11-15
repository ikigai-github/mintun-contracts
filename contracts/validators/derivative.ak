use aiken/transaction.{Transaction}
use aiken/transaction/value.{PolicyId}
use mintun/collection
use mintun/input as in

/// It is parameterized by a policy id to give it a unique script address
validator derivative_script(mint_policy_id: PolicyId) {
  /// A minting policy that requires all mints come from the parameterized minting policy id.
  /// This derivative mint is useful for minting with the authority of the original minting policy
  /// but minting to its own unique policy id.  Main intent is to use this policy to mint tokens
  /// holding script references to the main minting policy.
  mint(_redeemer, _policy_id, self: Transaction) {
    expect Some(_parent_owner_token) =
      in.find_asset(self.inputs, mint_policy_id, collection.owner_asset_name)
    True
  }

  else(_) {
    fail
  }
}
