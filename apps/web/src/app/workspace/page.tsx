import type { Metadata } from "next";
import { LiveWorkspaceEntry } from "@/components/live-workspace";

export const metadata: Metadata = { title: "Live workspace | SkillConnect" };

export default function WorkspacePage() {
  // The ready bootstrap must come from a future verified server-side session.
  return <LiveWorkspaceEntry access={{ status: "configuration-pending" }} />;
}
