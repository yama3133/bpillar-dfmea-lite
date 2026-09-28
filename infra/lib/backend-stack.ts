import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { pythonBundle } from './python-bundle';

export interface BackendStackProps extends StackProps {
  distributionDomainName: string;
  repoRoot: string;
  hitlThreshold: number;
  analystModelId?: string;
  specialistModelId?: string;
}

const ONTOLOGY_KEY = 'bpillar.ttl';

export class BackendStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly restUrl: string;
  public readonly wsUrl: string;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);
    const analystModel = props.analystModelId ?? 'us.anthropic.claude-sonnet-4-6';
    const specialistModel = props.specialistModelId ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
    const allowedOrigins = [`https://${props.distributionDomainName}`, 'http://localhost:5173'];

    // ---------- Storage ----------
    const ontologyBucket = new s3.Bucket(this, 'OntologyBucket', {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    new s3deploy.BucketDeployment(this, 'OntologyDeploy', {
      sources: [s3deploy.Source.asset(path.join(props.repoRoot, 'ontology'), { exclude: ['*', `!${ONTOLOGY_KEY}`] })],
      destinationBucket: ontologyBucket,
      prune: false,
    });

    const reviews = new dynamodb.Table(this, 'Reviews', {
      partitionKey: { name: 'reviewId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const connections = new dynamodb.Table(this, 'Connections', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    connections.addGlobalSecondaryIndex({
      indexName: 'byReview',
      partitionKey: { name: 'reviewId', type: dynamodb.AttributeType.STRING },
    });

    // ---------- Auth ----------
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      featurePlan: cognito.FeaturePlan.LITE,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.userPoolClient = this.userPool.addClient('WebClient', {
      authFlows: { userSrp: true, userPassword: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
    });

    // ---------- Lambdas ----------
    const code = pythonBundle(path.join(props.repoRoot, 'backend'));
    const baseEnv = {
      REVIEWS_TABLE: reviews.tableName,
      CONNECTIONS_TABLE: connections.tableName,
      ONTOLOGY_BUCKET: ontologyBucket.bucketName,
      ONTOLOGY_KEY,
    };
    const fn = (name: string, handler: string, memorySize: number, timeout: Duration, env: Record<string, string>) => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      return new lambda.Function(this, name, {
        runtime: lambda.Runtime.PYTHON_3_13,
        architecture: lambda.Architecture.ARM_64,
        code,
        handler,
        memorySize,
        timeout,
        logGroup,
        environment: { ...baseEnv, ...env },
      });
    };
    const apiFn = fn('DfmeaApiFn', 'dfmea.handlers.api.handler', 256, Duration.seconds(30), {
      ALLOWED_ORIGINS: allowedOrigins.join(','),
    });
    const wsFn = fn('WsFn', 'dfmea.handlers.ws.handler', 256, Duration.seconds(10), {
      USER_POOL_ID: this.userPool.userPoolId,
      USER_POOL_CLIENT_ID: this.userPoolClient.userPoolClientId,
    });
    const workflowFn = fn('WorkflowFn', 'dfmea.handlers.workflow.handler', 512, Duration.seconds(60), {
      HITL_CONFIDENCE_THRESHOLD: String(props.hitlThreshold),
    });
    const analyzeFn = fn('AnalyzeFn', 'dfmea.handlers.analyze.handler', 1024, Duration.seconds(900), {
      ANALYST_MODEL_ID: analystModel,
      SPECIALIST_MODEL_ID: specialistModel,
    });

    // ---------- WebSocket API ----------
    const wsApi = new apigwv2.WebSocketApi(this, 'WsApi', {
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('Connect', wsFn) },
      disconnectRouteOptions: { integration: new WebSocketLambdaIntegration('Disconnect', wsFn) },
    });
    // No access logging on purpose: the ID token travels in the $connect query string.
    const wsStage = new apigwv2.WebSocketStage(this, 'WsStage', { webSocketApi: wsApi, stageName: 'prod', autoDeploy: true });
    for (const f of [apiFn, workflowFn, analyzeFn]) {
      f.addEnvironment('WS_ENDPOINT', wsStage.callbackUrl);
      wsStage.grantManagementApiAccess(f);
    }

    // ---------- IAM (least privilege) ----------
    const ddbWrite = ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query', 'dynamodb:BatchWriteItem'];
    const connRead = new iam.PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:DeleteItem'],
      resources: [connections.tableArn, `${connections.tableArn}/index/byReview`],
    });
    for (const f of [apiFn, workflowFn, analyzeFn]) {
      f.addToRolePolicy(new iam.PolicyStatement({ actions: ddbWrite, resources: [reviews.tableArn] }));
      f.addToRolePolicy(connRead);
    }
    wsFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['dynamodb:PutItem', 'dynamodb:DeleteItem'], resources: [connections.tableArn] }),
    );
    const ontologyObj = ontologyBucket.arnForObjects(ONTOLOGY_KEY);
    apiFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [ontologyObj] }));
    workflowFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['s3:GetObject', 's3:GetObjectVersion'], resources: [ontologyObj] }),
    );
    analyzeFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObjectVersion'], resources: [ontologyObj] }));
    const fmId = (profile: string) => profile.replace(/^us\./, '');
    analyzeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          ...[analystModel, specialistModel].map((m) => `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${m}`),
          // US cross-region inference profiles route to any US region
          ...[analystModel, specialistModel].map((m) => `arn:aws:bedrock:*::foundation-model/${fmId(m)}`),
        ],
      }),
    );

    // ---------- Step Functions ----------
    const rid = sfn.JsonPath.stringAt('$.reviewId');
    const step = (id: string, lambdaFn: lambda.IFunction, payload: Record<string, unknown>, timeout: Duration) =>
      new tasks.LambdaInvoke(this, id, {
        lambdaFunction: lambdaFn,
        payload: sfn.TaskInput.fromObject(payload),
        payloadResponseOnly: true,
        taskTimeout: sfn.Timeout.duration(timeout),
      });

    const failState = new sfn.Fail(this, 'Failed');
    const notifyFailure = step(
      'NotifyFailure', workflowFn, { step: 'fail', reviewId: rid, error: sfn.JsonPath.objectAt('$.error') }, Duration.seconds(60),
    ).next(failState);
    const catchAll = <T extends sfn.TaskStateBase>(t: T): T => {
      t.addCatch(notifyFailure, { errors: ['States.ALL'], resultPath: '$.error' });
      return t;
    };

    const pin = catchAll(step('PinOntology', workflowFn, { step: 'pin', reviewId: rid }, Duration.seconds(60)));
    const analyze = catchAll(step('Analyze', analyzeFn, { reviewId: rid }, Duration.seconds(900)));
    analyze.addRetry({
      errors: ['Throttling', 'TooManyRequestsException', 'Lambda.TooManyRequestsException'],
      maxAttempts: 3,
      backoffRate: 2,
      interval: Duration.seconds(10),
    });
    const validate = catchAll(step('Validate', workflowFn, { step: 'validate', reviewId: rid }, Duration.seconds(60)));
    const hitlGate = catchAll(
      new tasks.LambdaInvoke(this, 'HitlGate', {
        lambdaFunction: workflowFn,
        integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        payload: sfn.TaskInput.fromObject({ step: 'hitl_request', reviewId: rid, taskToken: sfn.JsonPath.taskToken }),
        taskTimeout: sfn.Timeout.duration(Duration.hours(24)),
        resultPath: '$.hitl',
      }),
    );
    const done = new sfn.Succeed(this, 'Done');
    const finalize = catchAll(
      step('Finalize', workflowFn, { step: 'finalize', reviewId: rid, outcome: 'completed' }, Duration.seconds(60)),
    ).next(done);
    const finalizeRejected = catchAll(
      step('FinalizeRejected', workflowFn, { step: 'finalize', reviewId: rid, outcome: 'rejected_by_reviewer' }, Duration.seconds(60)),
    ).next(done);

    const definition = pin
      .next(analyze)
      .next(validate)
      .next(
        new sfn.Choice(this, 'NeedsHitl?')
          .when(
            sfn.Condition.booleanEquals('$.needsHitl', true),
            hitlGate.next(
              new sfn.Choice(this, 'Decision?')
                .when(sfn.Condition.stringEquals('$.hitl.decision', 'approve'), finalize)
                .otherwise(finalizeRejected),
            ),
          )
          .otherwise(finalize),
      );

    const smLogs = new logs.LogGroup(this, 'StateMachineLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const stateMachine = new sfn.StateMachine(this, 'ReviewWorkflow', {
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(26),
      logs: { destination: smLogs, level: sfn.LogLevel.ERROR, includeExecutionData: false },
    });
    apiFn.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);
    apiFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['states:StartExecution'], resources: [stateMachine.stateMachineArn] }));
    apiFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['states:SendTaskSuccess'], resources: [stateMachine.stateMachineArn] }));

    // ---------- REST API ----------
    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'Authorizer', { cognitoUserPools: [this.userPool] });
    const api = new apigw.RestApi(this, 'RestApi', {
      restApiName: 'dfmea-api',
      deployOptions: { stageName: 'prod', throttlingRateLimit: 5, throttlingBurstLimit: 10 },
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type'],
      },
      defaultMethodOptions: { authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    });
    for (const type of [apigw.ResponseType.DEFAULT_4XX, apigw.ResponseType.DEFAULT_5XX]) {
      // gateway-generated errors (e.g. authorizer 401) need CORS headers for the browser to read them
      api.addGatewayResponse(`Gw${type.responseType}`, {
        type,
        responseHeaders: { 'Access-Control-Allow-Origin': `'https://${props.distributionDomainName}'` },
      });
    }
    const integ = new apigw.LambdaIntegration(apiFn);
    const reviewsRes = api.root.addResource('reviews');
    reviewsRes.addMethod('POST', integ);
    const one = reviewsRes.addResource('{id}');
    one.addMethod('GET', integ);
    one.addResource('events').addMethod('GET', integ);
    one.addResource('decision').addMethod('POST', integ);
    api.root.addResource('ontology').addResource('components').addMethod('GET', integ);

    this.restUrl = api.url;
    this.wsUrl = wsStage.url;

    new CfnOutput(this, 'RestUrl', { value: api.url });
    new CfnOutput(this, 'WsUrl', { value: wsStage.url });
    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'OntologyBucketName', { value: ontologyBucket.bucketName });
    new CfnOutput(this, 'ReviewsTableName', { value: reviews.tableName });
    new CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });
  }
}
