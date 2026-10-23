---
name: Artifact static asset paths
description: How the API artifact resolves static web assets across development and production launch contexts.
---

The API artifact may start with the package directory as its working directory in development and the workspace root in production. Static asset configuration should therefore resolve an explicit path when it exists and probe the artifact-local web-dist path rather than assuming one shared relative cwd.

**Why:** The managed workflow and production runner do not necessarily launch from the same directory, so a single relative asset path can make the console return 404 while the API remains healthy.

**How to apply:** Keep static-serving resolution tolerant of both package-local and workspace-root launch contexts, and verify `/console.html` through the shared preview proxy after changing artifact configuration.