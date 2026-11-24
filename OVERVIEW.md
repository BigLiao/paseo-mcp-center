# MCP Center

Centralized MCP management and explicit manual cross-machine migration across local clients and paired Paseo hosts.

MCP Center scans MCP server definitions across local clients on each host and displays them in a dedicated sidebar screen:

- Claude Code (`~/.claude.json`)
- Claude Internal (`~/.claude-internal/.claude.json`)
- Codex (`~/.codex/config.toml`)
- Cursor (`~/.cursor/mcp.json`)
- Antigravity (`~/.gemini/config/mcp_config.json`)
- Agents (`~/.agents/mcp.json`)
- Paseo runtime injection (`agent.session_open` hook)

## How it works

Each host stays independent and nothing syncs automatically in the background. When multiple hosts are paired in Paseo (`~/.paseo/hosts.json`), MCP Center connects to online peers through Paseo's existing encrypted relay channel to inspect remote inventories, toggle individual or all clients, compare parameter drift across clients and align them to a chosen baseline, run live connectivity and `tools/list` probes, and perform explicit manual migrations with diff previews and pre-write parameter overrides.

Every file write creates a `.mcp-center.bak` backup beside the target file before replacing it atomically. Disabling a JSON-client MCP saves its definition in plugin data so re-enabling restores it without data loss.

## Requirements

- Paseo `>=0.17.1` on each participating host.
- Install and enable `paseo-mcp-center` on each host you want to manage or migrate across via Paseo Relay.
