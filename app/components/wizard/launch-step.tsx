import type { WizardState } from "./wizard-shell";

interface LaunchStepProps {
  state: WizardState;
  onChange: (updates: Partial<WizardState>) => void;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function LaunchStep({ state }: LaunchStepProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold font-mono text-text-bright">
        Ready to Launch
      </h2>

      <div className="space-y-3">
        <div className="flex items-center gap-3 text-sm font-mono">
          <span className="text-space-500 w-32">Project:</span>
          <span className="text-text-bright">{state.projectName}</span>
        </div>
        <div className="flex items-center gap-3 text-sm font-mono">
          <span className="text-space-500 w-32">Slug:</span>
          <span className="text-cyan">{toSlug(state.projectName)}</span>
        </div>
        <div className="flex items-center gap-3 text-sm font-mono">
          <span className="text-space-500 w-32">Type:</span>
          <span className="text-text">{state.projectType}</span>
        </div>
        <div className="flex items-center gap-3 text-sm font-mono">
          <span className="text-space-500 w-32">GitHub:</span>
          <span className="text-text">
            {state.createGithubRepo
              ? `Yes (${state.isPrivate ? "private" : "public"})`
              : "No"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm font-mono">
          <span className="text-space-500 w-32">Autonomy:</span>
          <span className="text-text">{state.autonomyMode}</span>
        </div>
        <div className="flex items-center gap-3 text-sm font-mono">
          <span className="text-space-500 w-32">PR Workflow:</span>
          <span className="text-text">
            {state.prWorkflowEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm font-mono">
          <span className="text-space-500 w-32">Agent Teams:</span>
          <span className="text-text">
            {state.agentTeamsEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm font-mono">
          <span className="text-space-500 w-32">Kickoff:</span>
          <span className="text-text">
            {state.kickoffContent
              ? `${state.kickoffContent.length} chars`
              : "Not generated"}
          </span>
        </div>
      </div>

      <div className="p-3 border border-cyan/30 bg-cyan/5 text-xs font-mono text-cyan">
        Click &quot;Launch&quot; to create the project directory, initialize git,
        {state.createGithubRepo && " create GitHub repo,"} and register in
        Cascade.
      </div>
    </div>
  );
}
