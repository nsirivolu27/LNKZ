const PATHS: Record<string, string> = {
  link: '<path d="M9 15 15 9"/><path d="M11 6.5 13 4.5a4.5 4.5 0 0 1 6.4 6.4l-2 2"/><path d="M13 17.5 11 19.5a4.5 4.5 0 0 1-6.4-6.4l2-2"/>',
  arrow: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
  spark: '<path d="M12 3.5 13.8 9 19 10.8 13.8 12.6 12 18l-1.8-5.4L5 10.8 10.2 9Z"/><path d="M18.5 4v3"/><path d="M17 5.5h3"/>',
  shield: '<path d="M12 3.5 5.5 6v5.2c0 4 2.7 7.3 6.5 9.3 3.8-2 6.5-5.3 6.5-9.3V6Z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  network: '<circle cx="12" cy="5" r="2.2"/><circle cx="5.5" cy="18" r="2.2"/><circle cx="18.5" cy="18" r="2.2"/><path d="M12 7.2v4.3"/><path d="M12 11.5 6.6 16"/><path d="m12 11.5 5.4 4.5"/>',
  message: '<path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V6.5A2.5 2.5 0 0 1 7.5 4h10A2.5 2.5 0 0 1 20 6.5Z"/>',
  braces: '<path d="M8.5 4c-2 0-2.5 1-2.5 2.7v2c0 1.5-.7 2.3-2 2.3v2c1.3 0 2 .8 2 2.3v2C6 19 6.5 20 8.5 20"/><path d="M15.5 4c2 0 2.5 1 2.5 2.7v2c0 1.5.7 2.3 2 2.3v2c-1.3 0-2-.8-2 2.3v2c0 1.7-.5 2.7-2.5 2.7"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m15.5 15.5 4 4"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20"/><path d="M17 12v3"/><path d="M20 12v2.5"/>',
  inbox: '<path d="M4 13h4l1.4 2.5h5.2L16 13h4"/><path d="M6.2 5h11.6l2.2 8v4.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5V13Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  bot: '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 4.5V8"/><circle cx="9.5" cy="13" r="1.1"/><circle cx="14.5" cy="13" r="1.1"/>',
};

export function icon(name: string, size = 18): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? PATHS.link}</svg>`;
}