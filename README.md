# LNKZ

**Your working context, out of the app it was trapped in.**

You spend an hour with a model working something out. It lands on an answer,
names the tradeoffs, leaves two things open. Then you need it somewhere else:
a different model, your phone, a teammate.

LNKZ saves the conversation, extracts its decisions with source messages, and
hands that context to the next model or person through an expiring link. It
runs on your machine or your server, with data you own.

## Run it locally

Use Node 22 and the pinned pnpm version:

```bash
git clone https://github.com/nsirivolu27/LNKZ.git
cd LNKZ
corepack enable
corepack pnpm install --frozen-lockfile
pnpm build
pnpm demo
```

The demo starts two temporary local instances, seeds A, asks what the forecast
model decision was, hands a conversation to B, and continues it there. It prints
real decisions and origin lineage, then closes both instances. No model or
provider account is needed. It uses synthetic data and removes its temporary stores.

Read the [recorded terminal output](docs/demo-output.txt) without installing
anything, or play the [terminal recording](docs/demo.cast) with an asciicast
player. [DEMO.md](DEMO.md) gives the same transfer as explicit commands.

To keep your own local store, run `pnpm start`, then in another terminal:

```bash
pnpm seed
pnpm ask "forecast model"
```

The answer includes the original gradient-boosting decision and its later
reversal to a seasonal ARIMA baseline. Connect your model using
[MCP.md](MCP.md#claude-desktop-setup). For public use, follow [DEPLOY.md](DEPLOY.md).

## Read next

| Document | Its job |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data flow, storage and trust boundaries |
| [MCP.md](MCP.md) | Tool, resource, prompt and REST contracts; MCP client setup |
| [DEPLOY.md](DEPLOY.md) | Configuration, hosting and operational commands |
| [ROADMAP.md](ROADMAP.md) | Remaining work and scope boundaries |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Local checks, review and branch protection |
| [CHANGELOG.md](CHANGELOG.md) | Changes over time |
| [SECURITY.md](SECURITY.md) | Private vulnerability disclosure |

## Related repositories

| Repository | What it owns |
| --- | --- |
| This repository | The relay and its REST and MCP surfaces |
| [LLMM](https://github.com/nsirivolu27/LLMM) | A separate product and console built on the relay |
| [lnkz-mcp](https://github.com/nsirivolu27/lnkz-mcp) | A standalone MCP adapter for a remotely hosted relay |

Licensed under [MIT](LICENSE).
