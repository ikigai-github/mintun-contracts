import { type Address, type Assets, type Lucid, type UTxO } from 'lucid-cardano';

import { NftMetadataWrappedShape } from './cip-68';
import { toRoyaltyUnit } from './cip-102';
import { toOwnerUnit } from './collection';
import {
  addMintsToCollectionState,
  asChainStateData,
  CollectionState,
  CollectionStateMetadataShape,
  extractCollectionState,
  toStateUnit,
} from './collection-state';
import {
  fetchMintingPolicyReferenceUtxo,
  fetchStateValidatorReferenceUtxo,
  MintRedeemerShape,
  StateValidatorRedeemerShape,
} from './contract';
import { Data } from './data';
import { AddressedNft, MintunNft, prepareAssets } from './nft';
import { fetchStateUtxo, ScriptCache } from './script';

// Don't have a dedicated cip-25.ts so just putting this here
export const CIP_25_METADATA_LABEL = 721;

export class MintTxBuilder {
  #lucid: Lucid;
  #mintingPolicyId?: string;
  #cache?: ScriptCache;
  #recipient?: Address;
  #stateUtxo?: UTxO;
  #mintingPolicyReferenceUtxo?: UTxO;
  #stateValidatorReferenceUtxo?: UTxO;
  #currentState?: CollectionState;
  #nfts: AddressedNft[] = [];
  #validFrom?: number;
  #validTo?: number;
  #useCip25 = false;

  private constructor(lucid: Lucid) {
    this.#lucid = lucid;
  }

  mintingPolicyId(mintingPolicyId: string) {
    this.#mintingPolicyId = mintingPolicyId;
    return this;
  }

  cache(cache: ScriptCache) {
    this.#cache = cache;
    return this;
  }

  recipient(recipient: Address) {
    this.#recipient = recipient;
    return this;
  }

  stateUtxo(utxo: UTxO) {
    this.#stateUtxo = utxo;
    return this;
  }

  mintingPolicyReferenceUtxo(utxo: UTxO) {
    this.#mintingPolicyReferenceUtxo = utxo;
    return this;
  }

  stateValidatorReferenceUtxo(utxo: UTxO) {
    this.#stateValidatorReferenceUtxo = utxo;
    return this;
  }

  state(state: CollectionState) {
    this.#currentState = state;
    return this;
  }

  nft(metadata: MintunNft, recipient: string | undefined = undefined) {
    this.#nfts.push({ metadata, recipient });
    return this;
  }

  nfts(nfts: MintunNft[], recipient: string | undefined = undefined) {
    const mapped = nfts.map((metadata) => ({
      metadata,
      recipient,
    }));
    this.#nfts = [...this.#nfts, ...mapped];
    return this;
  }

  // Note: Not sure this is a good idea may just confuse things to have both cip-25 and cip-68 metadata.
  //       Also, if NFT metadata is in any way modifiable then we shouldn't use cip-25.
  useCip25(useCip25: boolean) {
    this.#useCip25 = useCip25;
    return this;
  }

  validFrom(unixTime: number) {
    this.#validFrom = unixTime;
    return this;
  }

  validTo(unixTime: number) {
    this.#validTo = unixTime;
    return this;
  }

  async build() {
    const numMints = this.#nfts.length;
    if (numMints === 0) {
      throw new Error('Cannot build a mint transaction with no NFTs to mint');
    }

    if (!this.#cache) {
      if (this.#stateUtxo) {
        const { state, cache } = await ScriptCache.fromStateUtxo(this.#lucid, this.#stateUtxo);
        this.#cache = cache;
        this.#currentState = state;
      } else if (this.#mintingPolicyId) {
        const { state, cache } = await ScriptCache.fromMintPolicyId(this.#lucid, this.#mintingPolicyId);
        this.#cache = cache;
        this.#currentState = state;
      } else {
        throw new Error(
          'Must either supply a seed utxo, script cache, state utxo, or minting policy id to build transaction'
        );
      }
    }

    // Fetch the state token utxo
    this.#stateUtxo = this.#stateUtxo ? this.#stateUtxo : await fetchStateUtxo(this.#cache);

    if (!this.#stateUtxo) {
      throw new Error('Could not find the utxo holding state. It must be spent to mint');
    }

    if (!this.#mintingPolicyId) {
      this.#mintingPolicyId = this.#cache.mint().policyId;
    }

    // Check if there is the royalty token because we need to add a royalty flag if there is one
    let hasRoyalty;
    try {
      const royaltyUnit = toRoyaltyUnit(this.#mintingPolicyId);
      const royaltyFindResult = await this.#lucid.utxoByUnit(royaltyUnit);
      hasRoyalty = royaltyFindResult !== undefined;
    } catch {
      hasRoyalty = false;
    }

    // Compute the updated state
    const currentState = this.#currentState
      ? this.#currentState
      : await extractCollectionState(this.#lucid, this.#stateUtxo);
    const recipientAddress = this.#recipient || (await this.#lucid.wallet.address());
    const nftValidatorAddress = currentState.info.nftValidatorAddress;

    // Get script references if the state indicates there is a policy
    const { scriptReferencePolicyId } = currentState.info;
    if (scriptReferencePolicyId) {
      if (!this.#mintingPolicyReferenceUtxo) {
        this.#mintingPolicyReferenceUtxo = await fetchMintingPolicyReferenceUtxo(this.#cache);
      }

      if (!this.#stateValidatorReferenceUtxo) {
        this.#stateValidatorReferenceUtxo = await fetchStateValidatorReferenceUtxo(this.#cache);
      }
    }

    // Update state to reflect the new mints
    const nextState = addMintsToCollectionState(currentState, numMints);
    const chainState = asChainStateData(nextState);

    // Get user and reference token names for each nft as well as its on chain representation
    const prepared = prepareAssets(
      this.#nfts,
      this.#mintingPolicyId,
      currentState.nextSequence,
      recipientAddress,
      hasRoyalty,
      nftValidatorAddress
    );

    const mintRedeemer = Data.to('EndpointMint', MintRedeemerShape);
    const validatorRedeemer = Data.to('EndpointMint', StateValidatorRedeemerShape);

    const ownerUnit = toOwnerUnit(this.#mintingPolicyId);
    const ownerAsset = { [ownerUnit]: 1n };
    const stateUnit = toStateUnit(this.#mintingPolicyId);
    const stateAsset = { [stateUnit]: 1n };
    const stateOutput = { inline: Data.to(chainState, CollectionStateMetadataShape) };

    const tx = this.#lucid.newTx();

    if (this.#stateValidatorReferenceUtxo) {
      tx.readFrom([this.#stateValidatorReferenceUtxo]);
    } else {
      tx.attachSpendingValidator(this.#cache.state().script);
    }

    tx.collectFrom([this.#stateUtxo], validatorRedeemer);

    if (this.#mintingPolicyReferenceUtxo) {
      tx.readFrom([this.#mintingPolicyReferenceUtxo]);
    } else {
      tx.attachMintingPolicy(this.#cache.mint().script);
    }

    // Force a validity range but allow override to keep from creating infinite validity transaction
    if (this.#validFrom) {
      tx.validFrom(this.#validFrom);
    } else {
      tx.validFrom(Date.now() - 500_000_000);
    }

    if (this.#validTo) {
      tx.validTo(this.#validTo);
    } else {
      tx.validTo(Date.now() + 600_000);
    }

    // TODO: Maybe enforce this just goes back to the original utxo address to prevent accidentally sending this to some other wallet
    tx.mintAssets(prepared.userMints, mintRedeemer)
      .mintAssets(prepared.referenceMints, mintRedeemer)
      .payToAddress(recipientAddress, ownerAsset)
      .payToAddressWithData(this.#cache.state().address, stateOutput, stateAsset);

    for (const payout of prepared.referencePayouts) {
      // TODO: Add flag so can choose to inline or not
      const outputData = { inline: Data.to(payout.chainData, NftMetadataWrappedShape) };
      const referenceaAsset = { [payout.unit]: 1n };
      tx.payToAddressWithData(payout.address, outputData, referenceaAsset);
    }

    for (const [address, units] of Object.entries(prepared.userPayouts)) {
      const assets: Assets = {};
      for (const unit of units) {
        assets[unit] = 1n;
      }
      tx.payToAddress(address, assets);
    }

    if (this.#useCip25) {
      tx.attachMetadata(CIP_25_METADATA_LABEL, prepared.cip25Metadata);
    }

    // Clear the state utxos because it will be spent when this transaction is submitted
    this.#stateUtxo = undefined;

    // Also clear nft array to make this builder fully reusable
    this.#nfts = [];

    return { tx, cache: this.#cache, state: nextState };
  }

  static create(lucid: Lucid) {
    return new MintTxBuilder(lucid);
  }
}
