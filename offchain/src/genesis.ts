import { type Address, type Lucid, type Script, type UTxO } from 'lucid-cardano';

import { addCip88MetadataToTransaction, Cip88ExtraConfig } from './cip-88';
import { addCip102RoyaltyToTransaction } from './cip-102';
import { SEQUENCE_MAX_VALUE } from './collection';
import { asChainCollectionInfo, CollectionInfo, CollectionInfoMetadataShape } from './collection-info';
import {
  CollectionState,
  CollectionStateMetadataShape,
  createGenesisStateData,
  toCollectionState,
} from './collection-state';
import { MintRedeemerShape } from './contract';
import CONTRACTS_URL from './contracts-url';
import { Data } from './data';
import { Royalty } from './royalty';
import { fetchContracts, ScriptCache } from './script';
import { checkPolicyId } from './utils';

export class GenesisTxBuilder {
  #lucid: Lucid;
  #cache?: ScriptCache;
  #seed?: UTxO;
  #info?: CollectionInfo;
  #state: CollectionState = {
    info: {
      contractsUrl: CONTRACTS_URL,
      seed: {
        hash: '',
        index: 0,
      },
      scriptReferencePolicyId: '',
    },
    locked: false,
    nfts: 0,
    nextSequence: 0,
  };
  #useCip88 = false;
  #delegate = '';
  #nftValidator: 'permissive' | 'immutable' | 'custom' = 'immutable';
  #royalties: Record<string, Royalty> = {};
  #royaltyValidatorAddress?: Address;
  #ownerAddress?: string;

  private constructor(lucid: Lucid) {
    this.#lucid = lucid;
  }

  seed(seed: UTxO) {
    this.#seed = seed;
    this.#state.info.seed = {
      hash: seed.txHash,
      index: seed.outputIndex,
    };
    return this;
  }

  contractsUrl(url: string) {
    this.#state.info.contractsUrl = url;
    return this;
  }

  cache(cache: ScriptCache) {
    this.#cache = cache;
    this.#state.info.contractsUrl = cache.contractsUrl();
    return this;
  }

  group(policyId: string) {
    if (checkPolicyId(policyId)) {
      this.#state.info.group = policyId;
      return this;
    }

    throw new Error('Group policy id must be a 28 bytes hex string');
  }

  mintWindow(fromMs: number, toMs: number) {
    if (fromMs >= 0 && fromMs < toMs) {
      this.#state.info.mintWindow = {
        fromMs,
        toMs,
      };
      return this;
    }

    throw new Error('Start and End milliseconds must be positive integers with end > start');
  }

  maxNfts(maxNfts: number) {
    if (maxNfts > 0 || maxNfts < SEQUENCE_MAX_VALUE) {
      this.#state.info.maxNfts = maxNfts;
      return this;
    }

    throw new Error(`If using maxNfts it must be between 0 and ${SEQUENCE_MAX_VALUE}`);
  }

  nftValidatorAddress(address: string) {
    if (address.startsWith('addr')) {
      this.#nftValidator = 'custom';
      this.#state.info.nftValidatorAddress = address;
      return this;
    }

    throw new Error('reference token validator address must be bech32 encoded string');
  }

  nftValidator(validator: Script) {
    this.#nftValidator = 'custom';
    this.#state.info.nftValidatorAddress = this.#lucid.utils.validatorToAddress(validator);
    return this;
  }

  useImmutableNftValidator() {
    this.#nftValidator = 'immutable';
    this.#state.info.nftValidatorAddress = '';
    return this;
  }

  usePermissiveNftValidator() {
    this.#nftValidator = 'permissive';
    this.#state.info.nftValidatorAddress = '';
    return this;
  }

  allowDelegateToCreateScriptReferences(delegate: string) {
    this.#delegate = delegate;
    return this;
  }

  royaltyValidatorAddress(address: string) {
    if (address.startsWith('addr')) {
      this.#royaltyValidatorAddress = address;
      return this;
    }

    throw new Error('royalty address must be bech32 encoded string');
  }

  royaltyValidator(validator: Script) {
    this.#royaltyValidatorAddress = this.#lucid.utils.validatorToAddress(validator);
    return this;
  }

  ownerAddress(address: string) {
    if (address.startsWith('addr')) {
      this.#ownerAddress = address;
      return this;
    }

    throw Error('Owner address must be a bech32 encoded string');
  }

  // Don't bother translating till build step
  info(info: CollectionInfo) {
    this.#info = info;
    return this;
  }

  // When called the builder will include CIP-88 data in transaction metadata
  useCip88(useCip88: boolean) {
    this.#useCip88 = useCip88;
    return this;
  }

  royalty(
    address: string,
    variableFee: number = 0,
    minFee: number | undefined = undefined,
    maxFee: number | undefined = undefined
  ) {
    if (variableFee && variableFee < 1) {
      throw new Error('Royalty percent must be greater than 1%. If you want a fixed fee set min fee equal to max fee');
    }

    if (!address.startsWith('addr')) {
      throw new Error('This is not a valid bech32 address');
    }
    if (this.#royalties[address]) {
      throw new Error('Can only add royalties for an address once');
    }

    this.#royalties[address] = { address, variableFee, minFee, maxFee };

    const total = Object.values(this.#royalties)
      .map((royalty) => royalty.variableFee || 0)
      .reduce((acc, next) => acc + next, 0);

    if (total > 100) {
      throw new Error('Total royalty percent must be less than 100');
    }

    return this;
  }

  async build() {
    if (!this.#seed) {
      throw new Error('Missing required field seed. Did you forget to call `seed(utxo)`?');
    }

    if (!this.#info) {
      throw new Error('Missing required collection information. Did you call `info(info)`?');
    }

    // Create a script cache from seed utxo so that after build it can be reused if needed
    const cache = this.#cache
      ? this.#cache
      : ScriptCache.cold(this.#lucid, await fetchContracts(this.#state.info.contractsUrl), this.#seed);
    const mintScript = cache.mint();
    const stateScript = cache.state();
    const infoScript = cache.immutableInfo();
    const spendLock = cache.spendLock();
    const unit = cache.unit();
    const recipient = this.#ownerAddress ? this.#ownerAddress : await this.#lucid.wallet.address();

    // Declare minimum managment token assets here may add royalties depending on builder config
    const stateValidatorAssets = { [unit.state]: 1n };
    const infoValidatorAssets = { [unit.info]: 1n };
    const recipientAssets = { [unit.owner]: 1n };
    const assets = { ...stateValidatorAssets, ...infoValidatorAssets, ...recipientAssets };

    const redeemer = Data.to(
      {
        EndpointGenesis: {
          state_validator_policy_id: stateScript.policyId,
          info_validator_policy_id: infoScript.policyId,
        },
      },
      MintRedeemerShape
    );

    // Start building tx
    const tx = this.#lucid.newTx().attachMintingPolicy(mintScript.script).collectFrom([this.#seed]);

    // Add royalties to minted assets, if they are included
    const royalties = Object.values(this.#royalties);
    if (royalties.length > 0) {
      const royaltyAddress = this.#royaltyValidatorAddress
        ? this.#royaltyValidatorAddress
        : await spendLock.address
      addCip102RoyaltyToTransaction(tx, mintScript.policyId, royaltyAddress, royalties, redeemer);
    }

    // Add CIP-88 metadata to transaction if flag is set
    if (this.#useCip88) {
      const config: Cip88ExtraConfig = {
        info: this.#info,
        cip102Royalties: royalties,
      };

      addCip88MetadataToTransaction(this.#lucid, tx, mintScript.script, unit.owner, config);
    }

    // Set the address to send the reference half of the token to
    if (this.#nftValidator === 'immutable') {
      this.#state.info.nftValidatorAddress = cache.immutableNft().address;
    } else if (this.#nftValidator === 'permissive') {
      this.#state.info.nftValidatorAddress = cache.permissiveNft().address;
    }

    // Set the minting policy that create tokens that hold script references
    if (this.#delegate) {
      this.#state.info.scriptReferencePolicyId = cache.delegateMint(this.#delegate).policyId;
    } else {
      this.#state.info.scriptReferencePolicyId = cache.derivativeMint().policyId;
    }

    // Build out the gensis state and info datum
    const genesisStateData = createGenesisStateData(this.#state); // Plutus Data
    const genesisStateDatum = Data.to(genesisStateData, CollectionStateMetadataShape); // Serialized CBOR
    const infoData = asChainCollectionInfo(this.#info);
    const infoDatum = Data.to(infoData, CollectionInfoMetadataShape);

    tx.mintAssets(assets, redeemer)
      .payToAddressWithData(
        stateScript.address,
        {
          inline: genesisStateDatum,
        },
        stateValidatorAssets
      )
      .payToAddressWithData(
        infoScript.address,
        {
          inline: infoDatum,
        },
        infoValidatorAssets
      )
      .payToAddress(recipient, recipientAssets);

    const state = toCollectionState(this.#lucid, genesisStateData);
    return { cache, tx, state, recipient };
  }

  static create(lucid: Lucid) {
    return new GenesisTxBuilder(lucid);
  }
}
