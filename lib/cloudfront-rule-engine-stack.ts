// TODO simplify and homogenize the following declarations
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apiGateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as fs from "fs";
import * as path from "path";
var UglifyJS = require("uglify-js");

const API_INLINE_CODE = `
      exports.handler = async function(event) {
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body:  JSON.stringify({
            'message': '___MESSAGE___'
          }),
        };
      };
    `;
export class CloudfrontRuleEngineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create API A
    const functionA = new lambda.Function(this, 'functionA', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(API_INLINE_CODE.replace('___MESSAGE___', 'The message was fetched from clients API'))
    });

    const apiA = new apiGateway.RestApi(this, "apiA", {
      endpointConfiguration: {
          types: [apiGateway.EndpointType.REGIONAL]
      },
    });

    apiA.root.addResource('clients').addMethod(
        'GET',
        new apiGateway.LambdaIntegration(functionA, {proxy: true}),
    );

    // Create API B
    const functionB = new lambda.Function(this, 'functionB', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(API_INLINE_CODE.replace('___MESSAGE___', 'The message was fetched from orders API'))
    });

    const apiB = new apiGateway.RestApi(this, "apiB", {
      endpointConfiguration: {
          types: [apiGateway.EndpointType.REGIONAL]
      },
    });

    apiB.root.addResource('orders').addMethod(
        'GET',
        new apiGateway.LambdaIntegration(functionB, {proxy: true}),
    );

    apiB.domainName

    // S3 bucket to host the website files
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

    // Create KeyValueStore that will store the engine rules
    const kvs = new cloudfront.KeyValueStore(this, 'KeyValueStore', {
      keyValueStoreName: 'cff-engine-rules',
    });

    // Replace KVS id in the CloudFront Function code, then minify the code
    let cloudFrontFunctionCode = fs.readFileSync(path.join(__dirname, "../functions/cff-viewer/index.js"), 'utf-8');
    cloudFrontFunctionCode = cloudFrontFunctionCode.replace(/__KVS_ID__/g, kvs.keyValueStoreId);
    // TODO consider better compression, wihtout breaking the function code
    var minificationResult = UglifyJS.minify(cloudFrontFunctionCode, {
      compress: false
    });
    if (minificationResult.error) throw new Error("Issue in minification of CFF code");
    cloudFrontFunctionCode = minificationResult.code;

    // Create the CloudFront Function that will execute the rules stored in KVS
    const cfFunction = new cloudfront.Function(this, 'CFFunction', {
      code: cloudfront.FunctionCode.fromInline(cloudFrontFunctionCode),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      functionName: 'rulesEngine',
      keyValueStore: kvs
    });


    // Using Lambda@Edge on origin request evennt temporarily 
    // until CloudFront Functions supports origin selection
    // TODO remove this section all together when the feature is out.
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

    // Create the CloudFront distribution
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

    new cdk.CfnOutput(this, 's3-bucket', { value: originBucket.bucketName});
    new cdk.CfnOutput(this, 'kvs-arn', { value: kvs.keyValueStoreArn});
    new cdk.CfnOutput(this, 'api-a', { value: apiA.url});
    new cdk.CfnOutput(this, 'api-b', { value: apiB.url});
    new cdk.CfnOutput(this, 'HTML URL', {value: cloudfrontDistribution.distributionDomainName+'/index.html'});
           
  }
}
