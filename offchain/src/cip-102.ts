import { fromText, toUnit, type Tx } from 'lucid-cardano';

import { asChainAddress, ChainAddressSchema } from './aiken';
import { Data } from './data';
import { Royalty } from './royalty';

export const ROYALTY_TOKEN_LABEL = 500;
export const ROYALTY_TOKEN_NAME = fromText('Royalty');

export const RoyaltyRecipientSchema = Data.Object({
  address: ChainAddressSchema,
  variableFee: Data.Integer({ minimum: 1 }),
  minFee: Data.Nullable(Data.Integer()),
  maxFee: Data.Nullable(Data.Integer()),
});

export type RoyaltyRecipientType = Data.Static<typeof RoyaltyRecipientSchema>;
export const RoyaltyRecipientShape = RoyaltyRecipientSchema as unknown as RoyaltyRecipientType;

export const RoyaltyInfoSchema = Data.Object({
  metadata: Data.Array(RoyaltyRecipientSchema),
  version: Data.Integer({ minimum: 1, maximum: 1 }),
  extra: Data.Any(),
});
export type RoyaltyInfoType = Data.Static<typeof RoyaltyInfoSchema>;
export const RoyaltyInfoShape = RoyaltyInfoSchema as unknown as RoyaltyInfoType;

export function toRoyaltyUnit(policyId: string) {
  return toUnit(policyId, ROYALTY_TOKEN_NAME, ROYALTY_TOKEN_LABEL);
}

/// Converts a percentage between 0 and 100 inclusive to the CIP-102 fee format
export function asChainVariableFee(percent: number) {
  if (percent < 0.1 || percent > 100) {
    throw new Error('Royalty fee must be between 0.1 and 100 percent');
  }
  return BigInt(Math.floor(1 / (percent / 1000)));
}

/// Converts from a on chain royalty to a percent between 0 and 100
export function fromChainVariableFee(fee: bigint) {
  if(fee <= 0)
    throw new Error("Chain fee can't be zero or below.");
  return Math.ceil(Number(10000n / fee)) / 10;
}

/// Confirms the fee is a positive integer and casts it to a bigint otherwise returns null
export function asChainFixedFee(fee?: number) {
  if (fee) {
    if (fee < 0 || !Number.isInteger(fee)) {
      throw new Error('Fixed fee must be an positive integer or 0');
    }

    return BigInt(fee);
  } else {
    return null;
  }
}

// Converts the offchain representation of royaltyies into the format used for storing the royalties in datum on chain
export function toCip102RoyaltyDatum(royalties: Royalty[]) {
  const metadata: RoyaltyRecipientType[] = royalties.map((royalty) => {
    const address = asChainAddress(royalty.address);
    const variableFee = asChainVariableFee(royalty.variableFee);
    const minFee = asChainFixedFee(royalty.minFee);
    const maxFee = asChainFixedFee(royalty.maxFee);

    return {
      address,
      variableFee,
      minFee,
      maxFee,
    };
  });

  const info: RoyaltyInfoType = {
    metadata,
    version: BigInt(1),
    extra: '',
  };

  return Data.to(info, RoyaltyInfoShape);
}

export function addCip102RoyaltyToTransaction(
  tx: Tx,
  policyId: string,
  address: string,
  royalties: Royalty[],
  redeemer?: string
) {
  const royaltyUnit = toRoyaltyUnit(policyId);
  const royaltyAsset = { [royaltyUnit]: 1n };
  const royaltyDatum = toCip102RoyaltyDatum(royalties);
  const royaltyOutputData = { inline: royaltyDatum };

  tx.mintAssets(royaltyAsset, redeemer).payToAddressWithData(address, royaltyOutputData, royaltyAsset);
}
