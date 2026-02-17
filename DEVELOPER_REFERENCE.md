# Firebase Migration - Developer Quick Reference

## 🔄 Common Migration Patterns

### Pattern 1: Store School Data

**OLD**:
```javascript
localStorage.setItem(`schoolData_${userId}`, JSON.stringify(form));
```

**NEW**:
```javascript
import { setSchoolProfile } from '../utils/firebaseDatabase';
import { getUserData } from '../utils/userSession';

const userData = await getUserData(auth.currentUser.uid);
const schoolId = userData.schoolId; // or use form.name.trim() as ID

await setSchoolProfile(schoolId, {
  name: form.name,
  logo: form.logo,
  address: form.address,
  email: form.email,
  phone: form.phone,
  motto: form.motto,
});
```

---

### Pattern 2: Load School Data

**OLD**:
```javascript
const data = localStorage.getItem(`schoolData_${userId}`);
const school = JSON.parse(data);
```

**NEW**:
```javascript
import { getSchoolProfile } from '../utils/firebaseDatabase';

const schoolId = userData.schoolId;
const school = await getSchoolProfile(schoolId);
```

---

### Pattern 3: Add Student

**OLD**:
```javascript
const students = JSON.parse(localStorage.getItem(`students_${userId}`));
students.push({ name: 'John', classId: 'JS1' });
localStorage.setItem(`students_${userId}`, JSON.stringify(students));
```

**NEW**:
```javascript
import { addStudent } from '../utils/firebaseDatabase';

const studentId = await addStudent(schoolId, {
  name: 'John',
  classId: 'JS1',
});
```

---

### Pattern 4: Get Students in Class

**OLD**:
```javascript
const students = JSON.parse(localStorage.getItem(`students_${userId}`));
const classStudents = students.filter(s => s.classId === classId);
```

**NEW**:
```javascript
import { getStudentsByClass } from '../utils/firebaseDatabase';

const classStudents = await getStudentsByClass(schoolId, classId);
```

---

### Pattern 5: Save Score

**OLD**:
```javascript
const key = `scores_${userId}/${classId}`;
const scores = JSON.parse(localStorage.getItem(key) || '{}');
scores[studentId] = { [subjectId]: 95 };
localStorage.setItem(key, JSON.stringify(scores));
```

**NEW**:
```javascript
import { setScore } from '../utils/firebaseDatabase';

await setScore(schoolId, classId, subjectId, studentId, {
  score: 95,
  grade: 'A',
  remarks: 'Excellent',
});
```

---

### Pattern 6: Get Scores by Subject

**OLD**:
```javascript
const scores = JSON.parse(localStorage.getItem(`scores_${userId}/${classId}/${subjectId}`) || '{}');
```

**NEW**:
```javascript
import { getScoresBySubject } from '../utils/firebaseDatabase';

const scores = await getScoresBySubject(schoolId, classId, subjectId);
// Returns: { studentId1: {score: 95}, studentId2: {score: 87} }
```

---

### Pattern 7: Generate Teacher Code

**OLD**:
```javascript
const code = Math.floor(100000 + Math.random() * 900000).toString();
localStorage.setItem(`classPassword_${classId}`, code);
```

**NEW**:
```javascript
import { createClassAccessCode } from '../utils/teacherCodes';

const { plainCode, codeId } = await createClassAccessCode(schoolId, classId);
// Show plainCode to admin once, then discard
// codeId stored for future reference
// Code is hashed in database
```

---

### Pattern 8: Verify Teacher Code

**OLD**:
```javascript
const stored = localStorage.getItem(`classPassword_${classId}`);
const valid = enteredCode === stored;
```

**NEW**:
```javascript
import { verifyTeacherAccess } from '../utils/teacherCodes';

const codeData = await verifyTeacherAccess(
  schoolId,
  enteredCode,
  'class', // or 'subject'
  classId,
  subjectId // required if type='subject'
);

if (codeData) {
  // Code is valid!
  setSessionState('classAccess_' + classId, true);
} else {
  // Invalid code
}
```

---

### Pattern 9: Store Session State (Temporary)

**OLD**:
```javascript
localStorage.setItem(`selectedClass_${userId}`, classId);
```

**NEW**:
```javascript
import { setSelectedClass, getSelectedClass } from '../utils/userSession';

// Store (in-browser only, expires on tab close)
setSelectedClass(auth.currentUser.uid, classId);

// Retrieve
const rememberedClass = getSelectedClass(auth.currentUser.uid);
```

---

### Pattern 10: Real-time Updates

**OLD**:
```javascript
// Manual refresh needed
const data = JSON.parse(localStorage.getItem(key));
```

**NEW**:
```javascript
import { subscribeToPath } from '../utils/firebaseDatabase';
import { useState, useEffect } from 'react';

function StudentList() {
  const [students, setStudents] = useState(null);
  
  useEffect(() => {
    // Subscribe to real-time updates
    const unsubscribe = subscribeToPath(
      schoolId,
      'students',
      setStudents
    );
    
    // Cleanup on unmount
    return () => unsubscribe();
  }, [schoolId]);
  
  if (!students) return <div>Loading...</div>;
  return <div>{/* render students */}</div>;
}
```

---

## 🔑 Key Authentication Flows

### Admin Login

```javascript
import { adminLogin } from '../utils/adminAuth';
import { initializeUserSession } from '../utils/userSession';

try {
  const admin = await adminLogin(email, password);
  await initializeUserSession(
    { uid: admin.uid, email: admin.email, displayName: admin.displayName },
    admin.schoolId,
    'admin'
  );
  // Redirect to dashboard
} catch (error) {
  setError(error.message);
}
```

### Teacher Access via Code

```javascript
import { verifyTeacherAccess } from '../utils/teacherCodes';
import { setSessionState } from '../utils/userSession';

try {
  const codeData = await verifyTeacherAccess(
    schoolId,
    enteredCode,
    'class',
    classId
  );
  
  if (codeData) {
    setSessionState(`classAccess_${classId}`, true);
    // Teacher can now access scores for this class
  } else {
    setError('Invalid code');
  }
} catch (error) {
  setError(error.message);
}
```

### User Logout

```javascript
import { adminLogout } from '../utils/adminAuth';
import { endUserSession } from '../utils/userSession';

try {
  const uid = auth.currentUser.uid;
  
  // End session in database
  await endUserSession(uid);
  
  // Sign out from Firebase
  await adminLogout();
  
  // Redirect to login
  navigate('/login');
} catch (error) {
  console.error('Logout failed:', error);
}
```

---

## 🛡️ Security Checks

### Check Admin Access to School

```javascript
import { verifyAdminForSchool } from '../utils/adminAuth';

const hasAccess = await verifyAdminForSchool(
  auth.currentUser.uid,
  schoolId
);

if (!hasAccess) {
  throw new Error('Unauthorized');
}
```

### Check Teacher Access to Class

```javascript
import { getSessionState } from '../utils/userSession';

const classId = route.params.classId;
const hasAccess = getSessionState(`classAccess_${classId}`);

if (!hasAccess) {
  navigate('/verify-code/' + classId);
}
```

---

## ⚠️ Common Mistakes to Avoid

### ❌ WRONG: Forgetting async/await

```javascript
// This won't work!
const students = getStudents(schoolId);
students.forEach(...) // students is still a Promise!
```

### ✅ RIGHT: Use async/await

```javascript
// Correct
const students = await getStudents(schoolId);
students.forEach(...) // Now it's actual data
```

---

### ❌ WRONG: Storing in localStorage after update

```javascript
await setScore(schoolId, classId, subjectId, studentId, scoreData);
// Don't do this:
localStorage.setItem('lastScore', JSON.stringify(scoreData));
```

### ✅ RIGHT: Let Firebase handle persistence

```javascript
// Just call Firebase
await setScore(schoolId, classId, subjectId, studentId, scoreData);
// Data is automatically persisted
```

---

### ❌ WRONG: Not unsubscribing from listeners

```javascript
useEffect(() => {
  subscribeToPath(schoolId, 'students', setStudents);
  // Missing cleanup! This will cause memory leaks
}, [schoolId]);
```

### ✅ RIGHT: Always unsubscribe

```javascript
useEffect(() => {
  const unsubscribe = subscribeToPath(schoolId, 'students', setStudents);
  return () => unsubscribe(); // Cleanup
}, [schoolId]);
```

---

## 📦 Import Cheatsheet

```javascript
// Firebase Realtime Database
import {
  setSchoolProfile, getSchoolProfile,
  setClass, getClasses,
  addStudent, getStudents, getStudentsByClass,
  setScore, getScoresBySubject,
  setResult, getResult,
  setClassAccessCode, getClassAccessCodes,
  subscribeToPath
} from '../utils/firebaseDatabase';

// Admin Authentication
import {
  registerAdmin, adminLogin, adminLogout,
  sendAdminPasswordReset,
  getAdminInfo, verifyAdminForSchool
} from '../utils/adminAuth';

// Teacher Codes
import {
  generateAccessCode, hashAccessCode,
  createClassAccessCode, createSubjectAccessCode,
  resetClassAccessCode, resetSubjectAccessCode,
  verifyTeacherAccess, listClassAccessCodes
} from '../utils/teacherCodes';

// User Sessions
import {
  initializeUserSession, getUserSession,
  setSessionState, getSessionState,
  setSelectedRole, getSelectedRole,
  setSelectedClass, getSelectedClass,
  endUserSession
} from '../utils/userSession';
```

---

## 🧪 Testing Examples

### Test Admin Login
```javascript
describe('Admin Login', () => {
  it('should login with valid credentials', async () => {
    const admin = await adminLogin('admin@school.com', 'password123');
    expect(admin.uid).toBeDefined();
    expect(admin.schoolId).toBe('school-1');
  });
  
  it('should fail with invalid password', async () => {
    await expect(
      adminLogin('admin@school.com', 'wrong')
    ).rejects.toThrow('Incorrect password');
  });
});
```

### Test Teacher Code
```javascript
describe('Teacher Code', () => {
  it('should create and verify code', async () => {
    const { plainCode } = await createClassAccessCode(schoolId, classId);
    
    const result = await verifyTeacherAccess(
      schoolId,
      plainCode,
      'class',
      classId
    );
    
    expect(result).toBeDefined();
    expect(result.classId).toBe(classId);
  });
});
```

---

**Version**: 1.0
**Last Updated**: February 2026
**For Questions**: Check FIREBASE_MIGRATION_GUIDE.md
