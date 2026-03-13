import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserAPI } from "./browser-api";
import { Adapter } from "./adapter";
import { StaticSessionManager } from "./session";
import { SingleSessionOwnership } from "./tab-ownership";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const sessionManager = new StaticSessionManager();
const tabOwnership = new SingleSessionOwnership();
const adapter = new Adapter(sessionManager, tabOwnership);

function getSessionId(): string {
  return sessionManager.getActiveSession()!.id;
}

const mcpServer = new McpServer({
  name: "BrowserControl",
  version: "1.5.1",
});

mcpServer.tool(
  "open-browser-tab",
  "Open a new tab in the user's browser (useful when the user asks to open a website)",
  { url: z.string() },
  async ({ url }) => {
    return adapter.execute(getSessionId(), "open-browser-tab", {}, async () => {
      const openedTabId = await browserApi.openTab(url);
      if (openedTabId !== undefined) {
        return {
          content: [
            {
              type: "text",
              text: `${url} opened in tab id ${openedTabId}`,
            },
          ],
        };
      } else {
        return {
          content: [{ type: "text", text: "Failed to open tab", isError: true }],
        };
      }
    });
  }
);

mcpServer.tool(
  "close-browser-tabs",
  "Close tabs in the user's browser by tab IDs",
  { tabIds: z.array(z.number()) },
  async ({ tabIds }) => {
    return adapter.execute(getSessionId(), "close-browser-tabs", {}, async () => {
      await browserApi.closeTabs(tabIds);
      return {
        content: [{ type: "text", text: "Closed tabs" }],
      };
    });
  }
);

mcpServer.tool(
  "get-list-of-open-tabs",
  "Get the list of open tabs in the user's browser. Use offset and limit parameters for pagination when there are many tabs.",
  {
    offset: z.number().int().min(0).default(0).describe("Starting index for pagination (0-based, must be >= 0)"),
    limit: z.number().default(100).describe("Maximum number of tabs to return (default: 100, max: 500)"),
  },
  async ({ offset, limit }) => {
    return adapter.execute(getSessionId(), "get-list-of-open-tabs", {}, async () => {
    // Validate and cap the limit
    const effectiveLimit = Math.min(Math.max(1, limit), 500);

    const openTabs = await browserApi.getTabList();
    const totalTabs = openTabs.length;

    // Apply pagination
    const paginatedTabs = openTabs.slice(offset, offset + effectiveLimit);
    const hasMore = offset + effectiveLimit < totalTabs;

    // Add pagination info as the first content item
    const paginationInfo = {
      type: "text" as const,
      text: `Showing tabs ${offset + 1}-${offset + paginatedTabs.length} of ${totalTabs} total tabs${hasMore ? ` (use offset=${offset + effectiveLimit} to see more)` : ''}`,
    };

    const tabContent = paginatedTabs.map((tab) => {
      let lastAccessed = "unknown";
      if (tab.lastAccessed) {
        lastAccessed = dayjs(tab.lastAccessed).fromNow(); // LLM-friendly time ago
      }
      return {
        type: "text" as const,
        text: `tab id=${tab.id}, tab url=${tab.url}, tab title=${tab.title}, last accessed=${lastAccessed}`,
      };
    });

    return {
      content: [paginationInfo, ...tabContent],
    };
    });
  }
);

mcpServer.tool(
  "get-recent-browser-history",
  "Get the list of recent browser history (to get all, don't use searchQuery)",
  { searchQuery: z.string().optional() },
  async ({ searchQuery }) => {
    return adapter.execute(getSessionId(), "get-recent-browser-history", {}, async () => {
      const browserHistory = await browserApi.getBrowserRecentHistory(
        searchQuery
      );
      if (browserHistory.length > 0) {
        return {
          content: browserHistory.map((item) => {
            let lastVisited = "unknown";
            if (item.lastVisitTime) {
              lastVisited = dayjs(item.lastVisitTime).fromNow(); // LLM-friendly time ago
            }
            return {
              type: "text",
              text: `url=${item.url}, title="${item.title}", lastVisitTime=${lastVisited}`,
            };
          }),
        };
      } else {
        const hint = searchQuery ? "Try without a searchQuery" : "";
        return { content: [{ type: "text", text: `No history found. ${hint}` }] };
      }
    });
  }
);

mcpServer.tool(
  "get-tab-web-content",
  `
    Get the full text content of the webpage and the list of links in the webpage, by tab ID. 
    Use "offset" only for larger documents when the first call was truncated and if you require more content in order to assist the user.
  `,
  { tabId: z.number(), offset: z.number().default(0) },
  async ({ tabId, offset }) => {
    return adapter.execute(getSessionId(), "get-tab-web-content", { tabId }, async () => {
    const content = await browserApi.getTabContent(tabId, offset);
    let links: { type: "text"; text: string }[] = [];
    if (offset === 0) {
      // Only include the links if offset is 0 (default value). Otherwise, we can
      // assume this is not the first call. Adding the links again would be redundant.
      links = content.links.map((link: { text: string; url: string }) => {
        return {
          type: "text",

          text: `Link text: ${link.text}, Link URL: ${link.url}`,
        };
      });
    }

    let text = content.fullText;
    let hint: { type: "text"; text: string }[] = [];
    if (content.isTruncated || offset > 0) {
      // If the content is truncated, add a "tip" suggesting
      // that another tool, search in page, can be used to
      // discover additional data.
      const rangeString = `${offset}-${offset + text.length}`;
      hint = [
        {
          type: "text",
          text:
            `The following text content is truncated due to size (includes character range ${rangeString} out of ${content.totalLength}). ` +
            "If you want to read characters beyond this range, please use the 'get-tab-web-content' tool with an offset. ",
        },
      ];
    }

    return {
      content: [...hint, { type: "text", text }, ...links],
    };
    });
  }
);

mcpServer.tool(
  "reorder-browser-tabs",
  "Change the order of open browser tabs",
  { tabOrder: z.array(z.number()) },
  async ({ tabOrder }) => {
    return adapter.execute(getSessionId(), "reorder-browser-tabs", {}, async () => {
      const newOrder = await browserApi.reorderTabs(tabOrder);
      return {
        content: [
          { type: "text", text: `Tabs reordered: ${newOrder.join(", ")}` },
        ],
      };
    });
  }
);

mcpServer.tool(
  "find-highlight-in-browser-tab",
  "Find and highlight text in a browser tab (use a query phrase that exists in the web content)",
  { tabId: z.number(), queryPhrase: z.string() },
  async ({ tabId, queryPhrase }) => {
    return adapter.execute(getSessionId(), "find-highlight-in-browser-tab", { tabId }, async () => {
      const noOfResults = await browserApi.findHighlight(tabId, queryPhrase);
      return {
        content: [
          {
            type: "text",
            text: `Number of results found and highlighted in the tab: ${noOfResults}`,
          },
        ],
      };
    });
  }
);

mcpServer.tool(
  "group-browser-tabs",
  "Organize opened browser tabs in a new tab group",
  {
    tabIds: z.array(z.number()),
    isCollapsed: z.boolean().default(false),
    groupColor: z
      .enum([
        "grey",
        "blue",
        "red",
        "yellow",
        "green",
        "pink",
        "purple",
        "cyan",
        "orange",
      ])
      .default("grey"),
    groupTitle: z.string().default("New Group"),
  },
  async ({ tabIds, isCollapsed, groupColor, groupTitle }) => {
    return adapter.execute(getSessionId(), "group-browser-tabs", {}, async () => {
      const groupId = await browserApi.groupTabs(
        tabIds,
        isCollapsed,
        groupColor,
        groupTitle
      );
      return {
        content: [
          {
            type: "text",
            text: `Created tab group "${groupTitle}" with ${tabIds.length} tabs (group ID: ${groupId})`,
          },
        ],
      };
    });
  }
);

mcpServer.tool(
  "browser-navigate",
  "Navigate a browser tab to a URL and wait for the page to load",
  {
    url: z.string().describe("URL to navigate to (must be http:// or https://)"),
    tabId: z.number().optional().describe("Tab ID to navigate. Default: active tab"),
    wait_until: z.enum(["load", "domcontentloaded"]).optional().default("load").describe("Wait until page load event fires"),
    delay_before_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms before navigation"),
    delay_after_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms after navigation completes"),
  },
  async ({ url, tabId, wait_until, delay_before_ms, delay_after_ms }) => {
    return adapter.execute(
      getSessionId(),
      "browser-navigate",
      { tabId, delayBeforeMs: delay_before_ms, delayAfterMs: delay_after_ms },
      async () => {
        const result = await browserApi.navigate(url, tabId, wait_until);
        return {
          content: [
            {
              type: "text",
              text: `Navigated to ${result.url} — "${result.title}"`,
            },
          ],
        };
      }
    );
  }
);

mcpServer.tool(
  "browser-evaluate",
  "Execute JavaScript in the context of a browser tab and return the result",
  {
    script: z.string().describe("JavaScript code to evaluate in the page context. Use 'return <value>' to return a result."),
    tabId: z.number().optional().describe("Tab ID to evaluate in. Default: active tab"),
    delay_before_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms before evaluation"),
    delay_after_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms after evaluation completes"),
  },
  async ({ script, tabId, delay_before_ms, delay_after_ms }) => {
    return adapter.execute(
      getSessionId(),
      "browser-evaluate",
      { tabId, delayBeforeMs: delay_before_ms, delayAfterMs: delay_after_ms },
      async () => {
        const result = await browserApi.evaluate(script, tabId);
        return {
          content: [
            {
              type: "text",
              text: result.result,
            },
          ],
        };
      }
    );
  }
);

mcpServer.tool(
  "browser-click",
  "Click an element on a web page identified by CSS selector",
  {
    selector: z.string().describe("CSS selector for the element to click"),
    description: z.string().optional().describe("Human-readable label for the element (for logging)"),
    tabId: z.number().optional().describe("Tab ID to click in. Default: active tab"),
    delay_before_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms before clicking"),
    delay_after_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms after clicking"),
  },
  async ({ selector, description, tabId, delay_before_ms, delay_after_ms }) => {
    return adapter.execute(
      getSessionId(),
      "browser-click",
      { tabId, delayBeforeMs: delay_before_ms, delayAfterMs: delay_after_ms },
      async () => {
        const result = await browserApi.click(selector, description, tabId);
        const label = description ? ` (${description})` : "";
        return {
          content: [
            {
              type: "text",
              text: `Clicked element "${selector}"${label}`,
            },
          ],
        };
      }
    );
  }
);

mcpServer.tool(
  "browser-type",
  "Type text into an input element on a web page identified by CSS selector",
  {
    selector: z.string().describe("CSS selector for the input element"),
    text: z.string().describe("Text to type into the element"),
    clear_first: z.boolean().optional().describe("Clear the element before typing (default: false)"),
    submit: z.boolean().optional().describe("Submit the form after typing (default: false)"),
    tabId: z.number().optional().describe("Tab ID to type in. Default: active tab"),
    delay_before_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms before typing"),
    delay_after_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms after typing"),
  },
  async ({ selector, text, clear_first, submit, tabId, delay_before_ms, delay_after_ms }) => {
    return adapter.execute(
      getSessionId(),
      "browser-type",
      { tabId, delayBeforeMs: delay_before_ms, delayAfterMs: delay_after_ms },
      async () => {
        await browserApi.type(selector, text, clear_first, submit, tabId);
        return {
          content: [
            {
              type: "text",
              text: `Typed "${text}" into "${selector}"${clear_first ? " (cleared first)" : ""}${submit ? " (submitted)" : ""}`,
            },
          ],
        };
      }
    );
  }
);

mcpServer.tool(
  "browser-screenshot",
  "Capture a screenshot of the visible area of a browser tab",
  {
    tabId: z.number().optional().describe("Tab ID to screenshot. Default: active tab"),
    format: z.enum(["png", "jpeg"]).optional().describe("Image format (default: png)"),
    quality: z.number().int().min(0).max(100).optional().describe("JPEG quality 0-100 (only for jpeg format)"),
    delay_before_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms before taking screenshot"),
    delay_after_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms after taking screenshot"),
  },
  async ({ tabId, format, quality, delay_before_ms, delay_after_ms }) => {
    return adapter.execute(
      getSessionId(),
      "browser-screenshot",
      { tabId, delayBeforeMs: delay_before_ms, delayAfterMs: delay_after_ms },
      async () => {
        const result = await browserApi.screenshot(tabId, format, quality);
        // Strip data URL prefix to get raw base64
        const base64Data = result.dataUrl.replace(/^data:[^;]+;base64,/, "");
        return {
          content: [
            {
              type: "image",
              data: base64Data,
              mimeType: result.mimeType,
            },
          ],
        };
      }
    );
  }
);

mcpServer.tool(
  "browser-fill-form",
  "Fill multiple form fields at once on a web page",
  {
    fields: z.array(z.object({
      selector: z.string().describe("CSS selector for the form field"),
      value: z.union([z.string(), z.boolean()]).describe("Value to set (string for text/select, boolean for checkbox/radio)"),
    })).describe("Array of fields to fill"),
    submit: z.boolean().optional().describe("Submit the form after filling (default: false)"),
    tabId: z.number().optional().describe("Tab ID to fill form in. Default: active tab"),
    delay_before_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms before filling"),
    delay_after_ms: z.number().int().min(0).max(60000).optional().describe("Delay in ms after filling"),
  },
  async ({ fields, submit, tabId, delay_before_ms, delay_after_ms }) => {
    return adapter.execute(
      getSessionId(),
      "browser-fill-form",
      { tabId, delayBeforeMs: delay_before_ms, delayAfterMs: delay_after_ms },
      async () => {
        const result = await browserApi.fillForm(fields, submit, tabId);
        const parts: string[] = [`Filled ${result.filled}/${fields.length} fields`];
        if (result.errors.length > 0) {
          parts.push(`Errors: ${result.errors.join("; ")}`);
        }
        return {
          content: [
            {
              type: "text",
              text: parts.join(". "),
            },
          ],
        };
      }
    );
  }
);

const browserApi = new BrowserAPI();
browserApi.init().catch((err) => {
  console.error("Browser API init error", err);
  process.exit(1);
});

const transport = new StdioServerTransport();
mcpServer.connect(transport).catch((err) => {
  console.error("MCP Server connection error", err);
  process.exit(1);
});

process.stdin.on("close", () => {
  browserApi.close();
  mcpServer.close();
  process.exit(0);
});
