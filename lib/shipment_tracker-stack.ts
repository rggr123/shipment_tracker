import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as path from 'path';
import { Construct } from 'constructs';

export class ShipmentTableStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stage = this.node.tryGetContext('stage') || 'dev';

    // 1. Stand up explicit network VPC structures enabling NAT Gateways for internet routing paths
    const vpc = new ec2.Vpc(this, 'LambdaVpc', {
      maxAzs: 2,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'PrivateWithEgress', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS } // Lambda allocation zone
      ]
    });

    // 2. DynamoDB Target Table Destination
    const shipmentTable = new dynamodb.Table(this, 'ShipmentEventsTable', {
      tableName: `shipment_events_${stage}`, 
      partitionKey: { name: 'tracking_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'time_utc', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // 3. Resolve Reference to Aiven Credentials Object
    const aivenSecret = secretsmanager.Secret.fromSecretNameV2(this, 'AivenKafkaSecret', 'aiven-kafka-credentials');

    // 4. Provision Lambda bounded to Private Network Routing Subnets
    const trackingProcessorLambda = new lambda.Function(this, 'TrackingProcessorHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda')),
      vpc: vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        TABLE_NAME: shipmentTable.tableName,
      },
    });

    shipmentTable.grantWriteData(trackingProcessorLambda);
    aivenSecret.grantRead(trackingProcessorLambda);

    // 5. Establish Stream Mapping Attachment utilizing explicit mTLS Authentication Profiles
    trackingProcessorLambda.addEventSource(
      new lambdaEventSources.SelfManagedKafkaEventSource({
        bootstrapServers: ['://aivencloud.com'], 
        topic: 'shipment-tracking-events',
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        secret: aivenSecret, 
        authenticationMethod: lambdaEventSources.AuthenticationMethod.CLIENT_CERTIFICATE_TLS_AUTH, // Enforces mTLS
      })
    );
  }
}
