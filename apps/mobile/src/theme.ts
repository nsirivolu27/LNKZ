// Native equivalents of apps/web/src/magentic-tokens.css. Keep both themes
// aligned with the vendored Magentic source; React Native cannot consume CSS.
export const palettes = {
  dark: {
    bg: "#0A0610", surface: "#130D1C", raised: "#1B1327", selected: "#251B35",
    line: "#2C2140", strong: "#3E2F58", text: "#F2EDF8", muted: "#B0A4C4",
    subtle: "#8B7DA3", accent: "#E84BA3", onAccent: "#12060E",
    lineage: "#A87BFF", live: "#34E0B0", stop: "#FF5C47",
  },
  light: {
    bg: "#FAF7FD", surface: "#FFFFFF", raised: "#F3EEFA", selected: "#EAE2F5",
    line: "#E4DCF0", strong: "#CFC2E4", text: "#140D1F", muted: "#4E4361",
    subtle: "#6B5F80", accent: "#B22273", onAccent: "#FFFFFF",
    lineage: "#6D34D6", live: "#0C8F70", stop: "#C23A28",
  },
};

export type Palette = typeof palettes.dark;
