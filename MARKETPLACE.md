# Marketplace

**Status: described, not built.** Nothing in this repository implements any of
it, and nothing here is scaffolded for it. This file exists so the design is
written down while it is fresh, not so that work can start.

## What it is for

An MCP server is general. The same server pointed at Slack, Jira and a
conversation relay is useful to almost everyone and configured for nobody. The
gap between "has the tools" and "behaves usefully for my work" is filled today
by whoever is willing to write the configuration themselves.

A package closes that gap for one kind of work. Writing support shaped for an
architecture student. Weighing food against a training plan. A documentation
framework for how one team actually files Jira tickets. Someone who knows that
work writes it once, and everyone else installs it.

A package is configuration: which tools are active, how they are described,
what prompts and resources come with them, what scopes they need. It is not
code that runs inside a relay. That distinction is the whole security model,
and it should survive every future change.

## Why it is third

It distributes configuration for MCP servers, so the MCP adapter has to exist
and be stable enough that a package written against it keeps working. The
adapter talks to a relay, so the relay has to be finished. Building the
marketplace first would mean guessing at the shape of both.

## Domain model

**Package.** A name unique to its publisher, a description, a category, a
visibility, and an owning publisher. The name is stable for the life of the
package; everything a person sees can change between versions.

**Version.** An immutable release of a package: semantic version, the
configuration payload, a checksum, the scopes it requires, the LNKZ and MCP
protocol versions it supports, a documentation URL, a source repository, and
the date it was published. Immutable because an install records which version
it took, and a version that can change makes that record meaningless.

**Publisher.** An identity that owns package names and signs releases. One
publisher may own many packages; a package has exactly one.

**Installation.** A record that a specific version of a package was installed
somewhere, by whom, with which scopes approved, and when. Uninstall does not
delete this. An audit trail that forgets is not one.

## Rules that are not negotiable later

**Scopes are declared, reviewed and granted.** A package states what it needs.
A person sees that list before anything is installed, in words rather than
scope identifiers. Installation grants exactly what was shown and nothing that
arrives in a later version without another review.

**Every version carries a checksum, and verification happens before install,**
not after. A package that fails verification does not install and says so.

**A package name belongs to its publisher permanently.** Taking a name that was
released and then abandoned is how a supply chain attack starts.

**Version compatibility is declared and enforced.** A package that needs a
newer relay than the one installing it refuses clearly rather than failing
halfway through.

**Private is the default for a new package.** Publishing is a deliberate act.

**Deprecation marks, it does not delete.** An installed version keeps working
and its users are told. Rollback to a prior version stays possible, which is
the other reason versions are immutable.

## Deliberately not in scope

Payments and paid listings. OAuth application approval. A hosted public
registry. Automatic updates, which would defeat scope review. Any package
capable of executing code inside a relay, which would make every rule above
decoration.

## What would be built first, when the time comes

The domain model and its schemas, the storage abstraction, and the API
contract, behind a flag, with tests for metadata validation, version
compatibility, scope declaration, duplicate names across publishers, publisher
ownership, checksum verification, the install review step, and private versus
public visibility. No routes exposed in production until all of those pass.

Not yet. [ROADMAP.md](ROADMAP.md) has the two gates that come first.
