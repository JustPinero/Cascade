"use client";

import { useState, useRef, useEffect } from "react";
import type { WizardState } from "./wizard-shell";
import { extractKickoff } from "@/lib/wizard-prompt";

interface ClaudeChatStepProps {
  state: WizardState;
  onChange: (updates: Partial<WizardState>) => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function ClaudeChatStep({ state, onChange }: ClaudeChatStepProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    (state.chatMessages as ChatMessage[]) || []
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || streaming) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    try {
      const res = await fetch("/api/wizard/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          templateContent: state.templateContent,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages([
          ...newMessages,
          { role: "assistant", content: `Error: ${err.error}` },
        ]);
        return;
      }

      // Handle SSE stream
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

      const finalMessages = [
        ...newMessages,
        { role: "assistant" as const, content: assistantContent },
      ];
      setMessages(finalMessages);
      onChange({ chatMessages: finalMessages });

      // Check if kickoff was generated
      const kickoff = extractKickoff(assistantContent);
      if (kickoff) {
        onChange({ kickoffContent: kickoff });
      }
    } catch {
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: "Failed to connect to Claude. Check your API key.",
        },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold font-mono text-text-bright">
        Chat with Claude
      </h2>
      <p className="text-xs font-mono text-space-500">
        Describe your project. Claude will interview you and generate a kickoff
        prompt.
      </p>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="h-64 overflow-y-auto border border-space-600 bg-space-900 p-3 space-y-3"
      >
        {messages.length === 0 && (
          <p className="text-xs font-mono text-space-500">
            Start by describing what you want to build...
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-xs font-mono ${
              msg.role === "user"
                ? "text-cyan pl-4 border-l border-cyan/30"
                : "text-text pl-4 border-l border-accent/30"
            }`}
          >
            <span className="text-[10px] uppercase text-space-500 block mb-0.5">
              {msg.role === "user" ? "you" : "claude"}
            </span>
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </div>
        ))}
        {streaming && (
          <div className="text-xs font-mono text-accent animate-pulse">
            Claude is thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Describe your project..."
          disabled={streaming}
          className="flex-1 px-3 py-2 text-sm font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={streaming || !input.trim()}
          className="px-4 py-2 text-sm font-mono border border-cyan text-cyan hover:bg-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>

      {state.kickoffContent && (
        <div className="p-2 border border-success/40 bg-success/5 text-xs font-mono text-success">
          Kickoff prompt generated! Proceed to Review step.
        </div>
      )}
    </div>
  );
}
