"use client";

import { useState } from "react";

interface Props {
  onSubmit: (username: string) => void;
  disabled?: boolean;
}

export default function UsernameForm({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const name = value.trim();
        if (name) onSubmit(name);
      }}
    >
      <input
        className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 outline-none focus:border-emerald-500"
        placeholder="Chess.com username"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500 disabled:opacity-50"
      >
        Load games
      </button>
    </form>
  );
}
