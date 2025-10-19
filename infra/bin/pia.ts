import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PiaStack } from '../lib/pia-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

new PiaStack(app, 'PiaStack', {
  env,
  stage: process.env.STAGE || 'dev',
});