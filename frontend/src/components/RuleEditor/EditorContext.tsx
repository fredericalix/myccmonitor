"use client";

import { createContext, useContext } from "react";
import type {
  GroupView,
  Monitor,
  NotificationChannel,
  Rule,
} from "@/services/types";

export interface EditorData {
  monitors: Monitor[];
  groups: GroupView[];
  rules: Rule[]; // for `escalate` target picker
  channels: NotificationChannel[]; // for `send_notification` picker
}

export const EditorContext = createContext<EditorData>({
  monitors: [],
  groups: [],
  rules: [],
  channels: [],
});

export function useEditorData(): EditorData {
  return useContext(EditorContext);
}
