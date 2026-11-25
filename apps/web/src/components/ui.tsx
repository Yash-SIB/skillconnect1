import type { ComponentProps } from "react";
import type { Person } from "@/lib/workspace/models";
import { Icon, type IconName } from "./icon";

export function IconButton({ icon, label, className = "", ...props }: ComponentProps<"button"> & { icon: IconName; label: string }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} {...props}><Icon name={icon} /></button>;
}

export function Avatar({ person, status = false }: { person: Person; status?: boolean }) {
  return <span className={`avatar ${person.color}`} aria-hidden="true">{person.initials}{status && <i className={person.online ? "online" : ""} />}</span>;
}

export function BrandMark() {
  return (
    <svg className="brand-mark" width="32" height="32" viewBox="0 0 48 48" aria-hidden="true">
      <path d="m24 5 17 9-17 9-17-9z" fill="#29BCE5"/>
      <path d="m7 19 14 8v16L7 35z" fill="#F56622"/>
      <path d="m41 19-14 8v16l14-8z" fill="#FFBA35"/>
    </svg>
  );
}
