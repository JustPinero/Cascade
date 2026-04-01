import type { WizardState } from "./wizard-shell";

interface NameStepProps {
  state: WizardState;
  onChange: (updates: Partial<WizardState>) => void;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const projectTypes = [
  { value: "web-app", label: "Web App" },
  { value: "api", label: "API" },
  { value: "game", label: "Game" },
  { value: "mobile", label: "Mobile" },
  { value: "other", label: "Other" },
];

export function NameStep({ state, onChange }: NameStepProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold font-mono text-text-bright">
        Project Identity
      </h2>

      <div>
        <label className="block text-xs font-mono text-text mb-2 uppercase tracking-wider">
          Project Name
        </label>
        <input
          type="text"
          value={state.projectName}
          onChange={(e) => onChange({ projectName: e.target.value })}
          placeholder="My Awesome Project"
          className="w-full max-w-md px-3 py-2 text-sm font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none"
        />
        {state.projectName && (
          <p className="text-xs font-mono text-space-500 mt-1">
            slug: {toSlug(state.projectName)}
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-mono text-text mb-2 uppercase tracking-wider">
          Project Type
        </label>
        <div className="flex gap-2">
          {projectTypes.map((type) => (
            <button
              key={type.value}
              onClick={() => onChange({ projectType: type.value })}
              className={`px-3 py-1.5 text-xs font-mono border transition-colors ${
                state.projectType === type.value
                  ? "border-cyan text-cyan bg-cyan/8"
                  : "border-space-600 text-space-500 hover:text-text hover:border-space-500"
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
