// =============================================
//  BF6 Portal UI Preview Renderer
//  Renders UIContainer, UIText, UIButton, UITextButton
//  to HTML/CSS for quick prototyping without BF6
//  Coordinates are pixels on a 1920×1080 canvas
// =============================================

const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;
let _viewport = null;

// ---- Zoom & Debug ----
const DEBUG_STORAGE_KEY = "bf6-portal-ui-preview-debug";

let _zoom = 1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;
const ZOOM_STORAGE_KEY = "bf6-portal-ui-preview-zoom";
let _resolutionDisplay = null;

const storedZoom = localStorage.getItem(ZOOM_STORAGE_KEY);
if (storedZoom) {
  const z = parseFloat(storedZoom);
  if (!isNaN(z)) _zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

function setZoom(zoom) {
  _zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  localStorage.setItem(ZOOM_STORAGE_KEY, _zoom);
  if (_viewport) {
    _viewport.style.transform = `scale(${_zoom})`;
    _viewport.style.transformOrigin = "top left";
  }
  if (_resolutionDisplay) {
    const w = Math.round(VIEWPORT_W * _zoom);
    const h = Math.round(VIEWPORT_H * _zoom);
    _resolutionDisplay.textContent = `${w} × ${h} (${Math.round(_zoom * 100)}%)`;
  }
}

function zoomIn() {
  setZoom(_zoom + ZOOM_STEP);
}
function zoomOut() {
  setZoom(_zoom - ZOOM_STEP);
}
function zoomReset() {
  setZoom(1);
}

// ---- Viewport ----

const HEADER_H = 32;

export function initViewport(id = "viewport") {
  _viewport = document.getElementById(id);
  if (!_viewport) throw new Error(`Element #${id} not found`);
  const s = _viewport.style;
  s.width = VIEWPORT_W + "px";
  s.height = VIEWPORT_H + "px";
  s.position = "relative";
  s.overflow = "hidden";
  s.marginTop = HEADER_H + "px";
  s.marginLeft = "auto";
  s.marginRight = "auto";

  // Always get the info-bar's resolution-info span
  _resolutionDisplay = document.getElementById("resolution-info");
  setZoom(_zoom);

  // Restore debug outline state from localStorage
  const debugState = localStorage.getItem(DEBUG_STORAGE_KEY);
  if (debugState === "1") {
    _viewport.classList.add("debug");
  } else {
    _viewport.classList.remove("debug");
  }

  // Debug mode: press D to toggle element outlines
  window.addEventListener("keydown", (e) => {
    if (e.key === "d" || e.key === "D") {
      const isDebug = _viewport.classList.toggle("debug");
      localStorage.setItem(DEBUG_STORAGE_KEY, isDebug ? "1" : "0");
    }
    // Zoom controls
    if (e.key === "q" || e.key === "Q") {
      zoomOut();
    } else if (e.key === "e" || e.key === "E") {
      zoomIn();
    } else if (e.key === "r" || e.key === "R") {
      zoomReset();
    }
  });
}

export function setBackgroundImage(url) {
  if (!_viewport) return;
  _viewport.style.backgroundImage = `url('${encodeURI(url)}')`;
  _viewport.style.backgroundSize = "cover";
  _viewport.style.backgroundPosition = "center";
}

// ---- Vector (RGB color, components 0–1) ----

class Vector {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  toCSS(a = 1) {
    return `rgba(${Math.round(this.x * 255)},${Math.round(this.y * 255)},${Math.round(this.z * 255)},${a})`;
  }
}

// ---- Strings ----

let _strings = {};

export function setStrings(s) {
  _strings = s;
}

function _resolve(path) {
  let cur = _strings;
  for (const k of path.split(".")) {
    if (cur == null) return path;
    cur = cur[k];
  }
  return typeof cur === "string" ? cur : path;
}

// ---- mod namespace ----

function _makeProxy(p = "") {
  return new Proxy(Object.create(null), {
    get(_t, k) {
      if (k === "_path") return p;
      if (typeof k === "symbol") return undefined;
      return _makeProxy(p ? p + "." + String(k) : String(k));
    },
  });
}

export const mod = {
  UIAnchor: {
    TopLeft: "TopLeft",
    TopCenter: "TopCenter",
    TopRight: "TopRight",
    CenterLeft: "CenterLeft",
    Center: "Center",
    CenterRight: "CenterRight",
    BottomLeft: "BottomLeft",
    BottomCenter: "BottomCenter",
    BottomRight: "BottomRight",
  },
  UIBgFill: {
    None: "None",
    Solid: "Solid",
    Blur: "Blur",
    GradientTop: "GradientTop",
    GradientBottom: "GradientBottom",
    GradientLeft: "GradientLeft",
    GradientRight: "GradientRight",
    OutlineThin: "OutlineThin",
    OutlineThick: "OutlineThick",
  },
  UIDepth: {
    BelowGameUI: 0,
    AboveGameUI: 1,
  },
  UIImageType: {
    None: "None",
    CrownOutline: "CrownOutline",
    CrownSolid: "CrownSolid",
    QuestionMark: "QuestionMark",
    RifleAmmo: "RifleAmmo",
    SelfHeal: "SelfHeal",
    SpawnBeacon: "SpawnBeacon",
    TEMP_PortalIcon: "TEMP_PortalIcon",
  },
  stringkeys: _makeProxy(),
  Message(key, ...args) {
    let tpl;
    if (typeof key === "number") tpl = String(key);
    else if (typeof key === "string") tpl = key;
    else if (key && typeof key === "object" && key._path)
      tpl = _resolve(key._path);
    else tpl = String(key);
    let i = 0;
    return tpl.replace(/\{\}/g, () =>
      i < args.length ? String(args[i++]) : "{}",
    );
  },
  CreateVector: (x, y, z) => new Vector(x, y, z),
  IsPlayerValid: () => true,
  Equals: (a, b) => a === b,
};

// ---- UI namespace ----

export const UI = {
  COLORS: {
    BLACK: new Vector(0, 0, 0),
    GREY_25: new Vector(0.25, 0.25, 0.25),
    GREY_50: new Vector(0.5, 0.5, 0.5),
    GREY_75: new Vector(0.75, 0.75, 0.75),
    WHITE: new Vector(1, 1, 1),
    RED: new Vector(1, 0, 0),
    GREEN: new Vector(0, 1, 0),
    BLUE: new Vector(0, 0, 1),
    YELLOW: new Vector(1, 1, 0),
    PURPLE: new Vector(0.5, 0, 0.5),
    CYAN: new Vector(0, 1, 1),
    MAGENTA: new Vector(1, 0, 1),
    BF_GREY_1: new Vector(0.8353, 0.9216, 0.9765),
    BF_GREY_2: new Vector(0.3294, 0.3686, 0.3882),
    BF_GREY_3: new Vector(0.2118, 0.2235, 0.2353),
    BF_GREY_4: new Vector(0.0314, 0.0431, 0.0431),
    BF_BLUE_BRIGHT: new Vector(0.4392, 0.9216, 1.0),
    BF_BLUE_DARK: new Vector(0.0745, 0.1843, 0.2471),
    BF_RED_BRIGHT: new Vector(1.0, 0.5137, 0.3804),
    BF_RED_DARK: new Vector(0.251, 0.0941, 0.0667),
    BF_GREEN_BRIGHT: new Vector(0.6784, 0.9922, 0.5255),
    BF_GREEN_DARK: new Vector(0.2784, 0.4471, 0.2118),
    BF_YELLOW_BRIGHT: new Vector(1.0, 0.9882, 0.6118),
    BF_YELLOW_DARK: new Vector(0.4431, 0.3765, 0.0),
  },
};

// ---- DOM helpers ----

/**
 * Apply anchor-based positioning to an element.
 *
 * The anchor determines which reference point on the PARENT to measure from
 * and which point of the CHILD is placed there.
 *
 *   - x positive = rightward
 *   - y positive = downward
 */
function _applyAnchor(el, anchor, x, y) {
  const a = anchor || "TopLeft";

  // Horizontal
  if (a.includes("Left")) {
    el.style.left = x + "px";
  } else if (a.includes("Right")) {
    el.style.right = x + "px";
  } else {
    el.style.left = `calc(50% + ${x}px)`;
  }

  // Vertical
  if (a.includes("Top")) {
    el.style.top = y + "px";
  } else if (a.includes("Bottom")) {
    el.style.bottom = y + "px";
  } else {
    el.style.top = `calc(50% + ${y}px)`;
  }

  // Self-centering transform
  const tx = [];
  if (!a.includes("Left") && !a.includes("Right")) tx.push("translateX(-50%)");
  if (!a.includes("Top") && !a.includes("Bottom")) tx.push("translateY(-50%)");
  if (tx.length) el.style.transform = tx.join(" ");
}

/** Apply background fill mode. */
function _applyBgFill(el, fill, color, alpha) {
  if (!fill || fill === "None") return;
  const c = color || new Vector(0, 0, 0);
  const a = alpha ?? 1;
  switch (fill) {
    case "Solid":
      el.style.backgroundColor = c.toCSS(a);
      break;
    case "Blur":
      el.style.backgroundColor = c.toCSS(a * 0.25);
      el.style.backdropFilter = "blur(4px) brightness(0.35)";
      el.style.webkitBackdropFilter = "blur(4px) brightness(0.35)";
      break;
    case "GradientTop":
      el.style.background = `linear-gradient(to bottom, ${c.toCSS(a)}, ${c.toCSS(0)})`;
      break;
    case "GradientBottom":
      el.style.background = `linear-gradient(to top, ${c.toCSS(a)}, ${c.toCSS(0)})`;
      break;
    case "GradientLeft":
      el.style.background = `linear-gradient(to right, ${c.toCSS(a)}, ${c.toCSS(0)})`;
      break;
    case "GradientRight":
      el.style.background = `linear-gradient(to left, ${c.toCSS(a)}, ${c.toCSS(0)})`;
      break;
    case "OutlineThin":
      el.style.border = `1px solid ${c.toCSS(a)}`;
      break;
    case "OutlineThick":
      el.style.border = `3px solid ${c.toCSS(a)}`;
      break;
  }
}

/** Extract common position / size values from params. */
function _geom(params) {
  return {
    x: params.x ?? params.position?.x ?? 0,
    y: params.y ?? params.position?.y ?? 0,
    w: params.width ?? params.size?.width ?? 0,
    h: params.height ?? params.size?.height ?? 0,
  };
}

/** Shared base styling for every element. */
function _baseStyle(el, params) {
  const { x, y, w, h } = _geom(params);
  const s = el.style;
  s.position = "absolute";
  s.width = w + "px";
  s.height = h + "px";
  s.boxSizing = "border-box";
  s.zIndex = params.depth === 1 /* AboveGameUI */ ? "10" : "1";
  _applyAnchor(el, params.anchor, x, y);
  _applyBgFill(el, params.bgFill, params.bgColor, params.bgAlpha);
  if (params.visible === false) s.display = "none";
  return { x, y, w, h };
}

/** Attach element to parent or viewport. */
function _attach(el, parent) {
  const target = parent?.element ?? _viewport;
  if (target) target.appendChild(el);
}

// ---- Component classes ----

export class UIContainer {
  constructor(params) {
    this.element = document.createElement("div");
    this.element.className = "bf6-container";
    this.children = [];
    const g = _baseStyle(this.element, params);
    this.element.title = `UIContainer ${g.w}×${g.h}`;
    _attach(this.element, params.parent);
  }
  delete() {
    this.element.remove();
  }
  show() {
    this.element.style.display = "";
  }
  hide() {
    this.element.style.display = "none";
  }
}

export class UIText {
  constructor(params) {
    this.element = document.createElement("div");
    this.element.className = "bf6-text";
    const g = _baseStyle(this.element, params);
    const s = this.element.style;
    s.overflow = "visible";
    s.display = "flex";
    s.alignItems = "center";
    s.justifyContent = "center";
    s.textAlign = "center";
    s.fontFamily = "'BF Text', 'Segoe UI', 'Arial Narrow', sans-serif";
    // TEXT_SIZE_PATCH: UIText honoured textSize like UITextButton already did.
    if (params.textSize) s.fontSize = params.textSize + "px";
    s.letterSpacing = "0.5px";
    s.lineHeight = "1";
    s.whiteSpace = "nowrap";

    // textAnchor overrides text alignment within the box
    if (params.textAnchor) {
      const ta = params.textAnchor;
      if (ta.includes("Left")) s.justifyContent = "flex-start";
      else if (ta.includes("Right")) s.justifyContent = "flex-end";
      if (ta.includes("Top")) s.alignItems = "flex-start";
      else if (ta.includes("Bottom")) s.alignItems = "flex-end";
    }

    // Opt-in wrapping. The Portal's real UIText wraps inside its width; this
    // renderer defaults to nowrap, so long body copy (item descriptions)
    // needs this to be reviewable. Off by default so every existing call site
    // keeps byte-identical behaviour.
    if (params.wrap) {
      s.whiteSpace = "normal";
      s.lineHeight = String(params.lineHeight ?? 1.3);
      s.display = "block";
      s.padding = (params.padding ?? 4) + "px";
      if (params.textAnchor) {
        const ta = params.textAnchor;
        s.textAlign = ta.includes("Right")
          ? "right"
          : ta.includes("Center")
            ? "center"
            : "left";
      }
    }

    if (params.padding) s.padding = params.padding + "px";

    const msg =
      typeof params.message === "function" ? params.message() : params.message;
    this.element.textContent = msg ?? "";
    if (params.textSize) s.fontSize = params.textSize * 0.9 + "px";
    if (params.textColor)
      s.color = params.textColor.toCSS(params.textAlpha ?? 1);

    this.element.title = `UIText ${g.w}×${g.h} "${this.element.textContent}"`;
    _attach(this.element, params.parent);
  }
  delete() {
    this.element.remove();
  }
  show() {
    this.element.style.display = "flex";
  }
  hide() {
    this.element.style.display = "none";
  }
  setMessage(msg) {
    this.element.textContent = typeof msg === "function" ? msg() : msg;
    return this;
  }
}

export class UIButton {
  constructor(params) {
    this.element = document.createElement("div");
    this.element.className = "bf6-button";
    const g = _baseStyle(this.element, params);
    this.element.style.cursor = "pointer";

    const baseColor = params.baseColor || params.bgColor;
    const baseAlpha = params.baseAlpha ?? params.bgAlpha ?? 1;
    if (baseColor && !params.bgFill) {
      this.element.style.backgroundColor = baseColor.toCSS(baseAlpha);
    }
    if (params.enabled === false) this.element.style.opacity = "0.5";

    this.element.title = `UIButton ${g.w}×${g.h}`;
    _attach(this.element, params.parent);
  }
  delete() {
    this.element.remove();
  }
  show() {
    this.element.style.display = "";
  }
  hide() {
    this.element.style.display = "none";
  }
}

export class UITextButton {
  constructor(params) {
    this.element = document.createElement("div");
    this.element.className = "bf6-text-button";
    const g = _baseStyle(this.element, params);
    const s = this.element.style;
    s.cursor = "pointer";
    s.display = "flex";
    s.alignItems = "center";
    s.justifyContent = "center";
    s.textAlign = "center";
    s.fontFamily = "'BF Text', 'Segoe UI', 'Arial Narrow', sans-serif";
    s.fontWeight = "700";
    // TEXT_ANCHOR_PATCH
    if (params.textAnchor) {
      const ta = params.textAnchor;
      if (ta.includes("Left")) s.justifyContent = "flex-start";
      else if (ta.includes("Right")) s.justifyContent = "flex-end";
      if (ta.includes("Top")) s.alignItems = "flex-start";
      else if (ta.includes("Bottom")) s.alignItems = "flex-end";
    }
    s.letterSpacing = "-0.5px";
    s.lineHeight = "1";

    const baseColor = params.baseColor || params.bgColor;
    const baseAlpha = params.baseAlpha ?? params.bgAlpha ?? 1;
    if (baseColor && !params.bgFill) {
      s.backgroundColor = baseColor.toCSS(baseAlpha);
    }

    const msg =
      typeof params.message === "function" ? params.message() : params.message;
    this.element.textContent = msg ?? "";
    if (params.textSize) s.fontSize = params.textSize * 0.9 + "px";
    if (params.textColor)
      s.color = params.textColor.toCSS(params.textAlpha ?? 1);
    if (params.enabled === false) s.opacity = "0.5";

    this.element.title = `UITextButton ${g.w}×${g.h} "${this.element.textContent}"`;
    _attach(this.element, params.parent);
  }
  delete() {
    this.element.remove();
  }
  show() {
    this.element.style.display = "flex";
  }
  hide() {
    this.element.style.display = "none";
  }
}

export class UIImage {
  constructor(params) {
    this.element = document.createElement("div");
    this.element.className = "bf6-image";
    const g = _baseStyle(this.element, params);
    const s = this.element.style;
    s.display = "flex";
    s.alignItems = "center";
    s.justifyContent = "center";
    s.fontSize = Math.min(g.w, g.h) * 0.5 + "px";

    if (params.imageColor)
      s.color = params.imageColor.toCSS(params.imageAlpha ?? 1);
    this.element.textContent = params.imageType || "?";

    this.element.title = `UIImage ${g.w}×${g.h} [${params.imageType}]`;
    _attach(this.element, params.parent);
  }
  delete() {
    this.element.remove();
  }
}

// ---- SolidUI mock (static preview, no reactivity) ----

export const SolidUI = {
  h(component, props = {}) {
    // Resolve reactive props: call accessor functions to get static values
    const resolved = {};
    for (const [k, v] of Object.entries(props)) {
      if (k === "parent" || k === "receiver") {
        resolved[k] = v;
      } else if (typeof v === "function" && !/^on[A-Z]/.test(k)) {
        try {
          resolved[k] = v();
        } catch {
          resolved[k] = v;
        }
      } else {
        resolved[k] = v;
      }
    }
    if (typeof component === "function") {
      return new component(resolved);
    }
    return null;
  },

  createSignal(val) {
    let v = val;
    return [
      () => v,
      (nv) => {
        v = typeof nv === "function" ? nv(v) : nv;
      },
    ];
  },

  createEffect(fn) {
    fn();
    return () => {};
  },

  createMemo(fn) {
    return fn;
  },

  createStore(init) {
    return [init, (fn) => fn(init)];
  },

  createRoot(fn) {
    return fn(() => {});
  },

  createContext(def) {
    return { id: Symbol(), defaultValue: def, provide: (_v, fn) => fn() };
  },

  useContext(ctx) {
    return ctx.defaultValue;
  },

  untrack(fn) {
    return fn();
  },

  onCleanup() {},

  Index(each, render) {
    const arr = typeof each === "function" ? each() : each;
    if (Array.isArray(arr)) {
      arr.forEach((item, i) => render(() => item, i));
    }
  },
};

export { Vector };
