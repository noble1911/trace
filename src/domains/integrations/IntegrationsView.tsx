import { type ReactNode, useEffect, useState } from "react";
import { useGitHubStore } from "@/domains/github/store";
import { useIssuesStore } from "@/domains/issues/store";
import { SkillsTab } from "@/domains/skills/SkillsTab";
import { useTailscaleStatus } from "@/domains/tailscale/store";
import { useVercelStatus } from "@/domains/vercel/store";
import { GitHubDialog } from "./GitHubDialog";
import { GITHUB } from "./github";
import { IntegrationDialog } from "./IntegrationDialog";
import { McpTab } from "./McpTab";
import { INTEGRATIONS, type Integration } from "./registry";
import { TailscaleDialog } from "./TailscaleDialog";
import { TAILSCALE } from "./tailscale";
import { VercelDialog } from "./VercelDialog";
import { VERCEL } from "./vercel";

interface CardProps {
  name: string;
  logo: string;
  description: string;
  connected: boolean;
  /** Early, partial support: the card says so beside its name. */
  preview?: boolean;
  onOpen: () => void;
}

function IntegrationCard({ name, logo, description, connected, preview, onOpen }: CardProps) {
  return (
    <button type="button" className="ig-card" onClick={onOpen}>
      <div className="ig-card-top">
        <img className="ig-logo" src={logo} alt="" />
        {connected && <span className="ig-status">Connected</span>}
      </div>
      <div className="ig-name">
        {name}
        {preview && <span className="ig-preview">Preview</span>}
      </div>
      <div className="ig-desc">{description}</div>
    </button>
  );
}

const TABS = [
  { id: "services", label: "Integrations" },
  { id: "mcp", label: "MCP servers" },
  { id: "skills", label: "Skills" },
] as const;

// Three tabs. Integrations: the services trace works with, one card each. MCP servers:
// the tools trace's agents get (`McpTab`). Skills: GitHub repos of Claude Code skills (`SkillsTab`). Connect and disconnect a service here. Connecting a
// tracker adds its board to the rail; disconnecting takes it away. GitHub is about
// code rather than a board: signed in with trace's own token, it opens the repo browser.
// Vercel is somewhere sessions run: connected, New session offers it. Tailscale is a
// status-only preview of your other computers; its own app connects it, so it shows
// as connected while this computer is on a tailnet.
export function IntegrationsView() {
  const sessions = useIssuesStore((s) => s.sessions);
  const githubLogin = useGitHubStore((s) => s.status?.login);
  const checkGitHub = useGitHubStore((s) => s.checkStatus);
  const [open, setOpen] = useState<Integration | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const vercel = useVercelStatus();
  const [vercelOpen, setVercelOpen] = useState(false);
  const tailscale = useTailscaleStatus();
  const [tailscaleOpen, setTailscaleOpen] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("services");

  useEffect(() => void checkGitHub(), [checkGitHub]);

  const card = (i: Integration) => (
    <IntegrationCard
      key={i.kind}
      {...i}
      connected={Boolean(sessions[i.kind])}
      onOpen={() => setOpen(i)}
    />
  );
  const githubCard = (
    <IntegrationCard
      key="github"
      {...GITHUB}
      connected={Boolean(githubLogin)}
      onOpen={() => setGithubOpen(true)}
    />
  );
  const connected = INTEGRATIONS.filter((i) => sessions[i.kind]).map(card);
  const available = INTEGRATIONS.filter((i) => !sessions[i.kind]).map(card);
  const vercelCard = (
    <IntegrationCard
      key="vercel"
      {...VERCEL}
      connected={Boolean(vercel)}
      onOpen={() => setVercelOpen(true)}
    />
  );
  const tailscaleCard = (
    <IntegrationCard
      key="tailscale"
      {...TAILSCALE}
      connected={tailscale?.state === "running"}
      onOpen={() => setTailscaleOpen(true)}
    />
  );
  (githubLogin ? connected : available).push(githubCard);
  (vercel ? connected : available).push(vercelCard);
  (tailscale?.state === "running" ? connected : available).push(tailscaleCard);
  const section = (title: string, items: ReactNode[]) =>
    items.length > 0 && (
      <section className="ig-section">
        <h2>{title}</h2>
        <div className="ig-grid">{items}</div>
      </section>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Integrations</h1>
          <div className="desc">
            Connect the services trace works with, and the MCP servers that give its agents your
            tools, here and in Vercel sandboxes.
          </div>
        </div>
      </div>
      <div className="detail-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`detail-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="page-body">
        {tab === "services" ? (
          <div className="ig-wrap">
            {section("Connected integrations", connected)}
            {section("Available integrations", available)}
          </div>
        ) : tab === "mcp" ? (
          <McpTab />
        ) : (
          <SkillsTab />
        )}
      </div>
      {open && <IntegrationDialog integration={open} onClose={() => setOpen(null)} />}
      {githubOpen && <GitHubDialog onClose={() => setGithubOpen(false)} />}
      {vercelOpen && <VercelDialog onClose={() => setVercelOpen(false)} />}
      {tailscaleOpen && <TailscaleDialog onClose={() => setTailscaleOpen(false)} />}
    </div>
  );
}
