# Trusted host plugins

Host plugins are TypeScript modules that run inside Rakazo. Install a plugin by adding its entry to the fork's trusted registry and rebuilding. Only install code you trust with the process's access.

A definition has a manifest and a typed `hooks` object. Give it a stable `namespace/name` ID, a display name, a version, and `apiVersion: 1`. The host orders plugins by ID and rejects duplicate IDs. Server and Web entries for the same plugin share the manifest ID.

Users enable installed plugins from **Settings → Plugins**. The choice is stored per account and defaults to off. Rakazo broadcasts account preference changes over its existing live stream. Keep deployment configuration and credentials on the server.
