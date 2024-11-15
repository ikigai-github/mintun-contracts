use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/transaction.{Transaction}
use aiken/transaction/credential.{VerificationKey}
use aiken/transaction/value.{PolicyId}
use mintun/collection
use mintun/input as in

/// It is parameterized by a policy id to give it a unique script address
validator delegate_script(
  mint_policy_id: PolicyId,
  delegate: Hash<Blake2b_224, VerificationKey>,
) {
  /// A minting policy that requires all mints come from the parameterized minting policy id or signed by a delegate
  /// who is authorized to mint into the policy. This is mostly so a backend service can make script references without
  /// requiring the collection owner to sign a bunch of transactions.
  /// This derivative mint is useful for minting with the authority of the original minting policy
  /// but minting to its own unique policy id. Main intent is to use this policy to mint tokens
  /// holding script references to the main minting policy.
  mint(_redeemer, _policy_id, self: Transaction) {
    let Transaction { inputs, extra_signatories, .. } = self
    expect Some(_parent_owner_token) =
      in.find_asset(inputs, mint_policy_id, collection.owner_asset_name)

    // Delegate can sign or if delegate is left blank during parameterization this will be equivalent to derivate contract
    let delegate_signed = list.has(extra_signatories, delegate)

    delegate_signed?
  }

  else(_) {
    fail
  }
}
