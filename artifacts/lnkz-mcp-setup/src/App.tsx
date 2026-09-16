import { useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, ArrowUpRight, Check, ShieldAlert } from 'lucide-react';
import { toolGroups, type Tool } from './data/tools';

type ConfigMode = 'stdio' | 'hosted';

function App() {
  const [mode, setMode] = useState<ConfigMode>('stdio');
  const [relayUrl, setRelayUrl] = useState('http://localhost:8787');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  const config = useMemo(() => {
    if (mode === 'stdio') {
      return JSON.stringify(
        {
          mcpServers: {
            lnkz: {
              command: 'npx',
              args: ['@lnkz/mcp', '--relay', relayUrl],
              env: { LNKZ_API_KEY: apiKey },
            },
          },
        },
        null,
        2,
      );
    }
    return JSON.stringify(
      {
        mcpServers: {
          lnkz: {
            url: `${relayUrl.replace(/\/$/, '')}/mcp`,
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        },
      },
      null,
      2,
    );
  }, [apiKey, mode, relayUrl]);

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const visibleToolGroups = useMemo(
    () =>
      toolGroups.map((group) => ({
        ...group,
        tools: group.tools,
      })),
    [],
  );

  return (
    <main className="site-shell">
      <header className="topbar" data-testid="header-site">
        <a className="brand" href="#top" data-testid="link-home">
          <span className="brand-mark" aria-hidden="true">↗</span>
          <span>LNKZ <b>MCP</b></span>
        </a>
        <div className="topbar-meta">
          <span className="topbar-status"><i aria-hidden="true" /> PUBLIC SETUP</span>
          <span className="topbar-index">FIELD GUIDE / 01</span>
        </div>
      </header>

      <div className="page-wrap" id="top">
        <section className="hero" aria-labelledby="page-title">
          <div className="eyebrow">CONVERSATION RELAY / CLIENT HANDOFF</div>
          <h1 id="page-title">
            Give every conversation<br />
            <span>a way <em>back.</em></span>
          </h1>
          <div className="hero-bottom">
            <p className="hero-lede">
              LNKZ MCP points your model client at a relay you run yourself. Connect a
              local or remote instance, copy the client config, and be moving in under two minutes.
            </p>
            <a className="jump-link" href="#configure" data-testid="link-jump-config">
              START WITH CONFIG <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
            </a>
          </div>
          <div className="principles" aria-label="Product principles">
            <span><strong>01</strong> NO ACCOUNT</span>
            <span><strong>02</strong> YOUR RELAY</span>
            <span><strong>03</strong> NO MODEL CALLS</span>
          </div>
        </section>

        <section className="section path-section" id="how-it-works" aria-labelledby="path-title">
          <SectionKicker number="01" label="WHAT IT DOES" />
          <div className="section-intro">
            <h2 id="path-title">A conversation can<br /><span>change hands.</span></h2>
            <p>
              LNKZ is the small piece of infrastructure between a model client and the people
              who need to pick up its work. The relay keeps the chain legible without becoming
              the destination.
            </p>
          </div>
          <div className="path-grid" data-testid="display-handoff-path">
            <PathStep index="01" title="You talk" copy="Have a conversation with a model, in the client you already use." />
            <PathStep index="02" title="You hand it over" copy="Make a bounded handoff when someone else needs the context." />
            <PathStep index="03" title="They pick it up" copy="They continue on their own relay, with their own keys and limits." />
            <PathStep index="04" title="The chain stays visible" copy="Origin and lineage travel with the handoff, not the transcript." />
          </div>
        </section>

        <section className="section config-section" id="configure" aria-labelledby="config-title">
          <SectionKicker number="02" label="CONFIGURE YOUR CLIENT" inverted />
          <div className="config-heading">
            <div>
              <h2 id="config-title">Two fields.<br /><span>One working client.</span></h2>
            </div>
            <p>
              Local relay or hosted endpoint — choose the shape your client expects. Nothing
              below makes a request. The config is assembled in this browser.
            </p>
          </div>

          <div className="config-panel">
            <div className="config-tabs" role="tablist" aria-label="Client configuration type">
              <button
                className={mode === 'stdio' ? 'tab active' : 'tab'}
                type="button"
                role="tab"
                aria-selected={mode === 'stdio'}
                onClick={() => setMode('stdio')}
                data-testid="tab-config-stdio"
              >
                <span className="tab-number">01</span> STDIO / LOCAL
              </button>
              <button
                className={mode === 'hosted' ? 'tab active' : 'tab'}
                type="button"
                role="tab"
                aria-selected={mode === 'hosted'}
                onClick={() => setMode('hosted')}
                data-testid="tab-config-hosted"
              >
                <span className="tab-number">02</span> HOSTED / REMOTE
              </button>
            </div>
            <div className="config-grid">
              <form className="config-fields" onSubmit={(event) => event.preventDefault()}>
                <label className="field-label" htmlFor="relay-url">RELAY URL <span>REQUIRED</span></label>
                <input
                  id="relay-url"
                  className="field-input mono"
                  type="url"
                  placeholder="http://localhost:8787"
                  value={relayUrl}
                  onChange={(event) => setRelayUrl(event.target.value)}
                  data-testid="input-relay-url"
                  aria-describedby="relay-help"
                />
                <p className="field-help" id="relay-help">
                  {mode === 'stdio' ? 'Address your local relay listens on.' : 'Base URL of the relay you control.'}
                </p>

                <label className="field-label" htmlFor="api-key">API KEY <span>MASKED</span></label>
                <div className="key-input-wrap">
                  <input
                    id="api-key"
                    className="field-input mono"
                    type={showKey ? 'text' : 'password'}
                    placeholder="Paste your relay key"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    data-testid="input-api-key"
                    autoComplete="off"
                    aria-describedby="key-help"
                  />
                  <button
                    className="reveal-button"
                    type="button"
                    onClick={() => setShowKey((current) => !current)}
                    aria-label={showKey ? 'Hide API key' : 'Reveal API key'}
                    data-testid="button-toggle-api-key"
                  >
                    {showKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
                <p className="field-help" id="key-help">Used only to build this config in memory.</p>

                <div className="browser-note">
                  <ShieldAlert size={17} aria-hidden="true" />
                  <p><strong>BROWSER ONLY.</strong> This key never leaves this tab, enters a URL, or touches storage. Clear it before sharing your screen.</p>
                </div>
              </form>
              <div className="output-column">
                <div className="output-header">
                  <span className="field-label">CLIENT CONFIG <span>LIVE</span></span>
                  <span className="output-language">JSON</span>
                </div>
                <pre className="code-output" data-testid="display-generated-config" aria-label="Generated client configuration">{config}</pre>
                <button className="copy-button" type="button" onClick={copyConfig} data-testid="button-copy-config">
                  {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copied ? 'COPIED TO CLIPBOARD' : 'COPY CONFIG'}
                </button>
                <p className="credential-warning" data-testid="warning-credential">
                  <strong>KEEP THIS PRIVATE.</strong> This config contains a credential. Put it in your client&apos;s own configuration — never in a shared document or a chat.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section tools-section" id="tools" aria-labelledby="tools-title">
          <SectionKicker number="03" label="TOOL CATALOG" />
          <div className="tools-heading">
            <div>
              <h2 id="tools-title">Twenty-nine tools.<br /><span>One clear boundary.</span></h2>
              <p>Grouped by the job in front of you, not alphabetically.</p>
            </div>
            <button
              className={readOnly ? 'scope-toggle on' : 'scope-toggle'}
              type="button"
              aria-pressed={readOnly}
              onClick={() => setReadOnly((current) => !current)}
              data-testid="button-filter-read-only"
            >
              <span className="toggle-track" aria-hidden="true"><span /></span>
              <span>READ ONLY</span>
              <code>LNKZ_MCP_SCOPES=read</code>
            </button>
          </div>
          <div className="catalog" data-testid="display-tool-catalog">
            {visibleToolGroups.map((group) => (
              <div className="tool-group" key={group.slug} data-testid={`group-tools-${group.slug}`}>
                <div className="group-label">
                  <span className="group-index">{group.index}</span>
                  <h3>{group.label}</h3>
                  <span className="group-count">{group.tools.length.toString().padStart(2, '0')} TOOLS</span>
                </div>
                <div className="tool-table-wrap">
                  <div className="tool-table" role="list">
                    {group.tools.map((tool) => (
                      <ToolRow key={tool.name} tool={tool} readOnly={readOnly} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="catalog-footnote"><span aria-hidden="true">↳</span> Read-only dims write tools; it does not remove them from your client&apos;s schema.</p>
        </section>

        <section className="position-section" id="position" aria-labelledby="position-title">
          <SectionKicker number="04" label="WHAT IT DOES NOT DO" inverted />
          <div className="position-content">
            <h2 id="position-title">The relay is yours.<br /><span>Keep it that way.</span></h2>
            <div className="position-list">
              <PositionItem index="01" title="No account." copy="There is nothing to sign up for and nothing to log into." />
              <PositionItem index="02" title="No hosted storage of your conversations." copy="Your relay holds what you choose to run there. LNKZ MCP does not." />
              <PositionItem index="03" title="No model calls in the analysis." copy="This page generates configuration. It does not read, summarize, or route your prompts." />
            </div>
          </div>
          <div className="position-footer">
            <span>LNKZ MCP / PUBLIC SETUP</span>
            <a href="#top" data-testid="link-back-to-top">BACK TO TOP <ArrowUpRight size={14} aria-hidden="true" /></a>
          </div>
        </section>
      </div>
      <footer className="site-footer">
        <span className="footer-mark">LNKZ</span>
        <span>CONVERSATION RELAY / CLIENT ADAPTER</span>
        <span>NO TELEMETRY BY DESIGN</span>
      </footer>
    </main>
  );
}

function SectionKicker({ number, label, inverted = false }: { number: string; label: string; inverted?: boolean }) {
  return (
    <div className={inverted ? 'section-kicker inverted' : 'section-kicker'}>
      <span>{number}</span>
      <span>{label}</span>
    </div>
  );
}

function PathStep({ index, title, copy }: { index: string; title: string; copy: string }) {
  return (
    <article className="path-step">
      <span className="step-index">{index}</span>
      <div className="step-rule" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

function ToolRow({ tool, readOnly }: { tool: Tool; readOnly: boolean }) {
  const isDimmed = readOnly && tool.kind === 'write';
  return (
    <article className={isDimmed ? 'tool-row dimmed' : 'tool-row'} role="listitem" data-testid={`tool-row-${tool.name}`}>
      <div className="tool-name mono">{tool.name}</div>
      <p>{tool.description}</p>
      <span className={`tool-badge ${tool.kind}`} data-testid={`badge-${tool.name}`}>
        {tool.kind === 'read' ? 'READ' : 'WRITE'}
      </span>
      {tool.context && <div className="tool-context"><span>CONTEXT</span>{tool.context}</div>}
    </article>
  );
}

function PositionItem({ index, title, copy }: { index: string; title: string; copy: string }) {
  return (
    <div className="position-item">
      <span className="position-index">{index}</span>
      <div><h3>{title}</h3><p>{copy}</p></div>
    </div>
  );
}

export default App;