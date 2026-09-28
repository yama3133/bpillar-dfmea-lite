#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { App, Annotations } from 'aws-cdk-lib';
import { BackendStack } from '../lib/backend-stack';
import { SiteDeployStack } from '../lib/site-deploy-stack';
import { WafStack } from '../lib/waf-stack';
import { WebStack } from '../lib/web-stack';

const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' };
const repoRoot = path.resolve(__dirname, '..', '..');
const hitlThreshold = Number(app.node.tryGetContext('hitlThreshold') ?? 0.6);

const waf = new WafStack(app, 'DfmeaWaf', { env });
const web = new WebStack(app, 'DfmeaWeb', { env, webAclArn: waf.webAclArn });
const backend = new BackendStack(app, 'DfmeaBackend', {
  env,
  repoRoot,
  hitlThreshold,
  distributionDomainName: web.distribution.distributionDomainName,
});

const webDist = path.join(repoRoot, 'web', 'dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  new SiteDeployStack(app, 'DfmeaSiteDeploy', {
    env,
    webDistPath: webDist,
    siteBucket: web.siteBucket,
    distribution: web.distribution,
    runtimeConfig: {
      region: env.region,
      userPoolId: backend.userPool.userPoolId,
      clientId: backend.userPoolClient.userPoolClientId,
      restUrl: backend.restUrl,
      wsUrl: backend.wsUrl,
    },
  });
} else {
  Annotations.of(app).addWarningV2('dfmea:noWebDist', 'web/dist not built; DfmeaSiteDeploy skipped (run npm run build in web/)');
}
