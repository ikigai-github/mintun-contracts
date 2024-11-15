use aiken/dict
use aiken/transaction.{Input, OutputReference, Transaction}
use aiken/transaction/value.{MintedValue, PolicyId}
use mintun/cip68
use mintun/collection.{CollectionState}
use mintun/input as in
use mintun/output as out
use mintun/time

/// Endpoints available to be called on the batch mint spending validator
pub type Endpoint {
  /// Indicates the transaction is for minting or burning 
  EndpointMint

  /// Indicates the transaction is to lock the policy so that no more mints may occur
  EndpointLock
}

validator state_script(mint_policy_id: PolicyId) {
  /// Validates changes to mutable parts of state datum: current nfts, sequence, and locked.
  /// Allows spending anything that is not a state token.
  spend(_datum, endpoint: Endpoint, utxo: OutputReference, self: Transaction) {
    expect Some(state_input) = transaction.find_input(self.inputs, utxo)

    let spends_state =
      value.quantity_of(
        state_input.output.value,
        mint_policy_id,
        collection.state_asset_name,
      ) == 1

    // Only validate spend if it is the state token. If it is anything else we
    // don't care and let it be spent.
    when spends_state is {
      True -> validate_spend(endpoint, self, mint_policy_id, state_input)
      False -> True
    }
  }

  else(_) {
    fail
  }
}

fn validate_spend(
  endpoint: Endpoint,
  transaction: Transaction,
  mint_policy_id: PolicyId,
  state_input: Input,
) {
  let Transaction { inputs, outputs, mint, .. } = transaction
  // Make sure the (111)(Management)Collection token for that minting policy is also spent 
  expect Some(_owner_token) =
    in.find_asset(inputs, mint_policy_id, collection.owner_asset_name)

  // Previous state should be stored on the datum of the state reference input
  let input_data =
    collection.state_from_datum(transaction, state_input.output.datum)

  let CollectionState { info, force_locked, .. } = input_data

  // Ensure that the state tokens validity range constraint is met, if that constraint exists.
  let mint_window_valid =
    time.contains(transaction.validity_range, info.mint_window)

  // If the contract is locked you can no longer spend the reference token (which means you can't update the datum)
  let contract_is_not_locked = force_locked == False

  // Get the output where the reference token is sent
  expect Some(state_output) =
    out.find_asset(outputs, mint_policy_id, collection.state_asset_name)

  // Verify it is spent back to this spending validator
  let spends_back_to_validator =
    state_input.output.address == state_output.address

  // Finally we can verify the datum
  let output_data = collection.state_from_datum(transaction, state_output.datum)

  expect and {
      mint_window_valid?,
      contract_is_not_locked?,
      spends_back_to_validator,
    }
  when endpoint is {
    EndpointMint -> validate_mint(mint, mint_policy_id, input_data, output_data)
    EndpointLock -> validate_lock(mint, input_data, output_data)
  }
}

fn validate_lock(
  mint: MintedValue,
  input_data: CollectionState,
  output_data: CollectionState,
) {
  let nothing_minted = mint |> value.from_minted_value() |> value.is_zero()
  let info_unchanged = input_data.info == output_data.info
  let lock_enabled = output_data.force_locked == True
  let count_unchanged = output_data.nfts == input_data.nfts
  let sequence_unchanged = output_data.next_sequence == input_data.next_sequence

  and {
    nothing_minted?,
    info_unchanged?,
    lock_enabled?,
    count_unchanged?,
    sequence_unchanged?,
  }
}

/// This function confirms that only the stateful count and sequence values are updated and nothing else.
/// The count and sequence values are also checked to make sure they align with number of assets minted/burned.
fn validate_mint(
  mint: MintedValue,
  mint_policy_id: PolicyId,
  input_data: CollectionState,
  output_data: CollectionState,
) {
  let (mints, burns) = count_mints(mint, mint_policy_id)
  trace string.concat(@"Mint count is ", string.from_int(mints))
  trace string.concat(@"Burn count is ", string.from_int(burns))

  let current_nfts = input_data.nfts + mints - burns
  let next_sequence = input_data.next_sequence + mints

  // Make sure the mints will not cause the sequence number to overflow its max value
  let sequence_has_not_overflowed = next_sequence < collection.overflow_sequence
  expect sequence_has_not_overflowed?
  // Check that the output count hasn't exceeded max token count
  expect
    when input_data.info.max_nfts is {
      Some(max_nfts) -> current_nfts <= max_nfts
      None -> True
    }
  // Give each validation a name for easier tracing
  let info_unchanged = input_data.info == output_data.info
  let lock_unchanged = output_data.force_locked == input_data.force_locked
  let updated_nft_count_correct = output_data.nfts == current_nfts
  let updated_sequence_correct = output_data.next_sequence == next_sequence

  // Validate the output state has only mutated the token count and updated the next sequence
  and {
    info_unchanged?,
    lock_unchanged?,
    updated_nft_count_correct?,
    updated_sequence_correct?,
  }
}

/// Count the number of tokens minted or burned at the batch mint policy_id
fn count_mints(mint: MintedValue, mint_policy_id: PolicyId) {
  let values = value.from_minted_value(mint)
  let tokens = value.tokens(values, mint_policy_id)

  // Must mint at least one token with the batch mint policy
  expect dict.is_empty(tokens) |> not()
  // Tally the minted and burned NFTs (just counting user token mints/burns)
  dict.foldl(
    tokens,
    (0, 0),
    fn(asset_name, quantity, sums) {
      let (mints, burns) = sums
      if cip68.has_label(asset_name, cip68.nft_user_token_label) {
        if quantity == 1 {
          (mints + 1, burns)
        } else if quantity == -1 {
          (mints, burns + 1)
        } else {
          // Should never be the case mint or burn is not +/- 1
          fail
        }
      } else {
        (mints, burns)
      }
    },
  )
}
