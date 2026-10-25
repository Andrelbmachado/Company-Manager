import { cn } from "@/lib/utils";

/**
 * Pasta chapada e monocromática: a cor do texto (currentColor) em dois tons — aba atrás mais clara, corpo cheio —, sem
 * gradiente, sombra ou volume. `cloud` recorta uma nuvem no corpo (pasta conectada do iCloud, Drive etc.).
 */
export function FolderIcon({ cloud = false, className }: { cloud?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 48"
      aria-hidden="true"
      data-folder-icon=""
      className={cn("block h-12 w-16 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground", className)}
    >
      <path fill="currentColor" opacity="0.55" d="M4 8a4 4 0 0 1 4-4h14.34a4 4 0 0 1 2.83 1.17L29 9h27a4 4 0 0 1 4 4v3H4V8z" />
      <rect fill="currentColor" x="4" y="13" width="56" height="31" rx="4" />
      {cloud && (
        <path
          data-cloud-mark=""
          className="fill-background"
          d="M25.5 37h14a5.5 5.5 0 0 0 .86-10.93 7.5 7.5 0 0 0-14.3-1.6A6.25 6.25 0 0 0 25.5 37z"
        />
      )}
    </svg>
  );
}
