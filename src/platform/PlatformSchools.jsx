import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listPlatformSchools } from "./platformService";

const PAGE_SIZE = 20;

const getStatusBadgeClass = (status) => {
  if (status === "disabled") {
    return "bg-red-500/15 text-red-200";
  }
  if (status === "trial") {
    return "bg-amber-500/15 text-amber-200";
  }
  if (status === "archived") {
    return "bg-slate-700 text-slate-200";
  }
  return "bg-emerald-500/15 text-emerald-200";
};

export default function PlatformSchools() {
  const [schools, setSchools] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [flagFilter, setFlagFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await listPlatformSchools({
          pageSize: PAGE_SIZE,
          searchTerm,
          status: statusFilter,
          flag: flagFilter,
          activity: activityFilter,
        });
        if (!isMounted) return;
        setSchools(result.rows);
        setNextCursor(result.nextCursor);
        setHasMore(result.hasMore);
      } catch (error) {
        if (!isMounted) return;
        console.error("Error loading schools:", error);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }, 250);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [activityFilter, flagFilter, searchTerm, statusFilter]);

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor) return;
    setIsLoadingMore(true);
    try {
      const result = await listPlatformSchools({
        pageSize: PAGE_SIZE,
        cursor: nextCursor,
        searchTerm,
        status: statusFilter,
        flag: flagFilter,
        activity: activityFilter,
      });
      setSchools((prev) => [...prev, ...result.rows]);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (error) {
      console.error("Error loading more schools:", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
          Platform
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Schools Directory</h1>
        <p className="mt-3 text-sm text-slate-300">
          Filter schools by operational status, support flags, and recent activity.
        </p>
      </div>

      <div className="grid gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-5 md:grid-cols-2 xl:grid-cols-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search by school, code, or email"
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none ring-0 transition-colors placeholder:text-slate-500 focus:border-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="trial">Trial</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={flagFilter}
          onChange={(event) => setFlagFilter(event.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
        >
          <option value="all">All support flags</option>
          <option value="needsHelp">Needs help</option>
          <option value="onboardingIncomplete">Onboarding incomplete</option>
        </select>
        <select
          value={activityFilter}
          onChange={(event) => setActivityFilter(event.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
        >
          <option value="all">All activity</option>
          <option value="active">Recently active</option>
          <option value="inactive">Inactive (30+ days)</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-950 text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="px-5 py-4 font-semibold">School</th>
                <th className="px-5 py-4 font-semibold">Status</th>
                <th className="px-5 py-4 font-semibold">Counts</th>
                <th className="px-5 py-4 font-semibold">Session / Term</th>
                <th className="px-5 py-4 font-semibold">Last Active</th>
                <th className="px-5 py-4 font-semibold">Flags</th>
                <th className="px-5 py-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan="7" className="px-5 py-8 text-center text-slate-300">
                    Loading schools...
                  </td>
                </tr>
              ) : schools.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-5 py-8 text-center text-slate-300">
                    No schools matched the current filters.
                  </td>
                </tr>
              ) : (
                schools.map((school) => (
                  <tr key={school.schoolId} className="text-slate-200">
                    <td className="px-5 py-4">
                      <div>
                        <p className="font-medium text-white">{school.name || "Unnamed school"}</p>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          {school.schoolCode}
                        </p>
                        {school.email && (
                          <p className="mt-1 text-xs text-slate-400">{school.email}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(
                          school.status
                        )}`}
                      >
                        {school.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-1 text-xs text-slate-300">
                        <p>Students: {school.counts.students}</p>
                        <p>Teachers: {school.counts.teachers}</p>
                        <p>Enrollments: {school.counts.enrollments}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-300">
                      <p>{school.activeSessionId || "Not set"}</p>
                      <p className="mt-1 uppercase tracking-[0.2em] text-slate-500">
                        {school.activeTermId || "term1"}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-300">
                      {school.lastActiveAtMs
                        ? new Date(school.lastActiveAtMs).toLocaleString()
                        : "Not tracked"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        {school.supportFlags?.needsHelp && (
                          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-semibold text-amber-200">
                            Needs Help
                          </span>
                        )}
                        {school.supportFlags?.onboardingIncomplete && (
                          <span className="rounded-full bg-purple-500/15 px-3 py-1 text-[11px] font-semibold text-purple-200">
                            Onboarding Incomplete
                          </span>
                        )}
                        {!school.supportFlags?.needsHelp &&
                          !school.supportFlags?.onboardingIncomplete && (
                            <span className="text-xs text-slate-500">None</span>
                          )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        to={`/platform/schools/${school.schoolId}`}
                        className="inline-flex rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-600"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoadingMore ? "Loading..." : "Load More Schools"}
          </button>
        </div>
      )}
    </div>
  );
}
