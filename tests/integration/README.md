# Integration Testing Setup

How to build the fork's extension and MCP server, load them into Firefox, and run integration tests.

## Prerequisites

- Firefox (any recent version; MV2 extension support required)
- Node.js >= 22
- The fork repo at `~/code/browser-control-mcp/`

## 1. Build Everything

From the repo root:

```bash
cd ~/code/browser-control-mcp

# Install dependencies (if not already done)
npm install

# Build the MCP server (TypeScript → dist/server.js)
cd mcp-server && npx tsc && cd ..

# Build the extension (TypeScript → dist/background.js + dist/options.js)
cd firefox-extension && npm run build && cd ..
```

After building, verify these files exist:
- `mcp-server/dist/server.js`
- `firefox-extension/dist/background.js`
- `firefox-extension/dist/options.js`

## 2. Load the Fork's Extension into Firefox

The fork's extension replaces the upstream extension. You must **remove or disable the upstream extension first** to avoid two extensions competing on the same WebSocket port.

### Remove/Disable Upstream Extension

1. Open `about:addons` in Firefox
2. Find "Browser Control MCP"
3. Click the toggle to **disable** it (or click Remove)

### Load the Fork as a Temporary Add-on

1. Open `about:debugging#/runtime/this-firefox` in Firefox
2. Click **"Load Temporary Add-on..."**
3. Navigate to `~/code/browser-control-mcp/firefox-extension/`
4. Select `manifest.json`

The extension should now appear in the list with the name "Browser Control MCP" (version 1.5.0).

### Configure the Extension Secret

The fork's extension generates its own secret on first install. You need to copy it into the MCP server config:

1. Click the extension's gear icon or go to its Options page
2. Copy the **Secret Key** shown on the options page
3. Update `~/.claude/settings.json` with the new secret (see step 3 below)

**Important:** Each time you reload the temporary add-on, the secret persists in `browser.storage.local` — it does NOT regenerate. You only need to copy the secret once.

### After Code Changes

Every time you modify files in `firefox-extension/`:

```bash
cd ~/code/browser-control-mcp/firefox-extension && npm run build
```

Then in Firefox:
1. Go to `about:debugging#/runtime/this-firefox`
2. Find "Browser Control MCP" in the list
3. Click **"Reload"**

You do NOT need to remove and re-add the extension. Reload preserves storage (secret, settings).

## 3. Point Claude Code at the Fork's MCP Server

Edit `~/.claude/settings.json` — change the `browser-control` MCP entry:

```json
"browser-control": {
  "type": "stdio",
  "command": "node",
  "args": [
    "/home/drizzt/code/browser-control-mcp/mcp-server/dist/server.js"
  ],
  "env": {
    "EXTENSION_SECRET": "<secret from extension options page>"
  }
}
```

After saving, restart Claude Code (or run `/mcp` to reconnect) for the new server path to take effect.

### Reverting to Upstream

To go back to the upstream extension + server:

1. Remove the temporary add-on from `about:debugging`
2. Re-enable the upstream extension in `about:addons`
3. Revert `settings.json`:
   ```json
   "args": ["/home/drizzt/.claude/mcp-servers/browser-control/dist/server.js"]
   ```
4. Restore the upstream secret in `EXTENSION_SECRET`

## 4. Verify the Setup

After loading the fork extension and pointing to the fork server:

1. Run each existing tool via Claude Code MCP calls:
   - `get-list-of-open-tabs` — should return your tabs
   - `open-browser-tab` with `https://example.com`
   - `get-tab-web-content` on the opened tab
   - `find-highlight-in-browser-tab` searching for text
   - `group-browser-tabs` with the tab
   - `reorder-browser-tabs` with a few tab IDs
   - `close-browser-tabs` to clean up

2. Compare results against `tests/integration/baseline-results.json`

3. If all 7 tools return the same response shapes as baseline, the fork is working correctly and hasn't broken anything.

## 5. Testing New Tools (Steps 2+)

After merging a new tool branch to `dev`, rebuild both server and extension, reload the extension in Firefox, and test the new tool via MCP alongside the baseline regression tests.

Each new tool should be tested per its step's Testing Criteria in the implementation plan.

## Notes

- **Temporary add-ons do not survive Firefox restart.** You must re-load from `about:debugging` after each Firefox restart.
- **The `scripting` permission** (added in Step 1) is required for `browser.scripting.executeScript` used by mutation tools. Firefox will grant this automatically for temporary add-ons.
- **Optional permissions** (`*://*/*`, `find`) are prompted per-domain when tools that need them are first used. For testing, you can grant all-sites permission from the extension's options page.
- **WebSocket port** defaults to 8089. Both the extension and the MCP server must use the same port. The extension options page shows the configured port(s).
