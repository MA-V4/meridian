import type {
  AccentTheme, AnimationSpeedTheme, BorderRadiusTheme,
  CardStyleTheme, DensityTheme, SidebarWidthTheme,
  TextureTheme, ThemeSettings, TypographyTheme,
} from "./types";

// ── ACCENT PALETTES ───────────────────────────────────────────
export const ACCENT_THEMES: Record<AccentTheme, {
  label: string;
  preview: string;
  light: boolean; // true = light mode (inverted surfaces)
  vars: Record<string, string>;
}> = {
  "blood-noir": {
    label: "Blood Noir", preview: "#c41230", light: false,
    vars: {
      "--accent": "#c41230", "--accent-dim": "rgba(196,18,48,0.12)",
      "--accent-b": "rgba(196,18,48,0.32)", "--accent2": "#22d3ee",
      "--bg": "#080808", "--bg1": "#0d0b0b", "--bg2": "#111010",
      "--bg3": "#161414", "--bg4": "#1c1a1a",
      "--text": "#f0ece4", "--text2": "rgba(240,236,228,0.58)",
      "--text3": "rgba(240,236,228,0.30)", "--text4": "rgba(240,236,228,0.16)",
      "--rule": "rgba(240,236,228,0.06)", "--rule2": "rgba(240,236,228,0.10)",
      "--rule3": "rgba(240,236,228,0.18)",
    },
  },

  "pure-light": {
    label: "Pure Light", preview: "#ffffff", light: true,
    vars: {
      "--accent": "#e02020", "--accent-dim": "rgba(224,32,32,0.08)",
      "--accent-b": "rgba(224,32,32,0.25)", "--accent2": "#0284c7",
      "--bg": "#f8f8f8", "--bg1": "#ffffff", "--bg2": "#f2f2f2",
      "--bg3": "#ebebeb", "--bg4": "#e0e0e0",
      "--text": "#111111", "--text2": "rgba(17,17,17,0.65)",
      "--text3": "rgba(17,17,17,0.40)", "--text4": "rgba(17,17,17,0.22)",
      "--rule": "rgba(17,17,17,0.07)", "--rule2": "rgba(17,17,17,0.11)",
      "--rule3": "rgba(17,17,17,0.20)",
    },
  },

  "parchment": {
    label: "Parchment", preview: "#c8a96e", light: true,
    vars: {
      "--accent": "#8b5e2a", "--accent-dim": "rgba(139,94,42,0.10)",
      "--accent-b": "rgba(139,94,42,0.28)", "--accent2": "#2d6a4f",
      "--bg": "#faf6ee", "--bg1": "#fdf9f2", "--bg2": "#f4ede0",
      "--bg3": "#ede3d1", "--bg4": "#e4d7be",
      "--text": "#2c1f0e", "--text2": "rgba(44,31,14,0.65)",
      "--text3": "rgba(44,31,14,0.42)", "--text4": "rgba(44,31,14,0.24)",
      "--rule": "rgba(44,31,14,0.07)", "--rule2": "rgba(44,31,14,0.12)",
      "--rule3": "rgba(44,31,14,0.22)",
    },
  },

  "ocean": {
    label: "Deep Ocean", preview: "#0ea5e9", light: false,
    vars: {
      "--accent": "#0ea5e9", "--accent-dim": "rgba(14,165,233,0.12)",
      "--accent-b": "rgba(14,165,233,0.35)", "--accent2": "#f97316",
      "--bg": "#070c14", "--bg1": "#0b1120", "--bg2": "#0f172a",
      "--bg3": "#131e34", "--bg4": "#1a2744",
      "--text": "#e8f4fd", "--text2": "rgba(232,244,253,0.58)",
      "--text3": "rgba(232,244,253,0.30)", "--text4": "rgba(232,244,253,0.15)",
      "--rule": "rgba(232,244,253,0.06)", "--rule2": "rgba(232,244,253,0.10)",
      "--rule3": "rgba(232,244,253,0.18)",
    },
  },

  "forest": {
    label: "Forest", preview: "#22c55e", light: false,
    vars: {
      "--accent": "#22c55e", "--accent-dim": "rgba(34,197,94,0.12)",
      "--accent-b": "rgba(34,197,94,0.32)", "--accent2": "#f59e0b",
      "--bg": "#050c07", "--bg1": "#091209", "--bg2": "#0d180d",
      "--bg3": "#111f11", "--bg4": "#162716",
      "--text": "#e8f5e9", "--text2": "rgba(232,245,233,0.58)",
      "--text3": "rgba(232,245,233,0.30)", "--text4": "rgba(232,245,233,0.15)",
      "--rule": "rgba(232,245,233,0.06)", "--rule2": "rgba(232,245,233,0.10)",
      "--rule3": "rgba(232,245,233,0.18)",
    },
  },

  "ember": {
    label: "Ember", preview: "#f97316", light: false,
    vars: {
      "--accent": "#f97316", "--accent-dim": "rgba(249,115,22,0.12)",
      "--accent-b": "rgba(249,115,22,0.32)", "--accent2": "#a78bfa",
      "--bg": "#0d0806", "--bg1": "#140c08", "--bg2": "#1a100a",
      "--bg3": "#20140d", "--bg4": "#281a11",
      "--text": "#fef3e8", "--text2": "rgba(254,243,232,0.58)",
      "--text3": "rgba(254,243,232,0.30)", "--text4": "rgba(254,243,232,0.15)",
      "--rule": "rgba(254,243,232,0.06)", "--rule2": "rgba(254,243,232,0.10)",
      "--rule3": "rgba(254,243,232,0.18)",
    },
  },

  "violet": {
    label: "Violet", preview: "#8b5cf6", light: false,
    vars: {
      "--accent": "#8b5cf6", "--accent-dim": "rgba(139,92,246,0.12)",
      "--accent-b": "rgba(139,92,246,0.32)", "--accent2": "#34d399",
      "--bg": "#07060f", "--bg1": "#0d0b18", "--bg2": "#110f22",
      "--bg3": "#16132c", "--bg4": "#1c1938",
      "--text": "#ede8ff", "--text2": "rgba(237,232,255,0.58)",
      "--text3": "rgba(237,232,255,0.30)", "--text4": "rgba(237,232,255,0.15)",
      "--rule": "rgba(237,232,255,0.06)", "--rule2": "rgba(237,232,255,0.10)",
      "--rule3": "rgba(237,232,255,0.18)",
    },
  },

  "slate": {
    label: "Slate", preview: "#64748b", light: false,
    vars: {
      "--accent": "#94a3b8", "--accent-dim": "rgba(148,163,184,0.12)",
      "--accent-b": "rgba(148,163,184,0.32)", "--accent2": "#f472b6",
      "--bg": "#060708", "--bg1": "#0c0e10", "--bg2": "#111418",
      "--bg3": "#161b20", "--bg4": "#1c2228",
      "--text": "#e8edf2", "--text2": "rgba(232,237,242,0.58)",
      "--text3": "rgba(232,237,242,0.30)", "--text4": "rgba(232,237,242,0.15)",
      "--rule": "rgba(232,237,242,0.06)", "--rule2": "rgba(232,237,242,0.10)",
      "--rule3": "rgba(232,237,242,0.18)",
    },
  },

  "midnight-gold": {
    label: "Midnight Gold", preview: "#d4a843", light: false,
    vars: {
      "--accent": "#d4a843", "--accent-dim": "rgba(212,168,67,0.12)",
      "--accent-b": "rgba(212,168,67,0.30)", "--accent2": "#e879f9",
      "--bg": "#09080a", "--bg1": "#0f0d10", "--bg2": "#141118",
      "--bg3": "#1a1620", "--bg4": "#221c2a",
      "--text": "#fdf6e3", "--text2": "rgba(253,246,227,0.58)",
      "--text3": "rgba(253,246,227,0.30)", "--text4": "rgba(253,246,227,0.15)",
      "--rule": "rgba(253,246,227,0.06)", "--rule2": "rgba(253,246,227,0.10)",
      "--rule3": "rgba(253,246,227,0.18)",
    },
  },

  "neon-tokyo": {
    label: "Neon Tokyo", preview: "#00ff9f", light: false,
    vars: {
      "--accent": "#00ff9f", "--accent-dim": "rgba(0,255,159,0.10)",
      "--accent-b": "rgba(0,255,159,0.28)", "--accent2": "#ff2d78",
      "--bg": "#05050a", "--bg1": "#08080f", "--bg2": "#0c0c16",
      "--bg3": "#10101e", "--bg4": "#161628",
      "--text": "#e0ffe8", "--text2": "rgba(224,255,232,0.58)",
      "--text3": "rgba(224,255,232,0.30)", "--text4": "rgba(224,255,232,0.15)",
      "--rule": "rgba(224,255,232,0.06)", "--rule2": "rgba(224,255,232,0.10)",
      "--rule3": "rgba(224,255,232,0.18)",
    },
  },
};

// ── TYPOGRAPHY ────────────────────────────────────────────────
export const TYPOGRAPHY_THEMES: Record<TypographyTheme, {
  label: string;
  desc: string;
  googleFont?: string;
  vars: Record<string, string>;
}> = {
  "serif-editorial": {
    label: "Serif Editorial",
    desc: "DM Serif Display headlines, Inter body",
    vars: {
      "--font-display": "'DM Serif Display', Georgia, serif",
      "--font-body": "'Inter', system-ui, sans-serif",
      "--font-mono": "'DM Mono', ui-monospace, monospace",
      "--font-script": "'Dancing Script', cursive",
      "--display-weight": "400",
      "--display-tracking": "-0.04em",
      "--body-size": "13px",
      "--body-line-height": "1.6",
    },
  },
  "clean-sans": {
    label: "Clean Sans",
    desc: "Inter everywhere - crisp and modern",
    vars: {
      "--font-display": "'Inter', system-ui, sans-serif",
      "--font-body": "'Inter', system-ui, sans-serif",
      "--font-mono": "'DM Mono', ui-monospace, monospace",
      "--font-script": "'Dancing Script', cursive",
      "--display-weight": "600",
      "--display-tracking": "-0.02em",
      "--body-size": "13px",
      "--body-line-height": "1.55",
    },
  },
  "brutalist-mono": {
    label: "Brutalist Mono",
    desc: "DM Mono everywhere - terminal aesthetic",
    vars: {
      "--font-display": "'DM Mono', ui-monospace, monospace",
      "--font-body": "'DM Mono', ui-monospace, monospace",
      "--font-mono": "'DM Mono', ui-monospace, monospace",
      "--font-script": "'DM Mono', ui-monospace, monospace",
      "--display-weight": "500",
      "--display-tracking": "0.02em",
      "--body-size": "12px",
      "--body-line-height": "1.5",
    },
  },
  "renaissance": {
    label: "Renaissance",
    desc: "Playfair Display - elegant and literary",
    googleFont: "Playfair+Display:ital,wght@0,400;0,700;1,400",
    vars: {
      "--font-display": "'Playfair Display', 'DM Serif Display', Georgia, serif",
      "--font-body": "'Inter', system-ui, sans-serif",
      "--font-mono": "'DM Mono', ui-monospace, monospace",
      "--font-script": "'Dancing Script', cursive",
      "--display-weight": "400",
      "--display-tracking": "-0.02em",
      "--body-size": "13.5px",
      "--body-line-height": "1.7",
    },
  },
  "system-native": {
    label: "System Native",
    desc: "Uses your OS default fonts - zero flash",
    vars: {
      "--font-display": "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      "--font-body": "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      "--font-mono": "ui-monospace, 'SF Mono', 'Cascadia Code', 'Consolas', monospace",
      "--font-script": "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      "--display-weight": "700",
      "--display-tracking": "-0.03em",
      "--body-size": "13px",
      "--body-line-height": "1.55",
    },
  },
  "slab-serif": {
    label: "Slab Serif",
    desc: "Roboto Slab - strong, structured, readable",
    googleFont: "Roboto+Slab:wght@300;400;700",
    vars: {
      "--font-display": "'Roboto Slab', 'DM Serif Display', Georgia, serif",
      "--font-body": "'Inter', system-ui, sans-serif",
      "--font-mono": "'DM Mono', ui-monospace, monospace",
      "--font-script": "'Dancing Script', cursive",
      "--display-weight": "700",
      "--display-tracking": "-0.01em",
      "--body-size": "13px",
      "--body-line-height": "1.6",
    },
  },
};

// ── DENSITY ───────────────────────────────────────────────────
export const DENSITY_THEMES: Record<DensityTheme, {
  label: string;
  desc: string;
  vars: Record<string, string>;
}> = {
  "spacious": {
    label: "Spacious", desc: "Generous breathing room",
    vars: {
      "--pad-section": "28px", "--pad-card": "16px",
      "--pad-sb": "14px 10px", "--gap-cards": "10px",
      "--row-height": "52px", "--task-pad": "9px 10px",
    },
  },
  "compact": {
    label: "Compact", desc: "More content, less space",
    vars: {
      "--pad-section": "18px", "--pad-card": "11px",
      "--pad-sb": "10px 8px", "--gap-cards": "6px",
      "--row-height": "44px", "--task-pad": "6px 8px",
    },
  },
  "ultra-dense": {
    label: "Ultra Dense", desc: "Terminal-level density",
    vars: {
      "--pad-section": "12px", "--pad-card": "8px",
      "--pad-sb": "6px 6px", "--gap-cards": "4px",
      "--row-height": "38px", "--task-pad": "4px 6px",
    },
  },
};

// ── TEXTURE ───────────────────────────────────────────────────
export const TEXTURE_THEMES: Record<TextureTheme, {
  label: string;
  desc: string;
  bodyClass: string;
}> = {
  "flat":  { label: "Flat",  desc: "Clean solid surfaces",       bodyClass: "tex-flat"  },
  "glass": { label: "Glass", desc: "Frosted translucent panels", bodyClass: "tex-glass" },
  "paper": { label: "Paper", desc: "Subtle paper grain",         bodyClass: "tex-paper" },
  "noise": { label: "Noise", desc: "Fine noise overlay",         bodyClass: "tex-noise" },
};

// ── BORDER RADIUS ─────────────────────────────────────────────
export const BORDER_RADIUS_THEMES: Record<BorderRadiusTheme, {
  label: string;
  desc: string;
  vars: Record<string, string>;
}> = {
  "sharp":   { label: "Sharp",   desc: "No rounding - architectural",  vars: { "--r": "0px",   "--r-lg": "2px",  "--r-xl": "4px"  } },
  "rounded": { label: "Rounded", desc: "Subtle corners - balanced",     vars: { "--r": "4px",   "--r-lg": "8px",  "--r-xl": "14px" } },
  "pill":    { label: "Pill",    desc: "Fully rounded - friendly",      vars: { "--r": "8px",   "--r-lg": "16px", "--r-xl": "999px" } },
};

// ── ANIMATION SPEED ───────────────────────────────────────────
export const ANIMATION_SPEED_THEMES: Record<AnimationSpeedTheme, {
  label: string;
  desc: string;
  vars: Record<string, string>;
}> = {
  "snappy":    { label: "Snappy",    desc: "Instant, no-nonsense",      vars: { "--dur-fast": "60ms",  "--dur-base": "100ms", "--dur-slow": "180ms", "--ease": "ease-out" } },
  "normal":    { label: "Normal",    desc: "Balanced transitions",      vars: { "--dur-fast": "120ms", "--dur-base": "200ms", "--dur-slow": "350ms", "--ease": "cubic-bezier(0.23,1,0.32,1)" } },
  "cinematic": { label: "Cinematic", desc: "Slow, expressive motion",   vars: { "--dur-fast": "200ms", "--dur-base": "380ms", "--dur-slow": "600ms", "--ease": "cubic-bezier(0.16,1,0.3,1)" } },
};

// ── SIDEBAR WIDTH ─────────────────────────────────────────────
export const SIDEBAR_WIDTH_THEMES: Record<SidebarWidthTheme, {
  label: string;
  desc: string;
  vars: Record<string, string>;
}> = {
  "narrow":  { label: "Narrow",  desc: "More space for content",  vars: { "--sidebar-w": "180px" } },
  "default": { label: "Default", desc: "Balanced layout",         vars: { "--sidebar-w": "218px" } },
  "wide":    { label: "Wide",    desc: "More room for project names", vars: { "--sidebar-w": "260px" } },
};

// ── CARD STYLE ────────────────────────────────────────────────
export const CARD_STYLE_THEMES: Record<CardStyleTheme, {
  label: string;
  desc: string;
  bodyClass: string;
}> = {
  "minimal":  { label: "Minimal",  desc: "Flat, subtle borders",        bodyClass: "card-minimal"  },
  "bordered": { label: "Bordered", desc: "Clear defined borders",        bodyClass: "card-bordered" },
  "elevated": { label: "Elevated", desc: "Drop shadows, lifted feel",    bodyClass: "card-elevated" },
};

// ── DEFAULTS ──────────────────────────────────────────────────
export const DEFAULT_THEME: ThemeSettings = {
  accent:         "blood-noir",
  typography:     "serif-editorial",
  density:        "spacious",
  texture:        "flat",
  borderRadius:   "sharp",
  animationSpeed: "normal",
  sidebarWidth:   "default",
  cardStyle:      "minimal",
};

// ── LOAD GOOGLE FONTS DYNAMICALLY ────────────────────────────
const loadedFonts = new Set<string>();
function loadGoogleFont(fontQuery: string): void {
  if (loadedFonts.has(fontQuery)) return;
  loadedFonts.add(fontQuery);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${fontQuery}&display=swap`;
  document.head.appendChild(link);
}

// ── APPLY THEME TO DOM ────────────────────────────────────────
export function applyTheme(theme: ThemeSettings): void {
  const root = document.documentElement;

  const accent = ACCENT_THEMES[theme.accent];
  Object.entries(accent.vars).forEach(([k, v]) => root.style.setProperty(k, v));

  // Light mode flag on body
  document.body.classList.toggle("theme-light", accent.light);

  const typo = TYPOGRAPHY_THEMES[theme.typography];
  if (typo.googleFont) loadGoogleFont(typo.googleFont);
  Object.entries(typo.vars).forEach(([k, v]) => root.style.setProperty(k, v));

  const density = DENSITY_THEMES[theme.density];
  Object.entries(density.vars).forEach(([k, v]) => root.style.setProperty(k, v));

  const br = BORDER_RADIUS_THEMES[theme.borderRadius ?? "sharp"];
  Object.entries(br.vars).forEach(([k, v]) => root.style.setProperty(k, v));

  const anim = ANIMATION_SPEED_THEMES[theme.animationSpeed ?? "normal"];
  Object.entries(anim.vars).forEach(([k, v]) => root.style.setProperty(k, v));

  const sw = SIDEBAR_WIDTH_THEMES[theme.sidebarWidth ?? "default"];
  Object.entries(sw.vars).forEach(([k, v]) => root.style.setProperty(k, v));

  // Texture
  document.body.classList.remove("tex-flat", "tex-glass", "tex-paper", "tex-noise");
  document.body.classList.add(TEXTURE_THEMES[theme.texture].bodyClass);

  // Card style
  document.body.classList.remove("card-minimal", "card-bordered", "card-elevated");
  document.body.classList.add(CARD_STYLE_THEMES[theme.cardStyle ?? "minimal"].bodyClass);
}