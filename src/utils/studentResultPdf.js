import {
  formatGradingScaleLegend,
  getEnabledScoreComponents,
  isResultColumnEnabled,
} from "../components/utils/school-data";
import { formatScopedClassLabel } from "./departmentUtils";

const BRAND = {
  ink: [30, 41, 59],
  slate: [71, 85, 105],
  border: [191, 219, 254],
  softFill: [239, 246, 255],
  accent: [30, 64, 175],
  accentSoft: [37, 99, 235],
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

const getStudentReportClassLabel = (classId, departmentName = "") =>
  formatScopedClassLabel(classId, departmentName);

const getStudentReportTermLabel = (termId) => {
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

const isLaterTerm = (termId) => {
  const normalized = String(termId || "").trim().toLowerCase();
  return normalized === "term2" || normalized === "2nd" || normalized === "term3" || normalized === "3rd";
};

const formatStudentReportDate = (dateString) => {
  if (!dateString) return "Not set";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Not set";
  const options = { year: "numeric", month: "long", day: "numeric" };
  return date.toLocaleDateString("en-US", options);
};

const buildStudentReportPdfColumns = (termId, resultConfig) => {
  const isFirstTerm = termId === "term1" || termId === "1st";
  const columns = [
    { key: "subject", label: "Subject", align: "left", weight: 24 },
    ...getEnabledScoreComponents(resultConfig).map((component) => ({
      key: component.key,
      label: component.label,
      align: "center",
      weight: 10,
    })),
  ];

  if (isResultColumnEnabled(resultConfig, "ca")) {
    columns.push({ key: "ca", label: "CA", align: "center", weight: 9 });
  }
  if (!isFirstTerm && isResultColumnEnabled(resultConfig, "examAndCa")) {
    columns.push({ key: "examAndCa", label: "Exam + CA", align: "center", weight: 11 });
  }
  if (!isFirstTerm && isResultColumnEnabled(resultConfig, "ltc")) {
    columns.push({ key: "lastTermCumulative", label: "LTC", align: "center", weight: 9 });
  }
  if (isResultColumnEnabled(resultConfig, "total")) {
    columns.push({ key: "total", label: "Total", align: "center", weight: 9 });
  }
  if (isResultColumnEnabled(resultConfig, "classAverage")) {
    columns.push({ key: "classAverage", label: "Class Avg", align: "center", weight: 10 });
  }
  if (isResultColumnEnabled(resultConfig, "highestInClass")) {
    columns.push({ key: "highestInClass", label: "Highest", align: "center", weight: 10 });
  }
  if (isResultColumnEnabled(resultConfig, "lowestInClass")) {
    columns.push({ key: "lowestInClass", label: "Lowest", align: "center", weight: 10 });
  }
  if (isResultColumnEnabled(resultConfig, "position")) {
    columns.push({ key: "position", label: "Pos", align: "center", weight: 8 });
  }
  if (isResultColumnEnabled(resultConfig, "grade")) {
    columns.push({ key: "grade", label: "Grade", align: "center", weight: 8 });
  }
  if (isResultColumnEnabled(resultConfig, "remark")) {
    columns.push({ key: "remark", label: "Remark", align: "left", weight: 16 });
  }

  return columns;
};

export const downloadStudentResultPdf = async ({
  student,
  classInfo,
  results,
  schoolData = {},
  adminSettings = null,
  totalStudentsInClass = 0,
}) => {
  if (!student || !classInfo || !Array.isArray(results) || !results.length) {
    return false;
  }

  const resultConfig = adminSettings?.resultConfig || null;
  const baseColumns = buildStudentReportPdfColumns(classInfo.term, resultConfig);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const rowHeight = 6.5;
  const summaryY = 52;
  const summaryHeight = 34;
  const tableStartY = 94;
  const printableBottom = pageHeight - 20;
  const tableWidth = pageWidth - margin * 2;
  const totalWeight = baseColumns.reduce(
    (sum, column) => sum + (Number(column.weight) || 0),
    0
  );
  const tableColumns = baseColumns.map((column) => ({
    ...column,
    width:
      totalWeight > 0
        ? (tableWidth * (Number(column.weight) || 0)) / totalWeight
        : tableWidth / Math.max(baseColumns.length, 1),
  }));
  const availableWidth = tableColumns.reduce((sum, column) => sum + column.width, 0);
  const tableLeft = margin;
  let currentY = tableStartY;

  const drawFrame = () => {
    pdf.setDrawColor(...BRAND.border);
    pdf.setLineWidth(0.45);
    pdf.roundedRect(6, 6, pageWidth - 12, pageHeight - 12, 4, 4);
  };

  const drawHeader = () => {
    drawFrame();
    pdf.setFillColor(...BRAND.softFill);
    pdf.roundedRect(margin, 10, pageWidth - margin * 2, 34, 4, 4, "F");
    pdf.setDrawColor(...BRAND.border);
    pdf.roundedRect(margin, 10, pageWidth - margin * 2, 34, 4, 4);

    if (schoolData.logo) {
      const logoBox = getContainedImagePlacement(
        pdf,
        schoolData.logo,
        margin + 3,
        14,
        24,
        20,
      );
      addPdfImageSafely(
        pdf,
        schoolData.logo,
        logoBox.x,
        logoBox.y,
        logoBox.width,
        logoBox.height,
        { alias: "student-report-logo" },
      );
    }

    pdf.setTextColor(...BRAND.accent);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text(
      formatPdfLine(schoolData.name, "School Name"),
      pageWidth / 2,
      18.5,
      { align: "center" },
    );

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.2);
    pdf.setTextColor(...BRAND.slate);
    const mottoLine = String(schoolData.motto || "").trim();
    if (mottoLine) {
      pdf.text(mottoLine, pageWidth / 2, 23.5, { align: "center" });
    }

    const headerLine = [
      formatPdfLine(schoolData.address, ""),
      formatPdfLine(schoolData.email, ""),
      formatPdfLine(schoolData.phone, ""),
    ]
      .filter(Boolean)
      .join("  |  ");
    pdf.text(headerLine || "Student performance report", pageWidth / 2, 28.5, {
      align: "center",
    });

    pdf.setFillColor(...BRAND.accentSoft);
    pdf.roundedRect(42, 32, pageWidth - 84, 7.5, 2.4, 2.4, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.8);
    pdf.text("STUDENT ACADEMIC REPORT CARD", pageWidth / 2, 36.8, {
      align: "center",
    });
  };

  const drawWatermark = () => {
    if (schoolData.logo) {
      let rendered = false;
      const usedOpacity = withPdfOpacity(pdf, 0.03, () => {
        const watermarkBox = getContainedImagePlacement(
          pdf,
          schoolData.logo,
          pageWidth / 2 - 95,
          pageHeight / 2 - 95,
          190,
          190,
        );
        rendered = addPdfImageSafely(
          pdf,
          schoolData.logo,
          watermarkBox.x,
          watermarkBox.y,
          watermarkBox.width,
          watermarkBox.height,
          { alias: "student-report-watermark" },
        );
      });
      if (usedOpacity && rendered) return;
    }

    pdf.setTextColor(219, 234, 254);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(38);
    pdf.text(getSchoolInitials(schoolData.name), pageWidth / 2, pageHeight / 2, {
      align: "center",
      angle: 18,
    });
  };

  const drawSummaryColumns = () => {
    const gap = 4;
    const columnWidth = (pageWidth - margin * 2 - gap) / 2;
    const innerGap = 3;
    const titleOffset = 5;
    const contentStartY = summaryY + 9;
    const innerCardWidth = (columnWidth - 9) / 2;
    const innerCardHeight = 10;
    const leftItems = [
      ["Student Name", student.name || "Not set"],
      ["Student Reg", student.regNumber || "N/A"],
      ["Gender", student.sex || student.gender || "N/A"],
      ["Class", getStudentReportClassLabel(classInfo.class, classInfo.departmentName)],
    ];
    const rightItems = [
      ["Term", getStudentReportTermLabel(classInfo.term)],
      ["Session", classInfo.session || "Not set"],
      ["Total In Class", String(totalStudentsInClass || 0)],
      ["Next Term Begins", formatStudentReportDate(adminSettings?.nextTermBegins)],
    ];
    const columnsData = [leftItems, rightItems];

    columnsData.forEach((items, columnIndex) => {
      const columnX = margin + columnIndex * (columnWidth + gap);
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(columnX, summaryY, columnWidth, summaryHeight, 3, 3, "F");
      pdf.setDrawColor(...BRAND.border);
      pdf.setLineWidth(0.12);
      pdf.roundedRect(columnX, summaryY, columnWidth, summaryHeight, 3, 3);

      pdf.setTextColor(...BRAND.accent);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.4);
      pdf.text(
        columnIndex === 0 ? "Student Details" : "Academic Cycle",
        columnX + 3,
        summaryY + titleOffset,
      );

      items.forEach(([label, value], itemIndex) => {
        const cellX =
          columnX + 3 + (itemIndex % 2) * (innerCardWidth + innerGap);
        const cellY =
          contentStartY + Math.floor(itemIndex / 2) * (innerCardHeight + innerGap);

        pdf.setFillColor(...BRAND.softFill);
        pdf.roundedRect(
          cellX,
          cellY,
          innerCardWidth,
          innerCardHeight,
          1.6,
          1.6,
          "F",
        );
        pdf.setDrawColor(...BRAND.border);
        pdf.setLineWidth(0.08);
        pdf.roundedRect(
          cellX,
          cellY,
          innerCardWidth,
          innerCardHeight,
          1.6,
          1.6,
        );

        pdf.setTextColor(...BRAND.slate);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(6.6);
        pdf.text(label, cellX + 2, cellY + 3.5);

        pdf.setTextColor(...BRAND.ink);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(6.8);
        const textWidth = innerCardWidth - 4;
        const wrapped = pdf.splitTextToSize(String(value || "N/A"), textWidth);
        pdf.text(wrapped[0] || "N/A", cellX + 2, cellY + 7.6);
      });
    });
  };

  const drawTableHeader = (startY) => {
    pdf.setLineWidth(0.18);
    pdf.setFillColor(...BRAND.accent);
    pdf.rect(tableLeft, startY, availableWidth, rowHeight, "F");

    let x = tableLeft;
    tableColumns.forEach((column) => {
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      const textX = column.align === "center" ? x + column.width / 2 : x + 2.5;
      pdf.text(column.label, textX, startY + 4.7, {
        align: column.align === "center" ? "center" : "left",
      });
      pdf.setDrawColor(...BRAND.border);
      pdf.rect(x, startY, column.width, rowHeight);
      x += column.width;
    });
  };

  const renderPage = (tableY) => {
    drawHeader();
    drawWatermark();
    drawSummaryColumns();
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
    pdf.setLineWidth(0.14);

    let x = tableLeft;
    tableColumns.forEach((column) => {
      pdf.setDrawColor(...BRAND.border);
      pdf.rect(x, currentY, column.width, rowHeight);

      const rawValue = result[column.key];
      const cellValue =
        column.key === "lastTermCumulative" &&
        (rawValue === null || rawValue === undefined || rawValue === "")
          ? "-"
          : String(rawValue ?? "");
      const safeValue =
        (column.key === "subject" || column.key === "remark") && cellValue.length > 18
          ? `${cellValue.slice(0, 15)}...`
          : cellValue;

      if (column.key === "grade" || column.key === "total") {
        pdf.setTextColor(...BRAND.accent);
        pdf.setFont("helvetica", "bold");
      } else if (column.key === "subject") {
        pdf.setTextColor(...BRAND.ink);
        pdf.setFont("helvetica", "bold");
      } else {
        pdf.setTextColor(...BRAND.ink);
        pdf.setFont("helvetica", "normal");
      }

      pdf.setFontSize(7.4);
      const textX = column.align === "center" ? x + column.width / 2 : x + 2.5;
      pdf.text(safeValue, textX, currentY + 4.8, {
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
  pdf.setFontSize(7);
  pdf.setTextColor(...BRAND.slate);
  const legendParts = [];
  if (isResultColumnEnabled(resultConfig, "ca")) {
    legendParts.push("CA = Continuous Assessment");
  }
  if (isLaterTerm(classInfo.term) && isResultColumnEnabled(resultConfig, "ltc")) {
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
    formatGradingScaleLegend(adminSettings?.gradingScale, resultConfig) ||
      "Grading scale set by school",
    pageWidth - margin,
    footerY,
    { align: "right" },
  );

  const filename = `${student.name}_${getStudentReportTermLabel(classInfo.term)}_${classInfo.session}.pdf`;
  pdf.save(filename);
  return true;
};
