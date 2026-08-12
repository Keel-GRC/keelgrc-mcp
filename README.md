# keelgrc-mcp

A **Model Context Protocol (MCP) server** for Keel. Point any MCP client (Claude
Desktop, Claude Code, Cursor) at it and drive your compliance program in natural
language: "what's my ISO 27001 readiness?", "list controls still in gap", "open a
task to rotate our TLS certs."

Docs: <https://docs.keelgrc.com/api-mcp/mcp-server/> · Open source: <https://keelgrc.com/open-source/>

```bash
KEEL_API_KEY=your_key npx keelgrc-mcp
```

It's a thin wrapper over the Keel public API (`/api/v1`). Every tool maps 1:1 to a
real endpoint and is scoped to your API key's organization. The MCP grants no more
access than the key already has.

## Tools

| Tool | Maps to | Does |
|------|---------|------|
| `keel_whoami` | `GET /me` | Confirm the connected workspace (id, name, tier) |
| `keel_list_controls` | `GET /controls` | List controls with state + owner (filter with `query`) |
| `keel_readiness` | `GET /readiness` | ISO 27001 readiness % and requirement counts |
| `keel_list_tasks` | `GET /tasks` | List compliance tasks |
| `keel_create_task` | `POST /tasks` | Create a task (`title`, optional `description`, `dueAt`) |
| `keel_list_risks` | `GET /risks` | List the risk register with inherent and residual scores |
| `keel_create_risk` | `POST /risks` | Add a risk (`title`, `likelihood`, `impact`, `treatment`) |
| `keel_list_vendors` | `GET /vendors` | List vendors (filter with `query`) |
| `keel_create_vendor` | `POST /vendors` | Add a vendor (`name`, optional `tier`, `status`, …) |
| `keel_list_people` | `GET /people` | List the personnel directory (filter with `query`) |
| `keel_upsert_person` | `POST /people` | Add or update a person by email (idempotent) |
| `keel_list_policies` | `GET /policies` | List policies (filter with `query`) |
| `keel_create_policy` | `POST /policies` | Create a policy from Markdown |
| `keel_list_evidence` | `GET /evidence` | List collected evidence (filter with `since`) |
| `keel_add_evidence_link` | `POST /evidence` | Attach a URL as evidence, optionally to a control |
| `keel_list_webhooks` | `GET /hooks` | List webhook subscriptions |
| `keel_create_webhook` | `POST /hooks` | Subscribe a URL to events |
| `keel_delete_webhook` | `DELETE /hooks/{id}` | Remove a subscription |

**One deliberate gap.** `POST /evidence` accepts a file upload as `multipart/form-data`
as well as a link. This server implements the link form only — streaming a file
through a stdio MCP transport is not something the protocol does well, and a tool
that half-worked would be worse than one that says what it covers. Upload files in
the Keel app or against the REST API directly.

Tool descriptions quote API field names exactly (the control status field is called
`state`, not `status`) and use enums with the API's own accepted values, because the
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
