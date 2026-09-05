import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apprunner from "aws-cdk-lib/aws-apprunner";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export class LnkzStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const imageTag = new cdk.CfnParameter(this, "ImageTag", {
      type: "String",
      default: "latest",
      description: "ECR image tag to run. Push it before enabling App Runner.",
    });
    const enableAppRunner = new cdk.CfnParameter(this, "EnableAppRunner", {
      type: "String",
      default: "false",
      allowedValues: ["true", "false"],
      description: "Create the public App Runner service after the image exists in ECR.",
    });
    const publicBaseUrl = new cdk.CfnParameter(this, "PublicBaseUrl", {
      type: "String",
      default: "https://example.invalid",
      description: "Canonical HTTPS URL used in share links.",
    });
    const allowedHosts = new cdk.CfnParameter(this, "AllowedHosts", {
      type: "String",
      default: "example.invalid",
      description: "Comma-separated bare hostnames accepted by the Host allowlist.",
    });
    const allowedOrigins = new cdk.CfnParameter(this, "AllowedOrigins", {
      type: "String",
      default: "https://example.invalid",
      description: "Comma-separated browser origins accepted by CORS.",
    });
    const serviceCondition = new cdk.CfnCondition(this, "EnableAppRunnerCondition", {
      expression: cdk.Fn.conditionEquals(enableAppRunner.valueAsString, "true"),
    });

    const encryptionKey = new kms.Key(this, "DataKey", {
      alias: "alias/lnkz-data",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 28 },
      ],
    });
    vpc.addGatewayEndpoint("S3", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    const appSecurityGroup = new ec2.SecurityGroup(this, "AppSecurityGroup", {
      vpc,
      description: "App Runner VPC connector egress",
      allowAllOutbound: true,
    });
    const databaseSecurityGroup = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc,
      description: "Private LNKZ PostgreSQL access",
      allowAllOutbound: false,
    });
    databaseSecurityGroup.addIngressRule(appSecurityGroup, ec2.Port.tcp(5432), "App Runner to PostgreSQL");

    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      databaseName: "lnkz",
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      publiclyAccessible: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: encryptionKey,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      credentials: rds.Credentials.fromGeneratedSecret("lnkz_migrator", {
        secretName: `${this.stackName}/migration-database`,
      }),
    });

    // This secret is intentionally separate from the migration/master secret.
    // Bootstrap creates this role and grants it table DML without BYPASSRLS.
    const applicationDatabaseSecret = new secretsmanager.Secret(this, "ApplicationDatabaseSecret", {
      secretName: `${this.stackName}/application-database`,
      description: "Credentials for the non-owner LNKZ runtime PostgreSQL role",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "lnkz_app" }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
      encryptionKey,
    });
    const apiKeySecret = new secretsmanager.Secret(this, "ApiKeySecret", {
      secretName: `${this.stackName}/api-key`,
      description: "Bearer key for LNKZ REST and MCP clients",
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      encryptionKey,
    });

    const exportBucket = new s3.Bucket(this, "ExportBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ expiration: Duration.days(30), noncurrentVersionExpiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    const repository = new ecr.Repository(this, "Repository", {
      repositoryName: "lnkz",
      imageScanOnPush: true,
      encryption: ecr.RepositoryEncryption.KMS,
      encryptionKey,
      lifecycleRules: [{ maxImageCount: 20 }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const appRunnerEcrRole = new iam.Role(this, "AppRunnerEcrRole", {
      assumedBy: new iam.ServicePrincipal("build.apprunner.amazonaws.com"),
      description: "App Runner pulls the LNKZ image from ECR",
    });
    repository.grantPull(appRunnerEcrRole);

    const instanceRole = new iam.Role(this, "AppRunnerInstanceRole", {
      assumedBy: new iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
      description: "LNKZ runtime access to injected secrets and private exports",
    });
    applicationDatabaseSecret.grantRead(instanceRole);
    apiKeySecret.grantRead(instanceRole);
    exportBucket.grantReadWrite(instanceRole);
    encryptionKey.grantEncryptDecrypt(instanceRole);

    const vpcConnector = new apprunner.CfnVpcConnector(this, "VpcConnector", {
      vpcConnectorName: `${this.stackName}-private-egress`,
      subnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      securityGroups: [appSecurityGroup.securityGroupId],
    });

    const autoScaling = new apprunner.CfnAutoScalingConfiguration(this, "AutoScaling", {
      autoScalingConfigurationName: `${this.stackName}-three-instance-cap`,
      maxConcurrency: 80,
      maxSize: 3,
      minSize: 1,
    });

    const service = new apprunner.CfnService(this, "Service", {
      serviceName: this.stackName.toLowerCase(),
      autoDeploymentsEnabled: false,
      autoScalingConfigurationArn: autoScaling.attrAutoScalingConfigurationArn,
      sourceConfiguration: {
        autoDeploymentsEnabled: false,
        authenticationConfiguration: { accessRoleArn: appRunnerEcrRole.roleArn },
        imageRepository: {
          imageIdentifier: `${repository.repositoryUri}:${imageTag.valueAsString}`,
          imageRepositoryType: "ECR",
          imageConfiguration: {
            port: "3100",
            runtimeEnvironmentVariables: [
              { name: "HOST", value: "0.0.0.0" },
              { name: "PORT", value: "3100" },
              { name: "DATABASE_HOST", value: database.dbInstanceEndpointAddress },
              { name: "DATABASE_PORT", value: database.dbInstanceEndpointPort },
              { name: "DATABASE_NAME", value: "lnkz" },
              { name: "DATABASE_SSL", value: "true" },
              { name: "LNKZ_POSTGRES_WORKSPACE_ID", value: "00000000-0000-4000-8000-000000000001" },
              { name: "LNKZ_PUBLIC_BASE_URL", value: publicBaseUrl.valueAsString },
              { name: "ALLOWED_HOSTS", value: allowedHosts.valueAsString },
              { name: "ALLOWED_ORIGINS", value: allowedOrigins.valueAsString },
              { name: "LNKZ_S3_BUCKET", value: exportBucket.bucketName },
            ],
            runtimeEnvironmentSecrets: [
              { name: "DATABASE_SECRET_JSON", value: applicationDatabaseSecret.secretArn },
              { name: "LNKZ_API_KEY", value: apiKeySecret.secretArn },
            ],
            startCommand: "node dist/server.js",
          },
        },
      },
      instanceConfiguration: {
        cpu: "1 vCPU",
        memory: "2 GB",
        instanceRoleArn: instanceRole.roleArn,
      },
      healthCheckConfiguration: {
        protocol: "HTTP",
        path: "/health",
        interval: 10,
        timeout: 5,
        healthyThreshold: 1,
        unhealthyThreshold: 5,
      },
      networkConfiguration: {
        egressConfiguration: { egressType: "VPC", vpcConnectorArn: vpcConnector.attrVpcConnectorArn },
        ingressConfiguration: { isPubliclyAccessible: true },
      },
    });
    service.cfnOptions.condition = serviceCondition;

    new logs.LogGroup(this, "ApplicationLogGroup", {
      logGroupName: `/aws/apprunner/${this.stackName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri });
    new cdk.CfnOutput(this, "MigrationSecretArn", { value: database.secret?.secretArn ?? "" });
    new cdk.CfnOutput(this, "ApplicationDatabaseSecretArn", { value: applicationDatabaseSecret.secretArn });
    new cdk.CfnOutput(this, "ApiKeySecretArn", { value: apiKeySecret.secretArn });
    new cdk.CfnOutput(this, "DatabaseEndpoint", { value: database.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, "ExportBucketName", { value: exportBucket.bucketName });
    new cdk.CfnOutput(this, "VpcId", { value: vpc.vpcId });
    new cdk.CfnOutput(this, "ServiceUrl", { value: service.attrServiceUrl });
  }
}