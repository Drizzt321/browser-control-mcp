export interface TabOwnershipManager {
  claimTab(sessionId: string, tabId: number): void;
  releaseTab(sessionId: string, tabId: number): void;
  releaseAllTabs(sessionId: string): void;
  getOwner(tabId: number): string | undefined;
  isAllowed(sessionId: string, tabId: number): boolean;
}

/**
 * v1 implementation: single session, always allows access.
 * v2 will swap in MultiSessionOwnership with first-touch enforcement.
 */
export class SingleSessionOwnership implements TabOwnershipManager {
  private ownership: Map<number, string> = new Map();

  claimTab(sessionId: string, tabId: number): void {
    this.ownership.set(tabId, sessionId);
  }

  releaseTab(_sessionId: string, tabId: number): void {
    this.ownership.delete(tabId);
  }

  releaseAllTabs(sessionId: string): void {
    for (const [tabId, owner] of this.ownership) {
      if (owner === sessionId) {
        this.ownership.delete(tabId);
      }
    }
  }

  getOwner(tabId: number): string | undefined {
    return this.ownership.get(tabId);
  }

  isAllowed(_sessionId: string, _tabId: number): boolean {
    return true;
  }
}
