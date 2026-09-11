import assert from "node:assert/strict";
import test from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { LnkzStack } from "./lnkz-stack.js";

function synthesizedTemplate(): Template {
  const app = new cdk.App();
  return Template.fromStack(new LnkzStack(app, "LnkzAssertions"));
}

test("production data services are private, encrypted, retained, and scanned", () => {
  const template = synthesizedTemplate();
  template.hasResourceProperties("AWS::RDS::DBInstance", {
    PubliclyAccessible: false,
    StorageEncrypted: true,
    DeletionProtection: true,
    Engine: "postgres",
  });
  template.hasResourceProperties("AWS::ECR::Repository", {
    ImageScanningConfiguration: { ScanOnPush: true },
    EncryptionConfiguration: {
      EncryptionType: "KMS",
      KmsKey: Match.anyValue(),
    },
  });
  template.hasResourceProperties("AWS::S3::Bucket", {
    BucketEncryption: Match.anyValue(),
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});

test("App Runner remains conditional and receives only runtime secrets", () => {
  const template = synthesizedTemplate().toJSON() as {
    Resources: Record<string, { Type: string; Condition?: string; Properties?: unknown }>;
  };
  const services = Object.values(template.Resources).filter((resource) => resource.Type === "AWS::AppRunner::Service");
  assert.equal(services.length, 1);
  assert.equal(services[0]?.Condition, "EnableAppRunnerCondition");

  const serviceJson = JSON.stringify(services[0]?.Properties);
  assert.match(serviceJson, /ApplicationDatabaseSecret/);
  assert.match(serviceJson, /ApiKeySecret/);
  assert.doesNotMatch(serviceJson, /DatabaseSecretAttachment|migration-database/);
  assert.match(serviceJson, /DATABASE_SSL/);
  assert.match(serviceJson, /ALLOWED_HOSTS/);
  assert.match(serviceJson, /ALLOWED_ORIGINS/);
});

test("the runtime role cannot read the migration credential", () => {
  const resources = synthesizedTemplate().toJSON().Resources as Record<string, { Type: string; Properties?: unknown }>;
  const runtimePolicies = Object.entries(resources)
    .filter(([logicalId, resource]) => logicalId.includes("AppRunnerInstanceRole") && resource.Type === "AWS::IAM::Policy")
    .map(([, resource]) => JSON.stringify(resource.Properties));
  assert.ok(runtimePolicies.length > 0);
  const policyJson = runtimePolicies.join("\n");
  assert.match(policyJson, /ApplicationDatabaseSecret/);
  assert.match(policyJson, /ApiKeySecret/);
  assert.match(policyJson, /ExportBucket/);
  assert.match(policyJson, /DataKey/);
  assert.doesNotMatch(policyJson, /DatabaseSecretAttachment|migration-database/);
  assert.doesNotMatch(policyJson, /"Resource":"\*"/);
});