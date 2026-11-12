import type { ProviderKind, ProviderSession } from "@/domains/issues/types";
import jiraLogo from "./logos/jira.svg";
import pylonLogo from "./logos/pylon.png";

/** Connecting with the service's own login, over its MCP server: offered beside the API
 * token (`TwoWayConnect`). The login is trace's, shared with Integrations → MCP servers. */
export interface LoginWay {
  /** Its section's heading: "Atlassian login". */
  heading: string;
  /** The button: "Connect with your Atlassian login". */
  label: string;
  /** What it means, in a sentence. */
  note: string;
  /** Said in the dialog once it's connected this way. */
  connected: string;
}

export interface Integration {
  kind: ProviderKind;
  name: string;
  /** Bundled, so the page never loads anything remote and works offline. */
  logo: string;
  /** Shown on its card and at the top of its dialog. */
  description: string;
  /** The connected account, for the dialog. */
  account: (session: ProviderSession) => string;
  /** Its other way to connect, besides an API token. */
  login?: LoginWay;
}

// What the Integrations page offers. Each one adds its own page to the rail (`app/nav.ts`).
export const INTEGRATIONS: Integration[] = [
  {
    kind: "jira",
    name: "Jira",
    logo: jiraLogo,
    description: "Your Jira boards, with an agent one click from any ticket.",
    account: (session) => [session.site, session.email].filter(Boolean).join(" · "),
    login: {
      heading: "Atlassian login",
      label: "Connect with your Atlassian login",
      note: "Uses the same Atlassian login as Integrations → MCP servers, and needs no API token.",
      connected: "Connected with your Atlassian login",
    },
  },
  {
    kind: "pylon",
    name: "Pylon",
    logo: pylonLogo,
    description: "Your open Pylon issues on their own board, ready for an agent.",
    account: (session) => session.site ?? "api.usepylon.com",
    login: {
      heading: "Pylon login",
      label: "Connect with your Pylon login",
      note: "Uses the same Pylon login as Integrations → MCP servers, and needs no API token.",
      connected: "Connected with your Pylon login",
    },
  },
];
