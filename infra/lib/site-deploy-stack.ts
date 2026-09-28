import { Stack, StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface SiteDeployStackProps extends StackProps {
  webDistPath: string;
  siteBucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
  runtimeConfig: { region: string; userPoolId: string; clientId: string; restUrl: string; wsUrl: string };
}

export class SiteDeployStack extends Stack {
  constructor(scope: Construct, id: string, props: SiteDeployStackProps) {
    super(scope, id, props);
    new s3deploy.BucketDeployment(this, 'Site', {
      sources: [s3deploy.Source.asset(props.webDistPath), s3deploy.Source.jsonData('config.json', props.runtimeConfig)],
      destinationBucket: props.siteBucket,
      distribution: props.distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });
  }
}
