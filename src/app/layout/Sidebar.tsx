import { NavLink, useLocation } from "react-router-dom";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRequiredSession } from "@/hooks/useSession";
import { visibleModules } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import { NAV_ITEMS, isActivePath, type NavItem } from "./navigation";

interface SidebarProps {
  collapsed: boolean;
}

export function Sidebar({ collapsed }: SidebarProps) {
  const session = useRequiredSession();
  const location = useLocation();
  const allowed = new Set(visibleModules(session.membership.role as Role));
  const visible = NAV_ITEMS.filter((item) => allowed.has(item.module));

  const groups: Record<string, NavItem[]> = {};
  for (const item of visible) {
    (groups[item.group] ??= []).push(item);
  }

  return (
    <aside
      id="app-sidebar"
      data-testid="sidebar"
      data-collapsed={collapsed}
      aria-label="Menu principal"
      className={cn(
        "flex h-full shrink-0 select-none flex-col border-r bg-sidebar transition-[width] duration-200 ease-out",
        collapsed ? "w-[60px]" : "w-60"
      )}
    >
      {/* Brand — same height as the topbar so borders line up */}
      <div className={cn("flex h-14 shrink-0 items-center gap-2.5 border-b", collapsed ? "justify-center px-0" : "px-4")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
          <Building2 size={16} className="text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-sm font-semibold text-sidebar-foreground">Company Manager</span>
            <span className="truncate text-xs text-muted-foreground">{session.company.name}</span>
          </div>
        )}
      </div>

      <nav className={cn("flex-1 overflow-y-auto overflow-x-hidden py-3", collapsed ? "px-2" : "px-3")}>
        {Object.entries(groups).map(([group, items], gi) => (
          <div key={group} className="mb-3" role="group" aria-label={group}>
            {collapsed ? (
              gi > 0 && <div className="mx-2 mb-3 h-px bg-border" />
            ) : (
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group}
              </p>
            )}
            <div className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(item.path, location.pathname);
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    title={collapsed ? item.label : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    data-testid={`nav-${item.path === "/" ? "dashboard" : item.path.slice(1)}`}
                    className={cn(
                      "flex h-9 items-center gap-2.5 rounded-md text-sm transition-colors",
                      collapsed ? "justify-center px-0" : "px-2.5",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon size={16} className={cn("shrink-0", active && "text-primary")} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">v0.1.0 · Local-first</div>
      )}
    </aside>
  );
}
