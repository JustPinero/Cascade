"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { sendNotification } from "@/lib/notify";
import { playStartSound, playEndSound } from "@/lib/sounds";
import { getOverseerSettings } from "@/lib/overseer-settings";
import { extractDispatchActions } from "@/lib/dispatch-tag-parser";
import { localToday } from "@/lib/local-today";
import {
  hasSessionMemory,
  type SessionMemoryState,
} from "@/lib/session-memory";
import { speak as speakText, cancel as cancelSpeech } from "@/lib/speak";
import { setOverseerSettings as persistOverseerSettings } from "@/lib/overseer-settings";

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

// localToday() lives in lib/local-today.ts (Phase 17) so it has unit
// tests against DST transitions and timezone offsets.

/**
 * Phase 20 — strip the bracketed tag formats Delamain emits in text
 * output ([DISPATCH], [REMINDER], [HUMAN TODO], [PLAYBOOK],
 * [ENGINEER]) before passing the response to TTS. Reading "open
 * bracket dispatch close bracket cascade colon continue" out loud
 * is hostile UX. Whole tagged lines are dropped.
 */
function stripTagsForSpeech(text: string): string {
  return text
    .split("\n")
    .filter(
      (line) =>
        !/\[(DISPATCH|REMINDER|HUMAN TODO|PLAYBOOK|ENGINEER)\]/i.test(line)
    )
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

interface OverseerChatProps {
  onDispatch: (results: unknown[]) => void;
  fullPage?: boolean;
}

// Phase 17 — minimum viable wire-up of the session-state endpoint.
// Renders activeFlow + workingMemory.proposedDispatches as a small
// read-only panel below the chat. Doesn't change the existing
// [DISPATCH] tag-parsing flow — just exposes the structured state so
// the developer can see what the model has recorded.
// Types + hasSessionMemory live in lib/session-memory.ts (Phase 18)
// so they're unit-testable without jsdom.

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
  const [sessionMemory, setSessionMemory] = useState<SessionMemoryState | null>(
    null
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const historyLoaded = useRef(false);

  // Phase 17 — refresh session-state. Called on mount and after each
  // chat round-trip so the panel reflects whatever the model just
  // wrote via update_session_memory / propose_dispatch.
  const refreshSessionMemory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/overseer/session-state?sessionDate=${localToday()}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const body = await res.json();
      if (body.exists) {
        setSessionMemory({
          activeFlow: body.activeFlow,
          workingMemory: body.workingMemory ?? {},
        });
      } else {
        setSessionMemory({ activeFlow: null, workingMemory: {} });
      }
    } catch {
      // Best-effort — never break the chat over a session-state fetch.
    }
  }, []);

  useEffect(() => {
    refreshSessionMemory();
  }, [refreshSessionMemory]);

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
  const [overseerName, setOverseerName] = useState("Overseer");
  const [portraitIdle, setPortraitIdle] = useState("/delamain.jpg");
  const [portraitTalking, setPortraitTalking] = useState<string | null>(null);
  // Phase 20 — speech-OUTPUT (TTS) state. Distinct from the
  // existing voiceEnabled, which controls speech INPUT (the mic).
  // Read once on mount; mutated via the chat-header quick toggle
  // and the settings-page Voice panel.
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsVoiceURI, setTtsVoiceURI] = useState<string | null>(null);
  const [ttsRate, setTtsRate] = useState(1.0);
  const [ttsPitch, setTtsPitch] = useState(1.0);

  // Load overseer settings on mount
  useEffect(() => {
    const settings = getOverseerSettings();
    setOverseerName(settings.name);
    setPortraitIdle(settings.portraitIdle);
    setPortraitTalking(settings.portraitTalking);
    setTtsEnabled(settings.voiceEnabled);
    setTtsVoiceURI(settings.voiceURI);
    setTtsRate(settings.voiceRate);
    setTtsPitch(settings.voicePitch);
  }, []);

  // Phase 20 — chat-header quick toggle for speech output. Persists
  // to localStorage so the next session inherits the choice.
  function toggleTts() {
    setTtsEnabled((prev) => {
      const next = !prev;
      persistOverseerSettings({ voiceEnabled: next });
      // If the user mutes mid-utterance, kill it immediately.
      if (!next) cancelSpeech();
      return next;
    });
  }

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
    // Phase 20 — kill any in-flight speech the moment a new turn
    // starts. Stops Delamain mid-sentence if the user types over them.
    cancelSpeech();

    try {
      const res = await fetch("/api/overseer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send only the last 10 messages to avoid bloating context.
        // Del's system prompt already has full project state.
        // sessionDate (Phase 14.1/15) is the user's local YYYY-MM-DD —
        // server uses it to bind the right ChatSession instead of
        // bucketing by server UTC, which would cross-cut sessions at
        // midnight UTC for non-UTC users.
        body: JSON.stringify({
          messages: newMessages.slice(-10),
          sessionDate: localToday(),
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

      // Phase 20 — speak the assistant response if TTS is enabled.
      // Strip [DISPATCH] / [HUMAN TODO] / etc tags before speaking so
      // we don't read raw markup. Best-effort; speak() is a no-op
      // when disabled or when speechSynthesis is unavailable.
      if (ttsEnabled && assistantContent) {
        const spoken = stripTagsForSpeech(assistantContent);
        if (spoken) {
          speakText(spoken, {
            voiceEnabled: true,
            voiceURI: ttsVoiceURI,
            voiceRate: ttsRate,
            voicePitch: ttsPitch,
          });
        }
      }

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

      // Save any messages the Overseer wants to send to the Engineer
      const engineerRegex = /\[(?:ENGINEER|KILROY)\]\s*(.+)/gi;
      let kMatch;
      while ((kMatch = engineerRegex.exec(assistantContent)) !== null) {
        fetch("/api/engineer-channel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "overseer",
            message: kMatch[1].trim(),
          }),
        }).catch(() => {});
      }
    } catch {
      setMessages([
        ...newMessages,
        { role: "assistant", content: `Failed to connect to ${overseerName}.` },
      ]);
    } finally {
      setStreaming(false);
      playEndSound();
      // Phase 17 — refresh the session-memory panel after each turn
      // so update_session_memory / propose_dispatch results show up.
      refreshSessionMemory();
    }
  }

  // Phase 14.6 — extracted to lib/dispatch-tag-parser.ts so a unit
  // test can verify the SP-documented format and this regex agree.
  function extractActions(content: string): ParsedAction[] {
    return extractDispatchActions(content) as ParsedAction[];
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
                src={streaming && portraitTalking ? portraitTalking : portraitIdle}
                alt={overseerName}
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
              {overseerName}
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
              src={portraitIdle}
              alt={overseerName}
              className="w-5 h-5 rounded-full ring-1 ring-cyan/40"
            />
            <span className="text-xs font-mono text-cyan uppercase tracking-wider font-bold">
              {overseerName} — Sprint Planning
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Phase 20 — TTS quick toggle. Mutes Delamain mid-
                response if pressed while speaking. Persists. */}
            <button
              onClick={toggleTts}
              title={
                ttsEnabled
                  ? "Mute Delamain (TTS on)"
                  : "Have Delamain speak responses (TTS off)"
              }
              className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono uppercase border transition-colors ${
                ttsEnabled
                  ? "border-cyan text-cyan"
                  : "border-space-600 text-space-500 hover:text-text"
              }`}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                {ttsEnabled ? (
                  <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.787L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.797-3.787a1 1 0 011-.137zM14 7.05a3 3 0 010 5.9V7.05zM14 4.05a6 6 0 010 11.9V4.05z" />
                ) : (
                  <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.787L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.797-3.787a1 1 0 011-.137zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" />
                )}
              </svg>
              {ttsEnabled ? "Speaking On" : "Speaking"}
            </button>
            {hasSpeechSupport && (
              <button
                onClick={() => {
                  if (voiceEnabled && listening) stopListening();
                  setVoiceEnabled(!voiceEnabled);
                }}
                title={
                  voiceEnabled
                    ? "Voice input on — click the mic to speak"
                    : "Enable voice input"
                }
                className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono uppercase border transition-colors ${
                  voiceEnabled
                    ? "border-cyan text-cyan"
                    : "border-space-600 text-space-500 hover:text-text"
                }`}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
                {voiceEnabled ? "Mic On" : "Mic"}
              </button>
            )}
          </div>
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
            {overseerName} is thinking...
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

      {/* Phase 17 — Session Memory panel. Read-only window into
          ChatSession.workingMemory + activeFlow. Doesn't affect
          dispatch flow; coexists with the existing [DISPATCH]
          tag-parsed buttons. */}
      {sessionMemory && hasSessionMemory(sessionMemory) ? (
        <SessionMemoryPanel state={sessionMemory} />
      ) : null}
    </div>
  );
}

function SessionMemoryPanel({ state }: { state: SessionMemoryState }) {
  const proposed = state.workingMemory.proposedDispatches;
  const proposedList = Array.isArray(proposed) ? proposed : [];
  const otherKeys = Object.keys(state.workingMemory).filter(
    (k) => k !== "proposedDispatches"
  );
  return (
    <div className="border-t border-space-600 bg-space-900/50 px-4 py-2 text-xs font-mono text-space-300">
      <div className="flex items-center gap-3">
        <span className="text-cyan/80">session memory</span>
        {state.activeFlow ? (
          <span className="text-amber/80">flow: {state.activeFlow}</span>
        ) : null}
        {proposedList.length > 0 ? (
          <span className="text-emerald/80">
            {proposedList.length} proposed dispatch
            {proposedList.length === 1 ? "" : "es"}
          </span>
        ) : null}
        {otherKeys.length > 0 ? (
          <span className="text-space-400">keys: {otherKeys.join(", ")}</span>
        ) : null}
      </div>
    </div>
  );
}
