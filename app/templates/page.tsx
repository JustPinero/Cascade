"use client";

import { useCallback, useEffect, useState } from "react";

interface Template {
  id: number;
  name: string;
  description: string;
  content: string;
  projectType: string;
  isDefault: boolean;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    content: "",
    projectType: "web-app",
  });

  const fetchTemplates = useCallback(async () => {
    const res = await fetch("/api/templates");
    const data = await res.json();
    if (Array.isArray(data)) setTemplates(data);
  }, []);

  useEffect(() => {
    fetchTemplates();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setCreating(false);
    setForm({ name: "", description: "", content: "", projectType: "web-app" });
    fetchTemplates();
  }

  async function handleUpdate() {
    if (!editing) return;
    await fetch("/api/templates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editing.id, ...form }),
    });
    setEditing(null);
    fetchTemplates();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this template?")) return;
    await fetch("/api/templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchTemplates();
  }

  async function handleSetDefault(id: number) {
    await fetch("/api/templates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isDefault: true }),
    });
    fetchTemplates();
  }

  function startEdit(t: Template) {
    setEditing(t);
    setForm({
      name: t.name,
      description: t.description,
      content: t.content,
      projectType: t.projectType,
    });
  }

  const isFormOpen = creating || editing;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase">
            Templates
          </h1>
          <p className="text-sm text-text font-mono mt-1">
            Manage kickoff templates
          </p>
        </div>
        {!isFormOpen && (
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 text-sm font-mono border border-cyan text-cyan hover:bg-cyan/10 transition-colors"
          >
            New Template
          </button>
        )}
      </div>

      {/* Editor */}
      {isFormOpen && (
        <div className="mb-6 p-4 border border-space-600 bg-space-800 space-y-4">
          <h2 className="text-sm font-mono font-bold text-text-bright">
            {editing ? "Edit Template" : "New Template"}
          </h2>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Template name"
            className="w-full px-3 py-2 text-sm font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none"
          />
          <input
            type="text"
            value={form.description}
            onChange={(e) =>
              setForm({ ...form, description: e.target.value })
            }
            placeholder="Description"
            className="w-full px-3 py-2 text-sm font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none"
          />
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="Template content (markdown)"
            className="w-full h-64 px-3 py-2 text-xs font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={editing ? handleUpdate : handleCreate}
              disabled={!form.name || !form.content}
              className="px-4 py-2 text-sm font-mono border border-cyan text-cyan hover:bg-cyan/10 disabled:opacity-50 transition-colors"
            >
              {editing ? "Save" : "Create"}
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setCreating(false);
              }}
              className="px-4 py-2 text-sm font-mono border border-space-600 text-space-500 hover:text-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Template list */}
      <div className="space-y-3">
        {templates.map((t) => (
          <div
            key={t.id}
            className="p-4 border border-space-600 bg-space-800 hover:border-space-500 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-bold text-text-bright">
                  {t.name}
                </span>
                {t.isDefault && (
                  <span className="text-[10px] font-mono text-cyan border border-cyan/40 px-1">
                    DEFAULT
                  </span>
                )}
                <span className="text-[10px] font-mono text-space-500 border border-space-600 px-1">
                  {t.projectType}
                </span>
              </div>
              <div className="flex gap-2">
                {!t.isDefault && (
                  <button
                    onClick={() => handleSetDefault(t.id)}
                    className="text-[10px] font-mono text-info hover:text-cyan"
                  >
                    Set default
                  </button>
                )}
                <button
                  onClick={() => startEdit(t)}
                  className="text-[10px] font-mono text-text hover:text-cyan"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="text-[10px] font-mono text-danger hover:text-danger/80"
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="text-xs font-mono text-space-500">{t.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
