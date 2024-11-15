/// CIP-88 definitions and builder
import { fromUnit, type Lucid, type Script, type Tx } from 'lucid-cardano';

import { asChainVariableFee } from './cip-102';
import { CollectionImage, CollectionInfo } from './collection-info';
import { IMAGE_PURPOSE } from './image';
import { Royalty } from './royalty';
import { chunk } from './utils';

export const CIP_88_METADATA_LABEL = 867;

export type Cip88ExtraConfig = {
  info?: CollectionInfo;
  cip27Royalty?: Royalty;
  cip102Royalties?: Royalty[];
};

export const RegistrationMetadataField = {
  VERSION: 0,
  PAYLOAD: 1,
  WITNESS: 2,
} as const;

export type RegistrationMetadata = {
  [RegistrationMetadataField.VERSION]: 1;
  [RegistrationMetadataField.PAYLOAD]: RegistrationPayload;
  [RegistrationMetadataField.WITNESS]: string[][];
};

export const SCOPE_NATIVE = 0;
export const SCOPE_PLUTUS_V1 = 1;
export const SCOPE_PLUTUS_V2 = 2;

/// Only currently supported is native script [0, [policy_id, [compiled_script_hex]]]
/// but just to give an idea of what a smart contract would look like added the other script types found in lucid
/// I think the compiled hex will be less useful in smart contract and potentially makes the metadata quite large so it isn't in the plutus scope
export type RegistrationScope = [0, [string, string[]]] | [typeof SCOPE_PLUTUS_V1 | typeof SCOPE_PLUTUS_V2, [string]];

// TODO: Expand to rest of spec NFT to CIP-26, CIP-48, CIP-60, and CIP-86
// Currently supported standards for CIP-88 payload
export type RegistrationFeatureStandard = 25 | 27 | 68 | 102;

// Either [0] (Ed25519 Key Signature) or [1, [policyid, assetid]] (Beacon Token)
export type RegistrationValidationMethod = [0] | [1, [string, string]];
export type RegistrationFeatureDetails = Partial<Record<RegistrationFeatureStandard, object>>;

export const RegistrationPayloadField = {
  SCOPE: 1,
  FEATURE_SET: 2,
  VALIDATION_METHOD: 3,
  NONCE: 4,
  ORACLE_URI: 5,
  FEATURE_DETAILS: 6,
} as const;

export type RegistrationPayload = {
  [RegistrationPayloadField.SCOPE]: RegistrationScope;
  [RegistrationPayloadField.FEATURE_SET]: RegistrationFeatureStandard[];
  [RegistrationPayloadField.VALIDATION_METHOD]: RegistrationValidationMethod;
  [RegistrationPayloadField.NONCE]: number;
  [RegistrationPayloadField.ORACLE_URI]: string[];
  [RegistrationPayloadField.FEATURE_DETAILS]: RegistrationFeatureDetails;
};

// Common field structure across the cip-detail
export const FEATURE_VERSION_FIELD = 0;
export const FEATURE_DETAIL_FIELD = 1;

export const TokenProjectDetailField = {
  NAME: 0,
  DESCRIPTION: 1,
  PROJECT_IMAGE: 2,
  PROJECT_BANNER: 3,
  NSFW_FLAG: 4,
  SOCIAL: 5,
  PROJECT_ARTIST: 6,
} as const;

/// Cip-88 Defined Token Project Detail used by CIP-68 and CIP-25 token projects
export type TokenProjectDetail = {
  [FEATURE_VERSION_FIELD]: 1;
  [FEATURE_DETAIL_FIELD]: {
    [TokenProjectDetailField.NAME]: string;
    [TokenProjectDetailField.DESCRIPTION]?: string[];
    [TokenProjectDetailField.PROJECT_IMAGE]?: string[];
    [TokenProjectDetailField.PROJECT_BANNER]?: string[];
    [TokenProjectDetailField.NSFW_FLAG]?: 0 | 1;
    [TokenProjectDetailField.SOCIAL]?: Record<string, string[]>;
    [TokenProjectDetailField.PROJECT_ARTIST]?: string;
  };
};

export const Cip27RoyaltyDetailField = {
  RATE: 0,
  RECIPIENT: 1,
} as const;

export type Cip27RoyaltyDetail = {
  [FEATURE_VERSION_FIELD]: 1;
  [FEATURE_DETAIL_FIELD]: {
    [Cip27RoyaltyDetailField.RATE]?: string;
    [Cip27RoyaltyDetailField.RECIPIENT]: string[];
  };
};

export const Cip102RoyaltyDetailField = {
  ADDRESS: 0,
  VARIABLE_FEE: 1,
  MIN_FEE: 2,
  MAX_FEE: 3,
} as const;

export type Cip102RoyaltyRecipient = {
  [Cip102RoyaltyDetailField.ADDRESS]: string[];
  [Cip102RoyaltyDetailField.VARIABLE_FEE]?: number;
  [Cip102RoyaltyDetailField.MIN_FEE]?: number;
  [Cip102RoyaltyDetailField.MAX_FEE]?: number;
};

export type Cip102RoyaltyDetail = {
  [FEATURE_VERSION_FIELD]: 1;
  [FEATURE_DETAIL_FIELD]: Cip102RoyaltyRecipient[];
};

/// Break up a URI per the CIP-88 standard where the URI scheme is in index 0
export function cip88Uri(uri: string) {
  const [scheme, path] = uri.split('://', 2);

  if (scheme && scheme.length > 1 && path && path.length) {
    if (path.length > 64) {
      return [`${scheme}://`, ...chunk(path)];
    } else {
      return [`${scheme}://`, path];
    }
  }

  throw new Error(`Unable to parse scheme from URI ${uri}`);
}

/// Map collection info images into the TokenDetail image fields
function mapImages(info: CollectionInfo) {
  /// Find the best matching purpose for the project profile image and the project banner image.
  function selectImages(images: CollectionImage[]) {
    // Could be fancier here to reduce from 5*N search but it should be a tiny N list to search
    const brand = images.find((image) => image.purpose === IMAGE_PURPOSE.Brand);
    const banner = images.find((image) => image.purpose === IMAGE_PURPOSE.Banner);
    const thumbnail = images.find((image) => image.purpose === IMAGE_PURPOSE.Thumbnail);
    const general = images.find((image) => image.purpose === IMAGE_PURPOSE.General);
    const gallery = images.find((image) => image.purpose === IMAGE_PURPOSE.Gallery);

    return [brand || thumbnail || general, banner || gallery || general];
  }

  let profile: string[] | undefined;
  let banner: string[] | undefined;
  if (info.images) {
    const [profileImage, bannerImage] = selectImages(info.images);
    if (profileImage) {
      profile = cip88Uri(profileImage.src);
    }

    if (bannerImage) {
      banner = cip88Uri(bannerImage.src);
    }
  }

  return {
    profile,
    banner,
  };
}

// Map collection info nsfw boolean to the CIP-88 representation (1 or 0)
function mapNsfw(info: CollectionInfo) {
  if (info.nsfw !== undefined) {
    return info.nsfw ? 1 : 0;
  }

  return undefined;
}

// Map social records to the chunked URI format
function mapSocial(info: CollectionInfo) {
  if (info.links) {
    const mapped: Record<string, string[]> = {};
    for (const [label, uri] of Object.entries(info.links)) {
      if (uri) {
        mapped[label] = cip88Uri(uri);
      }
    }

    return mapped;
  }

  return undefined;
}

// Chunk the description if it is too long
function mapDescription(info: CollectionInfo) {
  if (info.description) {
    return chunk(info.description);
  }

  return undefined;
}

/// Converts a collection info object into a token detail object
export function toTokenProjectDetail(info: CollectionInfo): TokenProjectDetail {
  const { profile, banner } = mapImages(info);

  return {
    [FEATURE_VERSION_FIELD]: 1,
    [FEATURE_DETAIL_FIELD]: {
      [TokenProjectDetailField.NAME]: info.name,
      [TokenProjectDetailField.DESCRIPTION]: mapDescription(info),
      [TokenProjectDetailField.PROJECT_IMAGE]: profile,
      [TokenProjectDetailField.PROJECT_BANNER]: banner,
      [TokenProjectDetailField.NSFW_FLAG]: mapNsfw(info),
      [TokenProjectDetailField.SOCIAL]: mapSocial(info),
      [TokenProjectDetailField.PROJECT_ARTIST]: info.project || info.artist,
    },
  };
}

export function toCip27RoyaltyDetail(royalty: Royalty): Cip27RoyaltyDetail {
  const address = chunk(royalty.address);
  if (royalty.variableFee) {
    return {
      [FEATURE_VERSION_FIELD]: 1,
      [FEATURE_DETAIL_FIELD]: {
        [Cip27RoyaltyDetailField.RECIPIENT]: address,
        [Cip27RoyaltyDetailField.RATE]: `${royalty.variableFee / 100}`,
      },
    };
  }
  return {
    [FEATURE_VERSION_FIELD]: 1,
    [FEATURE_DETAIL_FIELD]: {
      [Cip27RoyaltyDetailField.RECIPIENT]: address,
    },
  };
}

export function toCip102RoyaltyRecipient(royalty: Royalty) {
  const address = chunk(royalty.address);
  const recipient: Cip102RoyaltyRecipient = {
    [Cip102RoyaltyDetailField.ADDRESS]: address,
  };

  if (royalty.variableFee !== undefined) {
    recipient[Cip102RoyaltyDetailField.VARIABLE_FEE] = Number(asChainVariableFee(royalty.variableFee));
  }

  if (royalty.maxFee !== undefined) {
    recipient[Cip102RoyaltyDetailField.MAX_FEE] = royalty.maxFee;
  }

  if (royalty.minFee !== undefined) {
    recipient[Cip102RoyaltyDetailField.MIN_FEE] = royalty.minFee;
  }

  return recipient;
}

export function toCip102RoyaltyDetail(royalties: Royalty[]): Cip102RoyaltyDetail {
  const recipients = royalties.map(toCip102RoyaltyRecipient);
  return {
    [FEATURE_VERSION_FIELD]: 1,
    [FEATURE_DETAIL_FIELD]: recipients,
  };
}

export class Cip88Builder {
  #script: Script;
  #beacon?: string;
  #features: RegistrationFeatureDetails = {};
  #oracle?: string;

  private constructor(script: Script) {
    this.#script = script;
  }

  public static register(script: Script) {
    return new Cip88Builder(script);
  }

  cip68Info(info: CollectionInfo) {
    const detail = toTokenProjectDetail(info);
    return this.tokenProject(68, detail);
  }

  cip25Info(info: CollectionInfo) {
    const detail = toTokenProjectDetail(info);
    return this.tokenProject(25, detail);
  }

  cip27Royalty(royalty: Royalty) {
    const detail = toCip27RoyaltyDetail(royalty);
    this.#features[27] = detail;
    return this;
  }

  cip102Royalties(royalties: Royalty[]) {
    const detail = toCip102RoyaltyDetail(royalties);
    this.#features[102] = detail;
    return this;
  }

  oracle(url: string) {
    this.#oracle = url;
    return this;
  }

  validateWithbeacon(unit: string) {
    this.#beacon = unit;
    return this;
  }

  async build(lucid: Lucid): Promise<RegistrationMetadata> {
    if (!lucid.wallet) {
      throw new Error('Must provide an instance of lucide with a selected wallet');
    }

    const payload = this.buildPayload(lucid);

    // FIXME: I am not sure if we leave the witness section empty when we use a beacon token.
    let witness: string[][] = [[]];
    if (!this.#beacon) {
      const address = await lucid.wallet.address();
      // FIXME: This seems wrong. The standard under 3. Validation Method says:
      // "The payload to be signed should be the hex-encoded CBOR representation of the Registration Payload object."
      // so I think I might need to declare a complete data schema for CIP-88 and use Data.to(...) to get correct cbor hex.
      const result = await lucid.wallet.signMessage(address, JSON.stringify(payload));
      // Probably should also add `0x` to these to convert them into byte arrays in the metadata
      witness = [[result.key, result.signature]];
    }

    return {
      [RegistrationMetadataField.VERSION]: 1,
      [RegistrationMetadataField.PAYLOAD]: payload,
      [RegistrationMetadataField.WITNESS]: witness,
    };
  }

  private tokenProject(standard: 25 | 68, detail: TokenProjectDetail) {
    if (this.#features[25] || this.#features[68]) {
      throw new Error(
        'Cannot declare a token project more than once. If your minting policy is CIP-68 but also emits CIP-25  for backward compatability just use 68'
      );
    }

    this.#features[standard] = detail;
    return this;
  }

  private buildPayload(lucid: Lucid): RegistrationPayload {
    const scope = this.buildScope(lucid);
    let validationMethod: RegistrationValidationMethod | undefined;
    if (this.#beacon) {
      const { policyId, assetName } = fromUnit(this.#beacon);

      const hexAssetName = assetName ? `0x${assetName}` : '';
      validationMethod = [1, [`0x${policyId}`, hexAssetName]];
    } else {
      validationMethod = [0]; // Witness validation
    }

    const nonce = Date.now();
    const oracleUri = this.#oracle ? cip88Uri(this.#oracle) : [];
    const featureSet = Object.keys(this.#features).map((feature) => Number(feature)) as RegistrationFeatureStandard[];

    return {
      [RegistrationPayloadField.SCOPE]: scope,
      [RegistrationPayloadField.FEATURE_SET]: featureSet,
      [RegistrationPayloadField.VALIDATION_METHOD]: validationMethod,
      [RegistrationPayloadField.NONCE]: nonce,
      [RegistrationPayloadField.ORACLE_URI]: oracleUri,
      [RegistrationPayloadField.FEATURE_DETAILS]: this.#features,
    };
  }

  private buildScope(lucid: Lucid): RegistrationScope {
    const policyId = `0x${lucid.utils.validatorToScriptHash(this.#script)}`;

    if (this.#script.type === 'Native') {
      const scriptChunks = chunk(this.#script.script, 64, '0x');
      return [SCOPE_NATIVE, [policyId, scriptChunks]];
    } else if (this.#script.type === 'PlutusV1') {
      return [SCOPE_PLUTUS_V1, [policyId]];
    } else if (this.#script.type === 'PlutusV2') {
      return [SCOPE_PLUTUS_V2, [policyId]];
    }

    throw Error(`Could not determine scope. Unexpected script type ${this.#script.type}`);
  }
}

export async function addCip88MetadataToTransaction(
  lucid: Lucid,
  tx: Tx,
  script: Script,
  beaconUnit: string,
  config: Cip88ExtraConfig | undefined = undefined
) {
  const builder = Cip88Builder.register(script).validateWithbeacon(beaconUnit);

  if (config) {
    if (config.cip27Royalty) {
      builder.cip27Royalty(config.cip27Royalty);
    }

    if (config.cip102Royalties) {
      builder.cip102Royalties(config.cip102Royalties);
    }

    if (config.info) {
      builder.cip68Info(config.info);
    }
  }

  const metadata = await builder.build(lucid);
  return tx.attachMetadataWithConversion(CIP_88_METADATA_LABEL, metadata);
}
