import Link from "next/link";

export type ShellView = "overview" | "topology" | "devices" | "monitoring" | "settings";

const NAV_ITEMS: { id: ShellView; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "◆" },
  { id: "topology", label: "Topology", icon: "◇" },
  { id: "devices", label: "Devices", icon: "▣" },
  { id: "monitoring", label: "Monitoring", icon: "▲" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

interface SidebarProps {
  activeView: ShellView;
  onSelectView: (view: ShellView) => void;
  onOpenConsole: () => void;
}

export function Sidebar({ activeView, onSelectView, onOpenConsole }: SidebarProps) {
  return (
    <nav className="flex w-48 shrink-0 flex-col border-r border-slate-800 bg-slate-950 py-3">
      <div className="px-4 pb-3 text-sm font-semibold tracking-wide text-slate-200">TRACE</div>
      <ul className="flex-1 space-y-0.5 px-2">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <button
              onClick={() => onSelectView(item.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                activeView === item.id ? "bg-sky-600/20 text-sky-300" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <span className="w-4 text-center text-xs">{item.icon}</span>
              {item.label}
            </button>
          </li>
        ))}
        <li>
          <button
            onClick={onOpenConsole}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-900 hover:text-slate-200"
          >
            <span className="w-4 text-center text-xs">▸</span>
            Console
          </button>
        </li>
      </ul>
      <div className="px-2 pt-2">
        <Link
          href="/dev-intel"
          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-900 hover:text-slate-300"
        >
          <span className="w-4 text-center">↗</span>
          Dev Intelligence
        </Link>
      </div>
    </nav>
  );
}
