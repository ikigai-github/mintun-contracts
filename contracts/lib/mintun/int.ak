use aiken/bytearray

/// Convert a bytearray into a base 10 integer.  
/// The byte array must be of even length.
/// This function was lifted from https://github.com/logicalmechanism/assist
pub fn from_hex_bytes(bytes: ByteArray) -> Int {
  bytearray.foldl(bytes, 0, fn(byte, acc) { acc * 256 + byte })
}
