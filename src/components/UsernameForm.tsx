"use client";

import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { loadMe, saveMe } from "@/lib/me";

interface Props {
  onSubmit: (username: string) => void;
  disabled?: boolean;
}

export default function UsernameForm({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");
  const [mine, setMine] = useState(true);

  // Pre-fill from the saved account; the checkbox starts on when it matches or nothing is saved.
  useEffect(() => {
    const saved = loadMe();
    if (saved) setValue(saved);
  }, []);

  function handleChange(next: string) {
    setValue(next);
    const saved = loadMe();
    setMine(!saved || saved === next.trim().toLowerCase());
  }

  return (
    <form
      className="flex w-full flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const name = value.trim();
        if (!name || disabled) return;
        const saved = loadMe();
        if (mine) saveMe(name);
        else if (saved === name.toLowerCase()) saveMe(null);
        onSubmit(name);
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="h-12 flex-1 rounded-xl border border-line bg-surface px-4 text-base text-fg outline-none transition-colors placeholder:text-muted focus:border-accent/70 focus:ring-2 focus:ring-accent/20"
          placeholder="Chess.com username"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Chess.com username"
        />
        <Button type="submit" variant="primary" size="lg" disabled={disabled || !value.trim()}>
          {disabled && <Spinner />}
          Analyse games
        </Button>
      </div>
      <label className="flex w-fit cursor-pointer select-none items-center gap-2 text-[13px] text-fg-2">
        <input
          type="checkbox"
          checked={mine}
          onChange={(e) => setMine(e.target.checked)}
          className="size-4 accent-[var(--color-accent)]"
        />
        This is my account
      </label>
    </form>
  );
}
