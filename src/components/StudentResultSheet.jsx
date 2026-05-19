import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { downloadStudentResultPdf } from "../utils/studentResultPdf";
import {
  formatGradingScaleLegend,
  getClassSelection,
  getDepartmentAwareClassStudents,
  getEnabledScoreComponents,
  getStudentReportRows,
  isResultColumnEnabled,
  roundScore,
} from "./utils/school-data";
import { useAuthContext } from "../context/AuthContext";
import { useSchoolBootstrap } from "../context/SchoolBootstrapContext";
import {
  buildClassDashboardPath,
  formatScopedClassLabel,
} from "../utils/departmentUtils";

const formatPdfLine = (value, fallback = "Not provided") => {
  const normalized = String(value || "").trim();
  return normalized || fallback;
};

const getSchoolInitials = (name) => {
  const initials = String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return initials || "SCH";
};

const getClassLabel = (classId, departmentName = "") =>
  formatScopedClassLabel(classId || "Not set", departmentName);

const getTermLabel = (termId) => {
  const termMap = {
    term1: "First Term",
    term2: "Second Term",
    term3: "Third Term",
    "1st": "First Term",
    "2nd": "Second Term",
    "3rd": "Third Term",
  };
  return termMap[termId] || termId || "Not set";
};

const formatDate = (dateString) => {
  if (!dateString) return "Not set";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

export default function StudentResultSheet() {
  const navigate = useNavigate();
  const { authUser, schoolId } = useAuthContext();
  const { schoolData, adminSettings, isLoading: isBootstrapLoading } = useSchoolBootstrap();
  const [studentData, setStudentData] = useState(null);
  const [classData, setClassData] = useState(null);
  const [studentResults, setStudentResults] = useState([]);
  const [isResultsLoading, setIsResultsLoading] = useState(false);
  const [hasResolvedResults, setHasResolvedResults] = useState(false);
  const [totalStudentsInClass, setTotalStudentsInClass] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const loadResults = async () => {
      const studentJson = sessionStorage.getItem("selectedStudent");
      if (!studentJson) {
        navigate("/school-dashboard");
        return;
      }

      const classInfo = getClassSelection();
      if (!classInfo?.class) {
        navigate("/school-dashboard");
        return;
      }

      let parsedStudent = null;
      try {
        parsedStudent = JSON.parse(studentJson);
      } catch {
        navigate("/school-dashboard");
        return;
      }

      if (!isMounted) return;
      setStudentData(parsedStudent);
      setClassData(classInfo);

      const resolvedSchoolId = schoolId || classInfo.schoolId;
      if (isBootstrapLoading && !resolvedSchoolId) return;
      if (!authUser?.uid && !resolvedSchoolId) return;
      if (!resolvedSchoolId) return;

      setIsResultsLoading(true);
      setHasResolvedResults(false);
      setStudentResults([]);

      try {
        const activeSettings = adminSettings;
        const subjectResults = await getStudentReportRows({
          schoolId: resolvedSchoolId,
          classId: classInfo.class,
          studentId: parsedStudent.id,
          departmentId: classInfo.departmentId || parsedStudent.departmentId || "",
          termId: classInfo.term,
          sessionId: classInfo.sessionId || classInfo.session,
          adminSettings: activeSettings,
          screen: "StudentResult",
        });

        if (!isMounted) return;
        setStudentResults(subjectResults);
      } catch (error) {
        console.error("Error loading student results:", error);
        if (!isMounted) return;
        setStudentResults([]);
      } finally {
        if (isMounted) {
          setIsResultsLoading(false);
          setHasResolvedResults(true);
        }
      }
    };

    loadResults();

    return () => {
      isMounted = false;
    };
  }, [adminSettings, authUser?.uid, isBootstrapLoading, navigate, schoolId]);

  useEffect(() => {
    const loadClassSize = async () => {
      if (!classData?.class) return;

      const resolvedSchoolId = schoolId || classData.schoolId;
      if (!resolvedSchoolId) return;

      try {
        const students = await getDepartmentAwareClassStudents(resolvedSchoolId, classData.class, {
          sessionId: classData.sessionId || classData.session,
          termId: classData.term,
          departmentId: classData.departmentId || "",
          classStructure: adminSettings?.classStructure || {},
        });
        setTotalStudentsInClass(Array.isArray(students) ? students.length : 0);
      } catch (error) {
        console.warn("Unable to load class size for report:", error?.message || error);
        setTotalStudentsInClass(0);
      }
    };

    loadClassSize();
  }, [adminSettings?.classStructure, classData, schoolId]);

  const isFirstTerm = useMemo(
    () => classData?.term === "term1" || classData?.term === "1st",
    [classData?.term],
  );

  const tableColumns = useMemo(() => {
    const resultConfig = adminSettings?.resultConfig || null;
    const columns = [
      { key: "subject", label: "Subject", align: "left" },
      ...getEnabledScoreComponents(resultConfig).map((component) => ({
        key: component.key,
        label: component.label,
        align: "center",
      })),
    ];

    if (isResultColumnEnabled(resultConfig, "ca")) {
      columns.push({ key: "ca", label: "CA", align: "center" });
    }
    if (!isFirstTerm && isResultColumnEnabled(resultConfig, "examAndCa")) {
      columns.push({ key: "examAndCa", label: "Exam + CA", align: "center" });
    }
    if (!isFirstTerm && isResultColumnEnabled(resultConfig, "ltc")) {
      columns.push({ key: "lastTermCumulative", label: "LTC", align: "center" });
    }
    if (isResultColumnEnabled(resultConfig, "total")) {
      columns.push({ key: "total", label: "Total", align: "center" });
    }
    if (isResultColumnEnabled(resultConfig, "classAverage")) {
      columns.push({ key: "classAverage", label: "Avg", align: "center" });
    }
    if (isResultColumnEnabled(resultConfig, "highestInClass")) {
      columns.push({ key: "highestInClass", label: "Highest", align: "center" });
    }
    if (isResultColumnEnabled(resultConfig, "lowestInClass")) {
      columns.push({ key: "lowestInClass", label: "Lowest", align: "center" });
    }
    if (isResultColumnEnabled(resultConfig, "position")) {
      columns.push({ key: "position", label: "Pos", align: "center" });
    }
    if (isResultColumnEnabled(resultConfig, "grade")) {
      columns.push({ key: "grade", label: "Grade", align: "center" });
    }
    if (isResultColumnEnabled(resultConfig, "remark")) {
      columns.push({ key: "remark", label: "Remark", align: "left" });
    }

    return columns;
  }, [adminSettings, isFirstTerm]);

  const summaryStats = useMemo(() => {
    if (!studentResults.length) {
      const placeholderValue = hasResolvedResults && !isResultsLoading ? "0" : "...";
      return [
        { label: "Subjects", value: placeholderValue },
        { label: "Average Score", value: placeholderValue },
        { label: "Best Score", value: placeholderValue },
      ];
    }

    const totalScore = studentResults.reduce(
      (sum, result) => sum + (Number(result.total) || 0),
      0,
    );
    const bestScore = studentResults.reduce(
      (highest, result) => Math.max(highest, Number(result.total) || 0),
      0,
    );
    const averageScore = roundScore(totalScore / studentResults.length);

    return [
      { label: "Subjects", value: String(studentResults.length) },
      { label: "Average Score", value: String(averageScore) },
      { label: "Best Score", value: String(bestScore) },
    ];
  }, [hasResolvedResults, isResultsLoading, studentResults]);

  const legendCards = useMemo(() => {
    const resultConfig = adminSettings?.resultConfig || null;
    const items = [];
    const enabledLabels = getEnabledScoreComponents(resultConfig).map(
      (component) => component.label
    );

    if (enabledLabels.length) {
      items.push({
        key: "inputs",
        title: "Inputs",
        body: enabledLabels.join(" / "),
      });
    }
    if (isResultColumnEnabled(resultConfig, "ca")) {
      items.push({
        key: "ca",
        title: "CA",
        body: "Continuous Assessment total",
      });
    }
    if (!isFirstTerm && isResultColumnEnabled(resultConfig, "ltc")) {
      items.push({
        key: "ltc",
        title: "LTC",
        body: "Last Term Cumulative",
      });
    }
    if (isResultColumnEnabled(resultConfig, "position")) {
      items.push({
        key: "position",
        title: "Pos",
        body: "Ranked position in class",
      });
    }
    items.push({
      key: "grades",
      title: "Grades",
      body:
        formatGradingScaleLegend(adminSettings?.gradingScale, resultConfig) ||
        "Grading scale set by school",
    });

    return items;
  }, [adminSettings, isFirstTerm]);

  const canDownloadResults = hasResolvedResults && !isResultsLoading;

  const generateAndDownloadPDF = useCallback(
    async (student, classInfo, results) => {
      if (!student || !classInfo) return;
      if (!Array.isArray(results) || !results.length) {
        alert("No result data is available for this student yet.");
        return;
      }

      try {
        const saved = await downloadStudentResultPdf({
          student,
          classInfo,
          results,
          schoolData,
          adminSettings,
          totalStudentsInClass,
        });
        if (!saved) {
          alert("No result data is available for this student yet.");
        }
      } catch (error) {
        console.error("Error generating PDF:", error);
        alert("Error generating PDF. Please try again.");
      }
    },
    [adminSettings, schoolData, totalStudentsInClass],
  );

  const handleDownloadResultClick = useCallback(async () => {
    if (!studentData || !classData) return;

    if (isResultsLoading || !hasResolvedResults) {
      alert("Result data is still loading. Please wait a moment.");
      return;
    }

    if (!studentResults.length) {
      alert("No result data is available for this student yet.");
      return;
    }

    await generateAndDownloadPDF(studentData, classData, studentResults);
  }, [
    classData,
    generateAndDownloadPDF,
    hasResolvedResults,
    isResultsLoading,
    studentData,
    studentResults,
  ]);

  if (!studentData || !classData) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(191,219,254,0.42),_transparent_38%),linear-gradient(180deg,_#f8fbff_0%,_#eff6ff_42%,_#f8fbff_100%)] p-3 md:p-8">
      <div className="mb-4 flex justify-center gap-3 md:mb-8 md:gap-4">
        <button
          onClick={() => {
            sessionStorage.removeItem("selectedStudent");
            navigate(
              buildClassDashboardPath({
                classId: classData.class,
                departmentId: classData.departmentId || studentData.departmentId || "",
                classStructure: adminSettings?.classStructure || {},
              })
            );
          }}
          className="px-8 py-2 border-2 border-gray-300 dark:border-gray-600 text-black dark:text-black font-semibold rounded-lg hover:bg-gray-100 dark:hover:bg-gray-100 transition-all duration-300"
        >
          Back
        </button>
        <button
          onClick={handleDownloadResultClick}
          disabled={!canDownloadResults}
          className="px-8 py-2 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300 disabled:cursor-not-allowed disabled:bg-green-300"
        >
          {isResultsLoading ? "Preparing..." : "Download Result"}
        </button>
      </div>

      <div className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-[2rem] border border-blue-100 bg-white shadow-[0_28px_60px_-30px_rgba(37,99,235,0.24)]">
          {schoolData.logo ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <img
                src={schoolData.logo}
                alt=""
                aria-hidden="true"
                className="h-72 w-72 max-w-[55%] object-contain opacity-[0.045]"
              />
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rotate-[-18deg] text-8xl font-black tracking-[0.35em] text-blue-50">
                {getSchoolInitials(schoolData.name)}
              </span>
            </div>
          )}

          <div className="relative z-10 border-b border-blue-200 bg-[linear-gradient(135deg,_rgba(30,64,175,0.98),_rgba(37,99,235,0.94))] px-4 py-4 text-white md:px-8 md:py-7">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-3 md:gap-4">
                {schoolData.logo ? (
                  <div className="rounded-3xl border border-white/20 bg-white/10 p-2 backdrop-blur-sm">
                    <img
                      src={schoolData.logo}
                      alt={schoolData.name || "School logo"}
                      className="h-14 w-14 rounded-2xl bg-white/5 object-contain md:h-16 md:w-16"
                    />
                  </div>
                ) : null}
                <div className="max-w-2xl">
                  <h1 className="text-xl font-semibold tracking-tight md:mt-2 md:text-3xl">
                    {schoolData.name || "School Name"}
                  </h1>
                  {schoolData.motto ? (
                    <p className="mt-1 text-sm text-blue-100/95">
                      {schoolData.motto}
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm text-blue-100">
                    {formatPdfLine(schoolData.address, "School address not set")}
                  </p>
                  {(schoolData.email || schoolData.phone) && (
                    <p className="mt-1 text-xs text-blue-100/85">
                      {[schoolData.email, schoolData.phone].filter(Boolean).join("  |  ")}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid min-w-full grid-cols-2 gap-2 md:min-w-[24rem] md:gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 backdrop-blur-sm md:px-4">
                  <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-blue-100">
                    Term
                  </p>
                  <p className="mt-1 text-sm font-semibold md:text-lg">
                    {getTermLabel(classData.term)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 backdrop-blur-sm md:px-4">
                  <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-blue-100">
                    Session
                  </p>
                  <p className="mt-1 text-sm font-semibold md:text-lg">
                    {classData.session || "Not set"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 backdrop-blur-sm md:px-4">
                  <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-blue-100">
                    Student
                  </p>
                  <p className="mt-1 text-sm font-semibold md:text-lg">
                    {studentData.name}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 backdrop-blur-sm md:px-4">
                  <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-blue-100">
                    Registration No
                  </p>
                  <p className="mt-1 text-sm font-semibold md:text-lg">
                    {studentData.regNumber || "N/A"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 border-b border-blue-100 bg-blue-50/70 px-4 py-4 md:px-8 md:py-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {summaryStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm"
                >
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-blue-700">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 px-4 py-5 md:px-8 md:py-8">
            <div className="mb-5 grid gap-3 grid-cols-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-blue-700">
                  Class
                </p>
                <p className="mt-2 text-base font-semibold text-slate-900 md:text-lg">
                  {getClassLabel(
                    classData.class,
                    classData.departmentName || studentData.departmentName || ""
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-blue-700">
                  Sex
                </p>
                <p className="mt-2 text-base font-semibold text-slate-900 md:text-lg">
                  {studentData.sex || studentData.gender || "N/A"}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-1 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-blue-700">
                  Next Term Begins
                </p>
                <p className="mt-2 text-base font-semibold text-slate-900 md:text-lg">
                  {formatDate(adminSettings?.nextTermBegins)}
                </p>
              </div>
            </div>

            <div className="mb-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-blue-700">
                Scholastic Performance
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">
                Student Result Breakdown
              </h2>
            </div>

            {isResultsLoading ? (
              <div className="rounded-3xl border border-blue-100 bg-blue-50/60 px-6 py-12 text-center">
                <p className="text-lg font-semibold text-slate-900">
                  Preparing result data...
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  The score table will appear as soon as subject records finish loading.
                </p>
              </div>
            ) : studentResults.length ? (
              <div className="overflow-x-auto rounded-3xl border border-blue-100 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-blue-800 text-white">
                      {tableColumns.map((column) => (
                        <th
                          key={column.key}
                          className={`border border-blue-700 px-3 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${
                            column.align === "center" ? "text-center" : "text-left"
                          }`}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {studentResults.map((result, index) => (
                      <tr
                        key={`${result.subject}-${index}`}
                        className={index % 2 === 0 ? "bg-white" : "bg-blue-50/40"}
                      >
                        {tableColumns.map((column) => {
                          const rawValue = result[column.key];
                          const cellValue =
                            column.key === "lastTermCumulative" &&
                            (rawValue === null || rawValue === undefined || rawValue === "")
                              ? "-"
                              : String(rawValue ?? "");

                          const emphasisClass =
                            column.key === "total" || column.key === "grade"
                              ? "font-semibold text-blue-700"
                              : column.key === "subject"
                                ? "font-medium text-slate-900"
                                : "text-slate-700";

                          return (
                            <td
                              key={column.key}
                              className={`border border-blue-100 px-3 py-3 ${
                                column.align === "center" ? "text-center" : "text-left"
                              } ${emphasisClass}`}
                            >
                              {cellValue}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-blue-200 bg-blue-50/60 px-6 py-12 text-center">
                <p className="text-lg font-semibold text-slate-900">
                  No subject scores available yet
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Once subject scores exist for this student, the result table will appear here.
                </p>
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {legendCards.map((card) => (
                <div
                  key={card.key}
                  className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-slate-600"
                >
                  <span className="font-semibold text-slate-900">{card.title}:</span>{" "}
                  {card.body}
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-xs font-semibold uppercase tracking-[0.3em] text-blue-700/80">
              Powered by Scoorla
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
