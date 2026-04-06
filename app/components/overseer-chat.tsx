"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { sendNotification } from "@/lib/notify";

// SpeechRecognition types for browser API
interface SpeechRecognitionEvent {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

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
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const historyLoaded = useRef(false);

  // Load today's conversation history on mount
  useEffect(() => {
    if (historyLoaded.current) return;
    historyLoaded.current = true;
    fetch("/api/overseer/history")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setMessages(
            data.map((m: { role: string; content: string }) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }))
          );
        }
      })
      .catch(() => {
        // History load failed — start fresh
      });
  }, []);

  const hasSpeechSupport =
    typeof window !== "undefined" &&
    (!!window.SpeechRecognition || !!window.webkitSpeechRecognition);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!hasSpeechSupport) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => (prev ? prev + " " + transcript : transcript));
      setListening(false);
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [hasSpeechSupport]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

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

      // Persist the new messages to history
      fetch("/api/overseer/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: userMessage.content }),
      }).catch(() => {});
      fetch("/api/overseer/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: assistantContent }),
      }).catch(() => {});

      // Try to extract dispatch actions from the response
      const actions = extractActions(assistantContent);
      if (actions.length > 0) {
        // Check if auto-dispatch is safe (all continue mode)
        const autoEnabled =
          typeof window !== "undefined" &&
          localStorage.getItem("cascade-auto-dispatch") === "true";
        const allSafeContinue = actions.every(
          (a) => a.action === "continue"
        );

        if (autoEnabled && allSafeContinue) {
          // Auto-execute without user approval
          autoExecuteActions(actions);
        } else {
          setPendingActions(actions);
        }
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
        }).catch(() => {
          // Reminder save failed silently — non-critical
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

  async function autoExecuteActions(actions: ParsedAction[]) {
    const allResults: unknown[] = [];
    for (const action of actions) {
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
    sendNotification(
      `Delamain auto-dispatched ${actions.length} project${actions.length > 1 ? "s" : ""} (continue)`,
      { body: actions.map((a) => a.project).join(", "), tag: "auto-dispatch" }
    );

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: `Auto-dispatched ${actions.length} projects in continue mode. Check the dispatch report above.`,
      },
    ]);
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan pulse-healthy" />
            <span className="text-xs font-mono text-cyan uppercase tracking-wider font-bold">
              Delamain — Sprint Planning
            </span>
          </div>
          {hasSpeechSupport && (
            <button
              onClick={() => {
                if (voiceEnabled && listening) stopListening();
                setVoiceEnabled(!voiceEnabled);
              }}
              className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono uppercase border transition-colors ${
                voiceEnabled
                  ? "border-cyan text-cyan"
                  : "border-space-600 text-space-500 hover:text-text"
              }`}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
              </svg>
              {voiceEnabled ? "Voice On" : "Voice"}
            </button>
          )}
        </div>
        <p className="text-[10px] font-mono text-space-500 mt-0.5">
          {voiceEnabled
            ? "Voice mode active — click the mic to speak"
            : "Tell me what you want done today. I\u2019ll create the dispatch plan."}
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
        {voiceEnabled && (
          <button
            onClick={listening ? stopListening : startListening}
            disabled={streaming}
            className={`px-3 flex items-center justify-center border-r border-space-600 transition-colors ${
              listening
                ? "text-danger bg-danger/10 pulse-blocked"
                : "text-cyan hover:bg-cyan/10"
            }`}
            title={listening ? "Stop recording" : "Start recording"}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
          </button>
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder={
            listening
              ? "Listening..."
              : voiceEnabled
                ? "Speak or type..."
                : "What should we work on today?"
          }
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
