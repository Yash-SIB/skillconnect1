import { Icon } from "./icon";

export const demoApps = {
  calendar: { name: "Google Calendar", description: "See upcoming team meetings and events in the workspace." },
  drive: { name: "Google Drive", description: "Find and share team documents from the workspace." },
};

export type AppId = keyof typeof demoApps;
export const appIds = Object.keys(demoApps) as AppId[];

export function AppIcon({ app }: { app: AppId }) {
  return <span className={`app-${app}`}><Icon name={app} /></span>;
}

export function AppsPreview({ app }: { app?: AppId }) {
  return (
    <div className="dialog-list">
      <p>{app ? demoApps[app].description : "Preview the integrations planned for the workspace."}</p>
      {(app ? [app] : appIds).map((id) => (
        <div key={id}><AppIcon app={id} />{demoApps[id].name}<small>Not connected</small></div>
      ))}
    </div>
  );
}
