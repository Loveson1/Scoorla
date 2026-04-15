import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  canonicalizeResultSelection,
  formatGradingScaleLegend,
  getClassSubjectResultRows,
  getEnabledScoreComponents,
  getResultSelection,
  isResultColumnEnabled,
  shouldUseLastTermCumulative,
} from "./utils/school-data";
import { useSessionContext } from "../context/SessionContext";
import { useAuthContext } from "../context/AuthContext";
import { useSchoolBootstrap } from "../context/SchoolBootstrapContext";

const BRAND = {
  ink: [30, 41, 59],
  slate: [71, 85, 105],
  border: [191, 219, 254],
  softFill: [239, 246, 255],
  brandFill: [219, 234, 254],
  accent: [30, 64, 175],
  accentSoft: [37, 99, 235],
  highlight: [219, 234, 254],
};

const IMAGE_FORMAT_MAP = {
  jpg: "JPEG",
  jpeg: "JPEG",
  png: "PNG",
  webp: "WEBP",
};

const resolveImageFormat = (imageSrc) => {
  if (typeof imageSrc !== "string") return "PNG";
  const match = imageSrc.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/i);
  const extension = String(match?.[1] || "").toLowerCase();
  return IMAGE_FORMAT_MAP[extension] || "PNG";
};

const addPdfImageSafely = (
  pdf,
  imageSrc,
  x,
  y,
  width,
  height,
  options = {},
) => {
  if (!imageSrc) return false;

  const formats = [resolveImageFormat(imageSrc), "PNG", "JPEG"].filter(
    (format, index, list) => list.indexOf(format) === index,
  );

  for (const format of formats) {
    try {
      pdf.addImage(
        imageSrc,
        format,
        x,
        y,
        width,
        height,
        options.alias,
        options.compression || "FAST",
        options.rotation || 0,
      );
      return true;
    } catch {
      // Try the next supported format.
    }
  }

  return false;
};

const getContainedImagePlacement = (
  pdf,
  imageSrc,
  x,
  y,
  maxWidth,
  maxHeight,
) => {
  try {
    if (typeof pdf.getImageProperties !== "function") {
      return { x, y, width: maxWidth, height: maxHeight };
    }

    const properties = pdf.getImageProperties(imageSrc);
    const imageWidth = Number(properties?.width) || maxWidth;
    const imageHeight = Number(properties?.height) || maxHeight;

    if (!imageWidth || !imageHeight) {
      return { x, y, width: maxWidth, height: maxHeight };
    }

    const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;

    return {
      x: x + (maxWidth - width) / 2,
      y: y + (maxHeight - height) / 2,
      width,
      height,
    };
  } catch {
    return { x, y, width: maxWidth, height: maxHeight };
  }
};

const withPdfOpacity = (pdf, opacity, drawFn) => {
  const canUseOpacity =
    typeof pdf.GState === "function" &&
    typeof pdf.setGState === "function" &&
    typeof pdf.saveGraphicsState === "function" &&
    typeof pdf.restoreGraphicsState === "function";

  if (!canUseOpacity) {
    return false;
  }

  try {
    pdf.saveGraphicsState();
    pdf.setGState(new pdf.GState({ opacity }));
    drawFn();
    pdf.restoreGraphicsState();
    return true;
  } catch {
    return false;
  }
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

const formatPdfLine = (value, fallback = "Not provided") => {
  const normalized = String(value || "").trim();
  return normalized || fallback;
};

export default function ResultPreview() {
  const navigate = useNavigate();
  const { isAdmin, canRecordClassSubject, authUser, schoolId } = useAuthContext();
  const { schoolData, adminSettings, isLoading: isBootstrapLoading } = useSchoolBootstrap();
  const {
    selectedSessionId,
    selectedSessionName,
    selectedTermId,
    isHistoricalView,
    isReadOnlyView,
    isPastTermView,
  } = useSessionContext();
  const previewRef = useRef();
  const [resultSelection, setResultSelection] = useState({});
  const [results, setResults] = useState([]);

  const hasRecordAccess =
    isAdmin || canRecordClassSubject(resultSelection.class, resultSelection.subject);
  const resultConfig = useMemo(() => adminSettings?.resultConfig || null, [adminSettings]);

  useEffect(() => {
    if (isBootstrapLoading) return;
    if (!authUser?.uid) {
      navigate("/login", { replace: true });
      return;
    }
    if (!schoolId) {
      navigate("/welcome", { replace: true });
      return;
    }

    const savedSelection = canonicalizeResultSelection(
      getResultSelection(authUser?.uid),
      schoolId
    );
    setResultSelection({
      ...savedSelection,
      term: selectedTermId || savedSelection?.term || "term1",
      sessionId: selectedSessionId || savedSelection?.sessionId || "",
      session: selectedSessionName || savedSelection?.session || "N/A",
    });
  }, [
    authUser?.uid,
    isBootstrapLoading,
    navigate,
    schoolId,
    selectedSessionId,
    selectedSessionName,
    selectedTermId,
  ]);

  const getClassLabel = (classId) => {
    const classMap = {
      jss1: "JSS 1",
      jss2: "JSS 2",
      jss3: "JSS 3",
      sss1: "SSS 1",
      sss2: "SSS 2",
      sss3: "SSS 3",
    };
    return classMap[classId] || classId;
  };

  const getTermLabel = (termId) => {
    const termMap = {
      term1: "First Term",
      term2: "Second Term",
      term3: "Third Term",
      "1st": "First Term",
      "2nd": "Second Term",
      "3rd": "Third Term",
    };
    return termMap[termId] || termId;
  };

  const shouldShowLastTerm = (termId) => shouldUseLastTermCumulative(termId);

  useEffect(() => {
    const loadResults = async () => {
      if (!schoolId || !resultSelection.class) return;

      try {
        if (!hasRecordAccess) {
          setResults([]);
          return;
        }
        const resolvedSessionId =
          resultSelection.sessionId || selectedSessionId || "";
        const resolvedTermId = resultSelection.term || selectedTermId || "term1";

        let previewOverrideScores = {};
        try {
          const previewOverrideKey = `preview_scores_${schoolId || ""}_${resultSelection.class || ""}_${resultSelection.subject || ""}_${resolvedSessionId || ""}_${resolvedTermId || ""}`;
          const raw = sessionStorage.getItem(previewOverrideKey);
          previewOverrideScores = raw ? JSON.parse(raw) : {};
        } catch {
          previewOverrideScores = {};
        }

        const previewRows = await getClassSubjectResultRows({
          schoolId,
          classId: resultSelection.class,
          subjectId: resultSelection.subject,
          termId: resolvedTermId,
          sessionId: resolvedSessionId,
          adminSettings,
          previewOverrides: previewOverrideScores,
          includeInactive: isHistoricalView,
          includeDeleted: isHistoricalView,
          screen: "ResultPreview",
        });
        setResults(previewRows);
      } catch (error) {
        console.error("Error loading results:", error);
      }
    };

    loadResults();
  }, [
    schoolId,
    resultSelection.class,
    resultSelection.subject,
    resultSelection.term,
    resultSelection.sessionId,
    resultSelection.session,
    selectedSessionId,
    selectedTermId,
    isHistoricalView,
    hasRecordAccess,
    adminSettings,
  ]);

  const columns = useMemo(() => {
    const nextColumns = [
      { key: "name", label: "Student Name", align: "left", weight: 28 },
      ...getEnabledScoreComponents(resultConfig).map((component) => ({
        key: component.key,
        label: component.label,
        align: "center",
        weight: 10,
      })),
    ];

    if (isResultColumnEnabled(resultConfig, "ca")) {
      nextColumns.push({ key: "ca", label: "CA", align: "center", weight: 10 });
    }
    if (
      shouldShowLastTerm(resultSelection.term) &&
      isResultColumnEnabled(resultConfig, "examAndCa")
    ) {
      nextColumns.push({
        key: "examAndCa",
        label: "Exam + CA",
        align: "center",
        weight: 12,
      });
    }
    if (
      shouldShowLastTerm(resultSelection.term) &&
      isResultColumnEnabled(resultConfig, "ltc")
    ) {
      nextColumns.push({ key: "lastTermCum", label: "LTC", align: "center", weight: 10 });
    }
    if (isResultColumnEnabled(resultConfig, "total")) {
      nextColumns.push({ key: "total", label: "Total", align: "center", weight: 10 });
    }
    if (isResultColumnEnabled(resultConfig, "classAverage")) {
      nextColumns.push({
        key: "classAverage",
        label: "Class Avg",
        align: "center",
        weight: 11,
      });
    }
    if (isResultColumnEnabled(resultConfig, "highestInClass")) {
      nextColumns.push({
        key: "highestInClass",
        label: "Highest",
        align: "center",
        weight: 11,
      });
    }
    if (isResultColumnEnabled(resultConfig, "lowestInClass")) {
      nextColumns.push({
        key: "lowestInClass",
        label: "Lowest",
        align: "center",
        weight: 11,
      });
    }
    if (isResultColumnEnabled(resultConfig, "position")) {
      nextColumns.push({ key: "position", label: "Pos", align: "center", weight: 8 });
    }
    if (isResultColumnEnabled(resultConfig, "grade")) {
      nextColumns.push({ key: "grade", label: "Grade", align: "center", weight: 9 });
    }
    if (isResultColumnEnabled(resultConfig, "remark")) {
      nextColumns.push({ key: "remark", label: "Remark", align: "left", weight: 16 });
    }

    return nextColumns;
  }, [resultConfig, resultSelection.term]);

  const summaryStats = useMemo(() => {
    if (!results.length) {
      return [
        { label: "Students", value: "0" },
        { label: "Class Average", value: "0" },
        { label: "Top Score", value: "0" },
      ];
    }

    const topScore = results.reduce(
      (highest, result) => Math.max(highest, result.total),
      0,
    );

    return [
      { label: "Students", value: String(results.length) },
      {
        label: "Class Average",
        value: String(results[0]?.classAverage ?? 0),
      },
      { label: "Top Score", value: String(topScore) },
    ];
  }, [results]);

  const legendCards = useMemo(() => {
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
    if (shouldShowLastTerm(resultSelection.term) && isResultColumnEnabled(resultConfig, "ltc")) {
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
  }, [adminSettings, resultConfig, resultSelection.term]);

  const downloadFilename = `${resultSelection.subject || "Subject"}_${getClassLabel(
    resultSelection.class,
  )}_${resultSelection.term || "term"}_${resultSelection.session || "session"}.pdf`;

  const handleDownloadPDF = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const rowHeight = 8;
      const metaTop = 44;
      const tableStartY = 73;
      const tableWidth = pageWidth - margin * 2;
      const totalWeight = columns.reduce(
        (sum, column) => sum + (Number(column.weight) || 0),
        0
      );
      const pdfColumns = columns.map((column) => ({
        ...column,
        width:
          totalWeight > 0
            ? (tableWidth * (Number(column.weight) || 0)) / totalWeight
            : tableWidth / Math.max(columns.length, 1),
      }));
      const availableWidth = pdfColumns.reduce((sum, column) => sum + column.width, 0);
      const tableLeft = margin;
      const printableBottom = pageHeight - 18;
      let currentY = tableStartY;

      const drawPageFrame = () => {
        pdf.setDrawColor(...BRAND.border);
        pdf.setLineWidth(0.5);
        pdf.roundedRect(6, 6, pageWidth - 12, pageHeight - 12, 4, 4);
      };

      const drawHeader = () => {
        drawPageFrame();
        pdf.setFillColor(...BRAND.softFill);
        pdf.roundedRect(margin, 10, pageWidth - margin * 2, 28, 4, 4, "F");

        if (schoolData.logo) {
          const logoBox = getContainedImagePlacement(
            pdf,
            schoolData.logo,
            margin + 4,
            14,
            22,
            18,
          );
          addPdfImageSafely(
            pdf,
            schoolData.logo,
            logoBox.x,
            logoBox.y,
            logoBox.width,
            logoBox.height,
            {
            alias: "school-header-logo",
            },
          );
        }

        pdf.setTextColor(...BRAND.accent);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(18);
        pdf.text(
          formatPdfLine(schoolData.name, "School Name"),
          pageWidth / 2,
          20,
          { align: "center" },
        );

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(...BRAND.slate);
        const headerLine = [
          formatPdfLine(schoolData.address, ""),
          formatPdfLine(schoolData.email, ""),
          formatPdfLine(schoolData.phone, ""),
        ]
          .filter(Boolean)
          .join("  |  ");
        pdf.text(headerLine || "Academic performance summary", pageWidth / 2, 26, {
          align: "center",
        });

        const titleWidth = 88;
        const titleX = (pageWidth - titleWidth) / 2;
        pdf.setFillColor(...BRAND.accentSoft);
        pdf.roundedRect(titleX, 30, titleWidth, 7, 2, 2, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(9.5);
        pdf.text("RESULT SCORE SHEET", pageWidth / 2, 34.8, { align: "center" });

        const cards = [
          `Class: ${getClassLabel(resultSelection.class)}`,
          `Subject: ${resultSelection.subject || "Not set"}`,
          `Term: ${getTermLabel(resultSelection.term)}`,
          `Session: ${resultSelection.session || "Not set"}`,
        ];
        const gap = 4;
        const cardWidth = (pageWidth - margin * 2 - gap * 3) / 4;
        let cardX = margin;

        cards.forEach((card, index) => {
          const isEmphasis = index === 1;
          pdf.setFillColor(...(isEmphasis ? BRAND.highlight : BRAND.brandFill));
          pdf.roundedRect(cardX, metaTop, cardWidth, 12, 3, 3, "F");
          pdf.setDrawColor(...BRAND.border);
          pdf.roundedRect(cardX, metaTop, cardWidth, 12, 3, 3);
          pdf.setTextColor(...BRAND.ink);
          pdf.setFont("helvetica", isEmphasis ? "bold" : "normal");
          pdf.setFontSize(8.5);
          const lines = pdf.splitTextToSize(card, cardWidth - 6);
          pdf.text(lines, cardX + 3, metaTop + 4.8);
          cardX += cardWidth + gap;
        });
      };

      const drawWatermark = () => {
        if (schoolData.logo) {
          let rendered = false;
          const usedOpacity = withPdfOpacity(pdf, 0.05, () => {
            const watermarkBox = getContainedImagePlacement(
              pdf,
              schoolData.logo,
              pageWidth / 2 - 34,
              pageHeight / 2 - 26,
              68,
              68,
            );
            rendered = addPdfImageSafely(
              pdf,
              schoolData.logo,
              watermarkBox.x,
              watermarkBox.y,
              watermarkBox.width,
              watermarkBox.height,
              { alias: "school-watermark" },
            );
          });
          if (usedOpacity && rendered) return;
        }

        pdf.setTextColor(236, 242, 248);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(42);
        pdf.text(
          getSchoolInitials(schoolData.name),
          pageWidth / 2,
          pageHeight / 2,
          { align: "center", angle: 18 },
        );
      };

      const drawTableHeader = (startY) => {
        pdf.setFillColor(...BRAND.accent);
        pdf.roundedRect(tableLeft, startY, availableWidth, rowHeight, 2, 2, "F");

        let x = tableLeft;
        pdfColumns.forEach((column) => {
          pdf.setTextColor(255, 255, 255);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(8.2);
          const textX =
            column.align === "center" ? x + column.width / 2 : x + 3;
          pdf.text(column.label, textX, startY + 5.3, {
            align: column.align === "center" ? "center" : "left",
          });

          pdf.setDrawColor(...BRAND.border);
          pdf.line(x, startY, x, startY + rowHeight);
          x += column.width;
        });
        pdf.line(
          tableLeft + availableWidth,
          startY,
          tableLeft + availableWidth,
          startY + rowHeight,
        );
      };

      const renderPage = (tableY) => {
        drawHeader();
        drawWatermark();
        drawTableHeader(tableY);
      };

      renderPage(currentY);
      currentY += rowHeight;

      results.forEach((result, index) => {
        if (currentY + rowHeight > printableBottom) {
          pdf.addPage();
          currentY = tableStartY;
          renderPage(currentY);
          currentY += rowHeight;
        }

        const rowFill = index % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
        pdf.setFillColor(...rowFill);
        pdf.rect(tableLeft, currentY, availableWidth, rowHeight, "F");

        let x = tableLeft;
        pdfColumns.forEach((column) => {
          pdf.setDrawColor(...BRAND.border);
          pdf.rect(x, currentY, column.width, rowHeight);

          const rawValue = result[column.key];
          const cellValue =
            column.key === "lastTermCum" && (rawValue === null || rawValue === undefined)
              ? "-"
              : String(rawValue ?? "");
          const safeValue =
            column.key === "name" && cellValue.length > 24
              ? `${cellValue.slice(0, 21)}...`
              : cellValue;

          if (column.key === "grade") {
            pdf.setTextColor(...BRAND.accent);
            pdf.setFont("helvetica", "bold");
          } else if (column.key === "total") {
            pdf.setTextColor(...BRAND.accent);
            pdf.setFont("helvetica", "bold");
          } else {
            pdf.setTextColor(...BRAND.ink);
            pdf.setFont("helvetica", column.key === "name" ? "bold" : "normal");
          }

          pdf.setFontSize(8.5);
          const textX =
            column.align === "center" ? x + column.width / 2 : x + 3;
          pdf.text(safeValue, textX, currentY + 5.3, {
            align: column.align === "center" ? "center" : "left",
          });

          x += column.width;
        });

        currentY += rowHeight;
      });

      const footerY = pageHeight - 11;
      pdf.setDrawColor(...BRAND.border);
      pdf.line(margin, footerY - 4, pageWidth - margin, footerY - 4);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(...BRAND.slate);
      const legendParts = [];
      if (isResultColumnEnabled(resultConfig, "ca")) {
        legendParts.push("CA = Continuous Assessment");
      }
      if (shouldShowLastTerm(resultSelection.term) && isResultColumnEnabled(resultConfig, "ltc")) {
        legendParts.push("LTC = Last Term Cumulative");
      }
      if (isResultColumnEnabled(resultConfig, "position")) {
        legendParts.push("Pos = Position");
      }
      pdf.text(
        legendParts.length ? `Legend: ${legendParts.join(", ")}` : "Legend: Configured result layout",
        margin,
        footerY,
      );
      pdf.text(
        formatGradingScaleLegend(adminSettings?.gradingScale, resultConfig) || "Grading scale set by school",
        pageWidth - margin,
        footerY,
        {
        align: "right",
        }
      );

      pdf.save(downloadFilename);
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Error generating PDF. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(191,219,254,0.42),_transparent_38%),linear-gradient(180deg,_#f8fbff_0%,_#eff6ff_42%,_#f8fbff_100%)] px-3 py-4 md:px-8 md:py-6">
      {!hasRecordAccess ? (
        <div className="mx-auto mb-4 max-w-6xl rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
          You are not assigned to this resource.
        </div>
      ) : null}
      {isReadOnlyView && (
        <div className="mx-auto mb-4 max-w-6xl rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {isHistoricalView
            ? "Viewing historical session data."
            : isPastTermView
              ? "Viewing a past term in read-only mode."
              : "This preview is read-only."}
        </div>
      )}

      <div className="mx-auto mb-4 flex max-w-6xl flex-wrap justify-center gap-3 md:mb-6">
        <button
          onClick={() => navigate("/record-dashboard")}
          className="px-6 py-2 border-2 border-gray-300 dark:border-gray-600 text-black dark:text-black font-semibold rounded-lg hover:bg-gray-100 dark:hover:bg-gray-100 transition-all duration-300"
        >
          Back
        </button>
        <button
          onClick={handleDownloadPDF}
          disabled={!hasRecordAccess}
          className="px-6 py-2 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300 disabled:cursor-not-allowed disabled:bg-green-300"
        >
          Download Score Sheet
        </button>
      </div>

      <div ref={previewRef} className="mx-auto max-w-6xl">
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
                      className="h-12 w-12 rounded-2xl object-cover md:h-16 md:w-16"
                    />
                  </div>
                ) : null}
                <div className="max-w-2xl">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.35em] text-slate-300">
                    Academic Performance Ledger
                  </p>
                  <h1 className="mt-1 text-xl font-semibold tracking-tight md:mt-2 md:text-3xl">
                    {schoolData.name || "School Name"}
                  </h1>
                  {schoolData.motto ? (
                  <p className="mt-1 text-sm text-slate-200">
                      {schoolData.motto}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-slate-300">
                    {formatPdfLine(schoolData.address, "School address not set")}
                  </p>
                  {(schoolData.email || schoolData.phone) && (
                    <p className="mt-1 text-xs text-slate-300">
                      {[schoolData.email, schoolData.phone].filter(Boolean).join("  |  ")}
                    </p>
                  )}
                </div>
              </div>

              <div className="hidden min-w-full grid-cols-2 gap-2 md:grid md:min-w-[24rem] md:gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-sm">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-slate-300">
                    Class
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {getClassLabel(resultSelection.class)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-sm">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-slate-300">
                    Subject
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {resultSelection.subject || "Not selected"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-sm">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-slate-300">
                    Term
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {getTermLabel(resultSelection.term)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-sm">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-slate-300">
                    Session
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {resultSelection.session || "Not selected"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 border-b border-blue-100 bg-blue-50/70 px-4 py-4 md:px-8 md:py-5">
            <div className="hidden grid-cols-3 gap-2 sm:grid md:gap-3">
              {summaryStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-blue-100 bg-white px-3 py-2 md:px-4 md:py-3 shadow-sm"
                >
                  <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-blue-700 md:text-[0.7rem] md:tracking-[0.28em]">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold tracking-tight text-slate-900 md:mt-2 md:text-2xl">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 px-4 py-5 md:px-8 md:py-8">
            <div className="mb-3 flex flex-col gap-1 md:mb-4 md:gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-blue-700">
                  Continuous Assessment Summary
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 md:mt-2 md:text-2xl">
                  Subject Score Register
                </h2>
              </div>
            </div>

            {results.length ? (
              <div className="overflow-x-auto rounded-3xl border border-blue-100 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-blue-800 text-white">
                      {columns.map((column) => (
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
                    {results.map((result, index) => (
                      <tr
                        key={result.id}
                        className={index % 2 === 0 ? "bg-white" : "bg-blue-50/40"}
                      >
                        {columns.map((column) => {
                          const rawValue = result[column.key];
                          const cellValue =
                            column.key === "lastTermCum" &&
                            (rawValue === null || rawValue === undefined)
                              ? "-"
                              : String(rawValue ?? "");

                          const emphasisClass =
                            column.key === "total" || column.key === "grade"
                              ? "font-semibold text-blue-700"
                              : column.key === "name"
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
                  No results available yet
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Once scores are recorded for this class and subject, they will appear here.
                </p>
              </div>
            )}

            <div className="mt-4 hidden grid-cols-2 gap-2 sm:grid md:mt-6 md:gap-3 xl:grid-cols-5">
              {legendCards.map((card) => (
                <div
                  key={card.key}
                  className="rounded-2xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-slate-600 md:px-4 md:py-3 md:text-sm"
                >
                  <span className="font-semibold text-slate-900">{card.title}:</span>{" "}
                  {card.body}
                </div>
              ))}
            </div>
            <p className="mt-4 hidden text-center text-xs font-semibold uppercase tracking-[0.3em] text-blue-700/80 sm:block">
              Powered by Scoorla
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}





