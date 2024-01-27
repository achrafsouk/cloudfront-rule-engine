#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CloudfrontRuleEngineStack } from '../lib/cloudfront-rule-engine-stack';

const app = new cdk.App();
new CloudfrontRuleEngineStack(app, 'CloudfrontRuleEngineStack', {
  env: { region: 'us-east-1' }, // TODO remove
});