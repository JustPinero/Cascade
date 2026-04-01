"use client";

import { useRouter } from "next/navigation";
import { WizardShell, type WizardState } from "../components/wizard/wizard-shell";
import { NameStep } from "../components/wizard/name-step";
import { GithubStep } from "../components/wizard/github-step";
import { TemplateStep } from "../components/wizard/template-step";
import { ConfigStep } from "../components/wizard/config-step";
import { ClaudeChatStep } from "../components/wizard/claude-chat-step";
import { ReviewStep } from "../components/wizard/review-step";
import { LaunchStep } from "../components/wizard/launch-step";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function CreateProjectPage() {
  const router = useRouter();

  async function handleLaunch(state: WizardState) {
    const res = await fetch("/api/projects/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: state.projectName,
        slug: toSlug(state.projectName),
        projectType: state.projectType,
        kickoffContent: state.kickoffContent,
        createGithubRepo: state.createGithubRepo,
        isPrivate: state.isPrivate,
        autonomyMode: state.autonomyMode,
        agentTeamsEnabled: state.agentTeamsEnabled,
        prWorkflowEnabled: state.prWorkflowEnabled,
      }),
    });

    if (res.ok) {
      router.push("/");
    } else {
      const err = await res.json();
      alert(`Launch failed: ${err.error}`);
    }
  }

  const steps = [
    (props: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) => (
      <NameStep {...props} />
    ),
    (props: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) => (
      <GithubStep {...props} />
    ),
    (props: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) => (
      <TemplateStep {...props} />
    ),
    (props: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) => (
      <ConfigStep {...props} />
    ),
    (props: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) => (
      <ClaudeChatStep {...props} />
    ),
    (props: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) => (
      <ReviewStep {...props} />
    ),
    (props: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) => (
      <LaunchStep {...props} />
    ),
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase mb-6">
        Create Project
      </h1>
      <WizardShell steps={steps} onLaunch={handleLaunch} />
    </div>
  );
}
