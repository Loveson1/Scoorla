import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthContext } from "../context/AuthContext";
import {
  executeRestoreRequest,
  listRestoreRequests,
  listSupportTickets,
  updateRestoreRequestStatus,
  updateSupportTicketStatus,
} from "./platformService";

const formatTermLabel = (value) => {
  const token = String(value || "").trim().toLowerCase();
  if (token === "term1") return "First Term";
  if (token === "term2") return "Second Term";
  if (token === "term3") return "Third Term";
  return value || "-";
};

const formatClassLabel = (value) => {
  const token = String(value || "").trim();
  if (!token) return "All classes";
  return token
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/([a-zA-Z]+)(\d+)/, (_, prefix, digits) => `${prefix} ${digits}`)
    .toUpperCase();
};

const PAGE_SIZE = 20;

export default function PlatformSupport() {
  const { authUser } = useAuthContext();
  const [tickets, setTickets] = useState([]);
  const [restoreRequests, setRestoreRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMoreTickets, setIsLoadingMoreTickets] = useState(false);
  const [isLoadingMoreRequests, setIsLoadingMoreRequests] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [restoreStatusFilter, setRestoreStatusFilter] = useState("all");
  const [busyRequestId, setBusyRequestId] = useState("");
  const [ticketsCursor, setTicketsCursor] = useState(null);
  const [ticketsHasMore, setTicketsHasMore] = useState(false);
  const [requestsCursor, setRequestsCursor] = useState(null);
  const [requestsHasMore, setRequestsHasMore] = useState(false);

  const loadSupportData = async () => {
    try {
      const [ticketPage, restorePage] = await Promise.all([
        listSupportTickets({ pageSize: PAGE_SIZE }),
        listRestoreRequests({ pageSize: PAGE_SIZE }),
      ]);
      setTickets(ticketPage.rows);
      setRestoreRequests(restorePage.rows);
      setTicketsCursor(ticketPage.nextCursor);
      setTicketsHasMore(ticketPage.hasMore);
      setRequestsCursor(restorePage.nextCursor);
      setRequestsHasMore(restorePage.hasMore);
    } catch (error) {
      console.error("Error loading support queue:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSupportData();
  }, []);

  const filteredTickets = useMemo(() => {
    if (statusFilter === "all") return tickets;
    return tickets.filter((ticket) => ticket.status === statusFilter);
  }, [statusFilter, tickets]);

  const filteredRestoreRequests = useMemo(() => {
    if (restoreStatusFilter === "all") return restoreRequests;
    return restoreRequests.filter((request) => request.status === restoreStatusFilter);
  }, [restoreStatusFilter, restoreRequests]);

  const handleLoadMoreTickets = async () => {
    if (!ticketsHasMore || !ticketsCursor) return;
    setIsLoadingMoreTickets(true);
    try {
      const nextPage = await listSupportTickets({
        pageSize: PAGE_SIZE,
        cursor: ticketsCursor,
      });
      setTickets((prev) => [...prev, ...nextPage.rows]);
      setTicketsCursor(nextPage.nextCursor);
      setTicketsHasMore(nextPage.hasMore);
    } catch (error) {
      console.error("Error loading more tickets:", error);
    } finally {
      setIsLoadingMoreTickets(false);
    }
  };

  const handleLoadMoreRequests = async () => {
    if (!requestsHasMore || !requestsCursor) return;
    setIsLoadingMoreRequests(true);
    try {
      const nextPage = await listRestoreRequests({
        pageSize: PAGE_SIZE,
        cursor: requestsCursor,
      });
      setRestoreRequests((prev) => [...prev, ...nextPage.rows]);
      setRequestsCursor(nextPage.nextCursor);
      setRequestsHasMore(nextPage.hasMore);
    } catch (error) {
      console.error("Error loading more restore requests:", error);
    } finally {
      setIsLoadingMoreRequests(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
          Platform
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Support Queue</h1>
        <p className="mt-3 text-sm text-slate-300">
          Track school tickets and move them through the support lifecycle.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
          >
            <option value="all">All ticket statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
          <select
            value={restoreStatusFilter}
            onChange={(event) => setRestoreStatusFilter(event.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
          >
            <option value="all">All restore request statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Support Tickets</h2>
        {isLoading ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
            Loading tickets...
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
            No tickets matched the current filter.
          </div>
        ) : (
          <>
            {filteredTickets.map((ticket) => (
              <div
                key={ticket.id}
                className="rounded-3xl border border-slate-800 bg-slate-900 p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-lg font-semibold text-white">{ticket.title}</h2>
                      <span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-200">
                        {ticket.priority}
                      </span>
                    </div>
                    <p className="text-sm text-slate-300">{ticket.message}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-500">
                      <span>School: {ticket.schoolId}</span>
                      <Link
                        to={`/platform/schools/${ticket.schoolId}`}
                        className="text-blue-300 hover:text-blue-200"
                      >
                        Open School
                      </Link>
                    </div>
                  </div>

                  <select
                    value={ticket.status}
                    onChange={async (event) => {
                      try {
                        await updateSupportTicketStatus({
                          actorUid: authUser?.uid,
                          ticketId: ticket.id,
                          status: event.target.value,
                        });
                        await loadSupportData();
                      } catch (error) {
                        console.error("Error updating support status:", error);
                        alert(error?.message || "Failed to update status.");
                      }
                    }}
                    className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-semibold text-white outline-none"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
              </div>
            ))}
            {ticketsHasMore && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadMoreTickets}
                  disabled={isLoadingMoreTickets}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingMoreTickets ? "Loading..." : "Load More Tickets"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Historical Restore Requests</h2>
        {isLoading ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
            Loading restore requests...
          </div>
        ) : filteredRestoreRequests.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
            No restore requests matched the current filter.
          </div>
        ) : (
          <>
            {filteredRestoreRequests.map((request) => {
              const isBusy = busyRequestId === request.id;
              const sessionLabel =
                String(request?.sessionName || "").trim() ||
                "Unknown Session";
              return (
                <div
                  key={request.id}
                  className="rounded-3xl border border-slate-800 bg-slate-900 p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-lg font-semibold text-white">
                          {sessionLabel} - {formatTermLabel(request?.termId)}
                        </h3>
                        <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200">
                          {String(request?.status || "open")}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300">
                        School: {request.schoolId} | Class:{" "}
                        {formatClassLabel(request?.classId)}
                      </p>
                      <p className="text-sm text-slate-400">
                        Reason: {String(request?.reason || "No reason provided.")}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-500">
                        <span>Requested by: {request.requestedBy || "-"}</span>
                        <Link
                          to={`/platform/schools/${request.schoolId}`}
                          className="text-blue-300 hover:text-blue-200"
                        >
                          Open School
                        </Link>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <select
                        value={request.status}
                        disabled={isBusy}
                        onChange={async (event) => {
                          try {
                            setBusyRequestId(request.id);
                            await updateRestoreRequestStatus({
                              actorUid: authUser?.uid,
                              schoolId: request.schoolId,
                              requestId: request.id,
                              status: event.target.value,
                            });
                            await loadSupportData();
                          } catch (error) {
                            console.error("Error updating restore request status:", error);
                            alert(error?.message || "Failed to update restore request status.");
                          } finally {
                            setBusyRequestId("");
                          }
                        }}
                        className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-semibold text-white outline-none disabled:opacity-60"
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="rejected">Rejected</option>
                      </select>

                      <button
                        type="button"
                        disabled={
                          isBusy ||
                          request.status === "resolved" ||
                          request.status === "rejected"
                        }
                        onClick={async () => {
                          const confirmed = window.confirm(
                            `Execute restore for ${sessionLabel}, ${formatTermLabel(
                              request?.termId
                            )}${request?.classId ? `, class ${formatClassLabel(request.classId)}` : ""}?`
                          );
                          if (!confirmed) return;
                          try {
                            setBusyRequestId(request.id);
                            await executeRestoreRequest({
                              actorUid: authUser?.uid,
                              schoolId: request.schoolId,
                              requestId: request.id,
                            });
                            await loadSupportData();
                            alert("Restore request executed successfully.");
                          } catch (error) {
                            console.error("Error executing restore request:", error);
                            alert(error?.message || "Failed to execute restore request.");
                          } finally {
                            setBusyRequestId("");
                          }
                        }}
                        className="rounded-xl bg-amber-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isBusy ? "Working..." : "Approve & Execute Restore"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {requestsHasMore && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadMoreRequests}
                  disabled={isLoadingMoreRequests}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingMoreRequests ? "Loading..." : "Load More Restore Requests"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
