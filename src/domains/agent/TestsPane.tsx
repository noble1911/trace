import { I } from "@/components/Icon";
import type { Issue } from "@/domains/jira/types";
import { useTestsStore } from "./testsStore";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

// The "Tests" tab — runs the worktree's detected test command on demand and
// renders the result onto the design's tests-summary / test-suite / test-detail.
// Run state lives in testsStore (keyed by issue) so it survives leaving the tab.
export function TestsPane({ issue }: { issue: Issue }) {
  const running = useTestsStore((s) => s.running.has(issue.key));
  const run = useTestsStore((s) => s.results[issue.key] ?? null);
  const error = useTestsStore((s) => s.errors[issue.key] ?? null);
  const start = useTestsStore((s) => s.run);

  const go = () => void start(issue.key);

  return (
    <div className="tab-pane">
      <div className="tests-bar">
        <button type="button" className="btn primary" onClick={go} disabled={running}>
          <I.Beaker size={13} /> {running ? "Running…" : run ? "Re-run tests" : "Run tests"}
        </button>
        {run && (
          <div className="tests-summary" style={{ margin: 0 }}>
            <span className="item">
              <b style={{ color: run.passed ? "var(--c-done)" : "var(--c-danger)" }}>
                {run.passed ? "passed" : "failed"}
              </b>
            </span>
            <span className="item">{secs(run.durationMs)}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="test-suite fail" style={{ marginTop: 4 }}>
          <div className="row">
            <span className="name">Couldn't run tests</span>
          </div>
          <div className="test-detail">{error}</div>
        </div>
      )}

      {run && (
        <div className={`test-suite ${run.passed ? "pass" : "fail"}`}>
          <div className="row">
            <span className="name">{run.command}</span>
            <span className="stat">
              {run.passed ? (
                <span className="ok">✓ passed</span>
              ) : (
                <span className="fail">✗ exit {run.exitCode}</span>
              )}
            </span>
            <span className="duration">{secs(run.durationMs)}</span>
          </div>
          {run.output && <div className="test-detail">{run.output}</div>}
        </div>
      )}

      {!run && !error && !running && (
        <div className="pr-muted" style={{ marginTop: 4 }}>
          Runs the worktree's test suite (gradle, cargo, npm, maven, go, or pytest — auto-detected)
          and shows the result here.
        </div>
      )}
    </div>
  );
}
