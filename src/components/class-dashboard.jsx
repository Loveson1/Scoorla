import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import {
  getSchoolData,
  getClassSelection,
  saveClassStudents,
  getClassStudents,
  getSubjectsByClass,
  getScores,
  calculateGrade,
  getRemarkByGrade,
  getAdminSettings,
  getGradingScale,
  getDefaultGradingScale,
  getClassAverage,
  getStudentPosition,
  roundScore,
} from "./utils/school-data";
import { getCurrentUser } from "../utils/authUtils";
import { getUserData } from "../utils/userSession";
import { deleteStudent } from "../utils/firebaseDatabase";
import AddStudent from "./AddStudent";
import StudentResultPreview from "./StudentResultPreview";


export default function ClassDashboard() {
  const navigate = useNavigate();
  const [schoolData, setSchoolData] = useState({});
  const [classSelection, setClassSelection] = useState({});
  const [userId, setUserId] = useState(null);
  const [schoolId, setSchoolId] = useState(null);
  const [students, setStudents] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [isResultPreviewOpen, setIsResultPreviewOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Load user data on mount
  useEffect(() => {
    const loadUserData = async () => {
      const currentUser = getCurrentUser();
      if (currentUser) {
        setUserId(currentUser.uid);
        setClassSelection(getClassSelection(currentUser.uid));
        
        // Get schoolId from Firestore FIRST
        const userData = await getUserData(currentUser.uid);
        if (userData && userData.schoolId) {
          setSchoolId(userData.schoolId);
          
          // THEN load school data with correct schoolId
          const data = await getSchoolData(userData.schoolId);
          setSchoolData(data || {});
        }
      }
    };
    
    loadUserData();
  }, []);

  useEffect(() => {
    if (!schoolId || !classSelection.class) return;
    
    // Load students from Firebase
    getClassStudents(schoolId, classSelection.class).then((savedStudents) => {
      setStudents(savedStudents || []);
    });
  }, [classSelection.class, schoolId]);

  const handleAddStudent = async (studentData) => {
    if (!userId || !schoolId) return;
    
    console.log("Adding student:", studentData);
    
    const newStudent = {
      id: Date.now(),
      name: studentData.name,
      regNumber: studentData.regNumber || "",
      sex: studentData.sex || "",
      phone: studentData.phone || "",
    };
    const updatedStudents = [...students, newStudent];
    setStudents(updatedStudents);
    
    try {
      console.log("Saving to Firebase:", { schoolId, classId: classSelection.class, students: updatedStudents });
      await saveClassStudents(schoolId, classSelection.class, updatedStudents, userId);
      
      console.log("Reloading students from Firebase...");
      // Reload students from Firebase to get the correct IDs
      const freshStudents = await getClassStudents(schoolId, classSelection.class);
      console.log("Fresh students loaded:", freshStudents);
      setStudents(freshStudents || []);
      
      setIsAddModalOpen(false);
    } catch (error) {
      console.error("Error adding student:", error);
      alert("Failed to add student: " + error.message);
      // Revert to previous students if save failed
      setStudents(students);
    }
  };

  const handleDeleteStudent = async (studentId) => {
    if (!userId || !schoolId) return;
    if (window.confirm("Are you sure you want to delete this student?")) {
      try {
        // If it's a Firebase ID (string), delete from Firebase first
        if (typeof studentId === 'string') {
          console.log("Deleting from Firebase:", { schoolId, studentId });
          await deleteStudent(schoolId, studentId);
        }
        
        // Remove from local state
        const updatedStudents = students.filter((s) => s.id !== studentId);
        setStudents(updatedStudents);
        
        // Update cache
        await saveClassStudents(schoolId, classSelection.class, updatedStudents, userId);
        
        // Reload from Firebase to ensure consistency
        const freshStudents = await getClassStudents(schoolId, classSelection.class);
        setStudents(freshStudents || []);
      } catch (error) {
        console.error("Error deleting student:", error);
        alert("Failed to delete student: " + error.message);
      }
    }
  };

  const handleEditStudent = (student) => {
    setEditingStudent(student);
    setIsAddModalOpen(true);
  };

  const handlePreviewResult = (student) => {
    setSelectedStudent(student);
    setIsResultPreviewOpen(true);
  };

  const handleDownloadResult = async (student) => {
    try {
      // Get subjects and scores
      const subjects = getSubjectsByClass(schoolId, classSelection.class);
      const gradingScale = getGradingScale(schoolId) || getDefaultGradingScale();
      const adminSettings = await getAdminSettings(schoolId);
      const results = [];

      subjects.forEach((subject) => {
        const scores = getScores(
          schoolId,
          classSelection.class,
          subject,
          classSelection.term,
          classSelection.session,
        );

        const studentScore = scores[student.id];
        const test1 = roundScore(parseFloat(studentScore?.test1) || 0);
        const test2 = roundScore(parseFloat(studentScore?.test2) || 0);
        const exam = roundScore(parseFloat(studentScore?.exam) || 0);
        const total = test1 + test2 + exam;
        const testSum = test1 + test2;
        const grade = calculateGrade(total, gradingScale);
        const remark = getRemarkByGrade(grade);
        const classAverage = roundScore(
          getClassAverage(
            schoolId,
            classSelection.class,
            subject,
            classSelection.term,
            classSelection.session,
          ),
        );
        const position = getStudentPosition(
          schoolId,
          classSelection.class,
          subject,
          classSelection.term,
          classSelection.session,
          student.id,
        );

        results.push({
          subject,
          test1,
          test2,
          testSum,
          exam,
          total,
          lastTermCumulative: 0,
          classAverage,
          position,
          grade,
          remark,
        });
      });

      // Generate PDF
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
      if (schoolData && schoolData.logo) {
        const logoSize = 20;
        try {
          pdf.addImage(
            schoolData.logo,
            "JPEG",
            margin,
            yPosition,
            logoSize,
            logoSize,
          );
        } catch (e) {
          // Logo conversion failed, continue without it
        }
      }

      // School Information
      const infoX = margin + 25;
      pdf.setFontSize(14);
      pdf.setFont(undefined, "bold");
      pdf.text(schoolData?.name || "School Name", infoX, yPosition + 5);

      pdf.setFontSize(9);
      pdf.setFont(undefined, "normal");
      yPosition += 8;
      pdf.text(schoolData?.address || "", infoX, yPosition);
      yPosition += 4;
      pdf.text(`Email: ${schoolData?.email || ""}`, infoX, yPosition);
      yPosition += 4;
      pdf.text(`Phone: ${schoolData?.phone || ""}`, infoX, yPosition);
      yPosition += 4;
      pdf.setFont(undefined, "italic");
      pdf.text(`"${schoolData?.motto || ""}`, infoX, yPosition);

      yPosition += 12;
      pdf.setFont(undefined, "bold");
      pdf.setFontSize(11);
      pdf.text(
        `${getTermLabel(classSelection.term)} Report Sheet - ${classSelection.session}`,
        margin,
        yPosition,
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
      pdf.text(
        `Class: ${getClassLabel(classSelection.class)}`,
        col2,
        yPosition,
      );
      yPosition += 5;

      pdf.text(
        `Position in Class: ${student.positionInClass || "N/A"}`,
        col1,
        yPosition,
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
        yPosition,
      );

      // Footer
      yPosition = pageHeight - 15;
      pdf.setFontSize(7);
      pdf.setTextColor(150, 150, 150);
      pdf.text(
        `Generated by Scoorla Result Management System`,
        margin,
        yPosition,
      );

      // Save PDF
      const filename = `${student.name}_${getTermLabel(classSelection.term)}_${classSelection.session}.pdf`;
      pdf.save(filename);
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Error downloading PDF. Please try again.");
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const options = { year: "numeric", month: "long", day: "numeric" };
    return date.toLocaleDateString("en-US", options);
  };

  const handleUpdateStudent = async (studentData) => {
    if (!userId || !schoolId) return;
    
    console.log("Updating student:", { studentData, editingStudent });
    
    const updatedStudents = students.map((s) =>
      s.id === editingStudent.id ? { 
        ...s, 
        name: studentData.name,
        regNumber: studentData.regNumber,
        sex: studentData.sex,
        phone: studentData.phone,
      } : s,
    );
    setStudents(updatedStudents);
    
    try {
      await saveClassStudents(schoolId, classSelection.class, updatedStudents, userId);
      
      // Reload from Firebase to ensure consistency
      const freshStudents = await getClassStudents(schoolId, classSelection.class);
      setStudents(freshStudents || []);
      
      setEditingStudent(null);
      setIsAddModalOpen(false);
    } catch (error) {
      console.error("Error updating student:", error);
      alert("Failed to update student: " + error.message);
      // Restore previous list if save failed
      setStudents(students);
    }
  };

  const filteredStudents = students.filter((student) =>
    student.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

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

  return (
    <div className="min-h-screen p-4 md:p-8 bg-white dark:bg-gray-900">
      {/* Header Section */}
      <div className="">
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-gray-800 dark:to-gray-700 rounded-lg p-6 md:p-8 mb-8">
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:items-center">
            {/* School Info */}
            <div className="flex items-center gap-3">
              {schoolData.logo && (
                <img
                  src={schoolData.logo}
                  alt={schoolData.name}
                  className="w-12 h-12 rounded-full object-cover border-2 border-blue-800"
                />
              )}
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  School
                </p>
                <p className="text-sm font-bold text-black dark:text-white ">
                  {schoolData.name}
                </p>
              </div>
            </div>

            {/* Class Info */}
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400">Class</p>
              <p className="text-sm font-bold text-black dark:text-white">
                {getClassLabel(classSelection.class)}
              </p>
            </div>

            {/* Term Info */}
            <div className="max-lg:ml-15">
              <p className="text-xs text-gray-600 dark:text-gray-400">Term</p>
              <p className="text-sm font-bold text-black dark:text-white">
                {getTermLabel(classSelection.term)}
              </p>
            </div>

            {/* Session Info */}
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Session
              </p>
              <p className="text-sm font-bold text-black dark:text-white">
                {classSelection.session}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats and Search Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Student Count Card */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-800 dark:to-gray-700 rounded-lg p-6 border-l-4 border-blue-800">
          <h3 className="text-gray-600 dark:text-gray-300 text-sm font-semibold mb-2">
            Total Students
          </h3>
          <p className="text-3xl font-bold text-blue-800 dark:text-blue-400">
            {students.length}
          </p>
        </div>

        {/* Search Input */}
        <div className="">
          <input
            type="text"
            placeholder="Enter student name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input w-full"
          />
          {/* Add Student Button */}
          <div>
            <div className="mt-3 gap-2  flex justify-between">
              <button
                onClick={() => {
                  setEditingStudent(null);
                  setIsAddModalOpen(true);
                }}
                className="flex items-center gap-2 px-6 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300 shadow-lg hover:shadow-xl"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Add Student
              </button>

               <button
          onClick={() => navigate("/school-dashboard")}
          className="px-2 py-2 md:hidden rounded-lg border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300" >
          Back to Dashboard
        </button>
            </div>
          </div>
        </div>
        <div className="flex-col justify-self-end">
       <button
          onClick={() => navigate("/school-dashboard")}
          className="px-6 py-2 max-md:hidden  rounded-lg border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300" >
          Back to Dashboard
        </button></div>
      </div>

      

      {/* Students Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full">
          <thead className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-4 md:px-6 py-4 text-left">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Name
                </span>
              </th>
              <th className="px-4 md:px-6 py-4 text-left">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Action
                </span>
              </th>
              <th className="px-4 md:px-6 py-4 text-left">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Result
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredStudents.length > 0 ? (
              filteredStudents.map((student) => (
                <tr
                  key={student.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-200"
                >
                  {/* Name Column */}
                  <td className="px-4 md:px-6 py-4">
                    <div>
                      <p className="font-medium text-black dark:text-white">
                        {student.name}
                      </p>
                      {student.regNumber && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Reg: {student.regNumber}
                        </p>
                      )}
                    </div>
                  </td>

                  {/* Action Column */}
                  <td className="px-4 md:px-6 py-4">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditStudent(student)}
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-all duration-300"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteStudent(student.id)}
                        className="px-3 py-2 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-all duration-300"
                      >
                        Del
                      </button>
                    </div>
                  </td>

                  {/* Result Column */}
                  <td className="px-4 md:px-6 py-4">
                    <div className="flex gap-2 ">
                      <button
                        onClick={() => {
                          sessionStorage.setItem(
                            "selectedStudent",
                            JSON.stringify(student),
                          );
                          sessionStorage.setItem("downloadPDF", "false");
                          // Save class info to sessionStorage for result sheet
                          sessionStorage.setItem(
                            "classSelection",
                            JSON.stringify({ ...classSelection, schoolId }),
                          );
                          navigate("/student-result-sheet");
                        }}
                        className="px-3 py-2 bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600 text-white text-xs font-semibold rounded-lg transition-all duration-300"
                      >
                        P
                      </button>
                      <button
                        onClick={() => handleDownloadResult(student)}
                        className="px-3 py-2 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white text-xs font-semibold rounded-lg transition-all duration-300"
                      >
                        D
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="3" className="px-6 py-8 text-center">
                  <p className="text-gray-500 dark:text-gray-400">
                    {students.length === 0
                      ? "No students added yet. Click 'Add Student' to get started."
                      : "No students match your search."}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Student Modal */}
      <AddStudent
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingStudent(null);
        }}
        onAdd={handleAddStudent}
        onUpdate={handleUpdateStudent}
        editingStudent={editingStudent}
      />

      {/* Student Result Preview Modal */}
      <StudentResultPreview
        isOpen={isResultPreviewOpen}
        onClose={() => {
          setIsResultPreviewOpen(false);
          setSelectedStudent(null);
        }}
        student={selectedStudent}
        classData={classSelection}
      />
    </div>
  );
}
