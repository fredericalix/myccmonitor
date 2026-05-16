"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { McpPanel } from "@/components/Settings/McpPanel";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Workbench"
        description="Account-level tools and integrations."
        breadcrumbs={[{ label: "Workbench" }]}
      />
      <McpPanel />
    </div>
  );
}
