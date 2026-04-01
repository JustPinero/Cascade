import type { WizardState } from "./wizard-shell";

interface ReviewStepProps {
  state: WizardState;
  onChange: (updates: Partial<WizardState>) => void;
}

export function ReviewStep({ state, onChange }: ReviewStepProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold font-mono text-text-bright">
        Review Kickoff Prompt
      </h2>
      <p className="text-xs font-mono text-space-500">
        Edit the generated kickoff prompt before launching.
      </p>

      <textarea
        value={state.kickoffContent}
        onChange={(e) => onChange({ kickoffContent: e.target.value })}
        className="w-full h-80 px-3 py-2 text-xs font-mono bg-space-900 border border-space-600 text-text-bright focus:border-cyan focus:outline-none resize-none"
        placeholder="Paste or type your kickoff prompt here..."
      />

      {!state.kickoffContent && (
        <p className="text-xs font-mono text-amber">
          No kickoff content yet. Go back to the Claude step to generate one,
          or paste your own content above.
        </p>
      )}
    </div>
  );
}
