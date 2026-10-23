import * as cdk from 'aws-cdk-lib';
import * as pipelines from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { ShipmentTableStack } from './shipment-table-stack'; // Your existing table stack

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Define the continuous delivery pipeline
    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'ShipmentTrackingDeploymentPipeline',
      synth: new pipelines.ShellStep('Synth', {
        // Connect to your source code repository
        input: pipelines.CodePipelineSource.gitHub('your-github-username/your-repo-name', 'main', {
          // You store your GitHub personal access token safely in AWS Secrets Manager
          authentication: cdk.SecretValue.secretsManager('github-token'),
        }),
        // Commands AWS will run natively in the cloud to build your project
        commands: [
          'npm ci',         // Install dependencies
          'npm run build',  // Compile TypeScript
          'npx cdk synth',  // Synthesize CloudFormation templates
        ],
      }),
    });

    // 2. Define the deployment target stage (e.g., Development)
    const devStage = pipeline.addStage(new cdk.Stage(this, 'Development', {
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
    }));

    // Instantiate your existing tracking table stack inside the pipeline stage
    // We pass 'dev' as context internally to keep your environment naming conventions
    this.node.setContext('stage', 'dev');
    new ShipmentTableStack(devStage, 'ShipmentTrackingDevBackend');
  }
}
