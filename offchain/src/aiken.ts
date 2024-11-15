/// Schema for aiken stdlib types added here as needed.
/// Some schema definitions were liberally taken from
/// https://github.com/spacebudz/nebula/blob/main/common/utils.ts
import { Constr, fromText, getAddressDetails, type Address, type Lucid } from 'lucid-cardano';

import { TimeWindow } from './common';
import { Data } from './data';

export const PolicyIdSchema = Data.Bytes({ minLength: 28, maxLength: 28 });

export const AssetNameSchema = Data.Bytes({ minLength: 0, maxLength: 32 });

export const PubKeyHashSchema = Data.Bytes({ minLength: 28, maxLength: 28 });

export const OutputReferenceSchema = Data.Object({
  transaction_id: Data.Object({
    hash: Data.Bytes(),
  }),
  output_index: Data.Integer(),
});

const PosixTimeIntervalBoundTypeSchema = Data.Enum([
  Data.Literal('NegativeInfinity'),
  Data.Object({ Finite: Data.Tuple([Data.Integer()]) }),
  Data.Literal('PositiveInfinity'),
]);

const PosixTimeIntervalBoundSchema = Data.Object({
  bound_type: PosixTimeIntervalBoundTypeSchema,
  is_inclusive: Data.Boolean(),
});

type PosixTimeIntervalBoundType = Data.Static<typeof PosixTimeIntervalBoundSchema>;

/// Interval is a generic type so this is specifically for most common use of posix time interval
export const PosixTimeIntervalSchema = Data.Object({
  lower_bound: PosixTimeIntervalBoundSchema,
  upper_bound: PosixTimeIntervalBoundSchema,
});

export type PosixTimeIntervalType = Data.Static<typeof PosixTimeIntervalSchema>;
export const PosixTimeIntervalShape = PosixTimeIntervalSchema as unknown as PosixTimeIntervalType;

/// The flexible and extensible structure of metadata is Dict<bytearray, Data> at the cost of type saftey.
/// If there is a standard and it includes `extra: Data` field for extension then you should prefer the well
/// defined definition over using a map for metadata.
export const MetadataSchema = Data.Map(Data.Bytes(), Data.Any());
export type MetadataType = Data.Static<typeof MetadataSchema>;
export const MetadataShape = MetadataSchema as unknown as MetadataType;

export const ChainCredentialSchema = Data.Enum([
  Data.Object({
    VerificationKeyCredential: Data.Tuple([Data.Bytes({ minLength: 28, maxLength: 28 })]),
  }),
  Data.Object({
    ScriptCredential: Data.Tuple([Data.Bytes({ minLength: 28, maxLength: 28 })]),
  }),
]);

export const ChainAddressSchema = Data.Object({
  paymentCredential: ChainCredentialSchema,
  stakeCredential: Data.Nullable(
    Data.Enum([
      Data.Object({ Inline: Data.Tuple([ChainCredentialSchema]) }),
      Data.Object({
        Pointer: Data.Object({
          slotNumber: Data.Integer(),
          transactionIndex: Data.Integer(),
          certificateIndex: Data.Integer(),
        }),
      }),
    ])
  ),
});

export type ChainAddress = Data.Static<typeof ChainAddressSchema>;
export const ChainAddress = ChainAddressSchema as unknown as ChainAddress;

export const CHAIN_FALSE = new Constr(0, []);
export const CHAIN_TRUE = new Constr(1, []);
/// Constructs Aiken representation of a time interval using upper and lower bounds in milliseconds.
/// Defaults to inclusive upper and lower bounds.
export function asChainTimeWindow(
  lowerMs: number,
  upperMs: number,
  inclusiveLowerBound = true,
  inclusiveUpperBound = true
): PosixTimeIntervalType {
  if (Number.isInteger(lowerMs) && Number.isInteger(upperMs)) {
    const lower_bound: PosixTimeIntervalBoundType = {
      bound_type: 'NegativeInfinity',
      is_inclusive: inclusiveLowerBound,
    };

    if (Number.isFinite(lowerMs)) {
      lower_bound.bound_type = { Finite: [BigInt(lowerMs)] };
    } else if (lowerMs !== -Infinity) {
      throw new Error(`${lowerMs} is an invalid lower bound`);
    }

    const upper_bound: PosixTimeIntervalBoundType = {
      bound_type: 'PositiveInfinity',
      is_inclusive: inclusiveUpperBound,
    };
    if (Number.isFinite(upperMs)) {
      upper_bound.bound_type = { Finite: [BigInt(upperMs)] };
    } else if (upperMs !== Infinity) {
      throw new Error(`${upperMs} is an invalid upper bound`);
    }

    return {
      lower_bound,
      upper_bound,
    };
  }

  throw new Error('POSIX time bounds must be integers representing milliseconds since epoch');
}

/// Converts from an on chain time window to the offchain representation
/// Loses the bound inclusive flags but can add if we end up need anything other than inclusive
export function toTimeWindow(interval: PosixTimeIntervalType): TimeWindow {
  const { lower_bound, upper_bound } = interval;
  let fromMs = -Infinity;
  if (typeof lower_bound.bound_type == 'object') {
    fromMs = Number(lower_bound.bound_type.Finite);
  } else {
    throw new Error(`Invalid lower bound of type ${lower_bound.bound_type}`);
  }

  let toMs = Infinity;
  if (typeof upper_bound.bound_type == 'object') {
    toMs = Number(upper_bound.bound_type.Finite);
  } else {
    throw new Error(`Invalid upper bound of type ${upper_bound.bound_type}`);
  }

  return { fromMs, toMs };
}

/// Converts an object into a general metadata map
export function asChainMap(data: Record<string, unknown>): Map<string, Data> {
  const metadata: Map<string, Data> = new Map();
  for (const [key, value] of Object.entries(data)) {
    const encodedKey = fromText(key);
    const encodedValue = typeof value == 'boolean' ? asChainBoolean(value) : Data.fromJson(value);
    metadata.set(encodedKey, encodedValue);
  }

  return metadata;
}

/// Converts a boolean into its chain representation
export function asChainBoolean(bool: boolean) {
  const index = bool ? 1 : 0;
  return new Constr(index, []);
}

/// Converts a Bech32 address to the aiken representation of a chain address
export function asChainAddress(address: Address): ChainAddress {
  const { paymentCredential, stakeCredential } = getAddressDetails(address);

  if (!paymentCredential) throw new Error('Not a valid payment address.');

  return {
    paymentCredential:
      paymentCredential?.type === 'Key'
        ? {
            VerificationKeyCredential: [paymentCredential.hash],
          }
        : { ScriptCredential: [paymentCredential.hash] },
    stakeCredential: stakeCredential
      ? {
          Inline: [
            stakeCredential.type === 'Key'
              ? {
                  VerificationKeyCredential: [stakeCredential.hash],
                }
              : { ScriptCredential: [stakeCredential.hash] },
          ],
        }
      : null,
  };
}

/// Converts a aiken chain address to a bech32 address
export function toBech32Address(lucid: Lucid, address: ChainAddress): Address {
  // Slightly silly lucid contains utils which references lucid only for a single field 'network'
  const { utils } = lucid;

  const paymentCredential = (() => {
    if ('VerificationKeyCredential' in address.paymentCredential) {
      return utils.keyHashToCredential(address.paymentCredential.VerificationKeyCredential[0]);
    } else {
      return utils.scriptHashToCredential(address.paymentCredential.ScriptCredential[0]);
    }
  })();
  const stakeCredential = (() => {
    if (!address.stakeCredential) return undefined;
    if ('Inline' in address.stakeCredential) {
      if ('VerificationKeyCredential' in address.stakeCredential.Inline[0]) {
        return utils.keyHashToCredential(address.stakeCredential.Inline[0].VerificationKeyCredential[0]);
      } else {
        return utils.scriptHashToCredential(address.stakeCredential.Inline[0].ScriptCredential[0]);
      }
    } else {
      return undefined;
    }
  })();
  return utils.credentialToAddress(paymentCredential, stakeCredential);
}
