export interface ServerMessageBase {
  cmd: string;
}

export interface OpenTabServerMessage extends ServerMessageBase {
  cmd: "open-tab";
  url: string;
}

export interface CloseTabsServerMessage extends ServerMessageBase {
  cmd: "close-tabs";
  tabIds: number[];
}

export interface GetTabListServerMessage extends ServerMessageBase {
  cmd: "get-tab-list";
}

export interface GetBrowserRecentHistoryServerMessage extends ServerMessageBase {
  cmd: "get-browser-recent-history";
  searchQuery?: string;
}

export interface GetTabContentServerMessage extends ServerMessageBase {
  cmd: "get-tab-content";
  tabId: number;
  offset?: number;
}

export interface ReorderTabsServerMessage extends ServerMessageBase {
  cmd: "reorder-tabs";
  tabOrder: number[];
}

export interface FindHighlightServerMessage extends ServerMessageBase {
  cmd: "find-highlight";
  tabId: number;
  queryPhrase: string;
}

export interface GroupTabsServerMessage extends ServerMessageBase {
  cmd: "group-tabs";
  tabIds: number[];
  isCollapsed: boolean;
  groupColor: string;
  groupTitle: string;
}

export interface NavigateServerMessage extends ServerMessageBase {
  cmd: "navigate";
  url: string;
  tabId?: number;
  waitUntil?: "load" | "domcontentloaded";
}

export interface EvaluateServerMessage extends ServerMessageBase {
  cmd: "evaluate";
  script: string;
  tabId?: number;
}

export interface ClickServerMessage extends ServerMessageBase {
  cmd: "click";
  selector: string;
  description?: string;
  tabId?: number;
}

export interface TypeServerMessage extends ServerMessageBase {
  cmd: "type";
  selector: string;
  text: string;
  clearFirst?: boolean;
  submit?: boolean;
  tabId?: number;
}

export interface ScreenshotServerMessage extends ServerMessageBase {
  cmd: "screenshot";
  tabId?: number;
  format?: "png" | "jpeg";
  quality?: number;
}

export interface FillFormField {
  selector: string;
  value: string | boolean;
}

export interface FillFormServerMessage extends ServerMessageBase {
  cmd: "fill-form";
  fields: FillFormField[];
  submit?: boolean;
  tabId?: number;
}

export interface SnapshotServerMessage extends ServerMessageBase {
  cmd: "snapshot";
  tabId?: number;
  maxElements?: number;
  includeNonInteractive?: boolean;
}

export interface WaitForServerMessage extends ServerMessageBase {
  cmd: "wait-for";
  selector: string;
  tabId?: number;
  timeoutMs?: number;
  visible?: boolean;
}

export interface GetNetworkRequestsServerMessage extends ServerMessageBase {
  cmd: "get-network-requests";
  tabId?: number;
  filterUrl?: string;
  sinceMs?: number;
  limit?: number;
}

export type ServerMessage =
  | OpenTabServerMessage
  | CloseTabsServerMessage
  | GetTabListServerMessage
  | GetBrowserRecentHistoryServerMessage
  | GetTabContentServerMessage
  | ReorderTabsServerMessage
  | FindHighlightServerMessage
  | GroupTabsServerMessage
  | NavigateServerMessage
  | EvaluateServerMessage
  | ClickServerMessage
  | TypeServerMessage
  | ScreenshotServerMessage
  | FillFormServerMessage
  | SnapshotServerMessage
  | WaitForServerMessage
  | GetNetworkRequestsServerMessage;

export type ServerMessageRequest = ServerMessage & { correlationId: string };
