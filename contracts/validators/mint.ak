use aiken/builtin
use aiken/bytearray
use aiken/dict
use aiken/list
use aiken/option
use aiken/transaction.{Input, Output, OutputReference, Transaction}
use aiken/transaction/value.{AssetName, MintedValue, PolicyId}
use mintun/cip102
use mintun/cip68
use mintun/collection.{CollectionName, CollectionState, NFT}
use mintun/input as in

/// The redeemer indicates if this is a genesis transaction, mint, or burn.  
pub type Endpoint {
  /// The genesis transaction must spend the seed UTxO to guarantee it can only be called once.
  EndpointGenesis {
    state_validator_policy_id: PolicyId,
    info_validator_policy_id: PolicyId,
  }
  /// Indicates will mint one or more (222, 100) token pairs
  EndpointMint
  /// Indicates will burn one or more tokens under policy
  EndpointBurn
}

/// Seed is used to make genesis transaction a one-shot
validator mint_script(seed: OutputReference) {
  /// Minting policy validates minted tokens are named in CIP-68 format and output to correct addresses
  /// We could also enforce constraints on datum shape but that may be overkill
  mint(endpoint: Endpoint, policy_id: PolicyId, self: Transaction) {
    trace @"Begin minting policy validation"

    // Branch evaluation based on endpoint being called
    when endpoint is {
      EndpointGenesis(state_validator_policy_id, info_validator_policy_id) ->
        validate_genesis(
          seed,
          self,
          policy_id,
          state_validator_policy_id,
          info_validator_policy_id,
        )
      EndpointMint -> validate_mint(self, policy_id)
      EndpointBurn -> validate_burn(self, policy_id)
    }
  }

  else(_) {
    fail
  }
}

/// Verifies that the seed UTxO is spent.
/// Verifies the minimum required state and user token are generated.
/// Verifies the initial collection state is valid
fn validate_genesis(
  seed: OutputReference,
  tx: Transaction,
  mint_policy_id: PolicyId,
  state_validator_policy_id: PolicyId,
  info_validator_policy_id: PolicyId,
) -> Bool {
  let Transaction { inputs, outputs, mint, .. } = tx
  trace @"Genesis: checking seed UTxO is spent"

  expect Some(_spent_utxo) = transaction.find_input(inputs, seed)
  let tokens = mint |> value.from_minted_value() |> value.tokens(mint_policy_id)
  // Must be exactly one (111)(Management)Collection owner token minted
  expect Some(owner_token_quantity) =
    dict.get(tokens, collection.owner_asset_name)
  let mints_owner_token = owner_token_quantity == 1

  // Must be exactly one (100)(Managment)Collection reference token minted
  expect Some(reference_token_quantity) =
    dict.get(tokens, collection.reference_asset_name)
  let mints_reference_token = reference_token_quantity == 1

  // Must be exactly one (600)State token minted
  expect Some(state_token_quantity) =
    dict.get(tokens, collection.state_asset_name)
  let mints_state_token = state_token_quantity == 1

  let cip_102_token_quantity =
    tokens |> dict.get(cip102.royalty_token_asset_name) |> option.or_else(0)

  let mints_at_most_one_cip_102_token =
    cip_102_token_quantity == 0 || cip_102_token_quantity == 1

  let total_expected_mints = 3 + cip_102_token_quantity

  // Don't allow minting anything else during genesis besides the state token, management token pair, and royalty token
  let only_expected_mints = dict.size(tokens) == total_expected_mints

  expect [state_token_output] =
    transaction.find_script_outputs(outputs, state_validator_policy_id)

  expect [info_token_output] =
    transaction.find_script_outputs(outputs, info_validator_policy_id)

  // Confirm the datum matches the collection state structure 
  let state = collection.state_from_datum(tx, state_token_output.datum)

  // Current NFTs and sequence number must always start at zero 
  let valid_initial_state = state.nfts == 0 && state.next_sequence == 0

  let state_to_correct_validator =
    nft_asset_in_output(state_token_output, collection.state_asset_name)
  let info_to_correct_validator =
    nft_asset_in_output(info_token_output, collection.reference_asset_name)

  let info = collection.info_from_datum(tx, info_token_output.datum)

  // Mostly just so the structure check doesn't get optimized out actually use it
  let non_empty_name = bytearray.length(info.name) > 0

  // Other collection state can be initialized to any value as far as genesis transaction is concerned.  
  // Bad states could be minted such as a validity_range in the distant past, negative max tokens, force_locked flag set to true.
  // But those will cause the spending validator to fail subsequent transactions. 
  and {
    mints_reference_token?,
    mints_owner_token?,
    mints_state_token?,
    mints_at_most_one_cip_102_token?,
    only_expected_mints?,
    valid_initial_state?,
    state_to_correct_validator?,
    info_to_correct_validator?,
    non_empty_name?,
  }
}

/// Searches the output for a reference token.
/// Reference token has it's own datum so it must be in its own output
/// Also constrain nothing else goes to that output with the token.
fn nft_asset_in_output(output: Output, asset_name: ByteArray) -> Bool {
  // There should be exactly one asset sent to the validator
  expect [(_, output_asset_name, output_asset_quantity)] =
    output.value |> value.without_lovelace() |> value.flatten()

  // That one asset sent to the validator must be the reference token of quantity 1
  output_asset_name == asset_name && output_asset_quantity == 1
}

/// Groups user and reference tokens together into tuples
/// This function assumes the tokens are partially ordered 
/// example: [(100A, 1), (100B,1), (222A, 1), (222B, 1)]
/// becomes [((100A,1), (222A,1)), ((100B,1), (222B,1))]
fn validate_tokens(
  mint: MintedValue,
  mint_policy_id: PolicyId,
  next_sequence: Int,
) {
  let tokens =
    mint
      |> value.from_minted_value()
      |> value.tokens(mint_policy_id)
      |> dict.to_pairs()

  let num_tokens = list.length(tokens)
  let num_nfts = num_tokens / 2
  // should always be pairs of 100 and 200 tokens minted so should always be an even number
  let even_tokens = num_tokens % 2 == 0
  let at_least_one_nft = num_nfts > 0

  expect even_tokens? && at_least_one_nft?

  // Split the list in half 
  let (reference_tokens, user_tokens) = list.span(tokens, num_nfts)

  // Each user token and reference token should now be grouped together
  // So we check each pair is valid
  let updated_sequence =
    reference_tokens
      |> list.zip(user_tokens)
      |> list.foldl(
          next_sequence,
          fn(token_pair, expected_sequence) {
            if validate_token_pair(token_pair, expected_sequence) {
              expected_sequence + 1
            } else {
              expected_sequence
            }
          },
        )

  let expected_sequence = updated_sequence == next_sequence + num_nfts

  // NOTE: could check datum of reference token but probably overkill
  expected_sequence?
}

/// This function sorts through the minted tokens to pair user and reference tokens.  
/// Then for each pair it validates they are labeled with CIP-68 standard 100 and 222. 
fn validate_mint(transaction: Transaction, mint_policy_id: PolicyId) {
  let Transaction { mint, inputs, .. } = transaction

  // Make sure the (111)Collection owner token is spent in the inputs 
  expect Some(_owner_input) =
    in.find_asset(inputs, mint_policy_id, collection.owner_asset_name)

  // Make sure the (600)Collection state token is spent in the inputs 
  expect Some(state_input) =
    in.find_asset(inputs, mint_policy_id, collection.state_asset_name)

  // Get the next_sequence number from state datum. 
  let CollectionState { next_sequence, .. } =
    collection.state_from_datum(transaction, state_input.output.datum)
  // Can only mint (222) and (100) pairs in batch mint any other tokens must be minted during genesis
  let tokens_valid = validate_tokens(mint, mint_policy_id, next_sequence)

  tokens_valid?
}

fn validate_token_pair(
  pair: (Pair<AssetName, Int>, Pair<AssetName, Int>),
  expected_sequence: Int,
) {
  let (reference_token, user_token) = pair
  let reference_name = builtin.fst_pair(reference_token)
  let reference_quantity = builtin.snd_pair(reference_token)
  let user_name = builtin.fst_pair(user_token)
  let user_quantity = builtin.snd_pair(user_token)

  let CollectionName {
    label: reference_label,
    purpose: reference_purpose,
    sequence: reference_sequence,
    content: reference_content,
  } = collection.parse_name(reference_name)

  let CollectionName {
    label: user_label,
    purpose: user_purpose,
    sequence: user_sequence,
    content: user_content,
  } = collection.parse_name(user_name)

  // NFT quantity should always be 1 on both tokens
  let mints_single_reference = reference_quantity == 1
  let mints_single_user = user_quantity == 1

  // Should have the 222 and 100 labels 
  let reference_correct_label = reference_label == cip68.reference_token_label
  let user_correct_label = user_label == cip68.nft_user_token_label

  // Sequence number should be the same expected sequence number for both tokens
  let reference_correct_sequence = reference_sequence == expected_sequence
  let user_correct_sequence = user_sequence == expected_sequence

  // Should both have the NFT purpose
  let reference_correct_purpose = reference_purpose == NFT
  let user_correct_purpose = user_purpose == NFT

  // Content name should match
  let shared_content_name = reference_content == user_content

  expect and {
      mints_single_reference?,
      mints_single_user?,
      reference_correct_label?,
      user_correct_label?,
      reference_correct_sequence?,
      user_correct_sequence?,
      reference_correct_purpose?,
      user_correct_purpose?,
      shared_content_name?,
    }

  True
}

/// Currently only the holder of the owner token can burn because we need to update the NFT count state
/// and don't want to get weird with allowing spending of the state without the owner token present.
/// Otherwise this just makes certain the only thing included in the mints are burn
fn validate_burn(transaction: Transaction, mint_policy_id: PolicyId) {
  let Transaction { mint, inputs, .. } = transaction

  // Just verify reference input is included so that spending validator tracks state but don't need to grab anything from it for burn
  // Make sure the (111)Collection token is spent in the inputs 
  expect Some(_owner_token) =
    in.find_asset(inputs, mint_policy_id, collection.owner_asset_name)

  // Make sure the (600)Collection token is also spent in the inputs
  expect Some(_state_token) =
    in.find_asset(inputs, mint_policy_id, collection.state_asset_name)

  // Make sure we only have burns
  let only_burns =
    mint
      |> value.from_minted_value()
      |> value.tokens(mint_policy_id)
      |> dict.values()
      |> list.all(fn(quantity) { quantity == -1 })

  only_burns?
}
