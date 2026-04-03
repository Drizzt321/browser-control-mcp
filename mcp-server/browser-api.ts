import WebSocket from "ws";
import type {
  ExtensionMessage,
  BrowserTab,
  BrowserHistoryItem,
  ServerMessage,
  TabContentExtensionMessage,
  ServerMessageRequest,
  ExtensionError,
} from "@browser-control-mcp/common";
import { isPortInUse } from "./util";
import * as crypto from "crypto";

const WS_DEFAULT_PORT = 8089;
const DEFAULT_TIMEOUT_MS = parseInt(
  process.env.EXTENSION_TIMEOUT_MS ?? "5000",
  10
);

// Per-command timeout map (ms)
const COMMAND_TIMEOUT_MS: Record<string, number> = {
  navigate: 30000,
  "wait-for": 30000,
  screenshot: 10000,
  click: 5000,
  type: 5000,
  "fill-form": 5000,
  evaluate: 5000,
  snapshot: 5000,
  "get-network-requests": 5000,
  // Read-only commands use default
};

function getTimeoutForCommand(cmd: string): number {
  return COMMAND_TIMEOUT_MS[cmd] ?? DEFAULT_TIMEOUT_MS;
}

interface ExtensionRequestResolver<T extends ExtensionMessage["resource"]> {
  resource: T;
  resolve: (value: Extract<ExtensionMessage, { resource: T }>) => void;
  reject: (reason?: string) => void;
}

const RECONNECT_WAIT_MS = 12000;
const RECONNECT_POLL_MS = 2000;

export class BrowserAPI {
  private ws: WebSocket | null = null;
  private wsServer: WebSocket.Server | null = null;
  private sharedSecret: string | null = null;
  private lastConnectionTime: number = 0;
  private lastDisconnectTime: number = 0;
  private extensionVersion: string | null = null;

  // Map to persist the request to the extension. It maps the request correlationId
  // to a resolver, fulfulling a promise created when sending a message to the extension.
  private extensionRequestMap: Map<
    string,
    ExtensionRequestResolver<ExtensionMessage["resource"]>
  > = new Map();

  async init() {
    const { secret, port } = readConfig();
    if (!secret) {
      throw new Error(
        "EXTENSION_SECRET env var missing. See the extension's options page."
      );
    }
    this.sharedSecret = secret;

    if (await isPortInUse(port)) {
      throw new Error(
        `Configured port ${port} is already in use. Please configure a different port.`
      );
    }

    // Unless running in a container, bind to localhost only
    const host = process.env.CONTAINERIZED ? "0.0.0.0" : "localhost";

    this.wsServer = new WebSocket.Server({
      host,
      port,
    });

    console.error(`[browser-mcp] WebSocket server listening on ${host}:${port}`);
    this.wsServer.on("connection", async (connection) => {
      this.ws = connection;
      this.lastConnectionTime = Date.now();

      console.error("[browser-mcp] WebSocket connection established on port", port);

      // Query extension version and store it
      this.queryExtensionVersion().then((version) => {
        this.extensionVersion = version;
      }).catch((err) => {
        console.error("[browser-mcp] Failed to query extension version:", err);
      });

      this.ws.on("message", (message) => {
        const decoded = JSON.parse(message.toString());
        if (isErrorMessage(decoded)) {
          this.handleExtensionError(decoded);
          return;
        }
        const signature = this.createSignature(JSON.stringify(decoded.payload));
        if (signature !== decoded.signature) {
          console.error("[browser-mcp] Invalid message signature");
          return;
        }
        this.handleDecodedExtensionMessage(decoded.payload);
      });

      this.ws.on("close", (code, reason) => {
        const duration = Date.now() - this.lastConnectionTime;
        console.error(`[browser-mcp] WebSocket closed: code=${code} reason=${reason} connection_duration_ms=${duration}`);
        this.ws = null;
        this.lastDisconnectTime = Date.now();
      });

      this.ws.on("error", (error) => {
        console.error("[browser-mcp] WebSocket connection error:", error);
      });
    });
    this.wsServer.on("error", (error) => {
      console.error("[browser-mcp] WebSocket server error:", error);
    });
  }

  close() {
    this.wsServer?.close();
  }

  getSelectedPort() {
    return this.wsServer?.options.port;
  }

  private async queryExtensionVersion(): Promise<string | null> {
    try {
      const correlationId = await this.sendMessageToExtension({
        cmd: "get-version",
      });
      const message = await this.waitForResponse(correlationId, "version-result");
      console.error(`[browser-mcp] Extension version: ${message.version}`);
      return message.version;
    } catch {
      console.error("[browser-mcp] Failed to query extension version");
      return null;
    }
  }

  async getExtensionVersion(): Promise<string | null> {
    return this.extensionVersion;
  }

  async openTab(url: string): Promise<number | undefined> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "open-tab",
      url,
    });
    const message = await this.waitForResponse(correlationId, "opened-tab-id");
    return message.tabId;
  }

  async closeTabs(tabIds: number[]) {
    const correlationId = await this.sendMessageToExtension({
      cmd: "close-tabs",
      tabIds,
    });
    await this.waitForResponse(correlationId, "tabs-closed");
  }

  async getTabList(): Promise<BrowserTab[]> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "get-tab-list",
    });
    const message = await this.waitForResponse(correlationId, "tabs");
    return message.tabs;
  }

  async getBrowserRecentHistory(
    searchQuery?: string
  ): Promise<BrowserHistoryItem[]> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "get-browser-recent-history",
      searchQuery,
    });
    const message = await this.waitForResponse(correlationId, "history");
    return message.historyItems;
  }

  async getTabContent(
    tabId: number,
    offset: number
  ): Promise<TabContentExtensionMessage> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "get-tab-content",
      tabId,
      offset,
    });
    return await this.waitForResponse(correlationId, "tab-content");
  }

  async reorderTabs(tabOrder: number[]): Promise<number[]> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "reorder-tabs",
      tabOrder,
    });
    const message = await this.waitForResponse(correlationId, "tabs-reordered");
    return message.tabOrder;
  }

  async findHighlight(tabId: number, queryPhrase: string): Promise<number> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "find-highlight",
      tabId,
      queryPhrase,
    });
    const message = await this.waitForResponse(
      correlationId,
      "find-highlight-result"
    );
    return message.noOfResults;
  }

  async navigate(
    url: string,
    tabId?: number,
    waitUntil?: "load" | "domcontentloaded"
  ): Promise<{ url: string; title: string }> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "navigate",
      url,
      tabId,
      waitUntil,
    });
    const message = await this.waitForResponse(
      correlationId,
      "navigate-result",
      getTimeoutForCommand("navigate")
    );
    return { url: message.url, title: message.title };
  }

  async evaluate(
    script: string,
    tabId?: number
  ): Promise<{ result: string }> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "evaluate",
      script,
      tabId,
    });
    const message = await this.waitForResponse(
      correlationId,
      "evaluate-result",
      getTimeoutForCommand("evaluate")
    );
    return { result: message.result };
  }

  async click(
    selector: string,
    description?: string,
    tabId?: number
  ): Promise<{ success: boolean }> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "click",
      selector,
      description,
      tabId,
    });
    const message = await this.waitForResponse(
      correlationId,
      "click-result",
      getTimeoutForCommand("click")
    );
    return { success: message.success };
  }

  async type(
    selector: string,
    text: string,
    clearFirst?: boolean,
    submit?: boolean,
    tabId?: number
  ): Promise<{ success: boolean }> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "type",
      selector,
      text,
      clearFirst,
      submit,
      tabId,
    });
    const message = await this.waitForResponse(
      correlationId,
      "type-result",
      getTimeoutForCommand("type")
    );
    return { success: message.success };
  }

  async screenshot(
    tabId?: number,
    format?: "png" | "jpeg",
    quality?: number
  ): Promise<{ dataUrl: string; mimeType: string }> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "screenshot",
      tabId,
      format,
      quality,
    });
    const message = await this.waitForResponse(
      correlationId,
      "screenshot-result",
      getTimeoutForCommand("screenshot")
    );
    return { dataUrl: message.dataUrl, mimeType: message.mimeType };
  }

  async fillForm(
    fields: Array<{ selector: string; value: string | boolean }>,
    submit?: boolean,
    tabId?: number
  ): Promise<{ filled: number; errors: string[] }> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "fill-form",
      fields,
      submit,
      tabId,
    });
    const message = await this.waitForResponse(
      correlationId,
      "fill-form-result",
      getTimeoutForCommand("fill-form")
    );
    return { filled: message.filled, errors: message.errors };
  }

  async snapshot(
    tabId?: number,
    maxElements?: number,
    includeNonInteractive?: boolean
  ): Promise<{ elements: Array<{ selector: string; role: string; name: string; tag: string; type?: string; href?: string }> }> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "snapshot",
      tabId,
      maxElements,
      includeNonInteractive,
    });
    const message = await this.waitForResponse(
      correlationId,
      "snapshot-result",
      getTimeoutForCommand("snapshot")
    );
    return { elements: message.elements };
  }

  async waitFor(
    selector: string,
    tabId?: number,
    timeoutMs?: number,
    visible?: boolean
  ): Promise<{ found: boolean; elapsed_ms: number }> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "wait-for",
      selector,
      tabId,
      timeoutMs,
      visible,
    });
    const message = await this.waitForResponse(
      correlationId,
      "wait-for-result",
      getTimeoutForCommand("wait-for")
    );
    return { found: message.found, elapsed_ms: message.elapsed_ms };
  }

  async getNetworkRequests(
    tabId?: number,
    filterUrl?: string,
    sinceMs?: number,
    limit?: number
  ): Promise<{ requests: Array<{ method: string; url: string; status: number; duration_ms: number; timestamp: number }> }> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "get-network-requests",
      tabId,
      filterUrl,
      sinceMs,
      limit,
    });
    const message = await this.waitForResponse(
      correlationId,
      "network-requests-result",
      getTimeoutForCommand("get-network-requests")
    );
    return { requests: message.requests };
  }

  async groupTabs(
    tabIds: number[],
    isCollapsed: boolean,
    groupColor: string,
    groupTitle: string
  ): Promise<number> {
    const correlationId = await this.sendMessageToExtension({
      cmd: "group-tabs",
      tabIds,
      isCollapsed,
      groupColor,
      groupTitle,
    });
    const message = await this.waitForResponse(correlationId, "new-tab-group");
    return message.groupId;
  }

  private createSignature(payload: string): string {
    if (!this.sharedSecret) {
      throw new Error("Shared secret not initialized");
    }
    const hmac = crypto.createHmac("sha256", this.sharedSecret);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  private async sendMessageToExtension(message: ServerMessage): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error(`[browser-mcp] WebSocket not connected, waiting up to ${RECONNECT_WAIT_MS}ms for extension reconnect...`);
      await this.waitForReconnect();
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const disconnectedFor = this.lastDisconnectTime
        ? `${Date.now() - this.lastDisconnectTime}ms`
        : "unknown";
      throw new Error(
        `Not connected — extension did not reconnect within ${RECONNECT_WAIT_MS}ms ` +
        `(disconnected for ${disconnectedFor})`
      );
    }

    const correlationId = Math.random().toString(36).substring(2);
    const req: ServerMessageRequest = { ...message, correlationId };
    const payload = JSON.stringify(req);
    const signature = this.createSignature(payload);
    const signedMessage = {
      payload: req,
      signature: signature,
    };

    // Send the signed message to the extension
    this.ws.send(JSON.stringify(signedMessage));

    return correlationId;
  }

  private waitForReconnect(): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          console.error(`[browser-mcp] Extension reconnected after ${Date.now() - start}ms`);
          resolve();
          return;
        }
        if (Date.now() - start >= RECONNECT_WAIT_MS) {
          console.error(`[browser-mcp] Extension did not reconnect within ${RECONNECT_WAIT_MS}ms`);
          resolve();
          return;
        }
        setTimeout(check, RECONNECT_POLL_MS);
      };
      setTimeout(check, RECONNECT_POLL_MS);
    });
  }

  private handleDecodedExtensionMessage(decoded: ExtensionMessage) {
    const { correlationId } = decoded;
    const entry = this.extensionRequestMap.get(correlationId);
    if (!entry) {
      // Late response after timeout — already cleaned up, ignore
      console.error(`[browser-mcp] Late response for correlationId=${correlationId} (already timed out), ignoring`);
      return;
    }
    if (entry.resource !== decoded.resource) {
      console.error("Resource mismatch:", entry.resource, decoded.resource);
      return;
    }
    this.extensionRequestMap.delete(correlationId);
    entry.resolve(decoded);
  }

  private handleExtensionError(decoded: ExtensionError) {
    const { correlationId, errorMessage } = decoded;
    const entry = this.extensionRequestMap.get(correlationId);
    if (!entry) {
      // Late error after timeout — already cleaned up, ignore
      console.error(`[browser-mcp] Late error for correlationId=${correlationId} (already timed out): ${errorMessage}`);
      return;
    }
    this.extensionRequestMap.delete(correlationId);
    entry.reject(errorMessage);
  }

  private async waitForResponse<T extends ExtensionMessage["resource"]>(
    correlationId: string,
    resource: T,
    timeoutMs?: number
  ): Promise<Extract<ExtensionMessage, { resource: T }>> {
    const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<Extract<ExtensionMessage, { resource: T }>>(
      (resolve, reject) => {
        this.extensionRequestMap.set(correlationId, {
          resolve: resolve as (value: ExtensionMessage) => void,
          resource,
          reject,
        });
        setTimeout(() => {
          this.extensionRequestMap.delete(correlationId);
          reject(`Timed out waiting for ${resource} response (correlationId=${correlationId}, timeout=${timeout}ms)`);
        }, timeout);
      }
    );
  }
}

function readConfig() {
  return {
    secret: process.env.EXTENSION_SECRET,
    port: process.env.EXTENSION_PORT
      ? parseInt(process.env.EXTENSION_PORT, 10)
      : WS_DEFAULT_PORT,
  };
}

export function isErrorMessage(message: any): message is ExtensionError {
  return (
    message.errorMessage !== undefined && message.correlationId !== undefined
  );
}
