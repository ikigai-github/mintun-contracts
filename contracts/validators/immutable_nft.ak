use aiken/dict
use aiken/transaction.{OutputReference, Transaction}
use aiken/transaction/value.{PolicyId}

/// Validator that doesn't allow spend of tokens with the given minting policy
validator imm_nft_script(mint_policy_id: PolicyId) {
  spend(_datum, _redeemer, utxo: OutputReference, self: Transaction) {
    expect Some(info_input) = transaction.find_input(self.inputs, utxo)

    // Don't allow spending of any tokens from the minting policy
    // Anything else we don't care about
    info_input.output.value |> value.tokens(mint_policy_id) |> dict.is_empty()
  }

  else(_) {
    fail
  }
}
