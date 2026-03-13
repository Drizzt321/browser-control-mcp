export interface ExtensionMessageBase {
  resource: string;
  correlationId: string;
}

export interface TabContentExtensionMessage extends ExtensionMessageBase {
  resource: "tab-content";
  tabId: number;
  fullText: string;
  isTruncated: boolean;
  totalLength: number;
  links: { url: string; text: string }[];
}

export interface BrowserTab {
  id?: number;
  url?: string;
  title?: string;
  lastAccessed?: number;
}

export interface TabsExtensionMessage extends ExtensionMessageBase {
  resource: "tabs";
  tabs: BrowserTab[];
}

export interface OpenedTabIdExtensionMessage extends ExtensionMessageBase {
  resource: "opened-tab-id";
  tabId: number | undefined;
}

export interface BrowserHistoryItem {
  url?: string;
  title?: string;
  lastVisitTime?: number;
}

export interface BrowserHistoryExtensionMessage extends ExtensionMessageBase {
  resource: "history";

  historyItems: BrowserHistoryItem[];
}

export interface ReorderedTabsExtensionMessage extends ExtensionMessageBase {
  resource: "tabs-reordered";
  tabOrder: number[];
}

export interface FindHighlightExtensionMessage extends ExtensionMessageBase {
  resource: "find-highlight-result";
  noOfResults: number;
}

export interface TabsClosedExtensionMessage extends ExtensionMessageBase {
  resource: "tabs-closed";
}

export interface TabGroupCreatedExtensionMessage extends ExtensionMessageBase {
  resource: "new-tab-group";
  groupId: number;
}

export interface NavigateResultExtensionMessage extends ExtensionMessageBase {
  resource: "navigate-result";
  url: string;
  title: string;
}

export interface EvaluateResultExtensionMessage extends ExtensionMessageBase {
  resource: "evaluate-result";
  result: string;
}

export interface ClickResultExtensionMessage extends ExtensionMessageBase {
  resource: "click-result";
  success: boolean;
  description?: string;
}

export interface TypeResultExtensionMessage extends ExtensionMessageBase {
  resource: "type-result";
  success: boolean;
}

export interface ScreenshotResultExtensionMessage extends ExtensionMessageBase {
  resource: "screenshot-result";
  dataUrl: string;
  mimeType: string;
}

export interface FillFormResultExtensionMessage extends ExtensionMessageBase {
  resource: "fill-form-result";
  filled: number;
  errors: string[];
}

export interface SnapshotElement {
  selector: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  href?: string;
}

export interface SnapshotResultExtensionMessage extends ExtensionMessageBase {
  resource: "snapshot-result";
  elements: SnapshotElement[];
}

export type ExtensionMessage =
  | TabContentExtensionMessage
  | TabsExtensionMessage
  | OpenedTabIdExtensionMessage
  | BrowserHistoryExtensionMessage
  | ReorderedTabsExtensionMessage
  | FindHighlightExtensionMessage
  | TabsClosedExtensionMessage
  | TabGroupCreatedExtensionMessage
  | NavigateResultExtensionMessage
  | EvaluateResultExtensionMessage
  | ClickResultExtensionMessage
  | TypeResultExtensionMessage
  | ScreenshotResultExtensionMessage
  | FillFormResultExtensionMessage
  | SnapshotResultExtensionMessage;

export interface ExtensionError {
  correlationId: string;
  errorMessage: string;
}