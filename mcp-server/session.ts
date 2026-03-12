export interface Session {
  id: string;
  createdAt: Date;
  lastActivity: Date;
  state: "active" | "expired";
}

export interface SessionManager {
  createSession(sessionId?: string): Session;
  validateSession(sessionId: string): boolean;
  expireSession(sessionId: string): void;
  getActiveSession(): Session | null;
  touchSession(sessionId: string): void;
}

/**
 * v1 implementation: single static session, always valid.
 * v2 will swap in HmacSessionManager with temp-file auth and real timeout tracking.
 */
export class StaticSessionManager implements SessionManager {
  private session: Session;

  constructor() {
    this.session = {
      id: "static-v1",
      createdAt: new Date(),
      lastActivity: new Date(),
      state: "active",
    };
  }

  createSession(_sessionId?: string): Session {
    return this.session;
  }

  validateSession(_sessionId: string): boolean {
    return true;
  }

  expireSession(_sessionId: string): void {
    // No-op in v1
  }

  getActiveSession(): Session {
    return this.session;
  }

  touchSession(_sessionId: string): void {
    // No-op in v1
  }
}
