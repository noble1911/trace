import { CLAUDE_MODEL_ALIASES, modelName } from "@/domains/agentChat/agentOptionsFormat";
import { useClaudeModels } from "@/domains/agentChat/claudeCatalog";
import { useOrchestratorStore } from "./store";

/**
 * The assistant's model: what the installed Claude Code lists, named as the agent
 * pickers name them ("Opus 5.5"). Until the list arrives, or without Claude Code,
 * Claude's aliases. A saved model the list no longer has stays selectable.
 */
export function OrchestratorModelSelect() {
  const catalog = useClaudeModels();
  const model = useOrchestratorStore((s) => s.model);
  const setModel = useOrchestratorStore((s) => s.setModel);
  const values: string[] = catalog.length ? catalog.map((m) => m.value) : [...CLAUDE_MODEL_ALIASES];
  if (!values.includes(model)) values.push(model);
  return (
    <select aria-label="Assistant model" value={model} onChange={(e) => setModel(e.target.value)}>
      {values.map((v) => (
        <option key={v} value={v}>
          {modelName(v, catalog)}
        </option>
      ))}
    </select>
  );
}
