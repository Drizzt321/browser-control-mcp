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

/**
 * Fill multiple form fields at once.
 * Handles text inputs, textareas, selects, checkboxes, and radio buttons.
 * Returns count of filled fields plus any errors for fields that failed.
 */
export async function fillForm(
  tabId: number,
  fields: Array<{ selector: string; value: string | boolean }>,
  submit: boolean
): Promise<{ filled: number; errors: string[] }> {
  const result = await runInPage(
    tabId,
    (fieldList: Array<{ selector: string; value: string | boolean }>, doSubmit: boolean) => {
      try {
        let filled = 0;
        const errors: string[] = [];
        let lastForm: HTMLFormElement | null = null;

        for (const field of fieldList) {
          try {
            const el = document.querySelector(field.selector);
            if (!el) {
              errors.push(`Element not found: ${field.selector}`);
              continue;
            }

            const target = el as HTMLElement;
            target.scrollIntoView({ block: "center", behavior: "instant" });
            target.focus();

            if (target instanceof HTMLSelectElement) {
              target.value = String(field.value);
              target.dispatchEvent(new Event("change", { bubbles: true }));
            } else if (target instanceof HTMLInputElement) {
              const inputType = target.type.toLowerCase();
              if (inputType === "checkbox") {
                const desired = Boolean(field.value);
                if (target.checked !== desired) {
                  target.checked = desired;
                  target.dispatchEvent(new Event("input", { bubbles: true }));
                  target.dispatchEvent(new Event("change", { bubbles: true }));
                }
              } else if (inputType === "radio") {
                target.checked = true;
                target.dispatchEvent(new Event("input", { bubbles: true }));
                target.dispatchEvent(new Event("change", { bubbles: true }));
              } else {
                // text, email, password, number, tel, url, search, etc.
                target.value = String(field.value);
                target.dispatchEvent(new Event("input", { bubbles: true }));
                target.dispatchEvent(new Event("change", { bubbles: true }));
              }
            } else if (target instanceof HTMLTextAreaElement) {
              target.value = String(field.value);
              target.dispatchEvent(new Event("input", { bubbles: true }));
              target.dispatchEvent(new Event("change", { bubbles: true }));
            } else if (target.isContentEditable) {
              target.textContent = String(field.value);
              target.dispatchEvent(new Event("input", { bubbles: true }));
              target.dispatchEvent(new Event("change", { bubbles: true }));
            } else {
              errors.push(`Element "${field.selector}" is not a form field`);
              continue;
            }

            const form = target.closest("form");
            if (form) lastForm = form;
            filled++;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            errors.push(`${field.selector}: ${message}`);
          }
        }

        if (doSubmit && lastForm) {
          lastForm.requestSubmit();
        } else if (doSubmit) {
          errors.push("No form found to submit");
        }

        return { ok: true, value: { filled, errors } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
    [fields, submit]
  );

  return result ?? { filled: 0, errors: ["fillForm returned no result"] };
}

export interface WaitForResult {
  found: boolean;
  elapsed_ms: number;
}

/**
 * Wait for an element matching a CSS selector to appear in the DOM.
 * Uses MutationObserver + polling fallback inside the page context.
 * Resolves when element is found or timeout is reached.
 */
export async function waitForElement(
  tabId: number,
  selector: string,
  timeoutMs: number,
  visible: boolean
): Promise<WaitForResult> {
  const result = await runInPage(
    tabId,
    (sel: string, timeout: number, checkVisible: boolean) => {
      return new Promise<{ ok: boolean; value: { found: boolean; elapsed_ms: number } }>((resolve) => {
        const startTime = Date.now();

        function isMatch(): boolean {
          const el = document.querySelector(sel);
          if (!el) return false;
          if (!checkVisible) return true;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const htmlEl = el as HTMLElement;
          return htmlEl.offsetWidth > 0 || htmlEl.offsetHeight > 0;
        }

        // Check immediately
        if (isMatch()) {
          resolve({ ok: true, value: { found: true, elapsed_ms: Date.now() - startTime } });
          return;
        }

        let resolved = false;
        const done = (found: boolean) => {
          if (resolved) return;
          resolved = true;
          observer.disconnect();
          clearInterval(pollId);
          clearTimeout(timeoutId);
          resolve({ ok: true, value: { found, elapsed_ms: Date.now() - startTime } });
        };

        // MutationObserver for DOM changes
        const observer = new MutationObserver(() => {
          if (isMatch()) done(true);
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: checkVisible,
        });

        // Polling fallback (50ms) for cases MutationObserver might miss
        const pollId = setInterval(() => {
          if (isMatch()) done(true);
        }, 50);

        // Timeout
        const timeoutId = setTimeout(() => {
          done(false);
        }, timeout);
      });
    },
    [selector, timeoutMs, visible]
  );

  return result ?? { found: false, elapsed_ms: timeoutMs };
}

export interface SnapshotElementResult {
  selector: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  href?: string;
}

/**
 * Get an inventory of interactive elements on the page with computed CSS selectors.
 * Helps agents discover what's clickable/fillable without guessing selectors.
 */
export async function getSnapshot(
  tabId: number,
  maxElements: number,
  includeNonInteractive: boolean
): Promise<SnapshotElementResult[]> {
  const result = await runInPage(
    tabId,
    (max: number, includeNonInt: boolean) => {
      try {
        // Selectors for interactive elements
        const interactiveSelector = "a[href], button, input, textarea, select, [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"menuitem\"], [tabindex]";
        // Additional selectors for non-interactive elements
        const nonInteractiveSelector = "h1, h2, h3, h4, h5, h6, img[alt], [role=\"heading\"]";

        const selector = includeNonInt
          ? `${interactiveSelector}, ${nonInteractiveSelector}`
          : interactiveSelector;

        const allElements = document.querySelectorAll(selector);
        const elements: Array<{
          selector: string;
          role: string;
          name: string;
          tag: string;
          type?: string;
          href?: string;
        }> = [];

        function computeSelector(el: Element): string {
          // Prefer ID
          if (el.id) {
            return `#${CSS.escape(el.id)}`;
          }

          // Try unique class combination
          if (el.classList.length > 0) {
            const classSelector = `${el.tagName.toLowerCase()}.${Array.from(el.classList).map(c => CSS.escape(c)).join(".")}`;
            if (document.querySelectorAll(classSelector).length === 1) {
              return classSelector;
            }
          }

          // Fall back to nth-of-type path
          const parts: string[] = [];
          let current: Element | null = el;
          while (current && current !== document.body && parts.length < 4) {
            const parent: Element | null = current.parentElement;
            if (!parent) break;
            const currentTag = current.tagName;
            const siblings = Array.from(parent.children).filter(
              (c: Element) => c.tagName === currentTag
            );
            const tag = current.tagName.toLowerCase();
            if (siblings.length === 1) {
              parts.unshift(tag);
            } else {
              const index = siblings.indexOf(current) + 1;
              parts.unshift(`${tag}:nth-of-type(${index})`);
            }
            current = parent;
          }
          return parts.join(" > ");
        }

        function getAccessibleName(el: Element): string {
          // aria-label takes priority
          const ariaLabel = el.getAttribute("aria-label");
          if (ariaLabel) return ariaLabel;

          // aria-labelledby
          const labelledBy = el.getAttribute("aria-labelledby");
          if (labelledBy) {
            const labelEl = document.getElementById(labelledBy);
            if (labelEl) return labelEl.textContent?.trim() ?? "";
          }

          // For inputs, check associated label
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
            if (el.id) {
              const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
              if (label) return label.textContent?.trim() ?? "";
            }
            if ((el as HTMLInputElement | HTMLTextAreaElement).placeholder) {
              return (el as HTMLInputElement | HTMLTextAreaElement).placeholder;
            }
          }

          // For images, use alt text
          if (el instanceof HTMLImageElement) {
            return el.alt || "";
          }

          // For links/buttons, use text content
          const text = el.textContent?.trim() ?? "";
          return text.length > 80 ? text.substring(0, 80) + "..." : text;
        }

        for (const el of allElements) {
          if (elements.length >= max) break;

          // Skip hidden elements
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;

          const htmlEl = el as HTMLElement;
          if (htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0) continue;

          const tag = el.tagName.toLowerCase();
          const entry: typeof elements[0] = {
            selector: computeSelector(el),
            role: el.getAttribute("role") || tag,
            name: getAccessibleName(el),
            tag,
          };

          if (el instanceof HTMLInputElement) {
            entry.type = el.type;
          }
          if (el instanceof HTMLAnchorElement && el.href) {
            entry.href = el.href;
          }

          elements.push(entry);
        }

        return { ok: true, value: elements };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
    [maxElements, includeNonInteractive]
  );

  return result ?? [];
}
