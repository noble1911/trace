import { useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { InlineConfirm } from "@/components/InlineConfirm";
import { copyPlain } from "@/ipc/clipboard";
import { peerPairCode, peerRotateToken } from "@/ipc/peers";

// This computer's pairing code, shown only while the user asks to see it. It holds
// the token that lets another computer in, so it lives in this component's state
// and is dropped when hidden: never in the store, never logged.
export function PairCode() {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = async () => {
    setBusy(true);
    try {
      setCode(await peerPairCode());
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    try {
      await peerRotateToken();
      setCode(null);
      toast.success("New code made. Computers already paired need to pair again.");
    } catch (e) {
      toast.error(String(e));
    }
  };

  if (code === null) {
    return (
      <button type="button" className="btn" disabled={busy} onClick={() => void show()}>
        Show this computer's code
      </button>
    );
  }
  return (
    <div className="pr-code">
      <div className="pr-code-row">
        <input className="pr-code-field" readOnly value={code} aria-label="Pairing code" />
        <IconButton
          label="Copy code"
          onClick={() =>
            copyPlain(code).then(
              () => toast.success("Code copied"),
              () => toast.error("Couldn't copy to clipboard")
            )
          }
        >
          <I.Copy size={14} />
        </IconButton>
        <button type="button" className="btn" onClick={() => setCode(null)}>
          Hide
        </button>
      </div>
      <InlineConfirm
        label="New code…"
        message="Computers already paired will need to pair again."
        confirmLabel="Make new code"
        onConfirm={() => void rotate()}
        className="link-btn"
      />
    </div>
  );
}
