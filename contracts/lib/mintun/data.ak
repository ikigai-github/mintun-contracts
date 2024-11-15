use aiken/dict
use aiken/transaction.{Datum, DatumHash, InlineDatum, NoDatum, Transaction}

/// Get data from datum whether it is inline or by lookup
pub fn extract(tx: Transaction, datum: Datum) -> Option<Data> {
  when datum is {
    NoDatum -> None
    DatumHash(hash) -> dict.get(tx.datums, hash)
    InlineDatum(data) -> Some(data)
  }
}
