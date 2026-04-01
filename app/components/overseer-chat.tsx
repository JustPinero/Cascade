"use client";

import { useState, useRef, useEffect } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ParsedAction {
  project: string;
  action: string;
  prompt: string;
}

interface OverseerChatProps {
  onDispatch: (results: unknown[]) => void;
}

export function OverseerChat({ onDispatch }: OverseerChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingActions, setPendingActions] = useState<ParsedAction[] | null>(
    null
  );
  const [dispatching, setDispatching] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, pendingActions]);

  async function sendMessage() {
    if (!input.trim() || streaming) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);
    setPendingActions(null);

    try {
      const res = await fetch("/api/overseer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages([
          ...newMessages,
          { role: "assistant", content: `Error: ${err.error}` },
        ]);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      let assistantContent = "";
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta") {
                assistantContent += parsed.delta?.text || "";
                setMessages([
                  ...newMessages,
                  { role: "assistant", content: assistantContent },
                ]);
              }
            } catch {
              // skip
            }
          }
        }
      }

      const finalMessages: ChatMessage[] = [
        ...newMessages,
        { role: "assistant", content: assistantContent },
      ];
      setMessages(finalMessages);

      // Try to extract dispatch actions from the response
      const actions = extractActions(assistantContent);
      if (actions.length > 0) {
        setPendingActions(actions);
      }

      // Save any reminders Delamain created
      const reminderRegex =
        /\[REMINDER\]\s*([\w-]+):([\w-:]+)\s*(?:—|-)\s*(.+)/gi;
      let rMatch;
      while ((rMatch = reminderRegex.exec(assistantContent)) !== null) {
        fetch("/api/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conditionType: rMatch[1],
            conditionValue: rMatch[2],
            message: rMatch[3].trim(),
            projectSlug: rMatch[2].split(":")[0] || null,
            createdBy: "delamain",
          }),
        });
      }
    } catch {
      setMessages([
        ...newMessages,
        { role: "assistant", content: "Failed to connect to Delamain." },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  function extractActions(content: string): ParsedAction[] {
    const actions: ParsedAction[] = [];
    // Look for [DISPATCH] markers in the response
    const regex =
      /\[DISPATCH\]\s*(\S+)\s*:\s*(continue|audit|investigate|custom)\s*(?:—|-)?\s*(.*)/gi;
    let match;
    while ((match = regex.exec(content)) !== null) {
      actions.push({
        project: match[1],
        action: match[2],
        prompt: match[3]?.trim() || "",
      });
    }
    return actions;
  }

  async function executeActions() {
    if (!pendingActions) return;
    setDispatching(true);

    const allResults: unknown[] = [];

    for (const action of pendingActions) {
      try {
        const res = await fetch(`/api/projects/${action.project}/dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: action.action,
            prompt: action.prompt || undefined,
          }),
        });
        const data = await res.json();
        allResults.push({ ...data, projectSlug: action.project });
      } catch {
        allResults.push({
          success: false,
          projectSlug: action.project,
          error: "Failed to dispatch",
        });
      }
    }

    onDispatch(allResults);
    setPendingActions(null);
    setDispatching(false);

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: `Dispatched ${allResults.length} projects. Check the dispatch report above.`,
      },
    ]);
  }

  return (
    <div className="border border-cyan/20 bg-space-900">
      {/* Header */}
      <div className="px-4 py-2 border-b border-space-600 bg-space-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan pulse-healthy" />
          <span className="text-xs font-mono text-cyan uppercase tracking-wider font-bold">
            Delamain — Sprint Planning
          </span>
        </div>
        <p className="text-[10px] font-mono text-space-500 mt-0.5">
          Tell me what you want done today. I&apos;ll create the dispatch plan.
        </p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="h-56 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs font-mono text-space-500">
              Describe your priorities for today. Examples:
            </p>
            <div className="space-y-1">
              {[
                "Finish the auth system on ratracer and run audits on everything else",
                "Fix the deploy on pointpartner, it's been broken since yesterday",
                "Run a full audit on all projects and tell me what needs attention",
                "Focus on sitelift and medipal today, everything else can wait",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s);
                    inputRef.current?.focus();
                  }}
                  className="block text-[10px] font-mono text-info hover:text-cyan transition-colors text-left"
                >
                  &quot;{s}&quot;
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-xs font-mono ${
              msg.role === "user"
                ? "text-cyan pl-3 border-l-2 border-cyan/30"
                : "text-text pl-3 border-l-2 border-accent/30"
            }`}
          >
            <span className="text-[10px] uppercase text-space-500 block mb-0.5">
              {msg.role === "user" ? "you" : "delamain"}
            </span>
            <div className="whitespace-pre-wrap leading-relaxed">
              {msg.content}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="text-xs font-mono text-accent pulse-healthy">
            Delamain is thinking...
          </div>
        )}
      </div>

      {/* Pending Actions */}
      {pendingActions && pendingActions.length > 0 && (
        <div className="mx-3 mb-3 p-2 border border-success/30 bg-success/5">
          <p className="text-[10px] font-mono text-success mb-2">
            Ready to dispatch {pendingActions.length} project
            {pendingActions.length > 1 ? "s" : ""}:
          </p>
          {pendingActions.map((a, i) => (
            <p key={i} className="text-[10px] font-mono text-text">
              {a.project} → {a.action}
              {a.prompt ? `: ${a.prompt.slice(0, 60)}` : ""}
            </p>
          ))}
          <button
            onClick={executeActions}
            disabled={dispatching}
            className="mt-2 px-3 py-1 text-[10px] font-mono border border-success text-success hover:bg-success/10 disabled:opacity-50 transition-colors"
          >
            {dispatching ? "Dispatching..." : "Execute Sprint"}
          </button>
        </div>
      )}

      {/* Input */}
      <div className="flex border-t border-space-600">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="What should we work on today?"
          disabled={streaming}
          className="flex-1 px-3 py-2.5 text-sm font-mono bg-transparent text-text-bright placeholder:text-space-500 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={streaming || !input.trim()}
          className="px-4 text-sm font-mono text-cyan hover:bg-cyan/10 disabled:opacity-30 transition-colors border-l border-space-600"
        >
          Send
        </button>
      </div>
    </div>
  );
}
