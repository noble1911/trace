import { useEffect, useState } from "react";
import { toast } from "@/app/toast";
import { InlineConfirm } from "@/components/InlineConfirm";
import { Modal } from "@/components/Modal";
import { useIssuesStore } from "@/domains/issues/store";
import { JiraForm, PylonForm } from "./ConnectForms";
import type { Integration } from "./registry";
import { TwoWayConnect } from "./TwoWayConnect";

interface IntegrationDialogProps {
  integration: Integration;
  onClose: () => void;
}

// One integration's details: the connect form, or its account and Disconnect.
export function IntegrationDialog({ integration, onClose }: IntegrationDialogProps) {
  const { kind, name, logo, description, account, login } = integration;
  const session = useIssuesStore((s) => s.sessions[kind]);
  const user = useIssuesStore((s) => s.users[kind]);
  const disconnect = useIssuesStore((s) => s.disconnect);
  const clearConnectError = useIssuesStore((s) => s.clearConnectError);
  // Each tracker with a `login` way names its store action here (Pylon's joins Jira's).
  const connectWithLogin = useIssuesStore((s) => (kind === "jira" ? s.connectJiraMcp : undefined));
  const wasConnected = useState(() => Boolean(session))[0];

  // Don't greet this dialog with the last attempt's failure.
  useEffect(() => clearConnectError(), [clearConnectError]);

  // Connecting succeeded: the card has moved to its new section, so we're done here.
  useEffect(() => {
    if (session && !wasConnected) onClose();
  }, [session, wasConnected, onClose]);

  const confirmDisconnect = () => {
    disconnect(kind)
      .then(onClose)
      .catch((err) => toast.error(`Couldn't disconnect ${name}: ${String(err)}`));
  };

  const loginWay = login && connectWithLogin ? login : undefined;
  const tokenForm =
    kind === "jira" ? (
      <JiraForm secondary={Boolean(loginWay)} />
    ) : (
      <PylonForm secondary={Boolean(loginWay)} />
    );
  const viaMcp = session?.via === "mcp";

  return (
    <Modal title={name} onClose={onClose}>
      <div className="ig-dialog">
        <div className="ig-dialog-head">
          <img className="ig-logo" src={logo} alt="" />
          <div className="ig-dialog-text">
            <div className="ig-desc">{description}</div>
            {session && (
              <div className="ig-account">
                {user ? `${user.displayName} · ` : ""}
                {account(session)}
              </div>
            )}
            {session && (
              <div className="ig-account">
                {viaMcp
                  ? (login?.connected ?? "Connected with your login")
                  : "Connected with an API token"}
              </div>
            )}
          </div>
        </div>
        {!session &&
          (loginWay && connectWithLogin ? (
            <TwoWayConnect way={loginWay} onLogin={connectWithLogin}>
              {tokenForm}
            </TwoWayConnect>
          ) : (
            tokenForm
          ))}
        {session && (
          <div className="ig-form-foot">
            <InlineConfirm
              label="Disconnect"
              message={
                viaMcp
                  ? `Disconnect ${name}? Your login stays, for agents.`
                  : `Disconnect ${name} and delete its token?`
              }
              confirmLabel="Disconnect"
              onConfirm={confirmDisconnect}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
