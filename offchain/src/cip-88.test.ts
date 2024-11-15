import { expect, test } from 'vitest';

import {
  Cip88Builder,
  FEATURE_DETAIL_FIELD,
  FEATURE_VERSION_FIELD,
  RegistrationMetadataField,
  RegistrationPayloadField,
  SCOPE_PLUTUS_V2,
  TokenProjectDetail,
  TokenProjectDetailField,
} from './cip-88';
import { parameterizeMintingPolicy } from './contract';
import contractsUrl from './contracts-url';
import { TEST_COLLECTION_INFO } from './fixtures.test';
import { fetchContracts } from './script';
import { createEmulatorLucid } from './support.test';

test('Build CIP-88 metadata', async () => {
  const { lucid, seedUtxo } = await createEmulatorLucid();

  const contracts = await fetchContracts(contractsUrl);

  const mintingPolicy = parameterizeMintingPolicy(lucid, contracts, seedUtxo.txHash, seedUtxo.outputIndex);
  const policyId = `0x${mintingPolicy.policyId}`;
  const address = await lucid.wallet.address();
  const info = TEST_COLLECTION_INFO;
  const royalty = { address, variableFee: 1.2 };
  const assetName = '';
  const oracleUri = 'https://www.whatever.com';

  const metadata = await Cip88Builder.register(mintingPolicy.script)
    .cip68Info(info)
    .cip27Royalty(royalty)
    .cip102Royalties([royalty])
    .oracle(oracleUri)
    .validateWithbeacon(mintingPolicy.policyId)
    .build(lucid);

  expect(metadata[RegistrationMetadataField.VERSION] === 1, 'CIP 88 Version 1');
  expect(metadata[RegistrationMetadataField.WITNESS][0].length === 0, 'Beacon validation uses empty witness set');

  const payload = metadata[RegistrationMetadataField.PAYLOAD];
  const scope = payload[RegistrationPayloadField.SCOPE];

  expect(scope[0] === SCOPE_PLUTUS_V2, 'Scope is plutus v2');
  expect(scope[1][0] === policyId, 'Scope Minting policy matches supplied script');

  const featureSet = payload[RegistrationPayloadField.FEATURE_SET];

  expect(featureSet.length === 3, 'Exactly three features selected');
  expect(featureSet.includes(27), 'Feature set include CIP-27');
  expect(featureSet.includes(68), 'Feature set includes CIP-68');
  expect(featureSet.includes(102), 'Feature set include CIP-102');

  const validationMethod = payload[RegistrationPayloadField.VALIDATION_METHOD];

  expect(validationMethod[0] === 1, 'Validation method is beacon token');
  expect(validationMethod[1] !== undefined, 'Validation tuple second value must not be undefined');
  if (!validationMethod[1]) throw new Error('Make type checker happy');
  expect(validationMethod[1][0] === policyId, 'Validation Method Beacon Token Policy matches minting policy');
  expect(validationMethod[1][1] === assetName, 'Beacon token asset name is null (can be other things)');

  const nonce = payload[RegistrationPayloadField.NONCE];
  expect(nonce > 0, 'Nonce is a positive integer');

  const oracle = payload[RegistrationPayloadField.ORACLE_URI];
  expect(oracle[0] === 'https://', 'Oracle uri scheme is https://');
  expect(oracle.join('') === oracleUri, 'Oracle uri chunks rejoined matches full uri');

  const features = payload[RegistrationPayloadField.FEATURE_DETAILS];

  const detailWrapper = features[68] as TokenProjectDetail;
  expect(detailWrapper[FEATURE_VERSION_FIELD] === 1, 'CIP-68 feature version field is 1');

  const tokenDetail = detailWrapper[FEATURE_DETAIL_FIELD];
  expect(
    tokenDetail[TokenProjectDetailField.NAME] === TEST_COLLECTION_INFO.name,
    `Token detail name is ${TEST_COLLECTION_INFO.name}`
  );
  expect(
    tokenDetail[TokenProjectDetailField.DESCRIPTION]?.join('') === info.description,
    'Token detail description chunks rejoin into original description'
  );
});
