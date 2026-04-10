import { createServiceClient } from "@/lib/supabase/server";

export type LogLevel = "info" | "step" | "warn" | "error" | "success";

interface LogEntry {
  level: LogLevel;
  agent: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

const LOG_PREFIX: Record<LogLevel, string> = {
  info: "ℹ",
  step: "→",
  warn: "⚠",
  error: "✗",
  success: "✓",
};

class JarvisLogger {
  private entries: LogEntry[] = [];
  private userId: string | null = null;

  setUser(userId: string) {
    this.userId = userId;
  }

  log(level: LogLevel, agent: string, message: string, details?: Record<string, unknown>) {
    const entry: LogEntry = {
      level,
      agent,
      message,
      details,
      timestamp: new Date().toISOString(),
    };

    this.entries.push(entry);
    const prefix = LOG_PREFIX[level];
    const tag = `[${agent.toUpperCase().padEnd(12)}]`;
    console.log(`${prefix} ${tag} ${message}`);

    if (details && level === "error") {
      console.error(`  └─ Details:`, JSON.stringify(details, null, 2));
    }
  }

  step(agent: string, message: string, details?: Record<string, unknown>) {
    this.log("step", agent, message, details);
  }

  info(agent: string, message: string, details?: Record<string, unknown>) {
    this.log("info", agent, message, details);
  }

  warn(agent: string, message: string, details?: Record<string, unknown>) {
    this.log("warn", agent, message, details);
  }

  error(agent: string, message: string, details?: Record<string, unknown>) {
    this.log("error", agent, message, details);
  }

  success(agent: string, message: string, details?: Record<string, unknown>) {
    this.log("success", agent, message, details);
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  async persist(action: string, resourceType?: string, resourceId?: string) {
    if (!this.userId) return;
    try {
      const supabase = createServiceClient();
      await supabase.from("audit_log").insert({
        user_id: this.userId,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        details: { log: this.entries.slice(-20) },
      });
    } catch {
      // Best-effort
    }
  }

  clear() {
    this.entries = [];
  }
}

export const logger = new JarvisLogger();
