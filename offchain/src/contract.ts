import { applyParamsToScript, fromText, Script, toLabel, UTxO, type Lucid } from 'lucid-cardano';

import { OutputReferenceSchema, PolicyIdSchema, PubKeyHashSchema } from './aiken';
import { Data } from './data';
import { Contracts, fetchOwnerUtxo, fetchUtxo, getScript, getScriptInfo, ScriptCache } from './script';

export const ScriptName = {
  NftMintingPolicy: 'mint.mint',
  DerivativeMintingPolicy: 'derivative.mint',
  DelegateMintingPolicy: 'delegate.mint',
  MintingStateValidator: 'state.spend',
  ImmutableInfoValidator: 'immutable_info.spend',
  ImmutableNftValidator: 'immutable_nft.spend',
  PermissiveNftValidator: 'permissive_nft.spend',
  SpendLockValidator: 'lock.spend',
} as const;

/// Minting policy paramaterization schema
const MintParameterSchema = Data.Tuple([OutputReferenceSchema]);
type MintParameterType = Data.Static<typeof MintParameterSchema>;
const MintParameterShape = MintParameterSchema as unknown as MintParameterType;

/// Validator paramaterization schema
const PolicyIdValidatorParameterSchema = Data.Tuple([PolicyIdSchema]);
type PolicyIdValidatorParameterType = Data.Static<typeof PolicyIdValidatorParameterSchema>;
const PolicyIdValidatorParameterShape = PolicyIdValidatorParameterSchema as unknown as PolicyIdValidatorParameterType;

const DelegateValidatorParameterSchema = Data.Tuple([PolicyIdSchema, PubKeyHashSchema]);
type DelegateValidatorParameterType = Data.Static<typeof DelegateValidatorParameterSchema>;
const DelegateValidatorParameterShape = DelegateValidatorParameterSchema as unknown as DelegateValidatorParameterType;

/// Redeemer schema for minting
const MintRedeemerSchema = Data.Enum([
  Data.Object({
    EndpointGenesis: Data.Object({
      state_validator_policy_id: PolicyIdSchema,
      info_validator_policy_id: PolicyIdSchema,
    }),
  }),
  Data.Literal('EndpointMint'),
  Data.Literal('EndpointBurn'),
]);
export type MintRedeemerType = Data.Static<typeof MintRedeemerSchema>;
export const MintRedeemerShape = MintRedeemerSchema as unknown as MintRedeemerType;

const StateValidatorRedeemerSchema = Data.Enum([Data.Literal('EndpointMint'), Data.Literal('EndpointBurn')]);
export type StateValidatorRedeemerType = Data.Static<typeof StateValidatorRedeemerSchema>;
export const StateValidatorRedeemerShape = StateValidatorRedeemerSchema as unknown as StateValidatorRedeemerType;

/// Given a minting policy, parameterizes the collection info reference token spending validator and returns its info
function paramaterizePolicyIdValidator(
  lucid: Lucid,
  contracts: Contracts,
  mintingPolicyId: string,
  scriptName: string
) {
  const script = getScript(contracts, scriptName);
  const paramertizedMintingPolicy = applyParamsToScript<PolicyIdValidatorParameterType>(
    script.compiledCode,
    [mintingPolicyId],
    PolicyIdValidatorParameterShape
  );
  return getScriptInfo(lucid, script.title, paramertizedMintingPolicy);
}

// Script references are not created under the same main minting policy as the collection and nft tokens.
// The only relationship is they are stored at the an always fail validator that is parameterized by that minting policy.
// In other words the policyId first parameter below is NOT the nft/collection token minting policy id.  It's just
// some native script minting policy.
export function scriptReferenceUnit(policyId: string, assetName: string) {
  return policyId + toLabel(0) + fromText(assetName);
}

// Creates a transaction that uses the passed in minting policy to generate tokens containing
// script references and sends them to a locked spending validator unique to the main minting policy.
export async function createScriptReference(
  lucid: Lucid,
  cache: ScriptCache,
  scripts: { script: Script; name: string }[],
  type: 'delegate' | 'derivative' = 'derivative',
  delegate?: string,
  ownerUtxo?: UTxO
) {
  const mintingPolicyInfo = getReferenceMintInfo(cache, type, delegate);
  const mintingPolicyId = mintingPolicyInfo.policyId;
  const lockAddress = cache.spendLock().address;

  if (!ownerUtxo && type === 'derivative') {
    const { utxo, wallet } = await fetchOwnerUtxo(cache);
    if (!wallet) {
      throw new Error('Selected wallet must hold the owner token of the collection');
    }

    ownerUtxo = utxo;
  }

  const assets: Record<string, bigint> = {};
  for (const { name } of scripts) {
    const unit = scriptReferenceUnit(mintingPolicyId, name);
    assets[unit] = 1n;
  }

  const tx = await lucid
    .newTx()
    .attachMintingPolicy(mintingPolicyInfo.script)
    .mintAssets(assets, Data.void())
    .validTo(Date.now() + 2 * 60 * 1000);

  // Spend the owner token if it is included to prove ownership
  if (ownerUtxo) {
    tx.payToAddress(ownerUtxo.address, { [cache.unit().owner]: 1n });
  }

  for (const { script, name } of scripts) {
    const unit = scriptReferenceUnit(mintingPolicyId, name);
    tx.payToContract(
      lockAddress,
      {
        inline: Data.void(),
        scriptRef: script,
      },
      { [unit]: 1n }
    );
  }

  return tx;
}

export async function fetchReferenceUtxo(cache: ScriptCache, scriptName: string, delegate?: string) {
  const lucid = cache.lucid();
  const address = cache.spendLock().address;
  const policyId = delegate ? cache.delegateMint(delegate).policyId : cache.derivativeMint().policyId;
  const unit = scriptReferenceUnit(policyId, scriptName);
  return await fetchUtxo(lucid, address, unit);
}

/// Given a unique hash and index from the seed transaction parameterizes the minting policy and returns its info
export function parameterizeMintingPolicy(lucid: Lucid, contracts: Contracts, hash: string, index: number) {
  const seed = {
    transaction_id: {
      hash,
    },
    output_index: BigInt(index),
  };

  const script = getScript(contracts, ScriptName.NftMintingPolicy);
  const paramertizedMintingPolicy = applyParamsToScript<MintParameterType>(
    script.compiledCode,
    [seed],
    MintParameterShape
  );
  return getScriptInfo(lucid, script.title, paramertizedMintingPolicy);
}

///// Rest of these functions are just some utility functions for readability that aren't strictly needed.

/// Minting Policy
export function mintingPolicyReferenceUnit(policyId: string) {
  return scriptReferenceUnit(policyId, ScriptName.NftMintingPolicy);
}

export async function fetchMintingPolicyReferenceUtxo(cache: ScriptCache, delegate?: string) {
  return await fetchReferenceUtxo(cache, ScriptName.NftMintingPolicy, delegate);
}

export async function createMintingPolicyReference(
  lucid: Lucid,
  cache: ScriptCache,
  type: 'delegate' | 'derivative' = 'derivative',
  delegate?: string,
  ownerUtxo?: UTxO
) {
  const script = cache.mint().script;
  const name = ScriptName.NftMintingPolicy;

  return await createScriptReference(lucid, cache, [{ script, name }], type, delegate, ownerUtxo);
}

/// State Validator
export function parameterizeStateValidator(lucid: Lucid, contracts: Contracts, mintingPolicyId: string) {
  return paramaterizePolicyIdValidator(lucid, contracts, mintingPolicyId, ScriptName.MintingStateValidator);
}

export function stateValidatorReferenceUnit(policyId: string) {
  return scriptReferenceUnit(policyId, ScriptName.MintingStateValidator);
}

export async function fetchStateValidatorReferenceUtxo(cache: ScriptCache, delegate?: string) {
  return await fetchReferenceUtxo(cache, ScriptName.MintingStateValidator, delegate);
}

export async function createStateValidatorReference(
  lucid: Lucid,
  cache: ScriptCache,
  type: 'delegate' | 'derivative' = 'derivative',
  delegate?: string,
  ownerUtxo?: UTxO
) {
  const script = cache.state().script;
  const name = ScriptName.MintingStateValidator;

  return await createScriptReference(lucid, cache, [{ script, name }], type, delegate, ownerUtxo);
}

/// Immutable Info Validator
export function parameterizeImmutableInfoValidator(lucid: Lucid, contracts: Contracts, mintingPolicyId: string) {
  return paramaterizePolicyIdValidator(lucid, contracts, mintingPolicyId, ScriptName.ImmutableInfoValidator);
}

export function immutableInfoReferenceUnit(policyId: string) {
  return scriptReferenceUnit(policyId, ScriptName.ImmutableInfoValidator);
}

export async function fetchImmutableInfoReferenceUtxo(cache: ScriptCache, delegate?: string) {
  return await fetchReferenceUtxo(cache, ScriptName.ImmutableInfoValidator, delegate);
}

/// Immutable NFT validator
export function parameterizeImmutableNftValidator(lucid: Lucid, contracts: Contracts, mintingPolicyId: string) {
  return paramaterizePolicyIdValidator(lucid, contracts, mintingPolicyId, ScriptName.ImmutableNftValidator);
}

export function immutableNftReferenceUnit(policyId: string) {
  return scriptReferenceUnit(policyId, ScriptName.ImmutableNftValidator);
}

export async function fetchImmutableNftReferenceUtxo(cache: ScriptCache, delegate?: string) {
  return await fetchReferenceUtxo(cache, ScriptName.ImmutableNftValidator, delegate);
}

/// Permissive NFT validator
export function parameterizePermissiveNftValidator(lucid: Lucid, contracts: Contracts, mintingPolicyId: string) {
  return paramaterizePolicyIdValidator(lucid, contracts, mintingPolicyId, ScriptName.PermissiveNftValidator);
}

export function permissiveNftReferenceUnit(policyId: string) {
  return scriptReferenceUnit(policyId, ScriptName.PermissiveNftValidator);
}

export async function fetchPermissiveNftReferenceUtxo(cache: ScriptCache, delegate?: string) {
  return await fetchReferenceUtxo(cache, ScriptName.PermissiveNftValidator, delegate);
}

/// Lock Validator
export function parameterizeSpendLockValidator(lucid: Lucid, contracts: Contracts, mintingPolicyId: string) {
  return paramaterizePolicyIdValidator(lucid, contracts, mintingPolicyId, ScriptName.SpendLockValidator);
}

export function lockReferenceUnit(policyId: string) {
  return scriptReferenceUnit(policyId, ScriptName.SpendLockValidator);
}

export async function fetchLockReferenceUtxo(cache: ScriptCache, delegate?: string) {
  return await fetchReferenceUtxo(cache, ScriptName.SpendLockValidator, delegate);
}

// Reference minting policy
export function parameterizeDerivativeMintingPolicy(lucid: Lucid, contracts: Contracts, mintingPolicyId: string) {
  return paramaterizePolicyIdValidator(lucid, contracts, mintingPolicyId, ScriptName.DerivativeMintingPolicy);
}

// Reference minting policy
export function parameterizeDelegativeMintingPolicy(
  lucid: Lucid,
  contracts: Contracts,
  mintingPolicyId: string,
  delegatePubKeyHash: string
) {
  const script = getScript(contracts, ScriptName.DelegateMintingPolicy);
  const paramertizedMintingPolicy = applyParamsToScript<DelegateValidatorParameterType>(
    script.compiledCode,
    [mintingPolicyId, delegatePubKeyHash],
    DelegateValidatorParameterShape
  );
  return getScriptInfo(lucid, script.title, paramertizedMintingPolicy);
}

// Utility for fetching minting policy given a type and script cache
function getReferenceMintInfo(cache: ScriptCache, type: 'derivative' | 'delegate', delegate?: string) {
  switch (type) {
    case 'delegate':
      if (delegate === undefined) {
        throw new Error(
          'Delegate public key hash must be set to generate correct policy even if owner token will be used as witness'
        );
      }

      return cache.delegateMint(delegate);
    case 'derivative':
      return cache.derivativeMint();
  }
}
