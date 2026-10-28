"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="no-print inline-flex min-h-11 items-center gap-2 rounded-md border border-lagoon/40 px-4 text-sm font-semibold text-lagoon">
      <Printer size={16} aria-hidden="true" /> {label}
    </button>
  );
}
