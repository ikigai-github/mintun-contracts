# Scripts

Development utility scripts which right now just consists of a script to bump the contract version. This should be done anytime the contracts.json file is modified or the CI will fail the build.

## Required Tools

- Bun - [bun|(https://bun.sh/docs/installation)]
- Web3 storage cli - `bun install -g @eb3-storage/w3cli`

## Setup web3 storage credentials

You should only need to run these steps once on your machine. The script uses the key and proof for upload permissions.

- Login
  - `w3 login <email>`
- Create a new space
  - `w3 space create "blah"`
- Create a access key
  - `w3 key create `
- Write the private key (starting "Mg...") in the .env file variable `W3_KEY`
- Create a delegate proof and store in proof.txt
  - `w3 delegation create <did_from_w3_key_create_above> --can space/blob/add --can space/index/add --can filecoin/offer --can upload/add --base64 > proof.txt`

## Bump version

```bash
bun run bump-contract-version.ts
```
