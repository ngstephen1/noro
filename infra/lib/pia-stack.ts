import * as path from 'node:path';
import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

interface Props extends StackProps { stage: string; }

export class PiaStack extends Stack {
  constructor(scope: any, id: string, props: Props) {
    super(scope, id, props);

    const stage = props.stage ?? 'dev';
    const repoRoot = path.resolve(__dirname, '../../');
    const runtime = lambda.Runtime.PYTHON_3_11;

    // LocalStack toggle
    const isLocal = process.env.USE_LOCALSTACK === '1';
    const extraEnv: Record<string, string> = isLocal ? { DDB_ENDPOINT_URL: 'http://localhost:4566' } : {};

    // DynamoDB
    const table = new ddb.Table(this, 'PiaTable', {
      tableName: `pia-${stage}`,
      partitionKey: { name: 'PK', type: ddb.AttributeType.STRING },
      sortKey: { name: 'SK', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // SQS + DLQ
    const dlq = new sqs.Queue(this, 'ContextDlq', {
      queueName: `pia-context-dlq-${stage}`,
      retentionPeriod: Duration.days(14),
    });
    const queue = new sqs.Queue(this, 'ContextQueue', {
      queueName: `pia-context-${stage}`,
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    // Shared layer (vendored at layers/common/python: pia_common + jsonschema)
    const commonLayer = new lambda.LayerVersion(this, 'CommonLayer', {
      code: lambda.Code.fromAsset(path.join(repoRoot, 'layers/common')),
      compatibleRuntimes: [runtime],
      description: 'pia_common + jsonschema vendored',
    });

    const commonEnv: Record<string, string> = { DDB_TABLE: table.tableName };

    // Helper to package code without docker/bundling
    const codeFrom = (subdir: string) =>
      lambda.Code.fromAsset(path.join(repoRoot, subdir), {
        exclude: ['**/__pycache__/**', '**/*.pyc', 'requirements.txt'],
      });

    // ingest_context (POST /context)
    const ingestFn = new lambda.Function(this, 'IngestContextFn', {
      runtime,
      handler: 'app.handler',
      code: codeFrom('backend/ingest_context'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: { ...commonEnv, ...extraEnv, QUEUE_URL: queue.queueUrl },
      layers: [commonLayer],
    });
    queue.grantSendMessages(ingestFn);

    // process_context (SQS consumer)
    const processFn = new lambda.Function(this, 'ProcessContextFn', {
      runtime,
      handler: 'app.handler',
      code: codeFrom('backend/process_context'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: { ...commonEnv, ...extraEnv },
      layers: [commonLayer],
    });
    table.grantWriteData(processFn);
    queue.grantConsumeMessages(processFn);
    processFn.addEventSource(new SqsEventSource(queue, { batchSize: 5 }));

    // get_insights (GET /insights)
    const getInsightsFn = new lambda.Function(this, 'GetInsightsFn', {
      runtime,
      handler: 'app.handler',
      code: codeFrom('backend/get_insights'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: { ...commonEnv, ...extraEnv },
      layers: [commonLayer],
    });
    table.grantReadData(getInsightsFn);

    // REST API
    const api = new apigw.RestApi(this, 'PiaApi', {
      restApiName: `pia-${stage}`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
      },
      deployOptions: { stageName: stage },
    });

    api.root.addResource('context').addMethod('POST', new apigw.LambdaIntegration(ingestFn));
    api.root.addResource('insights').addMethod('GET', new apigw.LambdaIntegration(getInsightsFn));

    new CfnOutput(this, 'ApiUrl', { value: api.url ?? '' });
    new CfnOutput(this, 'QueueUrl', { value: queue.queueUrl });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}