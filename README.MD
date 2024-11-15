# Mintun

This project consists of smart contracts for minting CIP-68, CIP-88 & CIP-102 standard NFTs with a few bells and whistles. It also includes an offchain library with lucid integration for using those smart contracts from javascript or typescript. The web project is a new user friendly tool project that leverages the contracts and offchain to let users create and manage different types of token collections. You can use the tool by visiting https://mintun.vercel.app.

## How To Build and Test

This project targets NodeJS 20 and leverages PNPM workspaces. In other words you will need NodeJS and PNPM installed at a minimum. You can then run `pnpm install && pnpm build` to get everything ready to go.

### Smart Contracts

The smart contracts are written in the Aiken language. So you need the Aiken CLI installed as well if you want to compile those contracts. You can target compling just the contracts with `pnpm build:aiken` or if you want traces `pnpm build:aiken:trace`.

### Offchain Library

If modifying the offchain code then `pnpm test` will likely be your most common command followed by `pnpm build:offchain` when you are satisfied your changes and tests are working as intended.

### Publishing a Release

If you want to build the smart contracts, offchain library, and website all in one go then use `pnpm build:full`. This is the command used by Github actions when deploying the web application to Vercel. This is as close as we have right now to a release.

The offchain doesn't publish to NPM it just relies on the workspace link. In the future we will add a versioning and release step for publishing the offchain library with the compiled smart contract.
