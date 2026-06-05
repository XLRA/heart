"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lock } from "lucide-react";
import TextHeart from "./components/TextHeart";
import Embers from "./components/Embers";

const Typewriter = ({
  text,
  delay = 50,
  onComplete,
}: {
  text: string;
  delay?: number;
  onComplete?: () => void;
}) => {
  const [currentText, setCurrentText] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index < text.length) {
      const timeout = setTimeout(() => {
        setCurrentText((prev) => prev + text[index]);
        setIndex((prev) => prev + 1);
      }, delay);
      return () => clearTimeout(timeout);
    } else if (onComplete) {
      onComplete();
    }
  }, [index, text, delay, onComplete]);

  return <span className="font-mono">{currentText}</span>;
};

type BootLine = {
  tag: string;
  text: string;
  delay?: number;
  tagClass?: string;
  textClass?: string;
};

const BOOT_LINES: BootLine[] = [
  {
    tag: "[system]",
    text: "Initializing strawberry.PROTOCOL_v1.0...",
    delay: 28,
  },
  {
    tag: "[auth]",
    text: "Verifying recipient... user@rin ✓",
    delay: 22,
  },
  {
    tag: "[scan]",
    text: "Searching local heap for affection.bin...",
    delay: 18,
  },
  {
    tag: "[scan]",
    text: "1 artifact recovered (sig: 0xDEADBEEF)",
    delay: 18,
    textClass: "text-white/80",
  },
];

export default function StrawberryPage() {
  const [stage, setStage] = useState<"console" | "reveal">("console");
  const [lineIndex, setLineIndex] = useState(0);
  const [consoleFinished, setConsoleFinished] = useState(false);

  const handleReveal = useCallback(() => {
    if (stage === "console" && consoleFinished) {
      setStage("reveal");
    }
  }, [stage, consoleFinished]);

  const resetConsole = useCallback(() => {
    setConsoleFinished(false);
    setLineIndex(0);
    setStage("console");
  }, []);

  return (
    <div
      onClick={handleReveal}
      className={`strawberry-bg isolate relative min-h-screen w-full flex items-center justify-center overflow-hidden selection:bg-[#ff4d6d]/30 ${
        stage === "console" && consoleFinished ? "cursor-pointer" : ""
      }`}
    >
      <Embers />
      <div className="strawberry-vignette pointer-events-none fixed inset-0 z-[5]" />
      <div className="scanline" />

      <AnimatePresence mode="wait">
        {stage === "console" ? (
          <motion.div
            key="console"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="w-full max-w-2xl p-8 font-mono text-sm md:text-base text-white/80"
          >
            <div className="space-y-2">
              {BOOT_LINES.map((line, i) => {
                if (i > lineIndex) return null;
                const isActive = i === lineIndex;
                return (
                  <div
                    key={i}
                    className={`flex gap-2 ${line.tagClass ?? "text-[#ff8fb1]/60"}`}
                  >
                    <span className="shrink-0">{line.tag}</span>
                    {isActive ? (
                      <Typewriter
                        text={line.text}
                        delay={line.delay ?? 25}
                        onComplete={() => {
                          if (i + 1 < BOOT_LINES.length) {
                            setLineIndex(i + 1);
                          } else {
                            setConsoleFinished(true);
                          }
                        }}
                      />
                    ) : (
                      <span
                        className={`font-mono ${line.textClass ?? "text-white/80"}`}
                      >
                        {line.text}
                      </span>
                    )}
                  </div>
                );
              })}

              <div className="flex gap-2 h-6">
                <span className="text-[#ff8fb1]/60">[status]</span>
                {consoleFinished && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-green-400"
                  >
                    READY
                  </motion.span>
                )}
              </div>

              {consoleFinished && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="pt-8 flex flex-col items-start gap-6"
                >
                  <p className="text-white/40 italic">
                    {">"} One encrypted message found for you.
                  </p>

                  <motion.pre
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3, duration: 0.6 }}
                    className="text-[11px] md:text-xs leading-relaxed text-[#ff8fb1]/70 border border-[#ff4d6d]/20 bg-[#ff4d6d]/[0.03] px-4 py-3 select-none"
                  >
{`┌─ PACKET ──────────────────────────────────┐
│ from:     ░░░░░░░░░@anon                  │
│ to:       user@rin                        │
│ size:     420 bytes                       │
│ cipher:   AES-256-HEART                   │
│ sent:     2026-05-17 17:44:01 UTC         │
└───────────────────────────────────────────┘`}
                  </motion.pre>

                  <button
                    id="decrypt-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStage("reveal");
                    }}
                    className="group flex items-center gap-3 px-6 py-3 border border-[#ff4d6d]/30 bg-[#ff4d6d]/5 hover:bg-[#ff4d6d]/10 text-[#ff8fb1] transition-all duration-300 pointer-events-auto"
                  >
                    <Lock
                      size={16}
                      className="group-hover:rotate-12 transition-transform"
                    />
                    <span className="font-mono tracking-widest uppercase text-xs">
                      Decrypt Message
                    </span>
                    <span className="terminal-cursor" />
                  </button>

                  <p className="text-[10px] text-white/20 animate-pulse">
                    (or just click anywhere)
                  </p>
                </motion.div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="reveal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative w-full h-screen flex items-center justify-center overflow-hidden"
          >
            <TextHeart />

            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 3, duration: 1.5 }}
              className="z-20 text-center"
            >
              <h2 className="text-[#ff4d6d] font-mono text-xl tracking-[0.3em] uppercase glow-text mb-2">
                Decrypted
              </h2>
              <div className="w-12 h-px bg-[#ff4d6d]/30 mx-auto mb-8" />

              <motion.button
                onClick={(e) => {
                  e.stopPropagation();
                  resetConsole();
                }}
                className="text-white/20 hover:text-white/60 transition-colors uppercase text-[10px] tracking-widest font-mono"
              >
                Re-encrypt
              </motion.button>
            </motion.div>

            <div className="absolute top-8 left-8 text-[10px] font-mono text-white/10 uppercase tracking-widest space-y-1">
              <div>ln: 420</div>
              <div>id: 0xDEADBEEF</div>
              <div>type: organic_emotion</div>
            </div>

            <div className="absolute bottom-8 right-8 text-[10px] font-mono text-white/10 uppercase tracking-widest">
              heart_reveal // success
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
