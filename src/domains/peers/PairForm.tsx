import { useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { usePeersStore } from "./store";

// Pair with another computer: paste the code its Settings showed. The code carries a
// token, so the field is masked like any key.
export function PairForm() {
  const pair = usePeersStore((s) => s.pair);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const failure = await pair(code);
    setBusy(false);
    if (failure) setError(failure);
    else setCode("");
  };

  return (
    <div className="field">
      <label htmlFor="peer-code">Pair with another computer</label>
      <div className="pr-code-row">
        <input
          id="peer-code"
          type="password"
          autoComplete="off"
          placeholder="Paste its trace-pair: code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        <button
          type="button"
          className="btn"
          disabled={!code.trim() || busy}
          onClick={() => void submit()}
        >
          <BusyLabel busy={busy} idle="Pair" working="Pairing…" />
        </button>
      </div>
      {error && <div className="hint pr-error">{error}</div>}
    </div>
  );
}
