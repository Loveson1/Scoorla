import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuthContext } from "../context/AuthContext";
import PlatformConfirmModal from "./PlatformConfirmModal";
import {
  createSupportTicket,
  getPlatformSchoolDetail,
  listAuditLogs,
  listSupportTickets,
  recomputeSchoolCountsWithAudit,
  resetSchoolOnboardingWithAudit,
  saveSchoolInternalNoteWithAudit,
  setSchoolStatusWithAudit,
  setSchoolSupportFlagWithAudit,
  updateSupportTicketStatus,
} from "./platformService";

const statusBadgeClass = (status) => {
  if (status === "disabled") return "bg-red-500/15 text-red-200";
  if (status === "trial") return "bg-amber-500/15 text-amber-200";
  if (status === "archived") return "bg-slate-700 text-slate-200";
  return "bg-emerald-500/15 text-emerald-200";
};

export default function PlatformSchoolDetail() {
  const { schoolId } = useParams();
  const { authUser } = useAuthContext();
  const [school, setSchool] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [ticketForm, setTicketForm] = useState({
    title: "",
    message: "",
    priority: "medium",
  });
  const [isSavingTicket, setIsSavingTicket] = useState(false);
  const [actionState, setActionState] = useState({
    type: "",
    title: "",
    message: "",
    confirmLabel: "",
    confirmClassName: "bg-blue-700 hover:bg-blue-600",
    isWorking: false,
  });

  const loadData = useCallback(async () => {
    if (!schoolId) return;
    try {
      const [schoolDetail, schoolTickets, auditRows] = await Promise.all([
        getPlatformSchoolDetail(schoolId),
        listSupportTickets({ schoolId, pageSize: 20 }),
        listAuditLogs({ schoolId, limit: 12 }),
      ]);
      setSchool(schoolDetail);
      setTickets(schoolTickets.rows);
      setLogs(auditRows);
      setNoteDraft(String(schoolDetail?.notes?.internal || ""));
    } catch (error) {
      console.error("Error loading platform school detail:", error);
    } finally {
      setIsLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      setIsLoading(true);
      if (!isMounted) return;
      await loadData();
    };

    run();
    return () => {
      isMounted = false;
    };
  }, [loadData]);

  const openActionModal = (type) => {
    if (!school) return;
    const stateMap = {
      disable: {
        type,
        title: "Disable School",
        message:
          "This will block school users from accessing the dashboard until the school is enabled again. This action is logged.",
        confirmLabel: "Disable School",
        confirmClassName: "bg-red-700 hover:bg-red-600",
      },
      enable: {
        type,
        title: "Enable School",
        message:
          "This will restore normal dashboard access for the school. This action is logged.",
        confirmLabel: "Enable School",
        confirmClassName: "bg-emerald-700 hover:bg-emerald-600",
      },
      needsHelp: {
        type,
        title: school.supportFlags?.needsHelp ? "Clear Help Flag" : "Set Help Flag",
        message:
          "This toggles the school support flag used in the platform queue. This action is logged.",
        confirmLabel: school.supportFlags?.needsHelp ? "Clear Flag" : "Set Flag",
        confirmClassName: "bg-amber-700 hover:bg-amber-600",
      },
      resetOnboarding: {
        type,
        title: "Reset Onboarding Flag",
        message:
          "This clears the onboarding-incomplete support flag for this school. This action is logged and cannot be silently undone.",
        confirmLabel: "Reset Flag",
        confirmClassName: "bg-blue-700 hover:bg-blue-600",
      },
      recomputeCounts: {
        type,
        title: "Recompute Counts",
        message:
          "This recalculates students, teachers, and enrollments from Firestore and overwrites the cached school counts. This action is logged.",
        confirmLabel: "Recompute",
        confirmClassName: "bg-violet-700 hover:bg-violet-600",
      },
    };

    setActionState({
      ...stateMap[type],
      isWorking: false,
    });
  };

  const closeActionModal = () => {
    if (actionState.isWorking) return;
    setActionState({
      type: "",
      title: "",
      message: "",
      confirmLabel: "",
      confirmClassName: "bg-blue-700 hover:bg-blue-600",
      isWorking: false,
    });
  };

  const handleConfirmedAction = async () => {
    if (!actionState.type || !school || !authUser?.uid) return;
    setActionState((prev) => ({ ...prev, isWorking: true }));
    try {
      if (actionState.type === "disable") {
        await setSchoolStatusWithAudit({
          actorUid: authUser.uid,
          schoolId: school.schoolId,
          status: "disabled",
        });
      } else if (actionState.type === "enable") {
        await setSchoolStatusWithAudit({
          actorUid: authUser.uid,
          schoolId: school.schoolId,
          status: "active",
        });
      } else if (actionState.type === "needsHelp") {
        await setSchoolSupportFlagWithAudit({
          actorUid: authUser.uid,
          schoolId: school.schoolId,
          flag: "needsHelp",
        });
      } else if (actionState.type === "resetOnboarding") {
        await resetSchoolOnboardingWithAudit({
          actorUid: authUser.uid,
          schoolId: school.schoolId,
        });
      } else if (actionState.type === "recomputeCounts") {
        await recomputeSchoolCountsWithAudit({
          actorUid: authUser.uid,
          schoolId: school.schoolId,
        });
      }

      await loadData();
      closeActionModal();
    } catch (error) {
      console.error("Error performing platform action:", error);
      alert(error?.message || "Failed to complete the action.");
      setActionState((prev) => ({ ...prev, isWorking: false }));
    }
  };

  const handleSaveNote = async () => {
    if (!school || !authUser?.uid) return;
    setIsSavingNote(true);
    try {
      await saveSchoolInternalNoteWithAudit({
        actorUid: authUser.uid,
        schoolId: school.schoolId,
        note: noteDraft,
      });
      await loadData();
    } catch (error) {
      console.error("Error saving internal note:", error);
      alert(error?.message || "Failed to save note.");
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleCreateTicket = async (event) => {
    event.preventDefault();
    if (!school || !authUser?.uid) return;
    setIsSavingTicket(true);
    try {
      await createSupportTicket({
        actorUid: authUser.uid,
        schoolId: school.schoolId,
        title: ticketForm.title,
        message: ticketForm.message,
        priority: ticketForm.priority,
      });
      setTicketForm({
        title: "",
        message: "",
        priority: "medium",
      });
      await loadData();
    } catch (error) {
      console.error("Error creating support ticket:", error);
      alert(error?.message || "Failed to create ticket.");
    } finally {
      setIsSavingTicket(false);
    }
  };

  const pendingTickets = useMemo(
    () => tickets.filter((item) => item.status !== "resolved"),
    [tickets]
  );

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-sm text-slate-300">
        Loading school details...
      </div>
    );
  }

  if (!school) {
    return (
      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-sm text-slate-300">
        School not found.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link
              to="/platform/schools"
              className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-300"
            >
              Back to Schools
            </Link>
            <h1 className="mt-2 text-3xl font-semibold text-white">
              {school.name || "Unnamed school"}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <span>{school.schoolCode}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(school.status)}`}>
                {school.status}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {school.status === "disabled" ? (
              <button
                type="button"
                onClick={() => openActionModal("enable")}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
              >
                Enable School
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openActionModal("disable")}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
              >
                Disable School
              </button>
            )}
            <button
              type="button"
              onClick={() => openActionModal("needsHelp")}
              className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
            >
              {school.supportFlags?.needsHelp ? "Clear Help Flag" : "Set Help Flag"}
            </button>
            <button
              type="button"
              onClick={() => openActionModal("recomputeCounts")}
              className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-600"
            >
              Recompute Counts
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 xl:col-span-2">
            <h2 className="text-lg font-semibold text-white">Overview</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Students</p>
                <p className="mt-3 text-3xl font-semibold text-white">{school.counts.students}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Teachers</p>
                <p className="mt-3 text-3xl font-semibold text-white">{school.counts.teachers}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Enrollments</p>
                <p className="mt-3 text-3xl font-semibold text-white">
                  {school.counts.enrollments}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Open Tickets</p>
                <p className="mt-3 text-3xl font-semibold text-white">{pendingTickets.length}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Profile</p>
                <div className="mt-4 space-y-2 text-sm text-slate-300">
                  <p>Name: {school.name || "Not set"}</p>
                  <p>Email: {school.email || "Not set"}</p>
                  <p>Phone: {school.phone || "Not set"}</p>
                  <p>Address: {school.address || "Not set"}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Academic Cycle</p>
                <div className="mt-4 space-y-2 text-sm text-slate-300">
                  <p>Active Session: {school.activeSessionId || "Not set"}</p>
                  <p>Active Term: {school.activeTermId || "term1"}</p>
                  <p>
                    Last Active:{" "}
                    {school.lastActiveAtMs
                      ? new Date(school.lastActiveAtMs).toLocaleString()
                      : "Not tracked"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-white">Support Flags</h2>
                <button
                  type="button"
                  onClick={() => openActionModal("resetOnboarding")}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
                >
                  Reset Onboarding
                </button>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3">
                  <span>Needs Help</span>
                  <span>{school.supportFlags?.needsHelp ? "Yes" : "No"}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3">
                  <span>Onboarding Incomplete</span>
                  <span>{school.supportFlags?.onboardingIncomplete ? "Yes" : "No"}</span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-lg font-semibold text-white">Internal Notes</h2>
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                rows={6}
                className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
                placeholder="Super admin internal notes..."
              />
              <button
                type="button"
                onClick={handleSaveNote}
                disabled={isSavingNote}
                className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingNote ? "Saving..." : "Save Notes"}
              </button>
            </div>
          </section>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Support</h2>
            <form onSubmit={handleCreateTicket} className="mt-4 space-y-4">
              <input
                type="text"
                value={ticketForm.title}
                onChange={(event) =>
                  setTicketForm((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Ticket title"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
              />
              <textarea
                value={ticketForm.message}
                onChange={(event) =>
                  setTicketForm((prev) => ({ ...prev, message: event.target.value }))
                }
                rows={4}
                placeholder="Ticket message"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
              />
              <div className="flex flex-col gap-3 sm:flex-row">
                <select
                  value={ticketForm.priority}
                  onChange={(event) =>
                    setTicketForm((prev) => ({ ...prev, priority: event.target.value }))
                  }
                  className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <button
                  type="submit"
                  disabled={isSavingTicket}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingTicket ? "Creating..." : "Create Ticket"}
                </button>
              </div>
            </form>

            <div className="mt-6 space-y-3">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium text-white">{ticket.title}</p>
                      <p className="mt-1 text-sm text-slate-300">{ticket.message}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                        {ticket.priority} priority
                      </p>
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
                          await loadData();
                        } catch (error) {
                          console.error("Error updating support ticket:", error);
                          alert(error?.message || "Failed to update ticket.");
                        }
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-white outline-none"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </div>
                </div>
              ))}
              {tickets.length === 0 && (
                <p className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-5 text-sm text-slate-300">
                  No support tickets for this school yet.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Audit Trail</h2>
            <div className="mt-4 space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{log.action}</p>
                      <p className="mt-1 text-xs text-slate-400">{log.targetPath}</p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {log.createdAtMs ? new Date(log.createdAtMs).toLocaleString() : ""}
                    </span>
                  </div>
                </div>
              ))}
              {logs.length === 0 && (
                <p className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-5 text-sm text-slate-300">
                  No audit entries yet for this school.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      <PlatformConfirmModal
        isOpen={!!actionState.type}
        title={actionState.title}
        message={actionState.message}
        confirmLabel={actionState.confirmLabel}
        confirmClassName={actionState.confirmClassName}
        isWorking={actionState.isWorking}
        onCancel={closeActionModal}
        onConfirm={handleConfirmedAction}
      />
    </>
  );
}
