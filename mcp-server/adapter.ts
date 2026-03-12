import { SessionManager } from "./session";
import { TabOwnershipManager } from "./tab-ownership";
import { logMutation } from "./audit-log";
import {
  SessionExpiredError,
  TabOwnedByOtherSessionError,
  DelayExceededError,
} from "./errors";

const MAX_DELAY_MS = 60000;

// Tools that perform mutations and should be audit-logged
const MUTATION_TOOLS = new Set([
  "browser-navigate",
  "browser-evaluate",
  "browser-click",
  "browser-type",
  "browser-screenshot",
  "browser-fill-form",
  "browser-snapshot",
  "browser-wait-for",
  "browser-network-requests",
]);

interface ExecuteOptions {
  delayBeforeMs?: number;
  delayAfterMs?: number;
  selector?: string;
  domain?: string;
  payload?: string;
  tabId?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Adapter {
  private sessionManager: SessionManager;
  private tabOwnership: TabOwnershipManager;

  constructor(
    sessionManager: SessionManager,
    tabOwnership: TabOwnershipManager
  ) {
    this.sessionManager = sessionManager;
    this.tabOwnership = tabOwnership;
  }

  async execute<T>(
    sessionId: string,
    toolName: string,
    options: ExecuteOptions,
    handler: () => Promise<T>
  ): Promise<T> {
    // Validate session
    if (!this.sessionManager.validateSession(sessionId)) {
      throw new SessionExpiredError(sessionId);
    }

    // Touch session (update last activity)
    this.sessionManager.touchSession(sessionId);

    // Check tab ownership if tabId is provided
    if (options.tabId !== undefined) {
      if (!this.tabOwnership.isAllowed(sessionId, options.tabId)) {
        const owner = this.tabOwnership.getOwner(options.tabId);
        throw new TabOwnedByOtherSessionError(options.tabId, owner ?? "unknown");
      }
      // Claim tab for this session
      this.tabOwnership.claimTab(sessionId, options.tabId);
    }

    // Validate and enforce delays
    if (options.delayBeforeMs !== undefined) {
      if (options.delayBeforeMs > MAX_DELAY_MS) {
        throw new DelayExceededError(
          "delay_before_ms",
          options.delayBeforeMs,
          MAX_DELAY_MS
        );
      }
    }
    if (options.delayAfterMs !== undefined) {
      if (options.delayAfterMs > MAX_DELAY_MS) {
        throw new DelayExceededError(
          "delay_after_ms",
          options.delayAfterMs,
          MAX_DELAY_MS
        );
      }
    }

    // Apply pre-delay
    if (options.delayBeforeMs && options.delayBeforeMs > 0) {
      await sleep(options.delayBeforeMs);
    }

    // Execute the handler
    const result = await handler();

    // Apply post-delay
    if (options.delayAfterMs && options.delayAfterMs > 0) {
      await sleep(options.delayAfterMs);
    }

    // Audit log for mutation tools
    if (MUTATION_TOOLS.has(toolName)) {
      logMutation({
        timestamp: new Date().toISOString(),
        sessionId,
        tool: toolName,
        selector: options.selector,
        domain: options.domain,
        payload: options.payload,
      });
    }

    return result;
  }
}
