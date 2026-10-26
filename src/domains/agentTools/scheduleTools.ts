import type Anthropic from "@anthropic-ai/sdk";
import { agentProvider } from "@/domains/agent/defaults";
import { describeSchedule, formatDuration, formatWhen } from "@/domains/schedules/describe";
import type { PromptInput, Schedule, ScheduledPrompt } from "@/domains/schedules/types";
import {
  listScheduledPrompts,
  listScheduleRuns,
  saveScheduledPrompt,
  setScheduledPromptEnabled,
} from "@/ipc/schedules";

// Scheduled-prompt tools for trace's agents. The main use is fixing a prompt
// that isn't behaving (read its recent runs, then update it); updates keep the
// prompt's on/off state. Creating one is for when the user asks, and a new
// prompt always starts paused for them to switch on.

const SCHEDULE_SCHEMA = {
  type: "object",
  description:
    'When it runs. One of: {"kind":"interval","every":N,"unit":"minutes"|"hours"|"days"}, ' +
    '{"kind":"daily","time":"HH:MM"}, {"kind":"weekly","weekdays":[0-6, 0=Sunday],"time":"HH:MM"}, ' +
    '{"kind":"monthly","day":1-31,"time":"HH:MM"}, {"kind":"cron","expr":"<5-field cron>"}.',
  properties: {
    kind: { type: "string", enum: ["interval", "daily", "weekly", "monthly", "cron"] },
  },
  required: ["kind"],
};

const EDITABLE = {
  title: { type: "string", description: "Short name shown in trace." },
  prompt: {
    type: "string",
    description: "The full prompt text sent at each run. {date}-style variables are filled in.",
  },
  schedule: SCHEDULE_SCHEMA,
  timeout_mins: {
    type: "number",
    description: "Kill a run still going after this many minutes; 0 = no limit (max 1440).",
  },
  notify: { type: "boolean", description: "Notify when a run finishes." },
  model: { type: "string", description: "Model for the run; omit to keep the current one." },
  extra_args: {
    type: "array",
    items: { type: "string" },
    description: "Extra CLI arguments for the run's Claude session.",
  },
};

export const SCHEDULE_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_scheduled_prompts",
    description:
      "List trace's scheduled prompts: id, title, schedule, whether it's on, and how its latest run went.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_scheduled_prompt",
    description:
      "Read one scheduled prompt in full (its prompt text and settings) with its five most recent runs: status, duration, closing summary and any error. Use before updating a prompt to see why it misbehaves.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "The prompt id." } },
      required: ["id"],
    },
  },
  {
    name: "update_scheduled_prompt",
    description:
      "Change an existing scheduled prompt, e.g. to fix one that isn't working as intended. Only the fields given change; whether the prompt is switched on stays as it is.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "The prompt id." }, ...EDITABLE },
      required: ["id"],
    },
  },
  {
    name: "create_scheduled_prompt",
    description:
      "Create a new scheduled prompt. Only when the user asks for one. It is created paused; the user switches it on in trace's Scheduled view.",
    input_schema: {
      type: "object",
      properties: {
        ...EDITABLE,
        repo: {
          type: "string",
          description: "Path of a repo configured in trace; omit for the default repo.",
        },
      },
      required: ["title", "prompt", "schedule"],
    },
  },
];

type Args = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;

function asInput(p: ScheduledPrompt): PromptInput {
  return {
    id: p.id,
    title: p.title,
    prompt: p.prompt,
    repo: p.repo ?? null,
    provider: p.provider ?? "anthropic",
    model: p.model ?? null,
    extraArgs: p.extraArgs,
    schedule: p.schedule,
    timeoutMins: p.timeoutMins,
    notify: p.notify,
  };
}

/** The fields an update or create may set, layered over `base`. */
function withEdits(base: PromptInput, a: Args): PromptInput {
  return {
    ...base,
    title: str(a.title) ?? base.title,
    prompt: str(a.prompt) ?? base.prompt,
    schedule: (a.schedule as Schedule | undefined) ?? base.schedule,
    timeoutMins: num(a.timeout_mins) ?? base.timeoutMins,
    notify: bool(a.notify) ?? base.notify,
    model: str(a.model) ?? base.model,
    extraArgs: strings(a.extra_args) ?? base.extraArgs,
  };
}

async function findPrompt(id: string): Promise<ScheduledPrompt | undefined> {
  return (await listScheduledPrompts()).find((p) => p.id === id);
}

async function listPrompts(): Promise<string> {
  const [prompts, runs] = await Promise.all([listScheduledPrompts(), listScheduleRuns()]);
  if (prompts.length === 0) return "No scheduled prompts.";
  return prompts
    .map((p) => {
      const last = runs.find((r) => r.promptId === p.id);
      const state = p.enabled ? "on" : "paused";
      const latest = last ? `last run ${last.status} ${formatWhen(last.startedAt)}` : "never run";
      return `${p.id} · ${p.title} · ${describeSchedule(p.schedule)} · ${state} · ${latest}`;
    })
    .join("\n");
}

async function getPrompt(id: string): Promise<string> {
  const p = await findPrompt(id);
  if (!p) return `No scheduled prompt ${id}.`;
  const runs = (await listScheduleRuns()).filter((r) => r.promptId === id).slice(0, 5);
  const lines = [
    `${p.title} (${p.id}) — ${p.enabled ? "on" : "paused"}`,
    `Schedule: ${describeSchedule(p.schedule)} · timeout ${p.timeoutMins ? `${p.timeoutMins}m` : "none"} · notify ${p.notify ? "on" : "off"}`,
    `Model: ${p.model ?? "default"} · provider ${p.provider ?? "anthropic"} · args ${p.extraArgs.join(" ") || "none"}`,
    "",
    "PROMPT:",
    p.prompt,
    "",
    runs.length ? "RECENT RUNS (newest first):" : "No runs yet.",
  ];
  for (const r of runs) {
    const took = r.endedAt ? formatDuration(r.endedAt - r.startedAt) : "still going";
    lines.push(
      `- ${formatWhen(r.startedAt)} · ${r.status} · ${took}${r.error ? ` · error: ${r.error}` : ""}`
    );
    if (r.summary) lines.push(`  summary: ${r.summary.slice(0, 600).replace(/\s+/g, " ")}`);
  }
  return lines.join("\n");
}

async function updatePrompt(a: Args): Promise<string> {
  const id = str(a.id) ?? "";
  const p = await findPrompt(id);
  if (!p) return `No scheduled prompt ${id}.`;
  const saved = await saveScheduledPrompt(withEdits(asInput(p), a));
  return `Updated "${saved.title}" (${saved.enabled ? "still on" : "still paused"}).`;
}

async function createPrompt(a: Args): Promise<string> {
  const base: PromptInput = {
    title: "",
    prompt: "",
    repo: str(a.repo) ?? null,
    provider: agentProvider(),
    model: null,
    extraArgs: [],
    schedule: { kind: "daily", time: "09:00" },
    timeoutMins: 0,
    notify: true,
  };
  const saved = await saveScheduledPrompt(withEdits(base, a));
  await setScheduledPromptEnabled(saved.id, false);
  return `Created "${saved.title}" (${saved.id}), paused — switch it on in trace's Scheduled view.`;
}

/** Run a scheduled-prompt tool. Returns the text for the model. */
export async function runScheduleTool(name: string, input: unknown): Promise<string> {
  const a = (input && typeof input === "object" ? input : {}) as Args;
  switch (name) {
    case "list_scheduled_prompts":
      return listPrompts();
    case "get_scheduled_prompt":
      return getPrompt(str(a.id) ?? "");
    case "update_scheduled_prompt":
      return updatePrompt(a);
    case "create_scheduled_prompt":
      return createPrompt(a);
    default:
      return `Unknown tool: ${name}`;
  }
}
