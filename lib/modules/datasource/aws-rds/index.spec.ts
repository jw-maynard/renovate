import type {
  DBEngineVersion,
  DescribeDBEngineVersionsCommandOutput,
} from '@aws-sdk/client-rds';
import {
  DescribeDBEngineVersionsCommand,
  RDSClient,
} from '@aws-sdk/client-rds';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { mockClient } from 'aws-sdk-client-mock';
import * as hostRules from '../../../util/host-rules.ts';
import { getPkgReleases } from '../index.ts';
import { AwsRdsDatasource } from './index.ts';

vi.mock('@aws-sdk/credential-providers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@aws-sdk/credential-providers')>();
  return {
    ...actual,
    fromNodeProviderChain: vi.fn(actual.fromNodeProviderChain),
  };
});

const rdsMock = mockClient(RDSClient);

const version1: DBEngineVersion = {
  Engine: 'mysql',
  EngineVersion: '8.0.26',
  DBParameterGroupFamily: 'mysql8.0',
  DBEngineDescription: 'MySQL Community Edition',
  DBEngineVersionDescription: 'MySQL 8.0.26',
  ValidUpgradeTarget: [
    {
      Engine: 'mysql',
      EngineVersion: '8.0.27',
      Description: 'MySQL 8.0.27',
      AutoUpgrade: false,
      IsMajorVersionUpgrade: false,
    },
    {
      Engine: 'mysql',
      EngineVersion: '8.0.28',
      Description: 'MySQL 8.0.28',
      AutoUpgrade: false,
      IsMajorVersionUpgrade: false,
    },
  ],
  ExportableLogTypes: ['audit', 'error', 'general', 'slowquery'],
  SupportsLogExportsToCloudwatchLogs: true,
  SupportsReadReplica: true,
  SupportedFeatureNames: [],
  Status: 'available',
  SupportsParallelQuery: false,
  SupportsGlobalDatabases: false,
  MajorEngineVersion: '8.0',
  SupportsBabelfish: false,
};

const version2: DBEngineVersion = {
  Engine: 'mysql',
  EngineVersion: '8.0.27',
  DBParameterGroupFamily: 'mysql8.0',
  DBEngineDescription: 'MySQL Community Edition',
  DBEngineVersionDescription: 'MySQL 8.0.27',
  ValidUpgradeTarget: [
    {
      Engine: 'mysql',
      EngineVersion: '8.0.28',
      Description: 'MySQL 8.0.28',
      AutoUpgrade: false,
      IsMajorVersionUpgrade: false,
    },
  ],
  ExportableLogTypes: ['audit', 'error', 'general', 'slowquery'],
  SupportsLogExportsToCloudwatchLogs: true,
  SupportsReadReplica: true,
  SupportedFeatureNames: [],
  Status: 'deprecated',
  SupportsParallelQuery: false,
  SupportsGlobalDatabases: false,
  MajorEngineVersion: '8.0',
  SupportsBabelfish: false,
};

const version3: DBEngineVersion = {
  Engine: 'mysql',
  EngineVersion: '8.0.28',
  DBParameterGroupFamily: 'mysql8.0',
  DBEngineDescription: 'MySQL Community Edition',
  DBEngineVersionDescription: 'MySQL 8.0.28',
  ValidUpgradeTarget: [],
  ExportableLogTypes: ['audit', 'error', 'general', 'slowquery'],
  SupportsLogExportsToCloudwatchLogs: true,
  SupportsReadReplica: true,
  SupportedFeatureNames: [],
  Status: 'available',
  SupportsParallelQuery: false,
  SupportsGlobalDatabases: false,
  MajorEngineVersion: '8.0',
  SupportsBabelfish: false,
};

function mockDescribeVersionsCommand(
  result: DescribeDBEngineVersionsCommandOutput,
): void {
  rdsMock.on(DescribeDBEngineVersionsCommand).resolves(result);
}

describe('modules/datasource/aws-rds/index', () => {
  beforeEach(() => {
    rdsMock.reset();
    hostRules.clear();
  });

  describe('getPkgReleases()', () => {
    it('without returned versions', async () => {
      mockDescribeVersionsCommand({
        $metadata: {},
      });
      const res = await getPkgReleases({
        datasource: AwsRdsDatasource.id,
        packageName: '[{"Name":"engine","Values":["mysql"]}]',
      });
      expect(res).toBeNull();
    });

    it('prefers host rule credentials over the default provider chain', async () => {
      hostRules.add({
        hostType: AwsRdsDatasource.id,
        username: 'access-key-id',
        password: 'secret-access-key',
        token: 'session-token',
      });
      mockDescribeVersionsCommand({
        $metadata: {},
        DBEngineVersions: [version1],
      });

      await getPkgReleases({
        datasource: AwsRdsDatasource.id,
        packageName: '[{"Name":"engine","Values":["host-rule-credentials"]}]',
      });

      const rds = rdsMock.call(0).thisValue as RDSClient;
      await expect(rds.config.credentials()).resolves.toEqual({
        accessKeyId: 'access-key-id',
        secretAccessKey: 'secret-access-key',
        sessionToken: 'session-token',
        $source: {
          CREDENTIALS_CODE: 'e',
        },
      });
    });

    it('prefers host rule credentials over the configured profile', async () => {
      hostRules.add({
        hostType: AwsRdsDatasource.id,
        username: 'access-key-id',
        password: 'secret-access-key',
      });
      mockDescribeVersionsCommand({
        $metadata: {},
        DBEngineVersions: [version1],
      });

      await getPkgReleases({
        datasource: AwsRdsDatasource.id,
        packageName:
          '[{"Name":"engine","Values":["host-rule-profile"]},{"profile":"ignored-profile"}]',
      });

      expect(fromNodeProviderChain).not.toHaveBeenCalled();
      const rds = rdsMock.call(0).thisValue as RDSClient;
      await expect(rds.config.credentials()).resolves.toMatchObject({
        accessKeyId: 'access-key-id',
        secretAccessKey: 'secret-access-key',
      });
    });

    it('uses the default provider chain without a profile', async () => {
      mockDescribeVersionsCommand({
        $metadata: {},
        DBEngineVersions: [version1],
      });

      await getPkgReleases({
        datasource: AwsRdsDatasource.id,
        packageName: '[{"Name":"engine","Values":["default-chain"]}]',
      });

      expect(fromNodeProviderChain).toHaveBeenCalledExactlyOnceWith(undefined);
    });

    it('uses region and profile from the package name', async () => {
      mockDescribeVersionsCommand({
        $metadata: {},
        DBEngineVersions: [version1],
      });

      const res = await getPkgReleases({
        datasource: AwsRdsDatasource.id,
        packageName:
          '[{"Name":"engine","Values":["region-profile"]},{"region":"eu-central-1","profile":"test-profile"}]',
      });

      expect(res).toEqual({
        releases: [{ isDeprecated: false, version: version1.EngineVersion }],
      });
      expect(fromNodeProviderChain).toHaveBeenCalledExactlyOnceWith({
        profile: 'test-profile',
      });
      const rds = rdsMock.call(0).thisValue as RDSClient;
      await expect(rds.config.region()).resolves.toBe('eu-central-1');
      expect(rdsMock.call(0).args[0].input).toEqual({
        Filters: [{ Name: 'engine', Values: ['region-profile'] }],
      });
    });

    it('with one deprecated version', async () => {
      mockDescribeVersionsCommand({
        $metadata: {},
        DBEngineVersions: [version2],
      });
      const res = await getPkgReleases({
        datasource: AwsRdsDatasource.id,
        packageName: '[{"Name":"engine","Values":["mysql"]}]',
      });
      expect(res).toEqual({
        releases: [
          {
            isDeprecated: true,
            version: version2.EngineVersion,
          },
        ],
      });
    });

    it('with 3 matching versions', async () => {
      mockDescribeVersionsCommand({
        $metadata: {},
        DBEngineVersions: [version1, version2, version3],
      });
      const res = await getPkgReleases({
        datasource: AwsRdsDatasource.id,
        packageName: '[{"Name":"engine","Values":["mysql"]}]',
      });
      expect(res).toEqual({
        releases: [
          {
            isDeprecated: false,
            version: version1.EngineVersion,
          },
          {
            isDeprecated: true,
            version: version2.EngineVersion,
          },
          {
            isDeprecated: false,
            version: version3.EngineVersion,
          },
        ],
      });
    });
  });

  describe('loadConfig()', () => {
    const rdsDatasource = new AwsRdsDatasource();

    it('loads filters without aws config', () => {
      const res = rdsDatasource.loadConfig(
        '[{"Name":"engine","Values":["mysql"]}]',
      );
      expect(res).toEqual([[{ Name: 'engine', Values: ['mysql'] }], {}]);
    });

    it('loads filters with multiple aws configs', () => {
      const res = rdsDatasource.loadConfig(
        '[{"Name":"engine","Values":["mysql"]},{"region":"us-west-2"},{"profile":"test-profile"},{"region":"eu-central-1"}]',
      );
      expect(res).toEqual([
        [{ Name: 'engine', Values: ['mysql'] }],
        { region: 'eu-central-1', profile: 'test-profile' },
      ]);
    });
  });
});
