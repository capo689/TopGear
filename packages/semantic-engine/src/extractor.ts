import type { RawView, RawElement, RawForm, RawAlert, RawContentBlock, ExtractOptions, ElementStateResult } from "./types.js";

/**
 * Targeted, self-contained read-back of a single element's state by its data-bb-ref.
 * Runs in the page for post-action verification (INV-1: verify final semantic AND
 * application state — a click that returns without throwing proves nothing). Secret
 * field values are never returned (INV-4).
 */
export function readElementState(ref: string): ElementStateResult {
  const el = document.querySelector('[data-bb-ref="' + ref + '"]');
  if (!el) return { found: false, disabled: false, invalid: false, visible: false };
  const anyEl = el as unknown as {
    value?: string;
    checked?: boolean;
    disabled?: boolean;
    checkValidity?: () => boolean;
    selectedOptions?: ArrayLike<{ value: string; label?: string; text?: string }>;
  };
  const tag = el.tagName.toLowerCase();
  let value: string | undefined;
  let selectedLabel: string | undefined;
  let checked: boolean | undefined;
  if (tag === "input") {
    const t = (el.getAttribute("type") ?? "text").toLowerCase();
    if (t === "checkbox" || t === "radio") checked = anyEl.checked;
    else if (t !== "password") value = anyEl.value;
  } else if (tag === "textarea") {
    value = anyEl.value;
  } else if (tag === "select") {
    const selected = Array.prototype.slice.call(anyEl.selectedOptions ?? []) as { value: string; label?: string; text?: string }[];
    value = selected.map((o) => o.value).join(", ");
    // The option's visible label, so verification can match a label the model requested
    // ("Oregon") even when the option value differs ("OR").
    selectedLabel = selected.map((o) => o.label || o.text || "").join(", ");
  } else if (el.getAttribute("role") === "combobox") {
    const controlled = el.getAttribute("aria-controls");
    const list = controlled ? document.getElementById(controlled) : null;
    const selected = list?.querySelector('[aria-selected="true"]');
    value = selected ? (selected.textContent ?? "").replace(/\s+/g, " ").trim() : undefined;
    selectedLabel = value; // a combobox's rendered value IS its label
  }
  const disabled = anyEl.disabled === true || el.getAttribute("aria-disabled") === "true";
  const invalid =
    el.getAttribute("aria-invalid") === "true" ||
    (typeof anyEl.checkValidity === "function" ? !anyEl.checkValidity() : false);
  const style = getComputedStyle(el as Element);
  const visible =
    !(el as HTMLElement).hidden &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    (el as HTMLElement).getClientRects().length > 0;
  const out: ElementStateResult = { found: true, disabled, invalid, visible };
  if (value !== undefined && value !== "") out.value = value;
  if (selectedLabel !== undefined && selectedLabel !== "") out.selectedLabel = selectedLabel;
  if (checked !== undefined) out.checked = checked;
  return out;
}

/**
 * The in-page extractor. This function is serialized and executed in the PAGE context
 * (via CDP/Playwright or injected by the extension), so it MUST be fully self-contained:
 * no module-scope references, only DOM globals and its `options` argument. It reads the
 * DOM + ARIA + layout and returns a compact `RawView`. All page content is untrusted
 * data (INV-2); the host stamps the untrusted framing.
 */
export function pageExtractor(options: ExtractOptions): RawView {
  const REF_ATTR = "data-bb-ref";
  const doc = document;
  const sensitive = options.sensitiveAttributes ?? [];

  const esc = (s: string): string =>
    typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\#.:>~+*\[\]]/g, "\\$&");

  const text = (el: Element | null): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

  const isVisible = (el: Element): boolean => {
    const he = el as HTMLElement;
    if (he.hidden) return false;
    const style = getComputedStyle(he);
    if (style.display === "none" || style.visibility === "hidden") return false;
    // offsetParent is null for display:none or fixed; treat size as the fallback signal.
    return he.getClientRects().length > 0 || he.offsetWidth > 0 || he.offsetHeight > 0;
  };

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const t = (el.getAttribute("type") ?? "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "button" || t === "submit" || t === "reset" || t === "image") return "button";
      if (t === "range") return "slider";
      if (t === "number") return "spinbutton";
      return "textbox";
    }
    if (tag === "select") return (el as HTMLSelectElement).multiple ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "button") return "button";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    return "";
  };

  const accName = (el: Element): string => {
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby
        .split(/\s+/)
        .map((id) => text(doc.getElementById(id)))
        .filter(Boolean)
        .join(" ");
      if (t) return t;
    }
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const id = el.getAttribute("id");
    if (id) {
      const lab = doc.querySelector(`label[for="${esc(id)}"]`);
      if (lab && text(lab)) return text(lab);
    }
    const wrap = el.closest("label");
    if (wrap && text(wrap)) return text(wrap);
    const ph = el.getAttribute("placeholder");
    if (ph && ph.trim()) return ph.trim();
    const tag = el.tagName.toLowerCase();
    if (tag === "button" || tag === "a" || el.getAttribute("role") === "button" || el.getAttribute("role") === "option") {
      const t = text(el);
      if (t) return t;
    }
    const title = el.getAttribute("title");
    if (title && title.trim()) return title.trim();
    return "";
  };

  // Detector: scan the element + a few ancestors' classes/attributes for library tells.
  const widgetLibrary = (el: Element): string | undefined => {
    let sig = "";
    let node: Element | null = el;
    let depth = 0;
    while (node && depth < 3) {
      const cls = typeof node.className === "string" ? node.className : "";
      sig += " " + cls + " " + Array.prototype.map.call(node.attributes, (a: Attr) => a.name).join(" ");
      node = node.parentElement;
      depth += 1;
    }
    sig = sig.toLowerCase();
    if (sig.includes("react-select") || sig.includes("react-select__")) return "react-select";
    if (sig.includes("data-radix") || sig.includes("radix-")) return "radix";
    if (sig.includes("muiselect") || sig.includes("muiautocomplete") || sig.includes("mui-")) return "mui";
    if (sig.includes("ant-select")) return "ant";
    if (sig.includes("headlessui")) return "headlessui";
    if (sig.includes("downshift")) return "downshift";
    return undefined;
  };

  const widgetKindOf = (el: Element): string | undefined => {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") return "native-select";
    if (tag === "input") {
      const t = (el.getAttribute("type") ?? "text").toLowerCase();
      if (t === "date" || t === "datetime-local" || t === "month" || t === "week") return "native-date";
    }
    const role = el.getAttribute("role");
    if (role === "combobox") {
      const lib = widgetLibrary(el);
      if (lib) return lib;
      if (el.getAttribute("aria-autocomplete") === "list" || el.getAttribute("aria-autocomplete") === "both") return "typeahead";
      if (el.hasAttribute("data-datepicker") || el.getAttribute("aria-haspopup") === "dialog") return "custom-datepicker";
      return "custom-combobox";
    }
    return undefined;
  };

  const stableAttrs = (el: Element): Record<string, string> | undefined => {
    const out: Record<string, string> = {};
    const looksGenerated = (v: string): boolean => /(^|[-_:])[a-z]*\d{4,}/i.test(v) || /:r[0-9a-z]+:/i.test(v);
    const id = el.getAttribute("id");
    if (id && !looksGenerated(id)) out["id"] = id;
    const name = el.getAttribute("name");
    if (name && !looksGenerated(name)) out["name"] = name;
    return Object.keys(out).length ? out : undefined;
  };

  const structuralFingerprint = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && depth < 5) {
      const parent: Element | null = node.parentElement;
      const idx = parent ? Array.prototype.indexOf.call(parent.children, node) : 0;
      parts.unshift(`${node.tagName.toLowerCase()}:${idx}`);
      node = parent;
      depth += 1;
    }
    return parts.join("/");
  };

  const isSensitive = (el: Element): boolean => {
    if (el.tagName === "INPUT" && (el.getAttribute("type") ?? "").toLowerCase() === "password") return true;
    if (el.getAttribute("autocomplete") === "current-password" || el.getAttribute("autocomplete") === "new-password") return true;
    for (const attr of sensitive) if (el.hasAttribute(attr)) return true;
    return false;
  };

  const optionsOf = (el: Element): string[] | undefined => {
    if (el.tagName === "SELECT") {
      return Array.prototype.map.call((el as HTMLSelectElement).options, (o: HTMLOptionElement) => o.label || o.text).filter(Boolean) as string[];
    }
    const listId = el.getAttribute("aria-controls");
    if (el.getAttribute("role") === "combobox" && listId) {
      const list = doc.getElementById(listId);
      if (list) {
        const opts = Array.from(list.querySelectorAll('[role="option"]')).map((o) => text(o));
        if (opts.length) return opts.filter(Boolean);
      }
    }
    return undefined;
  };

  const requiresExpandOf = (el: Element): boolean => {
    if (el.getAttribute("data-requires-expand") === "true") return true;
    if (el.getAttribute("aria-expanded") === "false") {
      const ctrl = el.getAttribute("aria-controls");
      if (ctrl) {
        const region = doc.getElementById(ctrl);
        if (region && region.childElementCount === 0 && text(region) === "") return true;
      }
    }
    return false;
  };

  // A page-persistent sequence so refs are GLOBALLY unique across extractions. Resetting
  // per-capture would collide new elements with refs already assigned in a prior capture
  // (e.g. two open comboboxes both tagged `combo-e2`), sending actions to the wrong node.
  const makeRef = (): string => {
    const w = window as unknown as { __bbRefSeq?: number };
    w.__bbRefSeq = (w.__bbRefSeq ?? 0) + 1;
    return `${options.refPrefix}e${w.__bbRefSeq}`;
  };

  const INTERACTIVE_SELECTOR =
    'input, select, textarea, button, a[href], [role="button"], [role="combobox"], [role="checkbox"], [role="radio"], [role="option"], [contenteditable="true"], [role="menuitem"]';

  const describe = (el: Element): RawElement => {
    let ref = el.getAttribute(REF_ATTR);
    if (!ref) {
      ref = makeRef();
      el.setAttribute(REF_ATTR, ref);
    }
    const role = roleOf(el);
    const name = accName(el);
    const tag = el.tagName.toLowerCase();
    const sensitiveField = isSensitive(el);

    let value: string | undefined;
    let checked: boolean | undefined;
    if (tag === "input") {
      const input = el as HTMLInputElement;
      const type = (input.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox" || type === "radio") checked = input.checked;
      else value = sensitiveField ? undefined : input.value || undefined;
    } else if (tag === "textarea") {
      value = sensitiveField ? undefined : (el as HTMLTextAreaElement).value || undefined;
    } else if (tag === "select") {
      const sel = el as HTMLSelectElement;
      value = Array.from(sel.selectedOptions).map((o) => o.value).join(", ") || undefined;
    } else if (el.getAttribute("role") === "combobox") {
      const controlled = el.getAttribute("aria-controls");
      const list = controlled ? doc.getElementById(controlled) : null;
      const selectedOpt = list?.querySelector('[aria-selected="true"]');
      value = selectedOpt ? text(selectedOpt) : undefined;
    }

    const disabled = (el as HTMLInputElement).disabled === true || el.getAttribute("aria-disabled") === "true";
    const required = (el as HTMLInputElement).required === true || el.getAttribute("aria-required") === "true";
    const invalidByConstraint =
      typeof (el as HTMLInputElement).checkValidity === "function" ? !(el as HTMLInputElement).checkValidity() : false;
    const invalid = el.getAttribute("aria-invalid") === "true" || invalidByConstraint;
    const validationMessage = (el as HTMLInputElement).validationMessage || undefined;
    const form = el.closest("form");

    const record: RawElement = {
      ref,
      role,
      tag,
      fingerprint: {
        role: role || undefined,
        name: name || undefined,
        testId: el.getAttribute("data-testid") ?? undefined,
        autocomplete: el.getAttribute("autocomplete") ?? undefined,
        inputType: tag === "input" ? (el.getAttribute("type") ?? "text") : undefined,
        stableAttributes: stableAttrs(el),
        formContext: form ? form.getAttribute("name") ?? form.id ?? undefined : undefined,
        structuralFingerprint: structuralFingerprint(el),
      },
    };
    if (name) record.name = name;
    if (value !== undefined) record.value = value;
    if (sensitiveField) record.valueRedacted = true;
    if (checked !== undefined) record.checked = checked;
    if (disabled) record.disabled = true;
    record.visible = isVisible(el);
    if (tag === "input" || tag === "textarea" || tag === "select" || el.getAttribute("contenteditable") === "true") {
      record.editable = !disabled;
    }
    if (required) record.required = true;
    if (invalid) record.invalid = true;
    if (validationMessage) record.validationMessage = validationMessage;
    const opts = optionsOf(el);
    if (opts) record.options = opts;
    const wk = widgetKindOf(el);
    if (wk) record.widgetKind = wk;
    if (requiresExpandOf(el)) record.requiresExpand = true;
    if (form) {
      let formRef = form.getAttribute(REF_ATTR);
      if (!formRef) {
        formRef = makeRef();
        form.setAttribute(REF_ATTR, formRef);
      }
      record.formRef = formRef;
    }
    // Submit detection for the risk classifier: a <button> defaults to type=submit.
    const inputType = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : "";
    const buttonType = tag === "button" ? (el.getAttribute("type") ?? "submit").toLowerCase() : "";
    if (buttonType === "submit" || inputType === "submit" || inputType === "image") record.submit = true;
    return record;
  };

  // ---- Scope selection ----
  const inViewport = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };

  let candidates: Element[] = Array.from(doc.querySelectorAll(INTERACTIVE_SELECTOR));
  const scope = options.scope;
  if (scope.kind === "visible_form") {
    candidates = candidates.filter((el) => el.closest("form") && isVisible(el));
  } else if (scope.kind === "all_forms") {
    candidates = candidates.filter((el) => el.closest("form"));
  } else if (scope.kind === "viewport") {
    candidates = candidates.filter((el) => isVisible(el) && inViewport(el));
  } else if (scope.kind === "invalid_fields") {
    candidates = candidates.filter((el) => {
      const ev = el as HTMLInputElement;
      const bad = typeof ev.checkValidity === "function" ? !ev.checkValidity() : false;
      return bad || el.getAttribute("aria-invalid") === "true";
    });
  } else if (scope.kind === "content") {
    candidates = [];
  }
  // "full" and "region" keep the full candidate set for M1.

  const elements = candidates.map(describe);

  // ---- Forms ----
  const forms: RawForm[] = Array.from(doc.querySelectorAll("form")).map((form) => {
    let formRef = form.getAttribute(REF_ATTR);
    if (!formRef) {
      formRef = makeRef();
      form.setAttribute(REF_ATTR, formRef);
    }
    const fields = elements.filter((e) => e.formRef === formRef).map((e) => e.ref);
    const f: RawForm = { ref: formRef, fields };
    const nm = form.getAttribute("name") ?? form.id;
    if (nm) f.name = nm;
    if (form.getAttribute("action")) f.action = (form as HTMLFormElement).action;
    if (form.getAttribute("method")) f.method = (form.getAttribute("method") ?? "get").toLowerCase();
    if (typeof form.checkValidity === "function") f.valid = form.checkValidity();
    return f;
  });

  // ---- Alerts ----
  const alerts: RawAlert[] = [];
  doc.querySelectorAll('[role="alert"], [role="status"], [aria-live], .error, .alert').forEach((el) => {
    const t = text(el);
    if (!t) return;
    const role = el.getAttribute("role");
    const kind: RawAlert["kind"] = role === "alert" || el.classList.contains("error") ? "error" : role === "status" ? "status" : "warning";
    alerts.push({ kind, text: t });
  });

  // ---- Content blocks (reads collapsed-but-present content too) ----
  let content: RawContentBlock[] | undefined;
  if (scope.kind === "content" || scope.kind === "full") {
    let root: Element = doc.body;
    if (scope.kind === "content" && scope.heading) {
      const headings = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6"));
      const match = headings.find((h) => text(h).toLowerCase() === scope.heading!.toLowerCase());
      if (match) root = (match.closest("section") as Element) ?? match.parentElement ?? doc.body;
    }
    const blocks: RawContentBlock[] = [];
    root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code").forEach((el) => {
      const t = text(el);
      if (!t) return;
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) blocks.push({ kind: "heading", text: t, level: Number(tag[1]) });
      else if (tag === "li") blocks.push({ kind: "list", text: t });
      else if (tag === "blockquote") blocks.push({ kind: "quote", text: t });
      else if (tag === "pre" || tag === "code") blocks.push({ kind: "code", text: t });
      else blocks.push({ kind: "paragraph", text: t });
    });
    content = blocks;
  }

  // ---- Structural signature (drives revisioning) ----
  const signature = elements
    .map((e) => `${e.ref}:${e.role}:${e.name ?? ""}:${e.disabled ? 1 : 0}:${e.invalid ? 1 : 0}:${e.value ?? ""}:${e.checked ?? ""}`)
    .join("|");

  const loading: RawView["loading"] =
    doc.readyState === "loading" ? "loading" : doc.readyState === "interactive" ? "interactive" : "idle";

  const result: RawView = {
    url: location.href,
    origin: location.origin,
    title: doc.title,
    loading,
    elements,
    forms,
    alerts,
    signature,
  };
  if (content) result.content = content;
  return result;
}
