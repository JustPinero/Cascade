import type { WizardState } from "./wizard-shell";

interface ConfigStepProps {
  state: WizardState;
  onChange: (updates: Partial<WizardState>) => void;
}

const autonomyModes = [
  {
    value: "full",
    label: "Full Autonomy",
    desc: "Claude Code operates independently. Minimal manual intervention.",
  },
  {
    value: "semi",
    label: "Semi-Autonomous",
    desc: "Claude requests approval for major decisions. Default mode.",
  },
  {
    value: "manual",
    label: "Manual",
    desc: "Claude waits for explicit instructions at each step.",
  },
];

function Toggle({
  enabled,
  onToggle,
  label,
  description,
}: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        onClick={onToggle}
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 mt-0.5 ${
          enabled ? "bg-cyan" : "bg-space-600"
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-text-bright transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
      <div>
        <span className="text-sm font-mono text-text-bright">{label}</span>
        <p className="text-xs font-mono text-space-500 mt-0.5">
          {description}
        </p>
      </div>
    </div>
  );
}

export function ConfigStep({ state, onChange }: ConfigStepProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold font-mono text-text-bright">
        Project Configuration
      </h2>

      <div>
        <label className="block text-xs font-mono text-text mb-3 uppercase tracking-wider">
          Autonomy Mode
        </label>
        <div className="space-y-2">
          {autonomyModes.map((mode) => (
            <button
              key={mode.value}
              onClick={() => onChange({ autonomyMode: mode.value })}
              className={`w-full text-left p-3 border transition-colors ${
                state.autonomyMode === mode.value
                  ? "border-cyan bg-cyan/8"
                  : "border-space-600 hover:border-space-500"
              }`}
            >
              <span className="text-sm font-mono font-bold text-text-bright">
                {mode.label}
              </span>
              <p className="text-xs font-mono text-space-500 mt-0.5">
                {mode.desc}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <Toggle
          enabled={state.prWorkflowEnabled}
          onToggle={() =>
            onChange({ prWorkflowEnabled: !state.prWorkflowEnabled })
          }
          label="PR Workflow"
          description="Create a pull request for each request. Enables code review before merge."
        />
        <Toggle
          enabled={state.agentTeamsEnabled}
          onToggle={() =>
            onChange({ agentTeamsEnabled: !state.agentTeamsEnabled })
          }
          label="Agent Teams"
          description="Enable multiple Claude Code agents working in parallel on different tasks."
        />
      </div>
    </div>
  );
}
