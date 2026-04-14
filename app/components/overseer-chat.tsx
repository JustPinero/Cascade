"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { sendNotification } from "@/lib/notify";
import { playStartSound, playEndSound } from "@/lib/sounds";

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
  fullPage?: boolean;
}

export function OverseerChat({ onDispatch, fullPage = false }: OverseerChatProps) {
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

  const [hasSpeechSupport, setHasSpeechSupport] = useState(false);

  useEffect(() => {
    setHasSpeechSupport(
      typeof window !== "undefined" &&
        (!!window.SpeechRecognition || !!window.webkitSpeechRecognition)
    );
  }, []);

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
    playStartSound();
    setPendingActions(null);

    try {
      const res = await fetch("/api/overseer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send only the last 10 messages to avoid bloating context.
        // Del's system prompt already has full project state.
        body: JSON.stringify({ messages: newMessages.slice(-10) }),
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

      // Save any messages Delamain wants to send to Kilroy
      const kilroyRegex = /\[KILROY\]\s*(.+)/gi;
      let kMatch;
      while ((kMatch = kilroyRegex.exec(assistantContent)) !== null) {
        fetch("/api/kilroy-channel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "delamain",
            message: kMatch[1].trim(),
          }),
        }).catch(() => {});
      }
    } catch {
      setMessages([
        ...newMessages,
        { role: "assistant", content: "Failed to connect to Delamain." },
      ]);
    } finally {
      setStreaming(false);
      playEndSound();
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

  /**
   * Dispatch actions — single project uses direct Terminal,
   * multiple projects use tmux grid via /api/dispatch/batch.
   */
  async function dispatchActions(
    actions: ParsedAction[]
  ): Promise<unknown[]> {
    if (actions.length === 1) {
      try {
        const res = await fetch(
          `/api/projects/${actions[0].project}/dispatch`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: actions[0].action,
              prompt: actions[0].prompt || undefined,
            }),
          }
        );
        const data = await res.json();
        return [{ ...data, projectSlug: actions[0].project }];
      } catch {
        return [
          {
            success: false,
            projectSlug: actions[0].project,
            error: "Failed",
          },
        ];
      }
    }

    // Multiple projects — agent team dispatch (lead coordinates teammates)
    try {
      const res = await fetch("/api/dispatch/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: actions.map((a) => ({
            slug: a.project,
            mode: a.action,
            prompt: a.prompt || undefined,
          })),
        }),
      });
      const data = await res.json();
      return data.results || [data];
    } catch {
      return actions.map((a) => ({
        success: false,
        projectSlug: a.project,
        error: "Failed to dispatch batch",
      }));
    }
  }

  async function autoExecuteActions(actions: ParsedAction[]) {
    const allResults = await dispatchActions(actions);

    onDispatch(allResults);
    sendNotification(
      `Delamain auto-dispatched ${actions.length} project${actions.length > 1 ? "s" : ""} (continue)`,
      {
        body: actions.map((a) => a.project).join(", "),
        tag: "auto-dispatch",
      }
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

    const allResults = await dispatchActions(pendingActions);

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
    <div className={`border border-cyan/20 bg-space-900 ${fullPage ? "flex flex-col h-full" : ""}`}>
      {/* RPG Portrait — full page only */}
      {fullPage && (
        <div className="flex items-center gap-4 px-6 py-4 border-b border-space-600 bg-space-800/80">
          <div className="relative">
            <div
              className={`w-32 h-32 rounded border-2 overflow-hidden transition-all duration-300 ${
                streaming
                  ? "border-cyan shadow-[0_0_16px_rgba(65,166,181,0.5)] delamain-talking"
                  : "border-space-600 shadow-[0_0_4px_rgba(65,166,181,0.1)]"
              }`}
            >
              <img
                src={streaming ? "/delamain-talking.jpg" : "/delamain.jpg"}
                alt="Delamain"
                className={`w-full h-full object-cover transition-all duration-300 ${
                  streaming ? "brightness-125" : "brightness-90"
                }`}
              />
            </div>
            {streaming && (
              <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-cyan pulse-healthy" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-bold font-mono text-cyan uppercase tracking-[0.15em]">
              Delamain
            </h2>
            <p className="text-[10px] font-mono text-space-500 uppercase tracking-wider">
              {streaming ? "Responding..." : "Fleet Dispatcher — Sprint Planning"}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-4 py-2 border-b border-space-600 bg-space-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="/delamain.jpg"
              alt="Delamain"
              className="w-5 h-5 rounded-full ring-1 ring-cyan/40"
            />
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
      <div ref={scrollRef} className={`${fullPage ? "flex-1" : "h-56"} overflow-y-auto ${fullPage ? "p-6 space-y-4" : "p-3 space-y-3"}`}>
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
            className={`${fullPage ? "text-sm" : "text-xs"} font-mono ${
              msg.role === "user"
                ? `text-cyan ${fullPage ? "pl-4" : "pl-3"} border-l-2 border-cyan/30`
                : `text-text ${fullPage ? "pl-4" : "pl-3"} border-l-2 border-accent/30`
            }`}
          >
            <span className={`${fullPage ? "text-xs" : "text-[10px]"} uppercase text-space-500 block mb-0.5`}>
              {msg.role === "user" ? "you" : "delamain"}
            </span>
            <div className={`whitespace-pre-wrap ${fullPage ? "leading-7" : "leading-relaxed"}`}>
              {msg.content}
            </div>
          </div>
        ))}
        {streaming && (
          <div className={`${fullPage ? "text-sm" : "text-xs"} font-mono text-accent pulse-healthy`}>
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
          className={`flex-1 ${fullPage ? "px-4 py-3.5 text-base" : "px-3 py-2.5 text-sm"} font-mono bg-transparent text-text-bright placeholder:text-space-500 focus:outline-none disabled:opacity-50`}
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
