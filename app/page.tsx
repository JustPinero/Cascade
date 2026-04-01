"use client";

import { useState } from "react";
import { ScanButton } from "./components/scan-button";
import { ProjectList } from "./components/project-list";

export default function DashboardPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase">
            Dashboard
          </h1>
          <p className="text-sm text-text font-mono mt-1">
            Project monitoring and health overview
          </p>
        </div>
        <ScanButton onScanComplete={() => setRefreshKey((k) => k + 1)} />
      </div>
      <ProjectList refreshKey={refreshKey} />
    </div>
  );
}
