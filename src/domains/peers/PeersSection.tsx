import { useEffect } from "react";
import { toast } from "@/app/toast";
import { BusyLabel } from "@/components/BusyLabel";
import { Switch } from "@/components/Switch";
import { PairCode } from "./PairCode";
import { PairForm } from "./PairForm";
import { PeerRow } from "./PeerRow";
import { usePeersStore } from "./store";

// Settings for running sessions on other computers' traces: this computer's server
// switch and pairing code, the paired computers, and any others where a trace
// answered. Shown in the Tailscale card once Tailscale is connected.
export function PeersSection() {
  const { peers, failed, searching, serverOn } = usePeersStore();
  const discover = usePeersStore((s) => s.discover);
  const loadServer = usePeersStore((s) => s.loadServer);
  const setServer = usePeersStore((s) => s.setServer);

  useEffect(() => {
    void discover();
    void loadServer();
  }, [discover, loadServer]);

  return (
    <div className="ig-sub">
      <h3>Run sessions on other computers</h3>
      <div className="pr-switch">
        <span>Let other computers on my tailnet run sessions here</span>
        <Switch
          on={serverOn === true}
          disabled={serverOn === null}
          label="Let other computers on my tailnet run sessions here"
          onChange={(on) => setServer(on).catch((e) => toast.error(String(e)))}
        />
      </div>
      {serverOn && (
        <div className="ig-note">
          Only computers that have this computer's code can connect. Keep trace open: agents run
          here, in this window.
        </div>
      )}
      <PairCode />
      <PairForm />
      {peers && peers.length > 0 && (
        <ul className="ig-devices">
          {peers.map((p) => (
            <PeerRow key={p.id ?? p.address} peer={p} />
          ))}
        </ul>
      )}
      {peers?.length === 0 && (
        <div className="ig-empty">
          No other trace found yet. Turn on the switch above on another computer, show its code
          there, and paste it here.
        </div>
      )}
      {failed && <div className="ig-note">Couldn't look for other computers. Try again.</div>}
      <button type="button" className="btn" disabled={searching} onClick={() => void discover()}>
        <BusyLabel busy={searching} idle="Look again" working="Looking…" />
      </button>
    </div>
  );
}
