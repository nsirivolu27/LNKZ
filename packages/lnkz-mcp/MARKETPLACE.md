# Magentic marketplace

**Status: specified, not yet implemented.** This document defines the future
package catalog for the Magentic MCP product. It does not add a registry,
automatic installer, payment flow, or code execution to the adapter.

## What it is for

An MCP server is general. A package makes it useful for one kind of work by
declaring which tools are active, how they are described, and which prompts and
resources are included. A package is configuration, not code that runs inside
the LNKZ relay.

## Ownership

- **Magentic / `lnkz-mcp`:** package metadata, catalog, marketplace contract,
  scope review, checksums, compatibility rules, and installation review.
- **LNKZ:** conversation storage, relay API, authentication, handoffs, and
  the runtime data a configured adapter accesses.
- **LLMM:** historical compatibility and migration reference.

The adapter talks to LNKZ through its published REST contract. A package must
not import a sibling repository, require a local checkout, or execute arbitrary
package code inside a relay.

## Package model

A package has a publisher-owned name, description, category, visibility, and
declared scopes. A version is immutable and carries:

- semantic version and checksum;
- the configuration payload;
- the scopes it requires, in human-readable language;
- the compatible LNKZ and MCP protocol versions;
- documentation and source repository links; and
- publication metadata.

An installation records the exact package version, approved scopes, target
adapter, publisher, and installation time. Uninstalling does not erase that
audit record.

## Rules

1. Scopes are declared and reviewed before installation. A later version
   cannot silently gain scope.
2. Checksum verification happens before install.
3. Package names belong permanently to their publishers.
4. Compatibility is checked before activation and fails clearly when unsupported.
5. New packages are private by default.
6. Deprecation marks a package without deleting installed versions.
7. Packages never execute arbitrary code inside an LNKZ relay.

## Deliberately later

Payments, paid listings, OAuth approval, a public hosted registry, automatic
updates, and production install routes remain outside this specification until
the adapter and relay contracts are stable.