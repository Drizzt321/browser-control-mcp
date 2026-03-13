import type { ServerMessageRequest } from "@browser-control-mcp/common";
import { WebsocketClient } from "./client";
import { isCommandAllowed, isDomainInDenyList, isDomainAllowed, COMMAND_TO_TOOL_ID, addAuditLogEntry } from "./extension-config";
import { evaluateInPage, clickElement, typeInElement, fillForm, getSnapshot } from "./mutation-handler";

export class MessageHandler {
  private client: WebsocketClient;

  constructor(client: WebsocketClient) {
    this.client = client;
  }

  public async handleDecodedMessage(req: ServerMessageRequest): Promise<void> {
    const isAllowed = await isCommandAllowed(req.cmd);
    if (!isAllowed) {
      throw new Error(`Command '${req.cmd}' is disabled in extension settings`);
    }

    this.addAuditLogForReq(req).catch((error) => {
      console.error("Failed to add audit log entry:", error);
    });

    switch (req.cmd) {
      case "open-tab":
        await this.openUrl(req.correlationId, req.url);
        break;
      case "close-tabs":
        await this.closeTabs(req.correlationId, req.tabIds);
        break;
      case "get-tab-list":
        await this.sendTabs(req.correlationId);
        break;
      case "get-browser-recent-history":
        await this.sendRecentHistory(req.correlationId, req.searchQuery);
        break;
      case "get-tab-content":
        await this.sendTabsContent(req.correlationId, req.tabId, req.offset);
        break;
      case "reorder-tabs":
        await this.reorderTabs(req.correlationId, req.tabOrder);
        break;
      case "find-highlight":
        await this.findAndHighlightText(
          req.correlationId,
          req.tabId,
          req.queryPhrase
        );
        break;
      case "group-tabs":
        await this.groupTabs(
          req.correlationId,
          req.tabIds,
          req.isCollapsed,
          req.groupColor as browser.tabGroups.Color,
          req.groupTitle
        );
        break;
      case "navigate":
        await this.navigateTab(
          req.correlationId,
          req.url,
          req.tabId,
          req.waitUntil
        );
        break;
      case "evaluate":
        await this.evaluateScript(
          req.correlationId,
          req.script,
          req.tabId
        );
        break;
      case "click":
        await this.clickElement(
          req.correlationId,
          req.selector,
          req.description,
          req.tabId
        );
        break;
      case "type":
        await this.typeText(
          req.correlationId,
          req.selector,
          req.text,
          req.clearFirst,
          req.submit,
          req.tabId
        );
        break;
      case "screenshot":
        await this.takeScreenshot(
          req.correlationId,
          req.tabId,
          req.format,
          req.quality
        );
        break;
      case "fill-form":
        await this.fillFormFields(
          req.correlationId,
          req.fields,
          req.submit,
          req.tabId
        );
        break;
      case "snapshot":
        await this.takeSnapshot(
          req.correlationId,
          req.tabId,
          req.maxElements,
          req.includeNonInteractive
        );
        break;
      default:
        const _exhaustiveCheck: never = req;
        console.error("Invalid message received:", req);
    }
  }

  private async addAuditLogForReq(req: ServerMessageRequest) {
    // Get the URL in context (either from param or from the tab)
    let contextUrl: string | undefined;
    if ("url" in req && req.url) {
      contextUrl = req.url;
    }
    if ("tabId" in req && req.tabId !== undefined) {
      try {
        const tab = await browser.tabs.get(req.tabId);
        contextUrl = tab.url;
      } catch (error) {
        console.error("Failed to get tab URL for audit log:", error);
      }
    }

    const toolId = COMMAND_TO_TOOL_ID[req.cmd];
    const auditEntry = {
      toolId,
      command: req.cmd,
      timestamp: Date.now(),
      url: contextUrl
    };
    
    await addAuditLogEntry(auditEntry);
  }

  /**
   * Checks both allow list and deny list for a URL.
   * Throws if the domain is blocked by either list.
   */
  private async checkDomainAccess(url: string): Promise<void> {
    if (!(await isDomainAllowed(url))) {
      throw new Error("Domain not in allow list");
    }
    if (await isDomainInDenyList(url)) {
      throw new Error("Domain in user defined deny list");
    }
  }

  private async openUrl(correlationId: string, url: string): Promise<void> {
    if (!url.startsWith("https://")) {
      console.error("Invalid URL:", url);
      throw new Error("Invalid URL");
    }

    await this.checkDomainAccess(url);

    const tab = await browser.tabs.create({
      url,
    });

    await this.client.sendResourceToServer({
      resource: "opened-tab-id",
      correlationId,
      tabId: tab.id,
    });
  }

  private async closeTabs(
    correlationId: string,
    tabIds: number[]
  ): Promise<void> {
    await browser.tabs.remove(tabIds);
    await this.client.sendResourceToServer({
      resource: "tabs-closed",
      correlationId,
    });
  }

  private async sendTabs(correlationId: string): Promise<void> {
    const tabs = await browser.tabs.query({});
    await this.client.sendResourceToServer({
      resource: "tabs",
      correlationId,
      tabs,
    });
  }

  private async sendRecentHistory(
    correlationId: string,
    searchQuery: string | null = null
  ): Promise<void> {
    const historyItems = await browser.history.search({
      text: searchQuery ?? "", // Search for all URLs (empty string matches everything)
      maxResults: 200, // Limit to 200 results
      startTime: 0, // Search from the beginning of time
    });
    const filteredHistoryItems = historyItems.filter((item) => {
      return !!item.url;
    });
    await this.client.sendResourceToServer({
      resource: "history",
      correlationId,
      historyItems: filteredHistoryItems,
    });
  }

  // Check that the user has granted permission to access the URL's domain.
  // This will open the options page with a URL parameter to request permission
  // and throw an error to indicate that the request cannot proceed until permission is granted.
  private async checkForUrlPermission(url: string | undefined): Promise<void> {
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      const origin = new URL(url).origin;
      const granted = await browser.permissions.contains({
        origins: [`${origin}/*`],
      });

      if (!granted) {
        // Open the options page with a URL parameter to request permission:
        const optionsUrl = browser.runtime.getURL("options.html");
        const urlWithParams = `${optionsUrl}?requestUrl=${encodeURIComponent(
          url
        )}`;

        await browser.tabs.create({ url: urlWithParams });
        throw new Error(
          `The user has not yet granted permission to access the domain "${origin}". A dialog is now being opened to request permission. If the user grants permission, you can try the request again.`
        );
      }
    }
  }

  private async checkForGlobalPermission(permissions: string[]): Promise<void> {
    const granted = await browser.permissions.contains({
      permissions,
    });

    if (!granted) {
      // Open the options page with a URL parameter to request permission:
      const optionsUrl = browser.runtime.getURL("options.html");
      const urlWithParams = `${optionsUrl}?requestPermissions=${encodeURIComponent(
        JSON.stringify(permissions)
      )}`;

      await browser.tabs.create({ url: urlWithParams });
      throw new Error(
        `The user has not yet granted permission for the following operations: ${permissions.join(
          ", "
        )}. A dialog is now being opened to request permission. If the user grants permission, you can try the request again.`
      );
    }
  }

  private async sendTabsContent(
    correlationId: string,
    tabId: number,
    offset?: number
  ): Promise<void> {
    const tab = await browser.tabs.get(tabId);
    if (tab.url) {
      await this.checkDomainAccess(tab.url);
    }

    await this.checkForUrlPermission(tab.url);

    const MAX_CONTENT_LENGTH = 50_000;
    const results = await browser.tabs.executeScript(tabId, {
      code: `
      (function () {
        function getLinks() {
          const linkElements = document.querySelectorAll('a[href]');
          return Array.from(linkElements).map(el => ({
            url: el.href,
            text: el.innerText.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || ''
          })).filter(link => link.text !== '' && link.url.startsWith('https://') && !link.url.includes('#'));
        }

        function getTextContent() {
          let isTruncated = false;
          let text = document.body.innerText.substring(${Number(offset) || 0});
          if (text.length > ${MAX_CONTENT_LENGTH}) {
            text = text.substring(0, ${MAX_CONTENT_LENGTH});
            isTruncated = true;
          }
          return {
            text, isTruncated
          }
        }

        const textContent = getTextContent();

        return {
          links: getLinks(),
          fullText: textContent.text,
          isTruncated: textContent.isTruncated,
          totalLength: document.body.innerText.length
        };
      })();
    `,
    });
    const { isTruncated, fullText, links, totalLength } = results[0];
    await this.client.sendResourceToServer({
      resource: "tab-content",
      tabId,
      correlationId,
      isTruncated,
      fullText,
      links,
      totalLength,
    });
  }

  private async reorderTabs(
    correlationId: string,
    tabOrder: number[]
  ): Promise<void> {
    // Reorder the tabs sequentially
    for (let newIndex = 0; newIndex < tabOrder.length; newIndex++) {
      const tabId = tabOrder[newIndex];
      await browser.tabs.move(tabId, { index: newIndex });
    }
    await this.client.sendResourceToServer({
      resource: "tabs-reordered",
      correlationId,
      tabOrder,
    });
  }

  private async findAndHighlightText(
    correlationId: string,
    tabId: number,
    queryPhrase: string
  ): Promise<void> {
    const tab = await browser.tabs.get(tabId);

    if (tab.url) {
      await this.checkDomainAccess(tab.url);
    }

    await this.checkForGlobalPermission(["find"]);

    const findResults = await browser.find.find(queryPhrase, {
      tabId,
      caseSensitive: true,
    });

    // If there are results, highlight them
    if (findResults.count > 0) {
      // But first, activate the tab. In firefox, this would also enable
      // auto-scrolling to the highlighted result.
      await browser.tabs.update(tabId, { active: true });
      browser.find.highlightResults({
        tabId,
      });
    }

    await this.client.sendResourceToServer({
      resource: "find-highlight-result",
      correlationId,
      noOfResults: findResults.count,
    });
  }

  private async navigateTab(
    correlationId: string,
    url: string,
    tabId?: number,
    waitUntil?: "load" | "domcontentloaded"
  ): Promise<void> {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("Invalid URL: must start with http:// or https://");
    }

    await this.checkDomainAccess(url);

    // Resolve target tab
    let targetTabId: number;
    if (tabId !== undefined) {
      targetTabId = tabId;
    } else {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab?.id) {
        throw new Error("No active tab found");
      }
      targetTabId = activeTab.id;
    }

    await this.checkForUrlPermission(url);

    // Navigate and wait for load
    await browser.tabs.update(targetTabId, { url });

    // Wait for the tab to finish loading
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        browser.tabs.onUpdated.removeListener(listener);
        reject(new Error("Navigation timed out"));
      }, 30000);

      const targetStatus =
        waitUntil === "domcontentloaded" ? "loading" : "complete";

      const listener = (
        updatedTabId: number,
        changeInfo: browser.tabs._OnUpdatedChangeInfo
      ) => {
        if (updatedTabId === targetTabId && changeInfo.status === targetStatus) {
          clearTimeout(timeout);
          browser.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      browser.tabs.onUpdated.addListener(listener);
    });

    // Get final tab info
    const tab = await browser.tabs.get(targetTabId);

    await this.client.sendResourceToServer({
      resource: "navigate-result",
      correlationId,
      url: tab.url ?? url,
      title: tab.title ?? "",
    });
  }

  private async evaluateScript(
    correlationId: string,
    script: string,
    tabId?: number
  ): Promise<void> {
    // Resolve target tab
    let targetTabId: number;
    if (tabId !== undefined) {
      targetTabId = tabId;
    } else {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab?.id) {
        throw new Error("No active tab found");
      }
      targetTabId = activeTab.id;
    }

    const tab = await browser.tabs.get(targetTabId);
    if (tab.url) {
      await this.checkDomainAccess(tab.url);
    }

    await this.checkForUrlPermission(tab.url);

    const result = await evaluateInPage(targetTabId, script);

    await this.client.sendResourceToServer({
      resource: "evaluate-result",
      correlationId,
      result,
    });
  }

  private async clickElement(
    correlationId: string,
    selector: string,
    description?: string,
    tabId?: number
  ): Promise<void> {
    // Resolve target tab
    let targetTabId: number;
    if (tabId !== undefined) {
      targetTabId = tabId;
    } else {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab?.id) {
        throw new Error("No active tab found");
      }
      targetTabId = activeTab.id;
    }

    const tab = await browser.tabs.get(targetTabId);
    if (tab.url) {
      await this.checkDomainAccess(tab.url);
    }

    await this.checkForUrlPermission(tab.url);

    const success = await clickElement(targetTabId, selector);

    await this.client.sendResourceToServer({
      resource: "click-result",
      correlationId,
      success,
      description,
    });
  }

  private async typeText(
    correlationId: string,
    selector: string,
    text: string,
    clearFirst?: boolean,
    submit?: boolean,
    tabId?: number
  ): Promise<void> {
    // Resolve target tab
    let targetTabId: number;
    if (tabId !== undefined) {
      targetTabId = tabId;
    } else {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab?.id) {
        throw new Error("No active tab found");
      }
      targetTabId = activeTab.id;
    }

    const tab = await browser.tabs.get(targetTabId);
    if (tab.url) {
      await this.checkDomainAccess(tab.url);
    }

    await this.checkForUrlPermission(tab.url);

    const success = await typeInElement(targetTabId, selector, text, clearFirst ?? false, submit ?? false);

    await this.client.sendResourceToServer({
      resource: "type-result",
      correlationId,
      success,
    });
  }

  private async takeScreenshot(
    correlationId: string,
    tabId?: number,
    format?: "png" | "jpeg",
    quality?: number
  ): Promise<void> {
    // Resolve target tab — must activate it since captureVisibleTab captures the visible tab
    let targetTabId: number;
    if (tabId !== undefined) {
      targetTabId = tabId;
    } else {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab?.id) {
        throw new Error("No active tab found");
      }
      targetTabId = activeTab.id;
    }

    const tab = await browser.tabs.get(targetTabId);
    if (tab.url) {
      await this.checkDomainAccess(tab.url);
    }

    await this.checkForUrlPermission(tab.url);

    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const options: browser.extensionTypes.ImageDetails = {
      format: format === "jpeg" ? "jpeg" : "png",
    };
    if (format === "jpeg" && quality !== undefined) {
      options.quality = quality;
    }

    // Try captureTab (Firefox-specific, takes tabId directly) then captureVisibleTab
    // Both require <all_urls> permission granted via optional_permissions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tabs = browser.tabs as any;
    let dataUrl: string;
    if (typeof tabs.captureTab === "function") {
      dataUrl = await tabs.captureTab(targetTabId, options);
    } else if (typeof tabs.captureVisibleTab === "function") {
      await browser.tabs.update(targetTabId, { active: true });
      dataUrl = await tabs.captureVisibleTab(tab.windowId!, options);
    } else {
      // APIs not available — open options page to request <all_urls> permission from user
      const optionsUrl = browser.runtime.getURL(
        "options.html?requestPermissions=" +
        encodeURIComponent(JSON.stringify(["<all_urls>"]))
      );
      await browser.tabs.create({ url: optionsUrl });
      throw new Error(
        'Screenshot requires the "<all_urls>" permission. ' +
        "A permission grant dialog has been opened — please approve it, then retry."
      );
    }

    await this.client.sendResourceToServer({
      resource: "screenshot-result",
      correlationId,
      dataUrl,
      mimeType,
    });
  }

  private async fillFormFields(
    correlationId: string,
    fields: Array<{ selector: string; value: string | boolean }>,
    submit?: boolean,
    tabId?: number
  ): Promise<void> {
    // Resolve target tab
    let targetTabId: number;
    if (tabId !== undefined) {
      targetTabId = tabId;
    } else {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab?.id) {
        throw new Error("No active tab found");
      }
      targetTabId = activeTab.id;
    }

    const tab = await browser.tabs.get(targetTabId);
    if (tab.url) {
      await this.checkDomainAccess(tab.url);
    }

    await this.checkForUrlPermission(tab.url);

    const result = await fillForm(targetTabId, fields, submit ?? false);

    await this.client.sendResourceToServer({
      resource: "fill-form-result",
      correlationId,
      filled: result.filled,
      errors: result.errors,
    });
  }

  private async takeSnapshot(
    correlationId: string,
    tabId?: number,
    maxElements?: number,
    includeNonInteractive?: boolean
  ): Promise<void> {
    // Resolve target tab
    let targetTabId: number;
    if (tabId !== undefined) {
      targetTabId = tabId;
    } else {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab?.id) {
        throw new Error("No active tab found");
      }
      targetTabId = activeTab.id;
    }

    const tab = await browser.tabs.get(targetTabId);
    if (tab.url) {
      await this.checkDomainAccess(tab.url);
    }

    await this.checkForUrlPermission(tab.url);

    const elements = await getSnapshot(
      targetTabId,
      maxElements ?? 100,
      includeNonInteractive ?? false
    );

    await this.client.sendResourceToServer({
      resource: "snapshot-result",
      correlationId,
      elements,
    });
  }

  private async groupTabs(
    correlationId: string,
    tabIds: number[],
    isCollapsed: boolean,
    groupColor: browser.tabGroups.Color,
    groupTitle: string
  ): Promise<void> {
    const groupId = await browser.tabs.group({
      tabIds,
    });

    let tabGroup = await browser.tabGroups.update(groupId, {
      collapsed: isCollapsed,
      color: groupColor,
      title: groupTitle,
    });

    await this.client.sendResourceToServer({
      resource: "new-tab-group",
      correlationId,
      groupId: tabGroup.id,
    });
  }
}
