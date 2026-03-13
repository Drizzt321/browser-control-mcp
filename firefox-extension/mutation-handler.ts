/**
 * Mutation handler — runs injected scripts in page context via browser.scripting API.
 * Uses world:"MAIN" for full DOM/JS access (Firefox 128+ MV2 backport).
 *
 * All interaction tools (evaluate, click, type, fill_form, snapshot) delegate here.
 */

interface ScriptResponse<T = unknown> {
  ok?: boolean;
  value?: T;
  error?: string;
}

/**
 * Core injection primitive. Serializes a function + args, injects into page context,
 * returns typed result. Adapted from YetiBrowser MCP (MIT).
 */
export async function runInPage<A extends unknown[], R>(
  tabId: number,
  func: (...args: A) => ScriptResponse<R> | Promise<ScriptResponse<R>>,
  args: A
): Promise<R | undefined> {
  // Cast required: @types/firefox-webext-browser types are too restrictive for
  // browser.scripting.executeScript — they don't support func return values,
  // typed args, or world:"MAIN" (all supported in Firefox 128+ MV2).
  const [execution] = await browser.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: "MAIN",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const response = execution?.result as ScriptResponse<R> | undefined;
  if (!response) {
    throw new Error("Injected script did not return a result");
  }
  if ("error" in response && response.error) {
    throw new Error(response.error);
  }
  return response.value;
}

/**
 * Evaluate arbitrary JavaScript in page context.
 * The script is wrapped as a function expression and invoked.
 * Results must be structuredClone-able to cross the execution boundary.
 */
export async function evaluateInPage(
  tabId: number,
  script: string
): Promise<string> {
  const result = await runInPage(
    tabId,
    (source: string) => {
      try {
        // Wrap in async IIFE to support both sync and async expressions
        const fn = new Function(`return (async () => { ${source} })()`) as () => Promise<unknown>;
        return fn().then((value) => {
          // Ensure result is serializable
          try {
            const serialized = JSON.stringify(value);
            return { ok: true, value: serialized ?? "undefined" };
          } catch {
            return { ok: true, value: String(value) };
          }
        }).catch((err: Error) => {
          return { error: err.message ?? String(err) };
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
    [script]
  );

  return result ?? "undefined";
}
