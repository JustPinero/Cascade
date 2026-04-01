export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase mb-2">
        Dashboard
      </h1>
      <p className="text-sm text-text font-mono">
        Project monitoring and health overview
      </p>
      <div className="mt-8 p-6 border border-space-600 bg-space-800 glow-border">
        <p className="text-sm text-text font-mono">
          No projects imported yet. Use the scanner to detect projects in your
          workspace.
        </p>
      </div>
    </div>
  );
}
