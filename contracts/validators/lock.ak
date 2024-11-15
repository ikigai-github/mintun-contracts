use aiken/transaction/value.{PolicyId}

/// This is parameterized by a policy id to give it a unique script address
validator lock_script(_mint_policy_id: PolicyId) {
  /// A spending validator that locks all assets at its address.
  spend(_datum, _redeemer, _utxo, _self) {
    False
  }

  else(_) {
    fail
  }
}
