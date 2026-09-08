import * as cdk from "aws-cdk-lib";
import { LnkzStack } from "./lnkz-stack.js";

const app = new cdk.App();
new LnkzStack(app, "LnkzProduction", {
  description: "LNKZ private Postgres, App Runner service, encrypted exports, and observability",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});