import { fromText, toText, type Lucid, type Tx, type Unit, type UTxO } from 'lucid-cardano';

/// Simple form of UTxO that only includes part needed to reference a transaction
export type TxReference = {
  txHash: string;
  outputIndex: number;
};

/// Utility function for completing a transaction, signing it, and then submitting it.
export async function submit(tx: Tx) {
  const completed = await tx.complete();
  const signed = await completed.sign().complete();
  return await signed.submit();
}

/// Result of trying to find a UTxO.
/// wallet is false if the UTxO was not found in the selected lucid wallet.
export type UtxoFindResult = {
  utxo?: UTxO;
  wallet: boolean;
};

/// Utility function to find a utxo first in wallet then in general if no match was found
export async function findUtxo(lucid: Lucid, unit: Unit): Promise<UtxoFindResult> {
  // Normally should be in the wallet
  let utxo: UTxO | undefined = undefined;
  let wallet = false;
  if (lucid.wallet) {
    const utxos = await lucid.wallet.getUtxos();
    utxo = utxos.find((utxo) => utxo.assets[unit]);
  }

  // Wider net search but can't be spent from current wallet
  if (!utxo) {
    utxo = await lucid.utxoByUnit(unit);
  } else {
    wallet = true;
  }

  return {
    utxo,
    wallet,
  };
}

/// Sanity check that it string conforms to a 28 byte hex string. Does not guarantee it really is a policy id.
export function checkPolicyId(policyId: string) {
  return /[0-9A-Fa-f]{56}/.test(policyId);
}

/// Utility function splitting a UTF8 string into chunks
/// Default characters per chunk is 64
/// Prefix is applied to every chunk.  Mainly for adding a 0x to each part of chunked hex string.
export function chunk(str: string, charactersPerChunk = 64, prefix = ''): string[] {
  const chunks = Array(Math.ceil(str.length / charactersPerChunk));
  for (let i = 0; i < chunks.length; ++i) {
    chunks[i] = `${prefix}${str.slice(i * charactersPerChunk, (i + 1) * charactersPerChunk)}`;
  }

  return chunks;
}

/// Utility function for encoding and splitting a UTF8 string into 64 byte chunks.
export function asChunkedHex(utf8String: string, prefix = ''): string[] {
  const hex = fromText(utf8String);
  const charactersPerChunk = 128;
  return chunk(hex, charactersPerChunk, prefix);
}

/// Utility function for resting a chunked hex string to a single UTF8 string
export function toJoinedText(hexStrings: string | string[]) {
  if (Array.isArray(hexStrings)) {
    return toText(hexStrings.join(''));
  } else {
    return toText(hexStrings);
  }
}

export function stringifyReplacer(_: unknown, value: unknown) {
  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  } else if (typeof value == 'bigint') {
    return value.toString();
  }

  return value;
}

function isRecord(record: unknown): record is Record<string, unknown> | unknown[] {
  return typeof record === 'object' || Array.isArray(record);
}

export function removeEmpty(record: Record<string, unknown> | unknown[]) {
  if (Array.isArray(record)) {
    record.forEach((item) => {
      if (isRecord(item)) {
        removeEmpty(item);
      }
    });
  } else {
    for (const key in record) {
      const value = record[key];
      if (value === null || value === undefined) {
        delete record[key];
      } else if (isRecord(value)) {
        removeEmpty(value);
      }
    }
  }
}
