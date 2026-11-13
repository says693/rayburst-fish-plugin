# Third-party notices

## FISH-Dock SDK

The files below are copied from `Fish-under-sea/FISH-Dock` at commit `0626a19` and retain their upstream MIT license in `sdk/LICENSE.txt`:

- `sdk/node/plugin.mjs`
- `sdk/browser/bridge.js`

Upstream copyrights: Fish-under-sea, Pengjie Zhou, Ebony-Vinyl (2026).

## Rayburst protocol

The JSON-RPC methods, default port, authentication convention, and task semantics were checked against `AnInsomniacy/rayburst` at commit `0c880e5`. No Rayburst application source code is bundled in this plugin. Rayburst and its associated rights belong to their respective owners. This is an independent, unofficial integration.

## Development-only packages

`fflate` (MIT) creates ZIP archives and `jsdom` (MIT) supports page tests. They are declared in `package.json` and `package-lock.json` for reproducible development but are not included in the runtime `.fish-plugin` archive.
