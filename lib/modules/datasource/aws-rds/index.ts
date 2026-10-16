import {
  DescribeDBEngineVersionsCommand,
  RDSClient,
} from '@aws-sdk/client-rds';
import { coerceArray } from '../../../util/array.ts';
import { buildCacheKey } from '../../../util/cache/package/key.ts';
import * as hostRules from '../../../util/host-rules.ts'; 
import { Datasource } from '../datasource.ts';
import type { GetReleasesConfig, ReleaseResult } from '../types.ts';

export class AwsRdsDatasource extends Datasource {
  static readonly id = 'aws-rds';

  constructor() {
    super(AwsRdsDatasource.id);
  }

  private getRDSClient(): RDSClient {
    const { password, token, username } = hostRules.find({
      hostType: AwsRdsDatasource.id,
    });
    return new RDSClient({
      credentials:
        username && password
          ? {
              accessKeyId: username,
              secretAccessKey: password,
              sessionToken: token,
            }
          : undefined,
    });
  }
  
  private async fetchReleases({
    packageName: serializedFilter,
  }: GetReleasesConfig): Promise<ReleaseResult | null> {
    const cmd = new DescribeDBEngineVersionsCommand({
      Filters: JSON.parse(serializedFilter),
    });
    const response = await this.getRDSClient().send(cmd);
    const versions = coerceArray(response.DBEngineVersions);
    return {
      releases: versions
        .filter((version) => version.EngineVersion)
        .map((version) => ({
          version: version.EngineVersion!,
          isDeprecated: version.Status === 'deprecated',
        })),
    };
  }

  getReleases(config: GetReleasesConfig): Promise<ReleaseResult | null> {
    return this.cached(
      {
        key: buildCacheKey('getReleases', config.packageName),
        fallback: true,
      },
      () => this.fetchReleases(config),
    );
  }
}
