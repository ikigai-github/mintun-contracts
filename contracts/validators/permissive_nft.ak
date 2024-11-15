use aiken/transaction.{OutputReference, Transaction}
use aiken/transaction/value.{PolicyId}
use mintun/cip68
use mintun/collection
use mintun/input as in
use mintun/output as out

/// Validator that allows holder of collection management token to modify the datum of an NFT.
/// It fully permissive meaning they could modify the datum to anything. 
/// The only requirement is that the reference token stays at the validator address.
validator perm_nft_script(mint_policy_id: PolicyId) {
  spend(_datum, _redeemer, utxo: OutputReference, self: Transaction) {
    let Transaction { inputs, outputs, .. } = self

    expect Some(spent_utxo_input) = transaction.find_input(inputs, utxo)

    expect Some(_owner_token) =
      in.find_asset(inputs, mint_policy_id, collection.owner_asset_name)

    // Should only be one reference token from the policy in th transaction
    expect [spent_utxo_output] =
      out.match_label(outputs, mint_policy_id, cip68.reference_token_label)

    let spends_back_to_validator =
      spent_utxo_input.output.address == spent_utxo_output.address

    spends_back_to_validator?
  }

  else(_) {
    fail
  }
}
