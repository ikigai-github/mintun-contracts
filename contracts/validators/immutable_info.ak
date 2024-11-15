use aiken/transaction.{OutputReference, Transaction}
use aiken/transaction/value.{PolicyId}
use mintun/collection

/// Currently just locks the info token and doesn't let it be spent.  
/// Allows spending of anything else that happens to have landed at this script address.
validator imm_info_script(mint_policy_id: PolicyId) {
  spend(_datum, _redeemer, utxo: OutputReference, self: Transaction) {
    expect Some(info_input) = transaction.find_input(self.inputs, utxo)

    // Don't allow collection info token to be spent. Anything else we don't care about.
    value.quantity_of(
      info_input.output.value,
      mint_policy_id,
      collection.reference_asset_name,
    ) == 0
  }

  else(_) {
    fail
  }
}
