import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import {
  getSchoolData,
  getClassSelection,
  getSubjectsByClass,
  getScores,
  calculateGrade,
  getRemarkByGrade,
  getAdminSettings,
  getGradingScale,
  getLastTermCumulative,
} from "./utils/school-data";
import { getUserData } from "../utils/userSession";
import { getCurrentUser } from "../utils/authUtils";

export default function StudentResultPreview({
  isOpen,
  onClose,
  student,
  classData,
}) {
  const [studentResults, setStudentResults] = useState([]);
  const [adminSettings, setAdminSettings] = useState(null);
  const [schoolId, setSchoolId] = useState(null);

  useEffect(() => {
    const loadSchool = async () => {
      const user = getCurrentUser();
      if (user) {
        const userData = await getUserData(user.uid);
        if (userData?.schoolId) {
          setSchoolId(userData.schoolId);
          const settings = await getAdminSettings(userData.schoolId);
          setAdminSettings(settings);
        }
      }
    };
    
    if (isOpen) {
      loadSchool();
    }
  }, [isOpen]);

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

  useEffect(() => {
    if (!student || !classData || !schoolId) return;

    const subjects = getSubjectsByClass(schoolId, classData.class);
    const gradingScale = getGradingScale(schoolId);
    const results = [];

    subjects.forEach((subject) => {
      const scores = getScores(
        schoolId,
        classData.class,
        subject,
        classData.term,
        classData.session
      );

      const studentScore = scores[student.id];
      const test1 = parseFloat(studentScore?.test1) || 0;
      const test2 = parseFloat(studentScore?.test2) || 0;
      const exam = parseFloat(studentScore?.exam) || 0;
      const total = test1 + test2 + exam;
      const grade = calculateGrade(total, gradingScale);
      const remark = getRemarkByGrade(grade);
      const lastTermCum = getLastTermCumulative(
        schoolId,
        classData.class,
        subject,
        classData.term,
        student.id
      );

      results.push({
        subject,
        test1,
        test2,
        exam,
        total,
        lastTermCum,
        grade,
        remark,
      });
    });

    setStudentResults(results);
  }, [student, classData]);

  const handleDownloadPDF = () => {
    if (!student || !classData) return;

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
      if (getSchoolData().logo) {
        const logoSize = 20;
        // Convert base64 logo if available
        try {
          pdf.addImage(
            getSchoolData().logo,
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
      pdf.text(getSchoolData().name || "School Name", infoX, yPosition + 5);

      pdf.setFontSize(9);
      pdf.setFont(undefined, "normal");
      yPosition += 8;
      pdf.text(getSchoolData().address || "", infoX, yPosition);
      yPosition += 4;
      pdf.text(`Email: ${getSchoolData().email || ""}`, infoX, yPosition);
      yPosition += 4;
      pdf.text(`Phone: ${getSchoolData().phone || ""}`, infoX, yPosition);
      yPosition += 4;
      pdf.setFont(undefined, "italic");
      pdf.text(`"${getSchoolData().motto || ""}`, infoX, yPosition);

      yPosition += 12;
      pdf.setFont(undefined, "bold");
      pdf.setFontSize(11);
      pdf.text(
        `${getTermLabel(classData.term)} Report Sheet - ${classData.session}`,
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
      pdf.text(`Class: ${getClassLabel(classData.class)}`, col2, yPosition);
      yPosition += 5;

      pdf.text(`Position in Class: ${student.positionInClass || "N/A"}`, col1, yPosition);

      yPosition += 10;
      // Results Table
      pdf.setFontSize(8);
      pdf.setFont(undefined, "bold");
      pdf.text("Subject Performance", margin, yPosition);
      yPosition += 6;

      // Table headers
      const headers = [
        { header: "Subject", width: 40 },
        { header: "T1", width: 12 },
        { header: "T2", width: 12 },
        { header: "Exam", width: 12 },
        { header: "Total", width: 15 },
        { header: "Grade", width: 12 },
        { header: "Remark", width: 25 },
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

      studentResults.forEach((result) => {
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
          result.test1.toFixed(1),
          result.test2.toFixed(1),
          result.exam.toFixed(1),
          result.total.toFixed(1),
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
      const filename = `${student.name}_${getTermLabel(classData.term)}_${classData.session}.pdf`;
      pdf.save(filename);
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Error generating PDF. Please try again.");
    }
  };

  if (!isOpen || !student || !classData) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-4xl w-full mx-4 my-8 p-6 md:p-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-black dark:text-white">
            Student Result Sheet
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-3xl leading-none"
          >
            ×
          </button>
        </div>

        {/* School Info Section */}
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-gray-700 dark:to-gray-600 p-6 rounded-lg mb-6 border-l-4 border-blue-800">
          <div className="flex gap-6">
            {/* Logo */}
            {getSchoolData().logo && (
              <img
                src={getSchoolData().logo}
                alt="School Logo"
                className="w-20 h-20 rounded-full object-cover border-2 border-blue-800"
              />
            )}

            {/* School Details */}
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-black dark:text-white mb-2">
                {getSchoolData().name}
              </h1>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">
                {getSchoolData().address}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">
                Email: {getSchoolData().email}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">
                Phone: {getSchoolData().phone}
              </p>
              <p className="text-sm italic text-gray-600 dark:text-gray-400">
                "{getSchoolData().motto}"
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
              {student.name}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              Registration No
            </p>
            <p className="text-lg font-bold text-black dark:text-white">
              {student.regNumber || "N/A"}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              Sex
            </p>
            <p className="text-lg font-bold text-black dark:text-white">
              {student.sex || "N/A"}
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
                  Exam
                </th>
                <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold">
                  Total
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
                    {result.test1.toFixed(1)}
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                    {result.test2.toFixed(1)}
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center text-black dark:text-white">
                    {result.exam.toFixed(1)}
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center font-bold text-black dark:text-white bg-blue-50 dark:bg-gray-600">
                    {result.total.toFixed(1)}
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

        {/* Action Buttons */}
        <div className="flex gap-4 justify-center">
          <button
            onClick={onClose}
            className="px-8 py-3 border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300"
          >
            Back
          </button>
          <button
            onClick={handleDownloadPDF}
            className="px-8 py-3 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-all duration-300"
          >
            Download Result
          </button>
        </div>
      </div>
    </div>
  );
}
