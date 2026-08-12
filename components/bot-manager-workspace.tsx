"use client";

import { useState } from "react";

import { CommandComposer } from "@/components/command-composer";
import { CommandsConsole } from "@/components/commands-console";

/**
 * Holds the one piece of state the composer and the list share: saving a
 * request should make it appear below without a page reload.
 */
export function BotManagerWorkspace() {
  const [savedCount, setSavedCount] = useState(0);

  return (
    <div className="space-y-4">
      <CommandComposer onSaved={() => setSavedCount((count) => count + 1)} />
      <CommandsConsole refreshToken={savedCount} />
    </div>
  );
}
