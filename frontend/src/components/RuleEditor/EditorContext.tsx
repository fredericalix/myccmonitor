"use client";

import { createContext, useContext } from "react";
import type { GroupView, Monitor, Rule } from "@/services/types";

export interface EditorData {
  monitors: Monitor[];
  groups: GroupView[];
  rules: Rule[]; // for `escalate` target picker
}

export const EditorContext = createContext<EditorData>({
  monitors: [],
  groups: [],
  rules: [],
});

export function useEditorData(): EditorData {
  return useContext(EditorContext);
}
