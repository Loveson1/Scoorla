import { useEffect, useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Building2, LifeBuoy, LayoutDashboard, LogOut, Menu, Shield } from "lucide-react";
import { logoutUser } from "../utils/authUtils";

const navItems = [
  {
    label: "Dashboard",
    to: "/platform",
    icon: LayoutDashboard,
    end: true,
  },
  {
    label: "Schools",
    to: "/platform/schools",
    icon: Building2,
  },
  {
    label: "Support",
    to: "/platform/support",
    icon: LifeBuoy,
  },
];

export default function PlatformLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    try {
      await logoutUser();
    } finally {
      navigate("/platform/login", { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div
        className={`fixed inset-0 z-40 bg-slate-950/70 transition-opacity duration-300 lg:hidden ${
          isSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setIsSidebarOpen(false)}
      />

      <div className="border-b border-slate-800 bg-slate-900 px-4 py-4 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600/15 text-blue-300">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-blue-300">
                Scoorla
              </p>
              <h1 className="text-base font-semibold text-white">Platform Console</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-slate-200 transition-colors hover:border-blue-500 hover:text-white"
            aria-label={isSidebarOpen ? "Close navigation menu" : "Open navigation menu"}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex min-h-[calc(100vh-73px)] lg:min-h-screen lg:items-start">
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-800 bg-slate-900 transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:self-start lg:translate-x-0 ${
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600/15 text-blue-300">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-300">
                  Scoorla
                </p>
                <h1 className="text-lg font-semibold text-white">Platform Console</h1>
              </div>
            </div>
          </div>

          <nav className="space-y-2 px-4 py-5">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-blue-600 text-white"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-auto px-4 pb-5">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-800 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800"
            >
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
