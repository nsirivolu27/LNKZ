# LNKZ in the Magentic design system

LNKZ keeps its product name and uses the Magentic magenta accent. Magenta marks
the primary action and focus, not headings, decorative icons, or panels.

The source of truth is `lnkz-mcp/brand/tokens.css` and its companion README.
`apps/web/src/magentic-tokens.css` is the vendored copy from commit `d421033`;
update it from that source rather than inventing local palette values. This
copy keeps LNKZ builds independent of another checkout and adds no dependency.

Dark is the base. The system light preference selects the full light palette;
`data-theme="dark"` or `data-theme="light"` on the root explicitly overrides it.
Both the landing page and console inherit the same tokens.

Use semantic CSS variables. No raw colour utilities and no opacity modifiers
on variables. Existing `--ink`, `--muted`, `--line`, `--green`, `--lime`, and
`--paper` names remain supported; the historical green/lime names alias the
accent and are not a second palette.

Use Instrument Sans and JetBrains Mono stacks, the shared type/spacing scales,
and small field/panel corners. Elevation is a surface plus a hairline; only
overlays cast shadows. Use scale and weight for hierarchy, with uppercase rare.
Keep tap targets at least 44px and respect reduced motion. Theme-specific
foregrounds, including `--on-accent`, must accompany their backgrounds.
