import Link from "next/link";
import { ApiError } from "@/lib/api/client";
import { requestMessage } from "@/lib/workspace/resource";

export function WorkspaceStatus({ loading, error, retry }: { loading?: string; error?: unknown; retry?: () => void }) {
  const loginRequired = error instanceof ApiError && error.status === 401;
  return (
    <div className="workspace-state" role={loading ? "status" : "alert"}>
      <p>{loading ?? requestMessage(error)}</p>
      {loginRequired ? <Link href="/login">Open sign-in</Link> : retry && <button type="button" className="primary-button" onClick={retry}>Retry</button>}
    </div>
  );
}
