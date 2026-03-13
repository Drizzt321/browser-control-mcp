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

/**
 * Click an element identified by CSS selector.
 * Uses synthetic event dispatch (focus → mousedown → mouseup → click) for
 * framework compatibility (React, Vue, etc. rely on the full event sequence).
 */
export async function clickElement(
  tabId: number,
  selector: string
): Promise<boolean> {
  const result = await runInPage(
    tabId,
    (sel: string) => {
      try {
        const el = document.querySelector(sel);
        if (!el) {
          return { error: `Element not found: ${sel}` };
        }

        const target = el as HTMLElement;

        // Scroll into view if needed
        target.scrollIntoView({ block: "center", behavior: "instant" });

        // Synthetic event sequence for framework compatibility
        target.focus();
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

        return { ok: true, value: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
    [selector]
  );

  return result ?? false;
}

/**
 * Type text into an element identified by CSS selector.
 * Supports input/textarea (via value assignment) and contentEditable (via textContent).
 * Dispatches input and change events for framework compatibility.
 */
export async function typeInElement(
  tabId: number,
  selector: string,
  text: string,
  clearFirst: boolean,
  submit: boolean
): Promise<boolean> {
  const result = await runInPage(
    tabId,
    (sel: string, txt: string, clear: boolean, doSubmit: boolean) => {
      try {
        const el = document.querySelector(sel);
        if (!el) {
          return { error: `Element not found: ${sel}` };
        }

        const target = el as HTMLElement;
        target.focus();

        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          if (clear) {
            target.value = "";
          }
          target.value += txt;
        } else if (target.isContentEditable) {
          if (clear) {
            target.textContent = "";
          }
          target.textContent = (target.textContent ?? "") + txt;
        } else {
          return { error: `Element "${sel}" is not an input, textarea, or contentEditable element` };
        }

        // Dispatch events for framework compatibility
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));

        if (doSubmit) {
          const form = target.closest("form");
          if (form) {
            form.requestSubmit();
          } else {
            // Simulate Enter keypress for non-form inputs
            target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
            target.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
          }
        }

        return { ok: true, value: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
    [selector, text, clearFirst, submit]
  );

  return result ?? false;
}
