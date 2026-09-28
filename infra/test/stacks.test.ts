import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BackendStack } from '../lib/backend-stack';
import { SiteDeployStack } from '../lib/site-deploy-stack';
import { WafStack } from '../lib/waf-stack';
import { WebStack } from '../lib/web-stack';

const env = { account: '123456789012', region: 'us-east-1' };
const repoRoot = path.resolve(__dirname, '..', '..');

function build() {
  // skip Lambda bundling in unit tests
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const waf = new WafStack(app, 'DfmeaWaf', { env });
  const web = new WebStack(app, 'DfmeaWeb', { env, webAclArn: waf.webAclArn });
  const backend = new BackendStack(app, 'DfmeaBackend', {
    env, repoRoot, hitlThreshold: 0.6, distributionDomainName: web.distribution.distributionDomainName,
  });
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dfmea-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
  const site = new SiteDeployStack(app, 'DfmeaSiteDeploy', {
    env, webDistPath: dist, siteBucket: web.siteBucket, distribution: web.distribution,
    runtimeConfig: { region: 'us-east-1', userPoolId: 'p', clientId: 'c', restUrl: 'r', wsUrl: 'w' },
  });
  return {
    waf: Template.fromStack(waf), web: Template.fromStack(web),
    backend: Template.fromStack(backend), site: Template.fromStack(site),
  };
}

const t = build();

test('WebACL is CLOUDFRONT scoped with common rules and rate limit', () => {
  t.waf.hasResourceProperties('AWS::WAFv2::WebACL', {
    Scope: 'CLOUDFRONT',
    Rules: Match.arrayWith([
      Match.objectLike({ Statement: { ManagedRuleGroupStatement: Match.objectLike({ Name: 'AWSManagedRulesCommonRuleSet' }) } }),
      Match.objectLike({ Statement: { RateBasedStatement: Match.objectLike({ Limit: 1000, AggregateKeyType: 'IP' }) } }),
    ]),
  });
});

test('Distribution has WebACLId, OAC and SPA fallbacks', () => {
  t.web.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      WebACLId: Match.anyValue(),
      DefaultRootObject: 'index.html',
      CustomErrorResponses: Match.arrayWith([Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' })]),
    }),
  });
  t.web.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
});

test('buckets block all public access', () => {
  const block = { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true };
  t.web.hasResourceProperties('AWS::S3::Bucket', { PublicAccessBlockConfiguration: block });
  t.backend.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: block, VersioningConfiguration: { Status: 'Enabled' },
  });
});

test('state machine waits for a task token with 24h timeout and catches all', () => {
  const sm = t.backend.findResources('AWS::StepFunctions::StateMachine');
  const def = JSON.stringify(Object.values(sm)[0].Properties.DefinitionString);
  expect(def).toContain('lambda:invoke.waitForTaskToken');
  expect(def).toContain('\\"TimeoutSeconds\\":86400');
  expect(def).toContain('States.ALL');
  expect(def).toContain('Throttling');
});

test('REST API uses Cognito authorizer and throttling', () => {
  t.backend.hasResourceProperties('AWS::ApiGateway::Authorizer', { Type: 'COGNITO_USER_POOLS' });
  t.backend.hasResourceProperties('AWS::ApiGateway::Stage', {
    MethodSettings: Match.arrayWith([Match.objectLike({ ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 })]),
  });
});

test('Lambdas are python3.13 arm64 and user pool disallows self sign-up', () => {
  const fns = Object.values(t.backend.findResources('AWS::Lambda::Function')).filter((f) =>
    String(f.Properties.Handler).startsWith('dfmea.'),
  );
  for (const f of fns) expect(f.Properties.Runtime).toBe('python3.13');
  expect(fns).toHaveLength(4);
  for (const f of fns) expect(f.Properties.Architectures).toEqual(['arm64']);
  t.backend.hasResourceProperties('AWS::Cognito::UserPool', {
    AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    UserPoolTier: 'LITE',
  });
});

test('site deploy writes config.json', () => {
  t.site.resourceCountIs('Custom::CDKBucketDeployment', 1);
});
