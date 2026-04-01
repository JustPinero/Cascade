"use client";

import { useState, type ReactNode } from "react";
import { StepIndicator } from "./step-indicator";

export interface WizardState {
  // Step 1: Name & Type
  projectName: string;
  projectType: string;
  // Step 2: GitHub
  createGithubRepo: boolean;
  isPrivate: boolean;
  // Step 3: Template
  templateId: number | null;
  templateContent: string;
  // Step 4: Config
  autonomyMode: string;
  prWorkflowEnabled: boolean;
  agentTeamsEnabled: boolean;
  // Step 5: Claude conversation
  chatMessages: { role: string; content: string }[];
  // Step 6: Review
  kickoffContent: string;
}

const initialState: WizardState = {
  projectName: "",
  projectType: "web-app",
  createGithubRepo: true,
  isPrivate: true,
  templateId: null,
  templateContent: "",
  autonomyMode: "semi",
  prWorkflowEnabled: false,
  agentTeamsEnabled: false,
  chatMessages: [],
  kickoffContent: "",
};

const STEP_LABELS = [
  "Name",
  "GitHub",
  "Template",
  "Config",
  "Claude",
  "Review",
  "Launch",
];

interface WizardShellProps {
  steps: ((props: {
    state: WizardState;
    onChange: (updates: Partial<WizardState>) => void;
  }) => ReactNode)[];
  onLaunch: (state: WizardState) => Promise<void>;
}

export function WizardShell({ steps, onLaunch }: WizardShellProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [launching, setLaunching] = useState(false);

  function handleChange(updates: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...updates }));
  }

  function canProceed(): boolean {
    switch (currentStep) {
      case 0:
        return state.projectName.trim().length > 0;
      case 1:
        return true; // GitHub is optional
      case 2:
        return state.templateContent.length > 0;
      case 3:
        return true; // Config has defaults
      case 4:
        return true; // Claude chat is optional
      case 5:
        return state.kickoffContent.length > 0;
      default:
        return true;
    }
  }

  async function handleNext() {
    if (currentStep === steps.length - 1) {
      setLaunching(true);
      try {
        await onLaunch(state);
      } finally {
        setLaunching(false);
      }
      return;
    }
    setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function handleBack() {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  const isLastStep = currentStep === steps.length - 1;

  return (
    <div>
      <StepIndicator steps={STEP_LABELS} currentStep={currentStep} />

      <div className="min-h-[400px] p-6 border border-space-600 bg-space-800 mb-4">
        {steps[currentStep]({ state, onChange: handleChange })}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          disabled={currentStep === 0}
          className={`px-4 py-2 text-sm font-mono border transition-colors ${
            currentStep === 0
              ? "border-space-600 text-space-500 cursor-not-allowed"
              : "border-space-500 text-text hover:text-text-bright hover:border-text"
          }`}
        >
          Back
        </button>

        <span className="text-xs font-mono text-space-500">
          Step {currentStep + 1} of {steps.length}
        </span>

        <button
          onClick={handleNext}
          disabled={!canProceed() || launching}
          className={`px-4 py-2 text-sm font-mono border transition-all ${
            !canProceed() || launching
              ? "border-space-600 text-space-500 cursor-not-allowed"
              : isLastStep
                ? "border-success text-success hover:bg-success/10"
                : "border-cyan text-cyan hover:bg-cyan/10"
          }`}
        >
          {launching ? "Launching..." : isLastStep ? "Launch" : "Next"}
        </button>
      </div>
    </div>
  );
}
