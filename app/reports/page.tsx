"use client";

import { useCallback, useEffect, useState } from "react";

interface Project {
  slug: string;
  name: string;
}

export default function ReportsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [reportType, setReportType] = useState<"single" | "cross-project">(
    "single"
  );
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const fetchProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    const data = await res.json();
    if (Array.isArray(data)) setProjects(data);
  }, []);

  useEffect(() => {
    fetchProjects();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    setMarkdown(null);
    try {
      const body =
        reportType === "single"
          ? { type: "single", slug: selectedSlug }
          : { type: "cross-project" };

      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.markdown) {
        setMarkdown(data.markdown);
      } else if (data.error) {
        setMarkdown(`Error: ${data.error}`);
      }
    } finally {
      setGenerating(false);
    }
  }

  function handleDownloadMd() {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      reportType === "single"
        ? `report-${selectedSlug}.md`
        : "cross-project-report.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadPdf() {
    const body =
      reportType === "single"
        ? { type: "single", slug: selectedSlug, format: "pdf" }
        : { type: "cross-project", format: "pdf" };

    const res = await fetch("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) return;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      reportType === "single"
        ? `report-${selectedSlug}.pdf`
        : "cross-project-report.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase mb-6">
        Reports
      </h1>

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-xs font-mono text-text mb-1 uppercase tracking-wider">
            Report Type
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setReportType("single")}
              className={`px-3 py-1.5 text-xs font-mono border transition-colors ${
                reportType === "single"
                  ? "border-cyan text-cyan bg-cyan/8"
                  : "border-space-600 text-space-500 hover:text-text"
              }`}
            >
              Single Project
            </button>
            <button
              onClick={() => setReportType("cross-project")}
              className={`px-3 py-1.5 text-xs font-mono border transition-colors ${
                reportType === "cross-project"
                  ? "border-cyan text-cyan bg-cyan/8"
                  : "border-space-600 text-space-500 hover:text-text"
              }`}
            >
              Cross-Project
            </button>
          </div>
        </div>

        {reportType === "single" && (
          <div>
            <label className="block text-xs font-mono text-text mb-1 uppercase tracking-wider">
              Project
            </label>
            <select
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono bg-space-800 border border-space-600 text-text-bright focus:border-cyan focus:outline-none"
            >
              <option value="">Select project...</option>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={
            generating ||
            (reportType === "single" && !selectedSlug)
          }
          className="px-4 py-1.5 text-xs font-mono border border-cyan text-cyan hover:bg-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {generating ? "Generating..." : "Generate Report"}
        </button>
      </div>

      {markdown && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-space-500">
              Report generated
            </span>
            <div className="flex gap-3">
              <button
                onClick={handleDownloadMd}
                className="text-xs font-mono text-cyan hover:text-text-bright transition-colors"
              >
                Download .md
              </button>
              <button
                onClick={handleDownloadPdf}
                className="text-xs font-mono text-accent hover:text-text-bright transition-colors"
              >
                Download .pdf
              </button>
            </div>
          </div>
          <pre className="p-4 border border-space-600 bg-space-900 text-xs font-mono text-text max-h-[600px] overflow-auto whitespace-pre-wrap">
            {markdown}
          </pre>
        </div>
      )}
    </div>
  );
}
