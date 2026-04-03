"use client";

import { useCallback, useEffect, useState } from "react";

interface HumanTask {
  id: number;
  title: string;
  category: string;
  priority: string;
  status: string;
  projectSlug: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  project: { name: string; slug: string } | null;
}

const categoryLabels: Record<string, string> = {
  asset: "Asset",
  credential: "Credential",
  testing: "Testing",
  deploy: "Deploy",
  review: "Review",
  external: "External",
  other: "Other",
};

const categoryColors: Record<string, string> = {
  asset: "text-info",
  credential: "text-amber",
  testing: "text-accent",
  deploy: "text-success",
  review: "text-cyan",
  external: "text-text",
  other: "text-space-400",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("other");
  const [newPriority, setNewPriority] = useState("normal");
  const [newProject, setNewProject] = useState("");

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (!showDone) params.set("status", "pending");
      if (filterCategory) params.set("category", filterCategory);
      const res = await fetch(`/api/tasks?${params}`);
      const data = await res.json();
      if (Array.isArray(data)) setTasks(data);
    } finally {
      setLoading(false);
    }
  }, [showDone, filterCategory]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  async function toggleTask(task: HumanTask) {
    const newStatus = task.status === "pending" ? "done" : "pending";
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, status: newStatus }),
    });
    fetchTasks();
  }

  async function deleteTask(id: number) {
    await fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchTasks();
  }

  async function addTask() {
    if (!newTitle.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newTitle.trim(),
        category: newCategory,
        priority: newPriority,
        projectSlug: newProject || undefined,
        createdBy: "user",
      }),
    });
    setNewTitle("");
    setNewPriority("normal");
    setNewCategory("other");
    setNewProject("");
    fetchTasks();
  }

  // Group tasks by project
  const grouped = new Map<string, HumanTask[]>();
  for (const task of tasks) {
    const key = task.project?.name || "General";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(task);
  }

  // Sort: projects with high-priority tasks first
  const sortedGroups = [...grouped.entries()].sort((a, b) => {
    const aHasHigh = a[1].some((t) => t.priority === "high");
    const bHasHigh = b[1].some((t) => t.priority === "high");
    if (aHasHigh && !bHasHigh) return -1;
    if (!aHasHigh && bHasHigh) return 1;
    return a[0].localeCompare(b[0]);
  });

  const pendingCount = tasks.filter((t) => t.status === "pending").length;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase glow-text-cyan">
          My Tasks
        </h1>
        {pendingCount > 0 && (
          <span className="text-sm font-mono text-amber">
            {pendingCount} pending
          </span>
        )}
      </div>
      <p className="text-sm text-text font-mono mb-6">
        Things only you can do — assets, credentials, manual testing, and more
      </p>

      {/* Add Task */}
      <div className="mb-6 p-4 border border-space-600 bg-space-800">
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTask();
            }}
            placeholder="Add a task..."
            className="flex-1 px-3 py-2 text-sm font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none"
          />
          <button
            onClick={addTask}
            disabled={!newTitle.trim()}
            className="px-4 py-2 text-sm font-mono border border-cyan text-cyan hover:bg-cyan/10 disabled:opacity-30 transition-colors"
          >
            Add
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="px-2 py-1 text-xs font-mono bg-space-900 border border-space-600 text-text focus:border-cyan focus:outline-none"
          >
            {Object.entries(categoryLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value)}
            className="px-2 py-1 text-xs font-mono bg-space-900 border border-space-600 text-text focus:border-cyan focus:outline-none"
          >
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <input
            type="text"
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
            placeholder="project slug (optional)"
            className="px-2 py-1 text-xs font-mono bg-space-900 border border-space-600 text-text placeholder:text-space-600 focus:border-cyan focus:outline-none w-48"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setShowDone(!showDone)}
          className={`px-2 py-1 text-[10px] font-mono uppercase border transition-colors ${
            showDone
              ? "border-cyan text-cyan"
              : "border-space-600 text-space-500 hover:text-text"
          }`}
        >
          {showDone ? "Showing all" : "Hide done"}
        </button>
        {[null, "asset", "credential", "testing", "deploy", "review", "external"].map(
          (cat) => (
            <button
              key={cat || "all"}
              onClick={() => setFilterCategory(cat)}
              className={`px-2 py-1 text-[10px] font-mono uppercase border transition-colors ${
                filterCategory === cat
                  ? "border-cyan text-cyan"
                  : "border-space-600 text-space-500 hover:text-text"
              }`}
            >
              {cat || "all"}
            </button>
          )
        )}
      </div>

      {/* Task List */}
      {loading ? (
        <p className="text-sm font-mono text-space-500">Loading...</p>
      ) : tasks.length === 0 ? (
        <div className="p-8 border border-space-600 bg-space-800 text-center">
          <p className="text-sm font-mono text-space-500">
            No tasks yet. Add one above or let Claude sessions create them
            with [HUMAN TODO] tags.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedGroups.map(([projectName, projectTasks]) => (
            <div
              key={projectName}
              className="border border-space-600 bg-space-800"
            >
              <div className="px-4 py-2 border-b border-space-700 bg-space-800/80">
                <span className="text-xs font-mono font-bold text-text-bright uppercase tracking-wider">
                  {projectName}
                </span>
                <span className="text-[10px] font-mono text-space-500 ml-2">
                  {projectTasks.filter((t) => t.status === "pending").length}{" "}
                  pending
                </span>
              </div>
              <div className="divide-y divide-space-700">
                {projectTasks.map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-center gap-3 px-4 py-3 group ${
                      task.status === "done" ? "opacity-50" : ""
                    }`}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleTask(task)}
                      className={`w-5 h-5 border flex-shrink-0 flex items-center justify-center transition-colors ${
                        task.status === "done"
                          ? "border-success bg-success/20 text-success"
                          : "border-space-500 hover:border-cyan"
                      }`}
                    >
                      {task.status === "done" && (
                        <span className="text-xs">&#10003;</span>
                      )}
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <span
                        className={`text-sm font-mono ${
                          task.status === "done"
                            ? "text-space-500 line-through"
                            : "text-text-bright"
                        }`}
                      >
                        {task.title}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={`text-[10px] font-mono ${
                            categoryColors[task.category] || "text-space-400"
                          }`}
                        >
                          {categoryLabels[task.category] || task.category}
                        </span>
                        {task.priority === "high" && (
                          <span className="text-[10px] font-mono text-danger">
                            HIGH
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-space-600">
                          via {task.createdBy}
                        </span>
                      </div>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="text-space-600 hover:text-danger text-xs font-mono opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      del
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
