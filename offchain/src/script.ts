/// Allow passing in as little or as much already computed data as possible
/// This cache will be updated if a some part is missing. The only case where

import { applyDoubleCborEncoding, Lucid, UTxO, type Credential, type Script } from 'lucid-cardano';

import { toInfoUnit, toOwnerUnit } from './collection';
import { extractCollectionState, toStateUnit } from './collection-state';
import {
  parameterizeDelegativeMintingPolicy,
  parameterizeDerivativeMintingPolicy,
  parameterizeImmutableInfoValidator,
  parameterizeImmutableNftValidator,
  parameterizeMintingPolicy,
  parameterizePermissiveNftValidator,
  parameterizeSpendLockValidator,
  parameterizeStateValidator,
} from './contract';
import { findUtxo, TxReference } from './utils';

/// A loose definition of the contracts json structure.
/// Just enough to lookup scripts by name and get the compiled code.
export type Contracts = {
  url: string;
  preamble: unknown;
  validators: {
    title: string;
    redeemer?: unknown;
    parameters?: unknown;
    compiledCode: string;
    hash: string;
  }[];
  definitions: unknown;
};

/// All the parts commonly used when dealing with a paramaterized script
export type ScriptInfo = {
  name: string;
  script: Script;
  policyId: string;
  credential: Credential;
  address: string;
};

/// Commonly paired reference and owner unit names
export type ManageUnitLookup = {
  info: string;
  owner: string;
  state: string;
};

// Fetches contracts from a given path and lightly checks it matches the expected schema
export async function fetchContracts(url: string) {
  try {
    if (url == 'local') {
      const contracts = (await import('../../contracts/plutus.json')) as unknown as Contracts;
      contracts.url = 'local';
      return contracts;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error();
    const json = await response.json();
    const contracts = json as unknown as Contracts;
    contracts.url = url;
    if (!contracts.preamble || !contracts.definitions || !contracts.validators) {
      throw new Error();
    }

    return contracts;
  } catch (error) {
    throw new Error(`Failed to fetch contract json at url: ${url}`);
  }
}

// Utility function for fetching a validator from the generated plutus.json
export function getScript(contracts: Contracts, title: string) {
  const script = contracts.validators.find((v) => v.title === title);
  if (!script) {
    throw new Error('script not found');
  }

  return script;
}

/// Utility function for grabbing commonly needed information about a validator (or minting policy)
export function getScriptInfo(lucid: Lucid, name: string, paramaterizedScript: string): ScriptInfo {
  const script: Script = {
    type: 'PlutusV2',
    script: applyDoubleCborEncoding(paramaterizedScript),
  };

  const policyId = lucid.utils.validatorToScriptHash(script);
  const credential = lucid.utils.scriptHashToCredential(policyId);
  const address = lucid.utils.credentialToAddress(credential);

  return {
    name,
    script,
    policyId,
    credential,
    address,
  };
}

export type ScriptCacheWarmer = {
  contracts: Contracts;
  mint?: ScriptInfo;
  state?: ScriptInfo;
  unit?: ManageUnitLookup;
};

/// Cache holds all the computed data from a builder transaction to
/// allow subsequent transactions to reuse computed data
export class ScriptCache {
  #lucid: Lucid;
  #contracts: Contracts;
  #seed: TxReference;
  #mint?: ScriptInfo;
  #state?: ScriptInfo;
  #immutableInfo?: ScriptInfo;
  #immutableNft?: ScriptInfo;
  #permissiveNft?: ScriptInfo;
  #spendLock?: ScriptInfo;
  #derivativeMint?: ScriptInfo;
  #delegate: string = '';
  #delegateMint?: ScriptInfo;
  #unit?: ManageUnitLookup;

  private constructor(lucid: Lucid, contracts: Contracts, seed: TxReference) {
    this.#lucid = lucid;
    this.#seed = seed;
    this.#contracts = contracts;
  }

  static cold(lucid: Lucid, contracts: Contracts, seed: TxReference) {
    return new ScriptCache(lucid, contracts, seed);
  }

  static warm(lucid: Lucid, seed: TxReference, warmer: ScriptCacheWarmer) {
    const cache = new ScriptCache(lucid, warmer.contracts, seed);
    cache.#mint = warmer.mint;
    cache.#state = warmer.state;
    cache.#unit = warmer.unit;

    return cache;
  }

  // Utility for when you already know the minting policy id
  static async fromMintPolicyId(lucid: Lucid, policyId: string) {
    const stateUtxo = await lucid.utxoByUnit(toStateUnit(policyId));

    return ScriptCache.fromStateUtxo(lucid, stateUtxo);
  }

  // Utility for when you already have a state utxo
  static async fromStateUtxo(lucid: Lucid, stateUtxo: UTxO) {
    const state = await extractCollectionState(lucid, stateUtxo);

    const contracts = await fetchContracts(state.info.contractsUrl);

    const cache = ScriptCache.cold(lucid, contracts, {
      txHash: state.info.seed.hash,
      outputIndex: state.info.seed.index,
    });

    return { state, cache };
  }

  static copy(lucid: Lucid, cache: ScriptCache) {
    const copy = new ScriptCache(lucid, cache.#contracts, cache.#seed);
    copy.#mint = cache.#mint;
    copy.#state = cache.#state;
    copy.#unit = cache.#unit;

    return copy;
  }

  lucid() {
    return this.#lucid;
  }

  contractsUrl() {
    return this.#contracts.url;
  }

  mint() {
    if (!this.#mint) {
      const { txHash, outputIndex } = this.#seed;
      this.#mint = parameterizeMintingPolicy(this.#lucid, this.#contracts, txHash, outputIndex);
    }

    return this.#mint;
  }

  spendLock() {
    if (!this.#spendLock) {
      const mint = this.mint();
      this.#spendLock = parameterizeSpendLockValidator(this.#lucid, this.#contracts, mint.policyId);
    }

    return this.#spendLock;
  }

  state() {
    if (!this.#state) {
      const mint = this.mint();
      this.#state = parameterizeStateValidator(this.#lucid, this.#contracts, mint.policyId);
    }

    return this.#state;
  }

  // TODO: Currently only one info validator but will add mutable validator
  immutableInfo() {
    if (!this.#immutableInfo) {
      const mint = this.mint();
      this.#immutableInfo = parameterizeImmutableInfoValidator(this.#lucid, this.#contracts, mint.policyId);
    }

    return this.#immutableInfo;
  }

  immutableNft() {
    if (!this.#immutableNft) {
      const mint = this.mint();
      this.#immutableNft = parameterizeImmutableNftValidator(this.#lucid, this.#contracts, mint.policyId);
    }

    return this.#immutableNft;
  }

  permissiveNft() {
    if (!this.#permissiveNft) {
      const mint = this.mint();
      this.#permissiveNft = parameterizePermissiveNftValidator(this.#lucid, this.#contracts, mint.policyId);
    }

    return this.#permissiveNft;
  }

  derivativeMint() {
    if (!this.#derivativeMint) {
      const mint = this.mint();
      this.#derivativeMint = parameterizeDerivativeMintingPolicy(this.#lucid, this.#contracts, mint.policyId);
    }

    return this.#derivativeMint;
  }

  delegateMint(delegate: string) {
    if (!this.#delegateMint || this.#delegate !== delegate) {
      const mint = this.mint();
      this.#delegate = delegate;
      this.#delegateMint = parameterizeDelegativeMintingPolicy(this.#lucid, this.#contracts, mint.policyId, delegate);
    }

    return this.#delegateMint;
  }

  unit() {
    if (!this.#unit) {
      const mint = this.mint();
      const info = toInfoUnit(mint.policyId);
      const owner = toOwnerUnit(mint.policyId);
      const state = toStateUnit(mint.policyId);

      this.#unit = { info, owner, state };
    }

    return this.#unit;
  }
}

export async function fetchUtxo(lucid: Lucid, address: string, unit: string) {
  const utxos = await lucid.utxosAt(address);
  const utxo = utxos.find((utxo) => utxo.assets[unit]);
  return utxo;
}

/// Fetches the UTxO that holds the state token
export async function fetchStateUtxo(cache: ScriptCache) {
  return await fetchUtxo(cache.lucid(), cache.state().address, cache.unit().state);
}

/// Fetches the UTxO that holds the collection info token
export async function fetchInfoUtxo(cache: ScriptCache) {
  return await fetchUtxo(cache.lucid(), cache.immutableInfo().address, cache.unit().info);
}

/// Fetches the UTxO that holds the collection owner token.
export async function fetchOwnerUtxo(cache: ScriptCache) {
  const unit = cache.unit();
  return await findUtxo(cache.lucid(), unit.owner);
}
