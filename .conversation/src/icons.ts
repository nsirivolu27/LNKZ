/**
 * A tiny inline icon set. LNKZ shipped with an icon package before, which meant
 * a runtime dependency and a bundler plugin for what amounts to twenty paths.
 * These are drawn with the same 24px stroke grid so they stay visually uniform.
 */
const PATHS: Record<string, string> = {
  link: '<path d="M9 15 15 9"/><path d="M11 6.5 13 4.5a4.5 4.5 0 0 1 6.4 6.4l-2 2"/><path d="M13 17.5 11 19.5a4.5 4.5 0 0 1-6.4-6.4l2-2"/>',
  arrow: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
  spark: '<path d="M12 3.5 13.8 9 19 10.8 13.8 12.6 12 18l-1.8-5.4L5 10.8 10.2 9Z"/><path d="M18.5 4v3"/><path d="M17 5.5h3"/>',
  shield: '<path d="M12 3.5 5.5 6v5.2c0 4 2.7 7.3 6.5 9.3 3.8-2 6.5-5.3 6.5-9.3V6Z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  network: '<circle cx="12" cy="5" r="2.2"/><circle cx="5.5" cy="18" r="2.2"/><circle cx="18.5" cy="18" r="2.2"/><path d="M12 7.2v4.3"/><path d="M12 11.5 6.6 16"/><path d="m12 11.5 5.4 4.5"/>',
  flow: '<rect x="3.5" y="4" width="7" height="6" rx="1.6"/><rect x="13.5" y="14" width="7" height="6" rx="1.6"/><path d="M7 10v4a3 3 0 0 0 3 3h3.5"/>',
  message: '<path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V6.5A2.5 2.5 0 0 1 7.5 4h10A2.5 2.5 0 0 1 20 6.5Z"/>',
  braces: '<path d="M8.5 4c-2 0-2.5 1-2.5 2.7v2c0 1.5-.7 2.3-2 2.3v2c1.3 0 2 .8 2 2.3v2C6 19 6.5 20 8.5 20"/><path d="M15.5 4c2 0 2.5 1 2.5 2.7v2c0 1.5.7 2.3 2 2.3v2c-1.3 0-2 .8-2 2.3v2c0 1.7-.5 2.7-2.5 2.7"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m15.5 15.5 4 4"/>',
  cloud: '<path d="M7.5 18a4 4 0 0 1-.4-8A5.2 5.2 0 0 1 17 10.6 3.7 3.7 0 0 1 16.7 18Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20"/><path d="M17 12v3"/><path d="M20 12v2.5"/>',
  users: '<circle cx="9.5" cy="8.5" r="3"/><path d="M4 19.5a5.5 5.5 0 0 1 11 0"/><path d="M16 6a3 3 0 0 1 0 5.6"/><path d="M17.5 14.5a5 5 0 0 1 2.8 4.6"/>',
  bot: '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 4.5V8"/><circle cx="9.5" cy="13" r="1.1"/><circle cx="14.5" cy="13" r="1.1"/>',
  slack: '<rect x="4" y="10" width="6" height="3" rx="1.5"/><rect x="11" y="4" width="3" height="6" rx="1.5"/><rect x="14" y="11" width="6" height="3" rx="1.5"/><rect x="10" y="14" width="3" height="6" rx="1.5"/>',
  ticket: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2 2 0 0 0 0 3.9v2a1.5 1.5 0 0 1-1.5 1.6h-13A1.5 1.5 0 0 1 4 16.4v-2a2 2 0 0 0 0-3.9Z"/><path d="m9.5 12.4 1.8 1.8 3.4-3.6"/>',
  figma: '<circle cx="14" cy="12" r="2.6"/><path d="M11.4 4h2.4a2.6 2.6 0 0 1 0 5.2h-2.4Z"/><path d="M11.4 9.2h-.8a2.6 2.6 0 0 1 0-5.2h.8Z"/><path d="M11.4 14.6h-.8a2.6 2.6 0 1 0 .8 5.2Z"/><path d="M11.4 9.2h-.8a2.6 2.6 0 0 0 0 5.2h.8Z"/>',
  file: '<path d="M13.5 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V8Z"/><path d="M13.5 3.5V8H18"/><path d="M9 13h6"/><path d="M9 16.5h4"/>',
  zap: '<path d="M13.5 3 6 13h5l-.5 8L18 11h-5Z"/>',
  github: '<path d="M15.5 20.5v-2.9c0-1-.3-1.7-.9-2.2 2.9-.3 5.4-1.4 5.4-5.6a4.4 4.4 0 0 0-1.2-3 4 4 0 0 0-.1-3s-1-.3-3.2 1.2a11 11 0 0 0-5.7 0C7.6 3.5 6.6 3.8 6.6 3.8a4 4 0 0 0-.1 3 4.4 4.4 0 0 0-1.2 3c0 4.2 2.5 5.3 5.4 5.6-.4.4-.7.9-.8 1.6-1.8.8-3.2-.4-4-1.5"/>',
  inbox: '<path d="M4 13h4l1.4 2.5h5.2L16 13h4"/><path d="M6.2 5h11.6l2.2 8v4.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5V13Z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 1.8"/>',
  alert: '<path d="M12 4.5 20 19H4Z"/><path d="M12 10v4"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 18): string {
  const path = PATHS[name] ?? PATHS.link;
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export const iconNames = Object.keys(PATHS);
