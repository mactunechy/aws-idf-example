import { Construct } from 'constructs';
import {
  Stack,
  StackProps,
  SecretValue,
  RemovalPolicy,
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as codepipelineActions,
  aws_codebuild as codebuid,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as cfOrigins,
  aws_s3 as s3,
  aws_cognito as cognito
} from 'aws-cdk-lib'

export class InfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const sourceOutput = new codepipeline.Artifact()
    const buildOutput = new codepipeline.Artifact()

    const sourceAction = new codepipelineActions.GitHubSourceAction({
      actionName: 'GithubSource',
      owner: 'mactunechy',
      repo: 'aws-idf-example',
      oauthToken: SecretValue.secretsManager('github_token'),
      output: sourceOutput,
      branch: 'main'
    })

    const buildAction = new codepipelineActions.CodeBuildAction({
      actionName: 'Build',
      project: new codebuid.PipelineProject(this, 'AwsIDFExampleProject', {
        buildSpec: codebuid.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: {
              'runtime-versions': {
                nodejs: '20.x'
              },
              commands: [
                'cd app',
                'npm install pnpm -g',
                'pnpm install'
              ]
            },
            build: {
              commands: ['pnpm run build']
            }
          },
          artifacts: {
            files: ['**/*'],
            'base-directory': 'app/dist'
          }
        }),
        environment: {
          buildImage: codebuid.LinuxBuildImage.AMAZON_LINUX_2_5
        }
      }),
      input: sourceOutput,
      outputs: [buildOutput]
    })

    const bucket = new s3.Bucket(this, 'AwsIDFExampleBucket', {
      websiteIndexDocument: 'index.html',
      removalPolicy: RemovalPolicy.DESTROY,
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      },
      publicReadAccess: true,
    })

    const awsIdfExample = new cloudfront.OriginAccessIdentity(this, 'OriginAccessControl', {
      comment: 'AwsIDFExampleBucket OAI'
    });

    new cloudfront.Distribution(this, 'AwsIDFExampleDistribution', {
      defaultBehavior: {
        origin: new cfOrigins.S3Origin(bucket, { originAccessIdentity: awsIdfExample }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.ALLOW_ALL,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS
      },
      errorResponses: [
        {
          httpStatus: 403,
          responsePagePath: '/error.html',
          responseHttpStatus: 200
        }
      ],
    })

    const deployAction = new codepipelineActions.S3DeployAction({
      actionName: 'S3Deploy',
      input: buildOutput,
      bucket
    })


    const userPool = new cognito.UserPool(this, 'AwsIDFExampleUserPool')
    const uniquePrefix = 'idf-example-2024'
    const userPoolDomain = userPool.addDomain("default", {
      cognitoDomain: {
        domainPrefix: uniquePrefix
      }
    })

    const pipeline = new codepipeline.Pipeline(this, 'AwsIDFExamplePipeline', {
      pipelineName: 'AwsIDFExample',
      crossAccountKeys: false
    })



    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction]
    })

    pipeline.addStage({
      stageName: 'Build',
      actions: [buildAction]
    })

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [deployAction]
    })
  }
}
