import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apiGateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as fs from "fs";
import * as path from "path";


export class CloudfrontRuleEngineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create API A
    const functionA = new lambda.Function(this, 'functionA', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
      exports.handler = async function(event) {
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body:  JSON.stringify({
            'version': 'A'
          }),
        };
      };
    `),
    });

    const apiA = new apiGateway.RestApi(this, "apiA", {
      endpointConfiguration: {
          types: [apiGateway.EndpointType.REGIONAL]
      },
    });

    apiA.root.addResource('api-a').addMethod(
        'GET',
        new apiGateway.LambdaIntegration(functionA, {proxy: true}),
    );

    const apiAURL = apiA.url + 'api-a';

    // Create API B
    const functionB = new lambda.Function(this, 'functionB', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
      exports.handler = async function(event) {
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body:  JSON.stringify({
            'version': 'B'
          }),
        };
      };
    `),
    });

    const apiB = new apiGateway.RestApi(this, "apiB", {
      endpointConfiguration: {
          types: [apiGateway.EndpointType.REGIONAL]
      },
    });

    apiB.root.addResource('api-b').addMethod(
        'GET',
        new apiGateway.LambdaIntegration(functionB, {proxy: true}),
    );

    const apiBURL = apiB.url + 'api-b';

    // S3 origin
    const originBucket = new s3.Bucket(this, 'origin-bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new cdk.aws_s3_deployment.BucketDeployment(this, 'DeployWebsite', {
      sources: [cdk.aws_s3_deployment.Source.asset('./html')],
      destinationBucket: originBucket,
    });

    // TODO minify JSON

    let rules = fs.readFileSync(path.join(__dirname, "../rules/rules.json"), 'utf-8');
    rules = rules.replaceAll(/__ORIGIN_S3_BUCKET__/g, "s3://cloudfrontruleenginestack-originbucket96e3b673-be7prtlatnfi");//"s3://"+ cdk.Fn.ref(originBucket.bucketName));
    rules = rules.replaceAll(/___APIA___/g, "https://bagqzfog1j.execute-api.us-east-1.amazonaws.com");//cdk.Fn.parseDomainName(apiAURL));
    rules = rules.replaceAll(/___APIB__/g, "https://2qjqmqfc68.execute-api.us-east-1.amazonaws.com");//cdk.Fn.parseDomainName(apiBURL));

    fs.writeFileSync(path.join(__dirname, "../cdk.out/rules.json"), rules);

    // Rule engine
    const kvs = new cloudfront.KeyValueStore(this, 'KeyValueStore', {
      keyValueStoreName: 'engine-rules2',
      source: cloudfront.ImportSource.fromAsset("cdk.out/rules.json"),
    });

    let cloudFrontFunctionCode = fs.readFileSync(path.join(__dirname, "../functions/cff-viewer/index.js"), 'utf-8');

    cloudFrontFunctionCode = cloudFrontFunctionCode.replace(/__KVS_ID__/g, kvs.keyValueStoreId);

    // TODO minify https://stackoverflow.com/questions/18878011/minify-javascript-programmatically-in-memory

    const cfFunction = new cloudfront.Function(this, 'CFFunction', {
      code: cloudfront.FunctionCode.fromInline(cloudFrontFunctionCode),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      functionName: 'rulesEngine'
    });

    // add CFF association
    (cfFunction.node.defaultChild as cloudfront.CfnFunction).addPropertyOverride("FunctionConfig.KeyValueStoreAssociations",
      [{ 
      'KeyValueStoreARN': kvs.keyValueStoreArn
      }]);

    // Using Lambda@Edge temporarily until CloudFront Functions supports origin selection
    const originSelection = new cloudfront.experimental.EdgeFunction(this, 'MyFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
      exports.handler = async function(event) {
        const request = event.Records[0].cf.request;
        if (request.headers['x-origin'] && request.headers['x-origin'][0].value) {
          let origin = request.headers['x-origin'][0].value;
          if (origin.startsWith("s3://")) {
            origin = origin.slice(5)+".s3.amazonaws.com";
            request.origin = {
              s3: {
                  domainName: origin,
                  region: 'us-east-1',
                  authMethod: 'origin-access-identity',
                  path: '',
                  customHeaders: {}
              }
            };
            request.headers['host'] = [{ key: 'host', value: origin}];
            return request;
          } else {
            origin = origin.slice(8);
            request.origin = {
              custom: {
                  domainName: origin,
                  port: 443,
                  protocol: 'https',
                  path: '',
                  sslProtocols: ['TLSv1', 'TLSv1.1'],
                  readTimeout: 5,
                  keepaliveTimeout: 5,
                  customHeaders: {}
              }
            };
          request.headers['host'] = [{ key: 'host', value: origin}];
          return request;
          }
        }
        console.log("No x-origin header sent");
        return {
          statusCode: '500',
          statusDescription: 'Internal Server Error',
        };
      };
    `),
    });

    // CloudFront distribution
    const cloudfrontDistribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'CloudFront Rule Engine example',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2018,
      defaultBehavior: {
          origin: new origins.S3Origin(originBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, `ImageCachePolicy${this.node.addr}`, {
            defaultTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.days(365),
            minTtl: cdk.Duration.seconds(0),
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList('x-cache-key'),
          }),
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          functionAssociations: [{
            function: cfFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
          edgeLambdas: [
            {
              functionVersion: originSelection.currentVersion,
              eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
            }
          ],
      },    
    });


    new cdk.CfnOutput(this, 'api-a', { value: apiAURL});
    new cdk.CfnOutput(this, 'api-b', { value: apiBURL});
    new cdk.CfnOutput(this, 'cloudfront', {value: cloudfrontDistribution.distributionDomainName});
           
  }
}
