import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import {
  getSchoolData,
  getResultSelection,
  getClassStudents,
  getScores,
  calculateGrade,
  getGradingScale,
  roundScore,
  getLastTermCumulative,
} from "./utils/school-data";
import { getCurrentUser } from "../utils/authUtils";
import { getUserData } from "../utils/userSession";

export default function ResultPreview() {
  const navigate = useNavigate();
  const previewRef = useRef();
  const [schoolData, setSchoolData] = useState({});
  const [resultSelection, setResultSelection] = useState({});
  const [userId, setUserId] = useState(null);
  const [schoolId, setSchoolId] = useState(null);
  const [students, setStudents] = useState([]);
  const [scores, setScores] = useState({});
  const [results, setResults] = useState([]);

  // Load user data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const currentUser = getCurrentUser();
        if (!currentUser) {
          navigate("/login", { replace: true });
          return;
        }

        setUserId(currentUser.uid);

        // Get schoolId from user document
        const userData = await getUserData(currentUser.uid);
        if (!userData?.schoolId) {
          navigate("/select-role", { replace: true });
          return;
        }

        setSchoolId(userData.schoolId);

        // Load school data from Firebase
        const data = await getSchoolData(userData.schoolId);
        setSchoolData(data || {});

        setResultSelection(getResultSelection());
      } catch (error) {
        console.error("Error loading data:", error);
      }
    };

    loadData();
  }, [navigate]);

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
      "term1": "First Term",
      "term2": "Second Term",
      "term3": "Third Term",
      "1st": "First Term",
      "2nd": "Second Term",
      "3rd": "Third Term",
    };
    return termMap[termId] || termId;
  };

  useEffect(() => {
    const loadResults = async () => {
      if (!schoolId || !resultSelection.class) return;

      try {
        // Load data from Firebase
        const classStudents = await getClassStudents(schoolId, resultSelection.class);
        setStudents(classStudents || []);

        const savedScores = await getScores(
          schoolId,
          resultSelection.class,
          resultSelection.subject
        );
        setScores(savedScores);

        // Calculate results
        if (classStudents && savedScores) {
          const gradingScale = getGradingScale(schoolId);
          const processedResults = [];

          classStudents.forEach((student) => {
        const studentScores = savedScores[student.id] || {
          test1: 0,
          test2: 0,
          exam: 0,
        };

        const test1 = roundScore(parseFloat(studentScores.test1) || 0);
        const test2 = roundScore(parseFloat(studentScores.test2) || 0);
        const exam = roundScore(parseFloat(studentScores.exam) || 0);
        const testSum = test1 + test2;
        const total = testSum + exam;
        const lastTermCum = getLastTermCumulative(
          resultSelection.class,
          resultSelection.subject,
          resultSelection.term,
          resultSelection.session,
          student.id
        );
        const grade = calculateGrade(total, gradingScale);

        processedResults.push({
          id: student.id,
          name: student.name,
          test1,
          test2,
          testSum,
          exam,
          total,
          lastTermCum,
          grade,
        });
      });

      // Calculate class average and positions
      const classAverageRaw = processedResults.length > 0
        ? processedResults.reduce((sum, r) => sum + r.total, 0) /
          processedResults.length
        : 0;
      const classAverage = roundScore(classAverageRaw);

      // Sort by total and assign positions
      processedResults.sort((a, b) => b.total - a.total);
      processedResults.forEach((result, index) => {
        result.position = index + 1;
        result.classAverage = classAverage;
      });

      // Sort back to original order for display
      processedResults.sort((a, b) => {
        const aIndex = classStudents.findIndex((s) => s.id === a.id);
        const bIndex = classStudents.findIndex((s) => s.id === b.id);
        return aIndex - bIndex;
      });

          setResults(processedResults);
        }
      } catch (error) {
        console.error("Error loading results:", error);
      }
    };

    loadResults();
  }, [schoolId, resultSelection.class, resultSelection.subject]);

  const handleDownloadPDF = () => {
    try {
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const pageHeight = pdf.internal.pageSize.getHeight();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 10;
      let yPosition = 20;

      // Set font for header
      pdf.setFontSize(16);
      pdf.setTextColor(0, 0, 0);
      pdf.text(`${schoolData.name}`, margin + 30, yPosition);
      yPosition += 5;

      pdf.setFontSize(11);
      pdf.text(`${schoolData.address}`, margin + 30, yPosition);
      yPosition += 5;

      // School info section
      pdf.setFontSize(11);
      pdf.setTextColor(80, 80, 80);
      const infoX = pageWidth - margin - 50;
      pdf.text(`Class: ${getClassLabel(resultSelection.class)}`, infoX, yPosition - 10);
      pdf.text(`Term: ${getTermLabel(resultSelection.term)}`, infoX, yPosition - 5);
      pdf.text(`Session: ${resultSelection.session}`, infoX, yPosition);
      pdf.text(`Subject: ${resultSelection.subject}`, infoX, yPosition + 5);

      yPosition += 10;

      // Add horizontal line
      pdf.setDrawColor(200, 200, 200);
      pdf.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += 5;

      // Table headers
      pdf.setFontSize(11);
      pdf.setTextColor(0, 0, 0);
      pdf.setFont(undefined, "bold");

      const columns = [
        { header: "Name", width: 50 },
        { header: "T1", width: 22 },
        { header: "T2", width: 22 },
        { header: "T1+T2", width: 22 },
        { header: "Exam", width: 22 },
        { header: "Total", width: 22 },
        { header: "LTC", width: 22 },
        { header: "CA", width: 22 },
        { header: "Pos", width: 22 },
        { header: "Grade", width: 22 },
      ];

      let xPos = margin;
      columns.forEach((col) => {
        pdf.text(col.header, xPos, yPosition);
        xPos += col.width;
      });

      yPosition += 6;
      pdf.setDrawColor(200, 200, 200);
      pdf.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += 4;

      // Table rows
      pdf.setFont(undefined, "normal");
      pdf.setTextColor(0, 0, 0);

      results.forEach((result) => {
        // Check if we need a new page
        if (yPosition + 5 > pageHeight - margin) {
          pdf.addPage();
          yPosition = margin;

          // Repeat headers on new page
          pdf.setFontSize(11);
          pdf.setFont(undefined, "bold");
          xPos = margin;
          columns.forEach((col) => {
            pdf.text(col.header, xPos, yPosition);
            xPos += col.width;
          });
          yPosition += 6;
          pdf.line(margin, yPosition, pageWidth - margin, yPosition);
          yPosition += 4;
          pdf.setFont(undefined, "normal");
        }

        xPos = margin;
        const rowData = [
          result.name.substring(0, 20),
          result.test1.toString(),
          result.test2.toString(),
          result.testSum.toString(),
          result.exam.toString(),
          result.total.toString(),
          result.lastTermCum.toString(),
          result.classAverage.toString(),
          result.position.toString(),
          result.grade,
        ];

        rowData.forEach((data, idx) => {
          const col = columns[idx];
          pdf.text(data.toString(), xPos, yPosition);
          xPos += col.width;
        });

        yPosition += 5;
      });

      // Add legend at the bottom
      yPosition += 50;
      pdf.setFontSize(7);
      pdf.setTextColor(100, 100, 100);
      pdf.text(
        "Legend: T1/T2=Tests, LTC=Last Term Cumulative, CA=Class Average, Pos=Position, Grades: A(70-100), B(55-69), C(50-54), D(45-49), E(40-44), F(0-39)",
        margin,
        yPosition
      );

      // Save PDF
      const filename = `${resultSelection.subject}_${getClassLabel(
        resultSelection.class
      )}_${resultSelection.term}_${resultSelection.session}.pdf`;
      pdf.save(filename);
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Error generating PDF. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-4 md:p-8">
      {/* Header Controls */}
      <div className="flex gap-4 mb-8 justify-center">
        <button
          onClick={() => navigate("/record-dashboard")}
          className="px-6 py-2 border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300"
        >
          Back
        </button>
        <button
          onClick={handleDownloadPDF}
          className="px-6 py-2 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300"
        >
          Download Score Sheet
        </button>
      </div>

      {/* Preview Content - Landscape Format */}
      <div
        ref={previewRef}
        className="bg-white dark:bg-gray-800 p-8 min-h-screen"
        style={{ pageBreakAfter: "always" }}
      >
        {/* Header Section */}
        <div className="mb-8 border-b-2 border-gray-300 dark:border-gray-600 pb-6">
          <div className="flex items-start gap-6 mb-4">
            {/* School Logo and Info */}
            <div className="flex items-center gap-4">
              {schoolData.logo && (
                <img
                  src={schoolData.logo}
                  alt={schoolData.name}
                  className="w-20 h-20 rounded-full object-cover border-2 border-blue-800"
                />
              )}
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-black dark:text-white">
                  {schoolData.name}
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {schoolData.address}
                </p>
              </div>
            </div>

            {/* Class Info */}
            <div className="ml-auto text-right space-y-1">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                <span className="font-bold">Class:</span> {getClassLabel(resultSelection.class)}
              </p>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                <span className="font-bold">Term:</span> {getTermLabel(resultSelection.term)}
              </p>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                <span className="font-bold">Session:</span> {resultSelection.session}
              </p>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                <span className="font-bold">Subject:</span> {resultSelection.subject}
              </p>
            </div>
          </div>
        </div>

        {/* Results Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs md:text-sm">
            <thead>
              <tr className="bg-gray-200 dark:bg-gray-700 border-2 border-gray-400 dark:border-gray-600">
                <th className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-left font-bold">
                  Name
                </th>
                <th className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold">
                  T1
                </th>
                <th className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold">
                  T2
                </th>
                <th className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold">
                  T1+T2
                </th>
                <th className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold">
                  Exam
                </th>
                <th className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold">
                  Total
                </th>
                {resultSelection.term !== "term1" && (
                  <th className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold">
                    LTC
                  </th>
                )}
                <th className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold">
                  CA
                </th>
                <th className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold">
                  Pos
                </th>
                <th className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold">
                  Grade
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, index) => (
                <tr
                  key={result.id}
                  className="border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <td className="border border-gray-400 dark:border-gray-600 px-3 py-2 font-medium text-black dark:text-white">
                    {result.name}
                  </td>
                  <td className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                    {result.test1}
                  </td>
                  <td className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                    {result.test2}
                  </td>
                  <td className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                    {result.testSum}
                  </td>
                  <td className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                    {result.exam}
                  </td>
                  <td className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold text-black dark:text-white bg-blue-50 dark:bg-gray-600">
                    {result.total}
                  </td>
                  {resultSelection.term !== "term1" && (
                    <td className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                      {result.lastTermCum ?? "-"}
                    </td>
                  )}
                  <td className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                    {result.classAverage}
                  </td>
                  <td className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold text-black dark:text-white">
                    {result.position}
                  </td>
                  <td className="border border-gray-400 dark:border-gray-600 px-3 py-2 text-center font-bold text-white bg-blue-800">
                    {result.grade}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="mt-8 pt-6 border-t-2 border-gray-300 dark:border-gray-600">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Legend:
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs text-gray-600 dark:text-gray-400">
            <p>
              <span className="font-semibold">T1/T2:</span> Test 1 & 2
            </p>
            <p>
              <span className="font-semibold">LTC:</span> Last Term Cum.
            </p>
            <p>
              <span className="font-semibold">CA:</span> Class Avg.
            </p>
            <p>
              <span className="font-semibold">Pos:</span> Position
            </p>
            <p>
              <span className="font-semibold">Grades:</span> A(70-100), B(55-69), C(50-54), D(45-49), E(40-44), F(0-39)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
