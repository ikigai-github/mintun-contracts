# MintUN Smart Contracts

Currently there are 3 smart contracts provided for batch minting an NFT collection.  The basic flow is to use the state minting policy
to create a state token which has on it's datum the state of the mint.  The token is stored at the state spending validator addres and includes the minting policy id.  The validator requires spending transaction include mints from that minting policy id, unless burning the reference token.  It checks and makes sure the state is updated accordingly when the mint occurs.  The batch minting policy similarly requires any transaction include spending the state user and reference token to ensure the count was updated correctly. 
