import type { GroupRolledState } from "@/services/types";
import { StateBadge } from "./StateBadge";

export function RolledStateBadge({ state }: { state: GroupRolledState }) {
  return <StateBadge state={state} />;
}
