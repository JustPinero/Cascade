"use client";

import { useState } from "react";
import { OverseerChat } from "../components/overseer-chat";
import { DispatchResults } from "../components/dispatch-results";

interface DispatchResultData {
  success: boolean;
  projectName: string;
  projectSlug: string;
  mode: string;
  prompt: string;
  ready: boolean;
  readyIssues: string[];
  error: string | null;
}

export default function DelamainPage() {
  const [dispatchResults, setDispatchResults] = useState<DispatchResultData[]>(
    []
  );

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col animate-fade-in">
      {dispatchResults.length > 0 && (
        <div className="mb-4">
          <DispatchResults
            results={dispatchResults}
            onDismiss={() => setDispatchResults([])}
          />
        </div>
      )}
      <div className="flex-1 min-h-0">
        <OverseerChat
          onDispatch={(r) => setDispatchResults(r as DispatchResultData[])}
          fullPage
        />
      </div>
    </div>
  );
}
