"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Zap, Loader2, CheckCircle, AlertCircle } from "lucide-react";

interface Props {
  campaignId: string;
  canRun: boolean;
  newLeadsCount: number;
}

type RunState = "idle" | "running" | "paused" | "done" | "error";

interface LogEntry {
  time: string;
  message: string;
}

export function RunPipelineButton({ campaignId, canRun, newLeadsCount }: Props) {
  const [state, setState] = useState<RunState>("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const router = useRouter();
  const logsEndRef = useRef<HTMLDivElement>(null);

  function addLog(message: string) {
    const time = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLogs((prev) => [...prev, { time, message }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function handleRun() {
    if (!canRun) return;

    setState("running");
    setLogs([]);
    setError("");
    addLog(`Starting pipeline for ${newLeadsCount} lead${newLeadsCount > 1 ? "s" : ""}…`);

    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "error") {
              setError(event.error);
              setState("error");
              addLog(`Error: ${event.error}`);
              break;
            }

            if (event.type === "paused") {
              setState("paused");
              addLog("Pipeline paused — waiting for your approval in the queue.");
              break;
            }

            if (event.type === "update" && event.data) {
              const nodeNames = Object.keys(event.data);
              for (const node of nodeNames) {
                const nodeData = event.data[node];
                if (nodeData?.messages) {
                  for (const msg of nodeData.messages) {
                    const content =
                      typeof msg === "string"
                        ? msg
                        : msg?.content ?? msg?.kwargs?.content ?? JSON.stringify(msg);
                    if (content) addLog(content);
                  }
                }
              }
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      if (state !== "error") {
        if (state !== "paused") {
          setState("done");
          addLog("Pipeline complete.");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setState("error");
      addLog(`Failed: ${msg}`);
    }

    router.refresh();
  }

  return (
    <div>
      {/* Run Button */}
      <button
        onClick={handleRun}
        disabled={!canRun || state === "running"}
        className={`inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold transition-all ${
          state === "running"
            ? "bg-jarvis-blue/20 text-jarvis-blue cursor-wait"
            : canRun
              ? "bg-jarvis-blue text-jarvis-dark hover:brightness-110 active:scale-[0.98]"
              : "bg-white/5 text-jarvis-muted cursor-not-allowed"
        }`}
      >
        {state === "running" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Zap className="h-4 w-4" />
        )}
        {state === "running"
          ? "Running…"
          : canRun
            ? `Run Pipeline (${newLeadsCount} lead${newLeadsCount > 1 ? "s" : ""})`
            : "No new leads to process"}
      </button>

      {/* Live Log Panel */}
      {logs.length > 0 && (
        <div className="mt-4 w-[500px] rounded-lg border border-jarvis-border bg-jarvis-dark">
          <div className="flex items-center justify-between border-b border-jarvis-border px-3 py-2">
            <div className="flex items-center gap-2">
              {state === "running" && <span className="status-dot status-dot-active" />}
              {state === "paused" && <span className="status-dot status-dot-pending" />}
              {state === "done" && <CheckCircle className="h-3.5 w-3.5 text-jarvis-success" />}
              {state === "error" && <AlertCircle className="h-3.5 w-3.5 text-jarvis-danger" />}
              <span className="text-xs font-medium text-jarvis-muted">
                Jarvis Pipeline
              </span>
            </div>
            <span className="text-[10px] text-jarvis-muted/50">
              {state === "running" ? "live" : state}
            </span>
          </div>
          <div className="max-h-60 overflow-y-auto p-3 font-mono text-xs leading-relaxed">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-jarvis-muted/40">{log.time}</span>
                <span className="text-jarvis-muted">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
