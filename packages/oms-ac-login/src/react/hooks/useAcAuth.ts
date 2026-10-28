"use client";

import { useAcAuthContext } from "../AcLoginProvider";

export function useAcAuth() {
  return useAcAuthContext();
}
