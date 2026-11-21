// @ts-types="@/shared/types/css-module.d.ts"
import styles from "./NavSidebar.module.css";

import { ChartColumn, History, SlidersVertical } from "lucide-react";
import type { ViewRoute } from "@/shared/view-route/index.ts";

const NAV_ITEMS = [
  { route: "history", label: "Snapshots History", Icon: History },
  { route: "sizes", label: "Snapshot Sizes", Icon: ChartColumn },
  { route: "config", label: "Config Editor", Icon: SlidersVertical },
] as const;

/** Vertical icon navigation sidebar for top-level views. */
export function NavSidebar({ view, onSelectView }: NavSidebarProps) {
  return (
    <nav className={styles.navSidebar} aria-label="Views">
      {NAV_ITEMS.map(({ route, label, Icon }) => {
        const active = view === route;
        return (
          <button
            key={route}
            type="button"
            className={styles.item}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
            data-tooltip={label}
            onClick={() => onSelectView(route)}
          >
            <Icon size={20} aria-hidden />
          </button>
        );
      })}
    </nav>
  );
}

/** Props for NavSidebar component. */
export type NavSidebarProps = {
  view: ViewRoute;
  onSelectView: (route: ViewRoute) => void;
};
