import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Building2, LifeBuoy } from "lucide-react";
import { useAuthContext } from "../context/AuthContext";
import {
  backfillSchoolSearchIndexesWithAudit,
  getPlatformDashboardSnapshot,
} from "./platformService";

export default function PlatformDashboard() {
  const { authUser } = useAuthContext();
  const [dashboardData, setDashboardData] = useState({
    summary: {
      schools: 0,
      active: 0,
      disabled: 0,
      openTickets: 0,
      needsHelp: 0,
    },
    flaggedSchools: [],
    latestTickets: [],
    searchIndexMaintenance: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillSummary, setBackfillSummary] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        const snapshot = await getPlatformDashboardSnapshot();
        if (!isMounted) return;
        setDashboardData(snapshot);
      } catch (error) {
        if (!isMounted) return;
        console.error("Error loading platform dashboard:", error);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  const summary = useMemo(() => {
    return [
      {
        label: "Schools",
        value: dashboardData.summary.schools,
        icon: Building2,
        tone: "from-blue-500/20 to-blue-700/10 text-blue-200",
      },
      {
        label: "Active",
        value: dashboardData.summary.active,
        icon: Activity,
        tone: "from-emerald-500/20 to-emerald-700/10 text-emerald-200",
      },
      {
        label: "Disabled",
        value: dashboardData.summary.disabled,
        icon: AlertTriangle,
        tone: "from-red-500/20 to-red-700/10 text-red-200",
      },
      {
        label: "Open Tickets",
        value: dashboardData.summary.openTickets,
        icon: LifeBuoy,
        tone: "from-amber-500/20 to-amber-700/10 text-amber-200",
      },
      {
        label: "Needs Help",
        value: dashboardData.summary.needsHelp,
        icon: AlertTriangle,
        tone: "from-purple-500/20 to-purple-700/10 text-purple-200",
      },
    ];
  }, [dashboardData]);

  const shouldShowBackfillCard = !dashboardData.searchIndexMaintenance?.completedAtMs;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
          Platform
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Super Admin Dashboard</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-300">
          Multi-tenant visibility across all schools, with support tooling and operational
          safety controls.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8">
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-blue-400"></div>
            <span>Loading platform data...</span>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {summary.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className={`rounded-3xl border border-slate-800 bg-gradient-to-br ${item.tone} p-5`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em]">
                      {item.label}
                    </p>
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="mt-4 text-3xl font-semibold text-white">{item.value}</p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            {shouldShowBackfillCard && (
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 xl:col-span-2">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Search Index Maintenance</h2>
                    <p className="mt-2 text-sm text-slate-300">
                      Backfill legacy school search indexes once so platform search covers older
                      schools immediately.
                    </p>
                    {backfillSummary && (
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                        Last run scanned {backfillSummary.scanned} schools and updated{" "}
                        {backfillSummary.updated}.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={isBackfilling}
                    onClick={async () => {
                      const confirmed = window.confirm(
                        "Run the legacy school search-index backfill now? This scans all school records and updates only those missing searchIndex."
                      );
                      if (!confirmed) return;
                      try {
                        setIsBackfilling(true);
                        const summary = await backfillSchoolSearchIndexesWithAudit({
                          actorUid: authUser?.uid,
                        });
                        setBackfillSummary(summary);
                        setDashboardData((prev) => ({
                          ...prev,
                          searchIndexMaintenance: {
                            completedAtMs: Date.now(),
                            scanned: summary.scanned,
                            updated: summary.updated,
                          },
                        }));
                        alert(
                          `Backfill completed. Scanned ${summary.scanned} schools and updated ${summary.updated}.`
                        );
                      } catch (error) {
                        console.error("Error backfilling school search index:", error);
                        alert(error?.message || "Failed to backfill school search index.");
                      } finally {
                        setIsBackfilling(false);
                      }
                    }}
                    className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isBackfilling ? "Backfilling..." : "Backfill Legacy Search Index"}
                  </button>
                </div>
              </section>
            )}

            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-lg font-semibold text-white">Recently Flagged Schools</h2>
              <div className="mt-4 space-y-3">
                {dashboardData.flaggedSchools
                  .filter((item) => item.supportFlags?.needsHelp || item.supportFlags?.onboardingIncomplete)
                  .slice(0, 5)
                  .map((item) => (
                    <div
                      key={item.schoolId}
                      className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-medium text-white">{item.name || item.schoolCode}</p>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                            {item.schoolCode}
                          </p>
                        </div>
                        <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200">
                          {item.supportFlags?.needsHelp
                            ? "Needs Help"
                            : "Onboarding Incomplete"}
                        </span>
                      </div>
                    </div>
                  ))}
                {dashboardData.flaggedSchools.length === 0 && (
                  <p className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-5 text-sm text-slate-300">
                    No schools are currently flagged for support.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-lg font-semibold text-white">Latest Support Tickets</h2>
              <div className="mt-4 space-y-3">
                {dashboardData.latestTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium text-white">{ticket.title}</p>
                        <p className="text-sm text-slate-300">{ticket.schoolId}</p>
                      </div>
                      <span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-200">
                        {ticket.status.replace("_", " ")}
                      </span>
                    </div>
                  </div>
                ))}
                {dashboardData.latestTickets.length === 0 && (
                  <p className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-5 text-sm text-slate-300">
                    No support tickets have been created yet.
                  </p>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
