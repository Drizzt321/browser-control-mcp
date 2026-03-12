export class BrowserControlError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ElementNotFoundError extends BrowserControlError {
  constructor(selector: string) {
    super("element_not_found", `Element not found: ${selector}`);
  }
}

export class ClickInterceptedError extends BrowserControlError {
  constructor(selector: string, reason?: string) {
    super(
      "click_intercepted",
      `Click intercepted on ${selector}${reason ? `: ${reason}` : ""}`
    );
  }
}

export class MutationBlockedError extends BrowserControlError {
  constructor(tool: string, reason: string) {
    super("mutation_blocked", `Mutation blocked for ${tool}: ${reason}`);
  }
}

export class SessionExpiredError extends BrowserControlError {
  constructor(sessionId: string) {
    super("session_expired", `Session expired: ${sessionId}`);
  }
}

export class TabOwnedByOtherSessionError extends BrowserControlError {
  constructor(tabId: number, ownerSessionId: string) {
    super(
      "tab_owned_by_other_session",
      `Tab ${tabId} is owned by session ${ownerSessionId}`
    );
  }
}

export class ConsentNotGrantedError extends BrowserControlError {
  constructor() {
    super("consent_not_granted", "User has not granted agent control consent");
  }
}

export class DelayExceededError extends BrowserControlError {
  constructor(paramName: string, value: number, max: number) {
    super(
      "delay_exceeded",
      `${paramName} value ${value}ms exceeds maximum of ${max}ms`
    );
  }
}
