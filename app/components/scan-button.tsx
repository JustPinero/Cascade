"use client";

import { useState } from "react";

interface ScanButtonProps {
  onScanComplete: () => void;
}

export function ScanButton({ onScanComplete }: ScanButtonProps) {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleScan() {
    setScanning(true);
    setResult(null);
    try {
      const res = await fetch("/api/projects/scan", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResult(`Scanned ${data.total} projects: ${data.created} new, ${data.updated} updated`);
        onScanComplete();
      } else {
        setResult(`Error: ${data.error}`);
      }
    } catch {
      setResult("Failed to connect to scan endpoint");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={handleScan}
        disabled={scanning}
        className={`
          px-4 py-2 text-sm font-mono uppercase tracking-wider
          border transition-all duration-150
          ${
            scanning
              ? "border-space-500 text-space-500 cursor-wait"
              : "border-cyan text-cyan hover:bg-cyan/10 hover:shadow-[0_0_12px_rgba(65,166,181,0.15)]"
          }
        `}
      >
        {scanning ? "Scanning..." : "Scan Projects"}
      </button>
      {result && (
        <span className="text-xs font-mono text-text">{result}</span>
      )}
    </div>
  );
}
