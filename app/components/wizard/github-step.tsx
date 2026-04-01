import type { WizardState } from "./wizard-shell";

interface GithubStepProps {
  state: WizardState;
  onChange: (updates: Partial<WizardState>) => void;
}

export function GithubStep({ state, onChange }: GithubStepProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold font-mono text-text-bright">
        GitHub Repository
      </h2>

      <div className="flex items-center gap-3">
        <button
          onClick={() =>
            onChange({ createGithubRepo: !state.createGithubRepo })
          }
          className={`relative w-10 h-5 rounded-full transition-colors ${
            state.createGithubRepo ? "bg-cyan" : "bg-space-600"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-text-bright transition-transform ${
              state.createGithubRepo ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
        <span className="text-sm font-mono text-text">
          Create GitHub repository
        </span>
      </div>

      {state.createGithubRepo && (
        <div className="space-y-4 pl-4 border-l border-space-600">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onChange({ isPrivate: true })}
              className={`px-3 py-1.5 text-xs font-mono border transition-colors ${
                state.isPrivate
                  ? "border-cyan text-cyan bg-cyan/8"
                  : "border-space-600 text-space-500 hover:text-text"
              }`}
            >
              Private
            </button>
            <button
              onClick={() => onChange({ isPrivate: false })}
              className={`px-3 py-1.5 text-xs font-mono border transition-colors ${
                !state.isPrivate
                  ? "border-cyan text-cyan bg-cyan/8"
                  : "border-space-600 text-space-500 hover:text-text"
              }`}
            >
              Public
            </button>
          </div>
          <p className="text-xs font-mono text-space-500">
            Requires gh CLI authenticated. Run `gh auth login` if needed.
          </p>
        </div>
      )}
    </div>
  );
}
