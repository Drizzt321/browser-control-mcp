export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  tool: string;
  selector?: string;
  domain?: string;
  payload?: string;
}

const AUDIT_ENABLED = process.env.AUDIT_LOG === "true";

/**
 * Logs mutation operations to stderr as structured JSON.
 * Read-only tools are not logged.
 * Controlled by AUDIT_LOG=true environment variable.
 */
export function logMutation(entry: AuditEntry): void {
  if (!AUDIT_ENABLED) return;
  console.error(JSON.stringify(entry));
}
