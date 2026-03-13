import { MessageHandler } from "../message-handler";
import { WebsocketClient } from "../client";
import type { ServerMessageRequest } from "@browser-control-mcp/common";
import { ExtensionConfig } from "../extension-config";

// Mock the WebsocketClient
jest.mock("../client", () => {
  return {
    WebsocketClient: jest.fn().mockImplementation(() => {
      return {
        sendResourceToServer: jest.fn().mockResolvedValue(undefined),
        sendErrorToServer: jest.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

describe("MessageHandler", () => {
  let messageHandler: MessageHandler;
  let mockClient: jest.Mocked<WebsocketClient>;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Create a new instance of WebsocketClient and MessageHandler
    mockClient = new WebsocketClient(
      8080,
      "test-secret"
    ) as jest.Mocked<WebsocketClient>;
    messageHandler = new MessageHandler(mockClient);

    // Mock browser.storage.local.get to return default config
    const defaultConfig: ExtensionConfig = {
      secret: "test-secret",
      toolSettings: {
        "open-browser-tab": true,
        "close-browser-tabs": true,
        "get-list-of-open-tabs": true,
        "get-recent-browser-history": true,
        "get-tab-web-content": true,
        "reorder-browser-tabs": true,
        "find-highlight-in-browser-tab": true,
      },
      domainDenyList: [],
      ports: [8089],
      auditLog: [],
    };

    (browser.storage.local.get as jest.Mock).mockResolvedValue({
      config: defaultConfig,
    });
  });

  describe("handleDecodedMessage", () => {
    it("should throw an error if command is not allowed", async () => {
      // Arrange
      const configWithDisabledOpenTab: ExtensionConfig = {
        secret: "test-secret",
        toolSettings: {
          "open-browser-tab": false, // Disable open-tab command
          "close-browser-tabs": true,
          "get-list-of-open-tabs": true,
          "get-recent-browser-history": true,
          "get-tab-web-content": true,
          "reorder-browser-tabs": true,
          "find-highlight-in-browser-tab": true,
        },
        domainDenyList: [],
        ports: [8089],
        auditLog: [],
      };
      (browser.storage.local.get as jest.Mock).mockResolvedValue({
        config: configWithDisabledOpenTab,
      });

      const request: ServerMessageRequest = {
        cmd: "open-tab",
        url: "https://example.com",
        correlationId: "test-correlation-id",
      };

      // Act & Assert
      await expect(
        messageHandler.handleDecodedMessage(request)
      ).rejects.toThrow("Command 'open-tab' is disabled in extension settings");
    });

    describe("open-tab command", () => {
      it("should open a new tab and send the tab ID to the server", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "open-tab",
          url: "https://example.com",
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 123 };
        (browser.tabs.create as jest.Mock).mockResolvedValue(mockTab);

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.tabs.create).toHaveBeenCalledWith({
          url: "https://example.com",
        });
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "opened-tab-id",
          correlationId: "test-correlation-id",
          tabId: 123,
        });
      });

      it("should throw an error if URL does not start with https://", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "open-tab",
          url: "http://example.com",
          correlationId: "test-correlation-id",
        };

        // Act & Assert
        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Invalid URL");
        expect(browser.tabs.create).not.toHaveBeenCalled();
      });

      it("should throw an error if domain is in deny list", async () => {
        // Arrange
        const configWithDenyList: ExtensionConfig = {
          secret: "test-secret",
          toolSettings: {
            "open-browser-tab": true,
            "close-browser-tabs": true,
            "get-list-of-open-tabs": true,
            "get-recent-browser-history": true,
            "get-tab-web-content": true,
            "reorder-browser-tabs": true,
            "find-highlight-in-browser-tab": true,
          },
          domainDenyList: ["example.com", "another.com"],
          ports: [8089],
          auditLog: [],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "open-tab",
          url: "https://example.com",
          correlationId: "test-correlation-id",
        };

        // Act & Assert
        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Domain in user defined deny list");
        expect(browser.tabs.create).not.toHaveBeenCalled();
      });

      it("should open a new tab in the domain is not in the deny list", async () => {
        // Arrange
        const configWithDenyList: ExtensionConfig = {
          secret: "test-secret",
          toolSettings: {
            "open-browser-tab": true,
            "close-browser-tabs": true,
            "get-list-of-open-tabs": true,
            "get-recent-browser-history": true,
            "get-tab-web-content": true,
            "reorder-browser-tabs": true,
            "find-highlight-in-browser-tab": true,
          },
          domainDenyList: ["example.com", "another.com"],
          ports: [8089],
          auditLog: [],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "open-tab",
          url: "https://allowed.com",
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 123 };
        (browser.tabs.create as jest.Mock).mockResolvedValue(mockTab);

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.tabs.create).toHaveBeenCalledWith({
          url: "https://allowed.com",
        });
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "opened-tab-id",
          correlationId: "test-correlation-id",
          tabId: 123,
        });
      });
    });

    describe("close-tabs command", () => {
      it("should close tabs and send confirmation to the server", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "close-tabs",
          tabIds: [123, 456],
          correlationId: "test-correlation-id",
        };

        (browser.tabs.remove as jest.Mock).mockResolvedValue(undefined);

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.tabs.remove).toHaveBeenCalledWith([123, 456]);
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "tabs-closed",
          correlationId: "test-correlation-id",
        });
      });
    });

    describe("get-tab-list command", () => {
      it("should get tabs and send them to the server", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "get-tab-list",
          correlationId: "test-correlation-id",
        };

        const mockTabs = [{ id: 123, url: "https://example.com" }];
        (browser.tabs.query as jest.Mock).mockResolvedValue(mockTabs);

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.tabs.query).toHaveBeenCalledWith({});
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "tabs",
          correlationId: "test-correlation-id",
          tabs: mockTabs,
        });
      });
    });

    describe("get-browser-recent-history command", () => {
      it("should get history items and send them to the server", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "get-browser-recent-history",
          searchQuery: "test",
          correlationId: "test-correlation-id",
        };

        const mockHistoryItems = [
          { url: "https://example.com", title: "Example" },
          { url: "https://test.com", title: "Test" },
        ];
        (browser.history.search as jest.Mock).mockResolvedValue(
          mockHistoryItems
        );

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.history.search).toHaveBeenCalledWith({
          text: "test",
          maxResults: 200,
          startTime: 0,
        });
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "history",
          correlationId: "test-correlation-id",
          historyItems: mockHistoryItems,
        });
      });

      it("should use empty string for search query if not provided", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "get-browser-recent-history",
          correlationId: "test-correlation-id",
        };

        const mockHistoryItems = [
          { url: "https://example.com", title: "Example" },
        ];
        (browser.history.search as jest.Mock).mockResolvedValue(
          mockHistoryItems
        );

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.history.search).toHaveBeenCalledWith({
          text: "",
          maxResults: 200,
          startTime: 0,
        });
      });

      it("should filter out history items without URLs", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "get-browser-recent-history",
          correlationId: "test-correlation-id",
        };

        const mockHistoryItems = [
          { url: "https://example.com", title: "Example" },
          { title: "No URL" }, // This should be filtered out
        ];
        (browser.history.search as jest.Mock).mockResolvedValue(
          mockHistoryItems
        );

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "history",
          correlationId: "test-correlation-id",
          historyItems: [{ url: "https://example.com", title: "Example" }],
        });
      });
    });

    describe("get-tab-content command", () => {
      it("should get tab content and send it to the server", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "get-tab-content",
          tabId: 123,
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 123, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);

        const mockScriptResult = [
          {
            links: [{ url: "https://example.com/page", text: "Page" }],
            fullText: "Page content",
            isTruncated: false,
            totalLength: 12,
          },
        ];
        (browser.tabs.executeScript as jest.Mock).mockResolvedValue(
          mockScriptResult
        );

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.tabs.get).toHaveBeenCalledWith(123);
        expect(browser.permissions.contains).toHaveBeenCalledWith({
          origins: ["https://example.com/*"],
        });
        expect(browser.tabs.executeScript).toHaveBeenCalled();
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "tab-content",
          tabId: 123,
          correlationId: "test-correlation-id",
          isTruncated: false,
          fullText: "Page content",
          links: [{ url: "https://example.com/page", text: "Page" }],
          totalLength: 12,
        });
      });

      it("should throw an error if tab URL domain is in deny list", async () => {
        // Arrange
        const configWithDenyList: ExtensionConfig = {
          secret: "test-secret",
          toolSettings: {
            "open-browser-tab": true,
            "close-browser-tabs": true,
            "get-list-of-open-tabs": true,
            "get-recent-browser-history": true,
            "get-tab-web-content": true,
            "reorder-browser-tabs": true,
            "find-highlight-in-browser-tab": true,
          },
          domainDenyList: ["example.com"], // Add example.com to deny list
          ports: [8089],
          auditLog: [],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "get-tab-content",
          tabId: 123,
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 123, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);

        // Act & Assert
        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Domain in user defined deny list");
        expect(browser.tabs.executeScript).not.toHaveBeenCalled();
      });

      it("should throw an error if permissions are denied", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "get-tab-content",
          tabId: 123,
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 123, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(false);

        // Act & Assert
        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow();
        expect(browser.tabs.executeScript).not.toHaveBeenCalled();
      });
    });

    describe("reorder-tabs command", () => {
      it("should reorder tabs and send confirmation to the server", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "reorder-tabs",
          tabOrder: [123, 456, 789],
          correlationId: "test-correlation-id",
        };

        (browser.tabs.move as jest.Mock).mockResolvedValue(undefined);

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.tabs.move).toHaveBeenCalledTimes(3);
        expect(browser.tabs.move).toHaveBeenNthCalledWith(1, 123, { index: 0 });
        expect(browser.tabs.move).toHaveBeenNthCalledWith(2, 456, { index: 1 });
        expect(browser.tabs.move).toHaveBeenNthCalledWith(3, 789, { index: 2 });
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "tabs-reordered",
          correlationId: "test-correlation-id",
          tabOrder: [123, 456, 789],
        });
      });
    });

    describe("find-highlight command", () => {
      it("should find and highlight text in a tab", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "find-highlight",
          tabId: 123,
          queryPhrase: "test",
          correlationId: "test-correlation-id",
        };

        const mockFindResults = { count: 5 };
        (browser.find.find as jest.Mock).mockResolvedValue(mockFindResults);
        (browser.tabs.update as jest.Mock).mockResolvedValue(undefined);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.find.find).toHaveBeenCalledWith("test", {
          tabId: 123,
          caseSensitive: true,
        });
        expect(browser.tabs.update).toHaveBeenCalledWith(123, { active: true });
        expect(browser.find.highlightResults).toHaveBeenCalledWith({
          tabId: 123,
        });
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "find-highlight-result",
          correlationId: "test-correlation-id",
          noOfResults: 5,
        });
      });

      it("should not highlight or activate tab if no results found", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "find-highlight",
          tabId: 123,
          queryPhrase: "test",
          correlationId: "test-correlation-id",
        };

        const mockFindResults = { count: 0 };
        const mockTab = { id: 123, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.find.find as jest.Mock).mockResolvedValue(mockFindResults);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.tabs.update).not.toHaveBeenCalled();
        expect(browser.find.highlightResults).not.toHaveBeenCalled();
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "find-highlight-result",
          correlationId: "test-correlation-id",
          noOfResults: 0,
        });
      });

      it("should throw an error if permissions are denied", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "find-highlight",
          tabId: 123,
          queryPhrase: "test",
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 123, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(false);

        // Act & Assert
        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow();
        expect(browser.find.find).not.toHaveBeenCalled();
      });
    });

    describe("group-tabs command", () => {
      it("should group tabs and send the group ID to the server", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "group-tabs",
          tabIds: [123, 456],
          isCollapsed: false,
          groupColor: "blue",
          groupTitle: "Test Group",
          correlationId: "test-correlation-id",
        };

        (browser.tabs.group as jest.Mock).mockResolvedValue(1);
        (browser.tabGroups.update as jest.Mock).mockResolvedValue({ id: 1 });

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.tabs.group).toHaveBeenCalledWith({
          tabIds: [123, 456],
        });
        expect(browser.tabGroups.update).toHaveBeenCalledWith(1, {
          collapsed: false,
          color: "blue",
          title: "Test Group",
        });
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "new-tab-group",
          correlationId: "test-correlation-id",
          groupId: 1,
        });
      });

      it("should handle tab group errors gracefully", async () => {
        const request: ServerMessageRequest = {
          cmd: "group-tabs",
          tabIds: [999],
          isCollapsed: false,
          groupColor: "grey",
          groupTitle: "Error Group",
          correlationId: "test-correlation-id",
        };

        (browser.tabs.group as jest.Mock).mockRejectedValue(
          new Error("Invalid tab IDs")
        );

        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Invalid tab IDs");
      });

      it("should group tabs with collapsed state", async () => {
        // Arrange
        const request: ServerMessageRequest = {
          cmd: "group-tabs",
          tabIds: [789],
          isCollapsed: true,
          groupColor: "red",
          groupTitle: "Collapsed Group",
          correlationId: "test-correlation-id",
        };

        (browser.tabs.group as jest.Mock).mockResolvedValue(2);
        (browser.tabGroups.update as jest.Mock).mockResolvedValue({ id: 2 });

        // Act
        await messageHandler.handleDecodedMessage(request);

        // Assert
        expect(browser.tabGroups.update).toHaveBeenCalledWith(2, {
          collapsed: true,
          color: "red",
          title: "Collapsed Group",
        });
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "new-tab-group",
          correlationId: "test-correlation-id",
          groupId: 2,
        });
      });
    });

    describe("navigate command", () => {
      it("should navigate the active tab and send result to server", async () => {
        const request: ServerMessageRequest = {
          cmd: "navigate",
          url: "https://example.com",
          correlationId: "test-correlation-id",
        };

        const mockActiveTab = { id: 42, url: "https://old.com" };
        (browser.tabs.query as jest.Mock).mockResolvedValue([mockActiveTab]);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.tabs.update as jest.Mock).mockResolvedValue(undefined);

        // Simulate the onUpdated listener firing immediately
        (browser.tabs.onUpdated.addListener as jest.Mock).mockImplementation(
          (listener: Function) => {
            setTimeout(() => listener(42, { status: "complete" }), 0);
          }
        );

        const mockTab = {
          id: 42,
          url: "https://example.com",
          title: "Example",
        };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.tabs.update).toHaveBeenCalledWith(42, {
          url: "https://example.com",
        });
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "navigate-result",
          correlationId: "test-correlation-id",
          url: "https://example.com",
          title: "Example",
        });
      });

      it("should navigate a specific tab by tabId", async () => {
        const request: ServerMessageRequest = {
          cmd: "navigate",
          url: "https://example.com",
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.tabs.update as jest.Mock).mockResolvedValue(undefined);
        (browser.tabs.onUpdated.addListener as jest.Mock).mockImplementation(
          (listener: Function) => {
            setTimeout(() => listener(99, { status: "complete" }), 0);
          }
        );
        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 99,
          url: "https://example.com",
          title: "Example",
        });

        await messageHandler.handleDecodedMessage(request);

        expect(browser.tabs.update).toHaveBeenCalledWith(99, {
          url: "https://example.com",
        });
        expect(browser.tabs.query).not.toHaveBeenCalled();
      });

      it("should reject invalid URLs", async () => {
        const request: ServerMessageRequest = {
          cmd: "navigate",
          url: "ftp://example.com",
          correlationId: "test-correlation-id",
        };

        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Invalid URL");
      });
    });

    describe("evaluate command", () => {
      it("should evaluate script in the active tab", async () => {
        const request: ServerMessageRequest = {
          cmd: "evaluate",
          script: "return document.title",
          correlationId: "test-correlation-id",
        };

        const mockActiveTab = { id: 42, url: "https://example.com" };
        (browser.tabs.query as jest.Mock).mockResolvedValue([mockActiveTab]);
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockActiveTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: '"Example Domain"' } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.scripting.executeScript).toHaveBeenCalled();
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "evaluate-result",
          correlationId: "test-correlation-id",
          result: '"Example Domain"',
        });
      });

      it("should evaluate script in a specific tab by tabId", async () => {
        const request: ServerMessageRequest = {
          cmd: "evaluate",
          script: "return 1 + 1",
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 99, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: "2" } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.tabs.query).not.toHaveBeenCalled();
        expect(browser.scripting.executeScript).toHaveBeenCalled();
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "evaluate-result",
          correlationId: "test-correlation-id",
          result: "2",
        });
      });

      it("should throw if tab domain is in deny list", async () => {
        const configWithDenyList: ExtensionConfig = {
          secret: "test-secret",
          toolSettings: {
            "browser-evaluate": true,
          },
          domainDenyList: ["evil.com"],
          ports: [8089],
          auditLog: [],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "evaluate",
          script: "return 1",
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 99,
          url: "https://evil.com",
        });

        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Domain in user defined deny list");
        expect(browser.scripting.executeScript).not.toHaveBeenCalled();
      });
    });

    describe("click command", () => {
      it("should click element in the active tab", async () => {
        const request: ServerMessageRequest = {
          cmd: "click",
          selector: "button.submit",
          correlationId: "test-correlation-id",
        };

        const mockActiveTab = { id: 42, url: "https://example.com" };
        (browser.tabs.query as jest.Mock).mockResolvedValue([mockActiveTab]);
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockActiveTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: true } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.scripting.executeScript).toHaveBeenCalled();
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "click-result",
          correlationId: "test-correlation-id",
          success: true,
          description: undefined,
        });
      });

      it("should click element in a specific tab by tabId", async () => {
        const request: ServerMessageRequest = {
          cmd: "click",
          selector: "#my-button",
          description: "Submit button",
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 99, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: true } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.tabs.query).not.toHaveBeenCalled();
        expect(browser.scripting.executeScript).toHaveBeenCalled();
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "click-result",
          correlationId: "test-correlation-id",
          success: true,
          description: "Submit button",
        });
      });

      it("should throw if tab domain is in deny list", async () => {
        const configWithDenyList: ExtensionConfig = {
          secret: "test-secret",
          toolSettings: {
            "browser-click": true,
          },
          domainDenyList: ["evil.com"],
          ports: [8089],
          auditLog: [],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "click",
          selector: "a.link",
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 99,
          url: "https://evil.com",
        });

        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Domain in user defined deny list");
        expect(browser.scripting.executeScript).not.toHaveBeenCalled();
      });
    });

    describe("type command", () => {
      it("should type text in the active tab", async () => {
        const request: ServerMessageRequest = {
          cmd: "type",
          selector: "input[name='q']",
          text: "hello world",
          correlationId: "test-correlation-id",
        };

        const mockActiveTab = { id: 42, url: "https://example.com" };
        (browser.tabs.query as jest.Mock).mockResolvedValue([mockActiveTab]);
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockActiveTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: true } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.scripting.executeScript).toHaveBeenCalled();
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "type-result",
          correlationId: "test-correlation-id",
          success: true,
        });
      });

      it("should type text in a specific tab with clearFirst and submit", async () => {
        const request: ServerMessageRequest = {
          cmd: "type",
          selector: "#search",
          text: "test query",
          clearFirst: true,
          submit: true,
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 99, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: true } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.tabs.query).not.toHaveBeenCalled();
        expect(browser.scripting.executeScript).toHaveBeenCalled();
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "type-result",
          correlationId: "test-correlation-id",
          success: true,
        });
      });

      it("should throw if tab domain is in deny list", async () => {
        const configWithDenyList: ExtensionConfig = {
          secret: "test-secret",
          toolSettings: {
            "browser-type": true,
          },
          domainDenyList: ["evil.com"],
          ports: [8089],
          auditLog: [],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "type",
          selector: "input",
          text: "test",
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 99,
          url: "https://evil.com",
        });

        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Domain in user defined deny list");
        expect(browser.scripting.executeScript).not.toHaveBeenCalled();
      });
    });

    describe("screenshot command", () => {
      it("should take screenshot of active tab", async () => {
        const request: ServerMessageRequest = {
          cmd: "screenshot",
          correlationId: "test-correlation-id",
        };

        const mockActiveTab = { id: 42, url: "https://example.com", windowId: 1 };
        (browser.tabs.query as jest.Mock).mockResolvedValue([mockActiveTab]);
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockActiveTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.tabs.captureTab as jest.Mock).mockResolvedValue(
          "data:image/png;base64,iVBORw0KGgo="
        );

        await messageHandler.handleDecodedMessage(request);

        expect(browser.tabs.captureTab).toHaveBeenCalledWith(42, {
          format: "png",
        });
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "screenshot-result",
          correlationId: "test-correlation-id",
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          mimeType: "image/png",
        });
      });

      it("should take jpeg screenshot of specific tab", async () => {
        const request: ServerMessageRequest = {
          cmd: "screenshot",
          tabId: 99,
          format: "jpeg",
          quality: 80,
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 99, url: "https://example.com", windowId: 2 };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.tabs.captureTab as jest.Mock).mockResolvedValue(
          "data:image/jpeg;base64,/9j/4AAQ="
        );

        await messageHandler.handleDecodedMessage(request);

        expect(browser.tabs.query).not.toHaveBeenCalled();
        expect(browser.tabs.captureTab).toHaveBeenCalledWith(99, {
          format: "jpeg",
          quality: 80,
        });
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "screenshot-result",
          correlationId: "test-correlation-id",
          dataUrl: "data:image/jpeg;base64,/9j/4AAQ=",
          mimeType: "image/jpeg",
        });
      });

      it("should throw if tab domain is in deny list", async () => {
        const configWithDenyList: ExtensionConfig = {
          secret: "test-secret",
          toolSettings: {
            "browser-screenshot": true,
          },
          domainDenyList: ["evil.com"],
          ports: [8089],
          auditLog: [],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "screenshot",
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 99,
          url: "https://evil.com",
          windowId: 1,
        });

        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Domain in user defined deny list");
        expect(browser.tabs.captureTab).not.toHaveBeenCalled();
      });
    });

    describe("fill-form command", () => {
      it("should fill form fields in the active tab", async () => {
        const request: ServerMessageRequest = {
          cmd: "fill-form",
          fields: [
            { selector: "#name", value: "John" },
            { selector: "#agree", value: true },
          ],
          correlationId: "test-correlation-id",
        };

        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: { filled: 2, errors: [] } } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith(
          expect.objectContaining({
            resource: "fill-form-result",
            correlationId: "test-correlation-id",
            filled: 2,
            errors: [],
          })
        );
      });

      it("should fill form in a specific tab by tabId", async () => {
        const request: ServerMessageRequest = {
          cmd: "fill-form",
          fields: [{ selector: "#email", value: "test@example.com" }],
          tabId: 42,
          correlationId: "test-correlation-id",
        };

        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 42,
          url: "https://example.com",
        });
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: { filled: 1, errors: [] } } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.scripting.executeScript).toHaveBeenCalledWith(
          expect.objectContaining({
            target: { tabId: 42 },
          })
        );
      });

      it("should throw if tab domain is in deny list", async () => {
        const configWithDenyList = {
          secret: "test-secret",
          domainDenyList: ["evil.com"],
          ports: [8089],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "fill-form",
          fields: [{ selector: "#name", value: "test" }],
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 99,
          url: "https://evil.com",
        });

        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Domain in user defined deny list");
        expect(browser.scripting.executeScript).not.toHaveBeenCalled();
      });
    });

    describe("snapshot command", () => {
      it("should return interactive elements from the active tab", async () => {
        const request: ServerMessageRequest = {
          cmd: "snapshot",
          correlationId: "test-correlation-id",
        };

        const mockElements = [
          { selector: "#login-btn", role: "button", name: "Login", tag: "button" },
          { selector: "a.nav-link", role: "a", name: "Home", tag: "a", href: "https://example.com/" },
        ];

        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: mockElements } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith(
          expect.objectContaining({
            resource: "snapshot-result",
            correlationId: "test-correlation-id",
            elements: mockElements,
          })
        );
      });

      it("should snapshot a specific tab by tabId", async () => {
        const request: ServerMessageRequest = {
          cmd: "snapshot",
          tabId: 42,
          correlationId: "test-correlation-id",
        };

        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 42,
          url: "https://example.com",
        });
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: [] } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.scripting.executeScript).toHaveBeenCalledWith(
          expect.objectContaining({
            target: { tabId: 42 },
          })
        );
      });

      it("should throw if tab domain is in deny list", async () => {
        const configWithDenyList = {
          secret: "test-secret",
          domainDenyList: ["evil.com"],
          ports: [8089],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "snapshot",
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 99,
          url: "https://evil.com",
        });

        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Domain in user defined deny list");
        expect(browser.scripting.executeScript).not.toHaveBeenCalled();
      });
    });

    describe("wait-for command", () => {
      it("should wait for element in the active tab and return found", async () => {
        const request: ServerMessageRequest = {
          cmd: "wait-for",
          selector: "#dynamic-element",
          correlationId: "test-correlation-id",
        };

        const mockActiveTab = { id: 42, url: "https://example.com" };
        (browser.tabs.query as jest.Mock).mockResolvedValue([mockActiveTab]);
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockActiveTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: { found: true, elapsed_ms: 12 } } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.scripting.executeScript).toHaveBeenCalled();
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "wait-for-result",
          correlationId: "test-correlation-id",
          found: true,
          elapsed_ms: 12,
        });
      });

      it("should wait for element in a specific tab by tabId", async () => {
        const request: ServerMessageRequest = {
          cmd: "wait-for",
          selector: ".loaded",
          tabId: 99,
          timeoutMs: 10000,
          visible: true,
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 99, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: { found: true, elapsed_ms: 250 } } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.tabs.query).not.toHaveBeenCalled();
        expect(browser.scripting.executeScript).toHaveBeenCalledWith(
          expect.objectContaining({
            target: { tabId: 99 },
          })
        );
        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "wait-for-result",
          correlationId: "test-correlation-id",
          found: true,
          elapsed_ms: 250,
        });
      });

      it("should return found: false when element not found within timeout", async () => {
        const request: ServerMessageRequest = {
          cmd: "wait-for",
          selector: "#never-exists",
          tabId: 42,
          timeoutMs: 1000,
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 42, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: { found: false, elapsed_ms: 1000 } } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith({
          resource: "wait-for-result",
          correlationId: "test-correlation-id",
          found: false,
          elapsed_ms: 1000,
        });
      });

      it("should throw if tab domain is in deny list", async () => {
        const configWithDenyList = {
          secret: "test-secret",
          domainDenyList: ["evil.com"],
          ports: [8089],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "wait-for",
          selector: "#target",
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 99,
          url: "https://evil.com",
        });

        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Domain in user defined deny list");
        expect(browser.scripting.executeScript).not.toHaveBeenCalled();
      });
    });

    describe("get-network-requests command", () => {
      it("should return network requests from the active tab", async () => {
        const request: ServerMessageRequest = {
          cmd: "get-network-requests",
          correlationId: "test-correlation-id",
        };

        const mockRequests = [
          { method: "GET", url: "https://api.example.com/data", status: 200, duration_ms: 150, timestamp: 1234567890 },
          { method: "POST", url: "https://api.example.com/submit", status: 201, duration_ms: 300, timestamp: 1234567900 },
        ];

        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: mockRequests } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(mockClient.sendResourceToServer).toHaveBeenCalledWith(
          expect.objectContaining({
            resource: "network-requests-result",
            correlationId: "test-correlation-id",
            requests: mockRequests,
          })
        );
      });

      it("should filter requests by URL pattern in a specific tab", async () => {
        const request: ServerMessageRequest = {
          cmd: "get-network-requests",
          tabId: 42,
          filterUrl: "api\\.example\\.com",
          limit: 10,
          correlationId: "test-correlation-id",
        };

        const mockTab = { id: 42, url: "https://example.com" };
        (browser.tabs.get as jest.Mock).mockResolvedValue(mockTab);
        (browser.permissions.contains as jest.Mock).mockResolvedValue(true);
        (browser.scripting.executeScript as jest.Mock).mockResolvedValue([
          { result: { ok: true, value: [] } },
        ]);

        await messageHandler.handleDecodedMessage(request);

        expect(browser.tabs.query).not.toHaveBeenCalled();
        expect(browser.scripting.executeScript).toHaveBeenCalledWith(
          expect.objectContaining({
            target: { tabId: 42 },
          })
        );
      });

      it("should throw if tab domain is in deny list", async () => {
        const configWithDenyList = {
          secret: "test-secret",
          domainDenyList: ["evil.com"],
          ports: [8089],
        };
        (browser.storage.local.get as jest.Mock).mockResolvedValue({
          config: configWithDenyList,
        });

        const request: ServerMessageRequest = {
          cmd: "get-network-requests",
          tabId: 99,
          correlationId: "test-correlation-id",
        };

        (browser.tabs.get as jest.Mock).mockResolvedValue({
          id: 99,
          url: "https://evil.com",
        });

        await expect(
          messageHandler.handleDecodedMessage(request)
        ).rejects.toThrow("Domain in user defined deny list");
        expect(browser.scripting.executeScript).not.toHaveBeenCalled();
      });
    });
  });
});
