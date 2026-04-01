"use client";

import { useState, useRef, useEffect } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface CommandPanelProps {
  projectSlug: string;
  projectName: string;
}

export function CommandPanel({ projectSlug, projectName }: CommandPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  useEffect(() => {
    if (expanded) {
      inputRef.current?.focus();
    }
  }, [expanded]);

  async function sendMessage() {
    if (!input.trim() || streaming) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    try {
      const res = await fetch(`/api/projects/${projectSlug}/chat`, {
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
              // Skip unparseable chunks
            }
          }
        }
      }

      setMessages([
        ...newMessages,
        { role: "assistant", content: assistantContent },
      ]);
    } catch {
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: "Failed to connect. Check your API key.",
        },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full p-3 border border-space-600 bg-space-800 hover:border-cyan/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-cyan font-mono text-sm">&gt;_</span>
          <span className="text-xs font-mono text-text">
            Command Panel — chat with Claude about {projectName}
          </span>
        </div>
      </button>
    );
  }

  return (
    <div className="border border-cyan/30 bg-space-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-space-600 bg-space-800">
        <div className="flex items-center gap-2">
          <span className="text-cyan font-mono text-sm">&gt;_</span>
          <span className="text-xs font-mono text-cyan uppercase tracking-wider">
            {projectName} — Command Panel
          </span>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="text-[10px] font-mono text-space-500 hover:text-danger transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setExpanded(false)}
            className="text-[10px] font-mono text-space-500 hover:text-text transition-colors"
          >
            Minimize
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="h-72 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs font-mono text-space-500">
              Chat with Claude about this project. Claude has full context:
              CLAUDE.md, handoff, debt log, current request, and knowledge base.
            </p>
            <div className="flex flex-wrap gap-1">
              {[
                "What's the current status?",
                "What should I work on next?",
                "Are there any blockers?",
                "Review the recent changes",
                "What debt needs addressing?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="text-[10px] font-mono px-2 py-1 border border-space-600 text-info hover:border-info/40 hover:text-cyan transition-colors"
                >
                  {suggestion}
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
              {msg.role === "user" ? "you" : "claude"}
            </span>
            <div className="whitespace-pre-wrap leading-relaxed">
              {msg.content}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="text-xs font-mono text-accent pulse-healthy">
            Claude is thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex border-t border-space-600">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Ask Claude about this project..."
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
