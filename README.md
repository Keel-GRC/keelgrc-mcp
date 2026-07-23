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
| `keel_list_controls` | `GET /controls` | List controls with status + owner |
| `keel_readiness` | `GET /readiness` | ISO 27001 readiness % and requirement counts |
| `keel_list_tasks` | `GET /tasks` | List compliance tasks |
| `keel_create_task` | `POST /tasks` | Create a task (`title`, optional `description`, `dueAt`) |
| `keel_list_webhooks` | `GET /hooks` | List webhook subscriptions |
| `keel_create_webhook` | `POST /hooks` | Subscribe a URL to events |
| `keel_delete_webhook` | `DELETE /hooks/{id}` | Remove a subscription |

The tool set tracks the API: as Keel's `/api/v1` surface grows (risks, vendors,
policies, evidence ...), add the matching tool here, or regenerate from
`/api/v1/openapi.json`.

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
npm install
npm run build                       # compile to dist/
KEEL_API_KEY=... node dist/index.js # run over stdio
```

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
2. Actions tab -> "Publish keelgrc-mcp" -> Run workflow, or publish a GitHub Release.

## Security notes

- The key is sent only to `KEEL_BASE_URL` as a `Bearer` token; nothing is logged.
- Access is exactly the key's org, enforced by Keel's row-level security, the same as
  the REST API. Revoke a key under Integrations to cut off the MCP instantly.

## License

MIT (c) Keel GRC LLC. See [LICENSE](./LICENSE).
