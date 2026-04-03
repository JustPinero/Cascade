"use client";

import { useEffect, useState } from "react";
import type { WizardState } from "./wizard-shell";

interface Template {
  id: number;
  name: string;
  description: string;
  content: string;
  projectType: string;
  isDefault: boolean;
}

interface TemplateStepProps {
  state: WizardState;
  onChange: (updates: Partial<WizardState>) => void;
}

export function TemplateStep({ state, onChange }: TemplateStepProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        setTemplates(data);
        if (!state.templateId) {
          const def = data.find((t: Template) => t.isDefault);
          if (def) {
            onChange({ templateId: def.id, templateContent: def.content });
          }
        }
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTemplate(t: Template) {
    onChange({ templateId: t.id, templateContent: t.content });
    setPreview(null);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold font-mono text-text-bright">
        Select Template
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTemplate(t)}
            className={`p-3 text-left border transition-colors ${
              state.templateId === t.id
                ? "border-cyan bg-cyan/8"
                : "border-space-600 hover:border-space-500"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-mono font-bold text-text-bright">
                {t.name}
              </span>
              {t.isDefault && (
                <span className="text-[10px] font-mono text-cyan border border-cyan/40 px-1">
                  DEFAULT
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-space-500">{t.description}</p>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setPreview(preview === t.content ? null : t.content);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  setPreview(preview === t.content ? null : t.content);
                }
              }}
              className="text-[10px] font-mono text-info mt-2 hover:text-cyan cursor-pointer inline-block"
            >
              {preview === t.content ? "Hide preview" : "Preview"}
            </span>
          </button>
        ))}
      </div>

      {preview && (
        <pre className="p-3 bg-space-900 border border-space-600 text-xs font-mono text-text max-h-48 overflow-auto whitespace-pre-wrap">
          {preview}
        </pre>
      )}
    </div>
  );
}
