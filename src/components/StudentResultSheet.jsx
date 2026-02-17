import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import { getCurrentUser } from "../utils/authUtils";
import { getUserData } from "../utils/userSession";
import {
  getSchoolData,
  getClassSelection,
  getSubjectsByClass,
  getScores,
  calculateGrade,
  getRemarkByGrade,
  getAdminSettings,
  getGradingScale,
  getClassAverage,
  getStudentPosition,
  roundScore,
} from "./utils/school-data";

export default function StudentResultSheet() {
  const navigate = useNavigate();
  const [studentData, setStudentData] = useState(null);
  const [classData, setClassData] = useState(null);
  const [studentResults, setStudentResults] = useState([]);
  const [schoolData, setSchoolData] = useState({});
  const [adminSettings, setAdminSettings] = useState(getAdminSettings());
  const [resolvedSchoolId, setResolvedSchoolId] = useState(null);

  // Load school data on component mount
  useEffect(() => {
    const loadSchoolData = async () => {
      try {
        const currentUser = getCurrentUser();
        if (currentUser) {
          
          const userData = await getUserData(currentUser.uid);
          if (userData && userData.schoolId) {
            setResolvedSchoolId(userData.schoolId);
            const data = await getSchoolData(userData.schoolId);
            setSchoolData(data || {});
          }
        }
      } catch (error) {
        console.error("Error loading school data:", error);
        setSchoolData({});
      }
    };

    loadSchoolData();
  }, []);

  useEffect(() => {
    // Get data from session and local storage
    const student = sessionStorage.getItem("selectedStudent");
    const shouldDownload = sessionStorage.getItem("downloadPDF") === "true";

    if (!student) {
      navigate("/school-dashboard");
      return;
    }

    // Get classInfo from localStorage using the utility function
    let classInfo = getClassSelection();
    if (!classInfo || !classInfo.class) {
      // Try to recover from studentData or session
      const fallback = studentData && studentData.classId ? {
        class: studentData.classId,
        term: studentData.term || "term1",
        session: studentData.session || "2025/2026",
        subject: studentData.subject || "Mathematics"
      } : null;
      if (!fallback) {
        navigate("/school-dashboard");
        return;
      }
      classInfo = fallback;
    }

    const parsedStudent = JSON.parse(student);
    setStudentData(parsedStudent);
    setClassData(classInfo);

    // Calculate results
    const schoolId = resolvedSchoolId || classInfo.schoolId;
    if (!schoolId) return;
    const subjects = getSubjectsByClass(schoolId, classInfo.class);
    const gradingScale = getGradingScale(schoolId);
    const results = [];

    Promise.all(subjects.map(async (subject) => {
      // Always fetch scores fresh from Firebase
      sessionStorage.removeItem(`scores_${schoolId}_${classInfo.class}_${subject}`);
      const scores = await getScores(schoolId, classInfo.class, subject, classInfo.term, classInfo.session);
      const studentScore = scores[parsedStudent.id];
      if (!studentScore || (studentScore.test1 === undefined && studentScore.test2 === undefined && studentScore.exam === undefined)) {
        return null; // Skip subjects with no scores
      }
      const test1 = roundScore(parseFloat(studentScore?.test1) || 0);
      const test2 = roundScore(parseFloat(studentScore?.test2) || 0);
      const exam = roundScore(parseFloat(studentScore?.exam) || 0);
      const total = test1 + test2 + exam;
      const testSum = test1 + test2;
      const grade = calculateGrade(total, gradingScale);
      const remark = getRemarkByGrade(grade);
      const classAverage = roundScore(await getClassAverage(schoolId, classInfo.class, subject, classInfo.term, classInfo.session));
      const position = await getStudentPosition(schoolId, classInfo.class, subject, classInfo.term, classInfo.session, parsedStudent.id);

      // Calculate last term cumulative only for 2nd and 3rd term
      let lastTermCumulative = "";
      if (classInfo.term === "term2" || classInfo.term === "term3") {
        lastTermCumulative = await getLastTermCumulative(schoolId, classInfo.class, subject, classInfo.term, parsedStudent.id);
      }

      return {
        subject,
        test1,
        test2,
        testSum,
        exam,
        total,
        lastTermCumulative: (classInfo.term === "term2" || classInfo.term === "term3") ? lastTermCumulative : "",
        classAverage,
        position,
        grade,
        remark,
      };
    })).then((subjectResults) => {
      setStudentResults(subjectResults.filter(r => r !== null));
    });

    // Auto-download if flag is set
    if (shouldDownload) {
      // Delay to ensure results are properly calculated
      const timer = setTimeout(() => {
        generateAndDownloadPDF(parsedStudent, classInfo, results);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [navigate, resolvedSchoolId]);

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

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const options = { year: "numeric", month: "long", day: "numeric" };
    return date.toLocaleDateString("en-US", options);
  };

  const generateAndDownloadPDF = (student, classInfo, results) => {
    if (!student || !classInfo) return;

    try {
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      let yPosition = margin;

      // School Logo and Info Section
      const logoCols = margin;
      if (schoolData.logo) {
        const logoSize = 20;
        try {
          pdf.addImage(
            schoolData.logo,
            "JPEG",
            logoCols,
            yPosition,
            logoSize,
            logoSize
          );
        } catch (e) {
          // Logo conversion failed, continue without it
        }
      }

      // School Information
      const infoX = margin + 25;
      pdf.setFontSize(14);
      pdf.setFont(undefined, "bold");
      pdf.text(schoolData.name || "School Name", infoX, yPosition + 5);

      pdf.setFontSize(9);
      pdf.setFont(undefined, "normal");
      yPosition += 8;
      pdf.text(schoolData.address || "", infoX, yPosition);
      yPosition += 4;
      pdf.text(`Email: ${schoolData.email || ""}`, infoX, yPosition);
      yPosition += 4;
      pdf.text(`Phone: ${schoolData.phone || ""}`, infoX, yPosition);
      yPosition += 4;
      pdf.setFont(undefined, "italic");
      pdf.text(`"${schoolData.motto || ""}`, infoX, yPosition);

      yPosition += 12;
      pdf.setFont(undefined, "bold");
      pdf.setFontSize(11);
      pdf.text(
        `${getTermLabel(classInfo.term)} Report Sheet - ${classInfo.session}`,
        margin,
        yPosition
      );

      yPosition += 10;
      // Student Information
      pdf.setFontSize(9);
      pdf.setFont(undefined, "bold");
      pdf.text("Student Information", margin, yPosition);
      yPosition += 5;

      pdf.setFont(undefined, "normal");
      const col1 = margin;
      const col2 = margin + 50;

      pdf.text(`Name: ${student.name}`, col1, yPosition);
      pdf.text(`Reg No: ${student.regNumber || "N/A"}`, col2, yPosition);
      yPosition += 5;

      pdf.text(`Sex: ${student.sex || "N/A"}`, col1, yPosition);
      pdf.text(`Class: ${getClassLabel(classInfo.class)}`, col2, yPosition);
      yPosition += 5;

      pdf.text(
        `Position in Class: ${student.positionInClass || "N/A"}`,
        col1,
        yPosition
      );

      yPosition += 10;
      // Results Table
      pdf.setFontSize(8);
      pdf.setFont(undefined, "bold");
      pdf.text("Subject Performance", margin, yPosition);
      yPosition += 6;

      // Table headers
      const headers = [
        { header: "Subject", width: 30 },
        { header: "T1", width: 10 },
        { header: "T2", width: 10 },
        { header: "T1+T2", width: 12 },
        { header: "Exam", width: 10 },
        { header: "Total", width: 12 },
        { header: "L.T.Cum", width: 12 },
        { header: "C.Avg", width: 10 },
        { header: "Pos", width: 8 },
        { header: "Grade", width: 10 },
        { header: "Remark", width: 16 },
      ];

      let xPos = margin;
      headers.forEach((col) => {
        pdf.text(col.header, xPos, yPosition);
        xPos += col.width;
      });

      yPosition += 5;
      pdf.setDrawColor(200, 200, 200);
      pdf.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += 4;

      pdf.setFont(undefined, "normal");

      results.forEach((result) => {
        if (yPosition + 5 > pageHeight - margin) {
          pdf.addPage();
          yPosition = margin;
          xPos = margin;
          headers.forEach((col) => {
            pdf.text(col.header, xPos, yPosition);
            xPos += col.width;
          });
          yPosition += 5;
          pdf.line(margin, yPosition, pageWidth - margin, yPosition);
          yPosition += 4;
        }

        xPos = margin;
        const rowData = [
          result.subject.substring(0, 20),
          result.test1.toString(),
          result.test2.toString(),
          result.testSum.toString(),
          result.exam.toString(),
          result.total.toString(),
          result.lastTermCumulative.toString(),
          result.classAverage.toString(),
          result.position.toString(),
          result.grade,
          result.remark,
        ];

        rowData.forEach((data, idx) => {
          const col = headers[idx];
          pdf.text(data.toString(), xPos, yPosition);
          xPos += col.width;
        });

        yPosition += 5;
      });

      // Next term begins info
      yPosition += 5;
      pdf.setFontSize(9);
      pdf.setFont(undefined, "italic");
      pdf.text(
        `Next term begins: ${formatDate(adminSettings.nextTermBegins)}`,
        margin,
        yPosition
      );

      // Footer
      yPosition = pageHeight - 15;
      pdf.setFontSize(7);
      pdf.setTextColor(150, 150, 150);
      pdf.text(
        `Generated by Scoorla Result Management System`,
        margin,
        yPosition
      );

      // Save PDF
      const filename = `${student.name}_${getTermLabel(classInfo.term)}_${classInfo.session}.pdf`;
      pdf.save(filename);
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Error generating PDF. Please try again.");
    }
  };

  if (!studentData || !classData) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-4 md:p-8">
      {/* Header Controls */}
      <div className="flex gap-4 mb-8 justify-center">
        <button
          onClick={() => {
            sessionStorage.removeItem("selectedStudent");
            navigate("/class-dashboard");
          }}
          className="px-8 py-2 border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300"
        >
          Back
        </button>
        <button
          onClick={() => generateAndDownloadPDF(studentData, classData, studentResults)}
          className="px-8 py-2 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300"
        >
          Download Result
        </button>
      </div>

      {/* School Info Section */}
      <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-gray-700 dark:to-gray-600 p-6 rounded-lg mb-6 border-l-4 border-blue-800">
        <div className="flex gap-6">
          {/* Logo */}
          {schoolData.logo && (
            <img
              src={schoolData.logo}
              alt="School Logo"
              className="w-20 h-20 rounded-full object-cover border-2 border-blue-800"
            />
          )}

          {/* School Details */}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-black dark:text-white mb-2">
              {schoolData.name}
            </h1>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">
              {schoolData.address}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">
              Email: {schoolData.email}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">
              Phone: {schoolData.phone}
            </p>
            <p className="text-sm italic text-gray-600 dark:text-gray-400">
              "{schoolData.motto}"
            </p>
          </div>
        </div>

        {/* Report Sheet Title */}
        <div className="mt-4 pt-4 border-t border-gray-300 dark:border-gray-500">
          <h2 className="text-lg font-bold text-blue-800 dark:text-blue-400">
            {getTermLabel(classData.term)} Report Sheet - {classData.session}
          </h2>
        </div>
      </div>

      {/* Student Info Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
        <div>
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
            Student Name
          </p>
          <p className="text-lg font-bold text-black dark:text-white">
            {studentData.name}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
            Registration No
          </p>
          <p className="text-lg font-bold text-black dark:text-white">
            {studentData.regNumber || "N/A"}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
            Sex
          </p>
          <p className="text-lg font-bold text-black dark:text-white">
            {studentData.sex || "N/A"}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
            Class
          </p>
          <p className="text-lg font-bold text-black dark:text-white">
            {getClassLabel(classData.class)}
          </p>
        </div>
      </div>

      {/* Results Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-600 mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-700">
            <tr>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left font-bold">
                Subject
              </th>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold">
                T1
              </th>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold">
                T2
              </th>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold">
                T1+T2
              </th>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold">
                Exam
              </th>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold">
                Total
              </th>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold">
                Last Term Cum.
              </th>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold">
                Class Avg.
              </th>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold">
                Position
              </th>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold">
                Grade
              </th>
              <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left font-bold">
                Remark
              </th>
            </tr>
          </thead>
          <tbody>
            {studentResults.map((result, idx) => (
              <tr
                key={idx}
                className="hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600"
              >
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-black dark:text-white">
                  {result.subject}
                </td>
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                  {result.test1}
                </td>
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                  {result.test2}
                </td>
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                  {result.testSum}
                </td>
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                  {result.exam}
                </td>
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold text-black dark:text-white bg-blue-50 dark:bg-gray-600">
                  {result.total}
                </td>
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                  {result.lastTermCumulative}
                </td>
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                  {result.classAverage}
                </td>
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white font-semibold">
                  {result.position}
                </td>
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold text-white bg-blue-800">
                  {result.grade}
                </td>
                <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-black dark:text-white">
                  {result.remark}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Next Term Info */}
      <div className="p-4 bg-blue-50 dark:bg-gray-700 rounded-lg mb-6 text-center">
        <p className="text-sm italic text-gray-700 dark:text-gray-300">
          Next term begins:{" "}
          <span className="font-semibold">
            {formatDate(adminSettings.nextTermBegins)}
          </span>
        </p>
      </div>
    </div>
  );
}
