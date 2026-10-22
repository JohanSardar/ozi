import { Outlet, createFileRoute, redirect, Link } from "@tanstack/react-router";
import { SettingsScopeProvider } from "../components/settings/SettingsScopeContext";
import { validateSettingsRouteSearch } from "../components/settings/settingsScopeNavigation";

const pages = [
  ["/settings/appearance", "Appearance"],
  ["/settings/connections", "Connections"],
  ["/settings/providers", "Providers"],
  ["/settings/keybindings", "Keybindings"],
  ["/settings/scheduled-tasks", "Scheduled tasks"],
  ["/settings/open-source-licenses", "Licenses"],
] as const;

function SettingsLayout() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SettingsScopeProvider search={search} onChange={(next) => void navigate({ search: next })}>
      <main className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
        <header className="flex min-h-12 flex-wrap items-center gap-4 border-b border-border px-5 py-3">
          <Link to="/">← Ozi</Link>
          <b>Settings</b>
          <nav aria-label="Settings" className="flex flex-wrap gap-4">
            {pages.map(([to, label]) => (
              <Link key={to} to={to} activeProps={{ className: "font-semibold text-primary" }}>
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <Outlet />
        </div>
      </main>
    </SettingsScopeProvider>
  );
}

export const Route = createFileRoute("/settings")({
  validateSearch: validateSettingsRouteSearch,
  beforeLoad: ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
    if (location.pathname === "/settings")
      throw redirect({ to: "/settings/appearance", replace: true });
  },
  component: SettingsLayout,
});
