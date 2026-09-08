# Optional AWS infrastructure

This is LLMM's existing CDK stack, now maintained with LNKZ. It defines an ECR
repository, private Postgres, App Runner, encrypted storage, and supporting
network/IAM resources. It is separate from the default SQLite/Fly deployment.

Run `pnpm infra:synth` from the repository root to synthesize the template.
`pnpm --filter @lnkz/infra diff` compares it with an AWS deployment and requires
credentials. Neither the repository consolidation nor synthesis deploys resources.

Keep `LnkzProduction` and its construct IDs when updating an existing stack.
Review a diff before applying it. Creating the stack can incur AWS charges.

Before enabling App Runner:

1. Build and push the root Docker image to the stack's ECR repository.
2. Create the application database role from its dedicated secret. Give it
   runtime grants without table ownership, superuser, or BYPASSRLS privileges.
3. Run the Postgres migrations with the migration role as documented in
   [DEPLOY.md](../DEPLOY.md#postgres-release-and-tests).
4. Supply public URL, host and origin allowlists, and the image tag. Validate
   the provider's health-probe Host header against the allowlist before rollout.
5. Enable the service and run the authenticated smoke command against its URL.

The S3 export bucket is infrastructure provisioned by the inherited template;
the relay does not currently use it as a conversation store. Live AWS rollout,
network reachability and recovery must be validated in the target account.
