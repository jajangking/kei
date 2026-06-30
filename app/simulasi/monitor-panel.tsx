import { useRef, useEffect } from "react";
import type { NavDebugData, LogEntryType, LogEntry } from "./types";
import { SECTORS, MAX_LOG } from "./constants";

type MonitorProps = {
  logEntriesRef: React.MutableRefObject<LogEntry[]>;
  logTick: number;
  setShowLog: (v: boolean) => void;
  navDebugRef: NavDebugData;
};

const SECTORS_LOOKUP = SECTORS.map((s) => ({ id: s.id }));

function typeColor(t: string) {
  switch (t) {
    case "warn":
      return "text-yellow-400";
    case "error":
      return "text-red-400";
    case "nav":
      return "text-cyan-400";
    case "sensor":
      return "text-emerald-400";
    case "motor":
      return "text-orange-400";
    default:
      return "text-zinc-400";
  }
}

export default function MonitorPanel({
  logEntriesRef,
  logTick,
  setShowLog,
  navDebugRef,
}: MonitorProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logTick]);

  const copyLog = () => {
    const text = logEntriesRef.current
      .map((e) => `[${e.time}] ${e.msg}`)
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const clearLog = () => {
    logEntriesRef.current = [];
  };

  const dumpNavDebug = () => {
    const n = navDebugRef;
    const log = (msg: string, type: LogEntryType = "nav") => {
      logEntriesRef.current.push({
        time: new Date().toLocaleTimeString("id-ID", { hour12: false }),
        msg,
        type,
      });
      if (logEntriesRef.current.length > MAX_LOG)
        logEntriesRef.current = logEntriesRef.current.slice(-MAX_LOG);
    };
    const pos = n.posRef.current;
    const hdg = (n.headingRef.current * 180 / Math.PI).toFixed(0);
    log(`=== DEBUG ===`, "nav");
    log(`pos=(${pos.x.toFixed(0)},${pos.y.toFixed(0)}) h=${hdg}°`, "nav");
    const sd = n.sectorDataRef.current;
    const sdBuf = sd
      .map((v, i) =>
        v > 0 ? `${SECTORS_LOOKUP[i].id}:${(v / 10).toFixed(0)}cm` : null
      )
      .filter(Boolean)
      .join(" ");
    log(`sectors: ${sd.filter((v) => v > 0).length}/14 filled`, "sensor");
    if (sdBuf) log(sdBuf, "sensor");
    log(`grid=${n.occupancyRef.current.size}`, "nav");
    log(
      `M1=${n.modul1Active} M2=${n.modul2Active} M3=${n.modul3Active}[${n.modul3StateRef?.current || "?"}/${n.modul3LabelRef?.current || ""}] M4=${n.modul4Active} cam=${n.camActive} tts=${n.ttsActive}`,
      "info"
    );
    log(`=== DEBUG END ===`, "nav");
  };

  const entries = logEntriesRef.current;

  return (
    <div className="fixed top-14 left-4 right-4 z-50 max-h-[70vh] bg-zinc-900/95 backdrop-blur-md rounded-xl border border-white/10 text-[10px] font-mono shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 shrink-0">
        <span className="text-violet-400 font-bold text-[11px] tracking-wider">
          LOG
        </span>
        <div className="flex gap-1 items-center">
          <span className="text-zinc-600 text-[8px]">#{logTick}</span>
          <button
            onClick={clearLog}
            className="px-1.5 py-0.5 rounded text-[8px] bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700 active:scale-90"
          >
            HAPUS
          </button>
          <button
            onClick={copyLog}
            className="px-1.5 py-0.5 rounded text-[8px] bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700 active:scale-90"
          >
            COPY
          </button>
          <button
            onClick={dumpNavDebug}
            className="px-1.5 py-0.5 rounded text-[8px] bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700 active:scale-90"
          >
            NAVSTATE
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div
        className="overflow-y-auto p-2 space-y-0.5 flex-1"
        style={{ maxHeight: "calc(70vh - 36px)" }}
      >
        {entries.length === 0 && (
          <div className="text-zinc-600 italic py-4 text-center">
            Belum ada log
          </div>
        )}
        {entries.map((entry, i) => (
          <div
            key={i}
            className="flex gap-2 leading-snug hover:bg-white/5 px-1 rounded"
          >
            <span className="text-zinc-600 shrink-0 w-[60px]">
              {entry.time}
            </span>
            <span className={`${typeColor(entry.type)} break-all`}>
              {entry.msg}
            </span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
