import { openUrl } from "@tauri-apps/plugin-opener";
import { BusyLabel } from "@/components/BusyLabel";
import { Modal } from "@/components/Modal";
import { PeersSection } from "@/domains/peers/PeersSection";
import { useTailscaleStore } from "@/domains/tailscale/store";
import type { TailnetDevice, TailnetState } from "@/ipc/tailscale";
import { TAILSCALE } from "./tailscale";

const DOWNLOAD_URL = "https://tailscale.com/download";

// What to do next, for each state short of connected. Tailscale's own app signs in
// and switches on; trace can only point there.
const NEXT_STEP: Record<Exclude<TailnetState, "running">, string> = {
  notInstalled:
    "Tailscale isn't on this computer. Install it, sign in, then do the same on each computer you want to reach.",
  stopped: "Tailscale is installed but not connected. Turn it on from the Tailscale app.",
  needsLogin: "Tailscale needs you to sign in. Open the Tailscale app and log in.",
};

function DeviceRow({ device }: { device: TailnetDevice }) {
  return (
    <li className="ig-device">
      <span className="ig-device-name">{device.name}</span>
      <span className="ig-device-meta">{device.os ?? ""}</span>
      <span className="ig-device-ip">{device.ip ?? "—"}</span>
      <span className={device.online ? "ig-device-on" : "ig-device-off"}>
        {device.online ? "Online" : "Offline"}
      </span>
    </li>
  );
}

// Tailscale's details: which tailnet this computer is on and the other devices
// there. Nothing to connect or disconnect here — that's Tailscale's own app.
export function TailscaleDialog({ onClose }: { onClose: () => void }) {
  const status = useTailscaleStore((s) => s.status);
  const loading = useTailscaleStore((s) => s.loading);
  const check = useTailscaleStore((s) => s.check);
  const running = status?.state === "running";
  const me = status?.device;

  return (
    <Modal title={TAILSCALE.name} onClose={onClose}>
      <div className="ig-dialog">
        <div className="ig-dialog-head">
          <img className="ig-logo" src={TAILSCALE.logo} alt="" />
          <div className="ig-dialog-text">
            <div className="ig-desc">{TAILSCALE.description}</div>
            {running && (
              <div className="ig-account">
                {status.tailnet ? `Tailnet ${status.tailnet}` : "Connected"}
                {me && ` · this computer is ${me.name}${me.ip ? ` (${me.ip})` : ""}`}
              </div>
            )}
          </div>
        </div>
        {status && status.state !== "running" && (
          <div className="ig-note">{NEXT_STEP[status.state]}</div>
        )}
        {running && <PeersSection />}
        {running && (
          <div className="ig-sub">
            <h3>Other devices on your tailnet</h3>
            {status.peers.length > 0 ? (
              <ul className="ig-devices">
                {status.peers.map((p) => (
                  <DeviceRow key={p.dnsName ?? p.name} device={p} />
                ))}
              </ul>
            ) : (
              <div className="ig-empty">
                No other devices yet. Install Tailscale on another computer and sign in with the
                same account, and it shows up here.
              </div>
            )}
          </div>
        )}
        <div className="ig-form-foot">
          {status?.state === "notInstalled" && (
            <button type="button" className="btn" onClick={() => void openUrl(DOWNLOAD_URL)}>
              Get Tailscale
            </button>
          )}
          <button type="button" className="btn" disabled={loading} onClick={() => void check()}>
            <BusyLabel busy={loading} idle="Check again" working="Checking…" />
          </button>
        </div>
      </div>
    </Modal>
  );
}
