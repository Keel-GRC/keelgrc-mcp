# keelgrc-mcp

A **Model Context Protocol (MCP) server** for Keel. Point any MCP client (Claude
Desktop, Claude Code, Cursor) at it and drive your compliance program in natural
language: "what's my ISO 27001 readiness?", "list controls still in gap", "open a
task to rotate our TLS certs."

Docs: <https://docs.keelgrc.com/api-mcp/mcp-server/> · Open source: <https://keelgrc.com/open-source/>

```bash
KEEL_API_KEY=your_key npx keelgrc-mcp
```

It's a thin wrapper over the Keel public API (`/api/v1`). Every action maps to a real
endpoint and is scoped to your API key's organization. The MCP grants no more access
than the key already has.

## Tools

One tool per resource, with an `action` argument. Eleven tools cover thirty-nine
operations; the alternative is a tool per operation, and MCP clients degrade badly
past roughly a hundred tools.

| Tool | Actions | Maps to |
|------|---------|---------|
| `keel_whoami` | (none) | `GET /me` |
| `keel_frameworks` | (none) | `GET /frameworks` |
| `keel_readiness` | (none) | `GET /readiness` |
| `keel_controls` | list, get, update, delete | `/controls`, `/controls/{id}` |
| `keel_tasks` | list, get, create, update | `/tasks`, `/tasks/{id}` |
| `keel_risks` | list, get, create, update, delete | `/risks`, `/risks/{id}` |
| `keel_vendors` | list, get, create, update, delete | `/vendors`, `/vendors/{id}` |
| `keel_people` | list, get, create, update, delete | `/people`, `/people/{id}` |
| `keel_policies` | list, get, create, update, delete | `/policies`, `/policies/{id}` |
| `keel_evidence` | list, get, create, update, delete | `/evidence`, `/evidence/{id}` |
| `keel_webhooks` | list, create, delete | `/hooks`, `/hooks/{id}` |

Some actions are absent. Each is a gap in the REST surface, and each is stated in the
tool description so a model reads an answer rather than a hole:

- `keel_tasks` has no **delete**. Keel has no delete-a-task operation anywhere, the
  app included. Update the status to `cancelled` instead, which keeps the record.
- `keel_controls` has no **create**. Controls come from the framework content Keel
  ships and from the app; no endpoint creates one.
- `keel_webhooks` has no **get** or **update**. The API has neither. List them to read
  one, and replace a subscription by deleting it and creating another.
- `keel_vendors` reads the authentication posture (`auth`) and cannot write it. The
  underlying update treats any one of `mfa`, `passwordPolicy` and `sso` as the caller
  owning all three, so a partial write would silently clear the other two.
- `keel_evidence` `create` covers **link evidence only**. `POST /evidence` also accepts
  a file as `multipart/form-data`, which is not something a stdio transport streams
  well; a tool that half-worked would be worse than one that says what it covers.
  Upload files in the Keel app or against the REST API directly.

`keel_readiness` answers for **ISO/IEC 27001:2022 only**, whatever framework the
workspace actually runs. `keel_frameworks` is the one that answers for the workspace.
Both are here because they are different questions, and the descriptions say which.

### Roles

The API key acts as the member who created it. Writes are refused for the auditor
role, and most deletes need owner or admin, matching what the same person can do in
the browser.

A key created **before keys carried an actor** has no member and therefore no role.
It can still read and create; every role-gated action answers 403 until the key is
re-created under **Integrations -> API keys**. One of those gates is new in this
release: **deleting a webhook subscription now requires owner or admin**, where it
used to accept any valid key. A Zapier unsubscribe running on an old key will start
failing and needs a fresh key.

Tool descriptions quote API field names exactly (the control status field is called
`state`, not `status`; a vendor's `tier` on the way out is the residual and on the way
in is the inherent) and use enums with the API's own accepted values, because the
description and schema are the only things the model sees before it calls a tool.

## Configuration

Two environment variables:

- `KEEL_API_KEY`: **required.** Create one under **Integrations -> API keys** in your
  Keel workspace.
- `KEEL_BASE_URL`: optional, defaults to `https://app.keelgrc.com`. Set it for a
  self-hosted or preview workspace.

### Claude Desktop / Claude Code

Add to your MCP config (`claude_desktop_config.json`, or `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "keel": {
      "command": "npx",
      "args": ["-y", "keelgrc-mcp"],
      "env": { "KEEL_API_KEY": "keel_live_..." }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` uses the same `mcpServers` shape.

## Develop

```bash
npm ci                              # installs exactly package-lock.json
npm run build                       # compile to dist/
npm run smoke                       # boot the built server and assert it speaks MCP
KEEL_API_KEY=... node dist/index.js # run over stdio
```

`npm run smoke` needs no API key and makes no network call: it starts `dist/index.js`,
completes the MCP handshake, and checks the tool list, the advertised version, and that
nothing but protocol frames reach stdout. It runs in CI before every publish.

The server speaks MCP over **stdio**, so it never writes to stdout except protocol
frames; status goes to stderr.

## Publishing

This repository is the source of truth for the npm package
[`keelgrc-mcp`](https://www.npmjs.com/package/keelgrc-mcp). It is published from here via
npm OIDC **trusted publishing** (`.github/workflows/publish.yml`): GitHub Actions
authenticates to npm directly, so there is no stored `NPM_TOKEN` and no 2FA code, and
each release carries build provenance. The first release (`0.1.0`) was a manual
bootstrap, because trusted publishing can only be enabled for a package that already
exists.

The one-time trusted-publisher setup (npmjs.com -> the package -> Settings -> Trusted
Publisher) is documented at the top of the workflow file. To cut a new release:

1. Bump `version` in `package.json` (npm rejects re-publishing an existing version).
   The server reports that same version in its MCP handshake — it reads `package.json`
   rather than carrying a copy, so the two cannot drift.
2. Commit the regenerated `package-lock.json` in the same change, or `npm ci` fails.
3. Actions tab -> "Publish keelgrc-mcp" -> Run workflow, or publish a GitHub Release.

The publish job is deliberately locked down, because it is the one place in Keel that
holds an OIDC token able to publish under Keel's name with a provenance attestation:
`npm ci` against a committed lockfile, `--ignore-scripts` so no dependency's install
hook runs beside that token, a pinned npm rather than `@latest`, and an audit that
fails the job instead of a flag that silences it.

## Security notes

- The key is sent only to `KEEL_BASE_URL` as a `Bearer` token; nothing is logged.
- Access is exactly the key's org, enforced by Keel's row-level security, the same as
  the REST API. Revoke a key under Integrations to cut off the MCP instantly.

## License

MIT (c) Keel GRC LLC. See [LICENSE](./LICENSE).
