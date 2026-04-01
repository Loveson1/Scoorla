# Scoorla Firestore Schema (Step 1 Foundation)

This is the Firestore-first data model for Scoorla.  
All domain collections are top-level and every domain document includes `schoolId`.

## Collections

### `schools/{schoolId}`
- Core school profile and metadata.
- Example fields: `schoolId`, `name`, `email`, `phone`, `address`, `motto`, `createdAt`, `updatedAt`

### `users/{userId}`
- Auth profile and authorization context.
- Example fields: `schoolId`, `role`, `email`, `displayName`, `onboardingComplete`, `createdAt`, `updatedAt`
- Roles: `admin`, `class_teacher`, `subject_teacher`

### `settings/{schoolId}`
- Global academic state for a school.
- Fields:
  - `schoolId`
  - `activeSessionId`
  - `activeTermId`
  - `updatedAt`

### `sessions/{sessionId}`
- Academic sessions per school.
- Fields:
  - `sessionId`
  - `schoolId`
  - `name` (e.g. `2026/2027`)
  - `isActive` (bool)
  - `isArchived` (bool)
  - `isEditable` (bool)
  - `createdAt`
  - `updatedAt`

### `terms/{termId}`
- Terms scoped to a session.
- Fields:
  - `termId`
  - `schoolId`
  - `sessionId`
  - `name` (`1st Term`, `2nd Term`, `3rd Term`)
  - `alias` (`term1`, `term2`, `term3`)
  - `sortOrder` (1, 2, 3)
  - `isActive` (bool)
  - `createdAt`
  - `updatedAt`

### `classes/{classId}`
- Class definitions and promotion order.
- Fields:
  - `classId`
  - `schoolId`
  - `name` (e.g. `JSS1`, `SS2B`)
  - `levelOrder` (numeric)
  - `createdAt`
  - `updatedAt`

### `students/{studentId}`
- Permanent student identity records.
- Fields:
  - `studentId`
  - `schoolId`
  - `firstName`
  - `lastName`
  - `gender`
  - `status` (`active`, `withdrawn`, `graduated`)
  - `isDeleted` (bool)
  - `createdAt`
  - `updatedAt`

### `enrollments/{enrollmentId}`
- Student class placement per session.
- Fields:
  - `enrollmentId`
  - `schoolId`
  - `studentId`
  - `classId`
  - `sessionId`
  - `createdAt`
  - `updatedAt`

### `subjects/{subjectId}`
- Subject catalog.
- Fields:
  - `subjectId`
  - `schoolId`
  - `name`
  - `level` (`junior`/`senior` optional)
  - `createdAt`
  - `updatedAt`

### `scores/{scoreId}`
- Enrollment-scoped assessment records.
- Fields:
  - `scoreId`
  - `schoolId`
  - `enrollmentId`
  - `studentId` (denormalized convenience field)
  - `classId` (denormalized convenience field)
  - `sessionId`
  - `termId`
  - `subjectId`
  - `score`
  - `createdAt`
  - `updatedAt`

## Example Documents

```json
{
  "settings/school_abc": {
    "schoolId": "school_abc",
    "activeSessionId": "sess_2032_2033",
    "activeTermId": "term_sess_2032_2033_1",
    "updatedAt": "serverTimestamp()"
  },
  "sessions/sess_2032_2033": {
    "sessionId": "sess_2032_2033",
    "schoolId": "school_abc",
    "name": "2032/2033",
    "isActive": true,
    "isArchived": false,
    "isEditable": true,
    "createdAt": "serverTimestamp()",
    "updatedAt": "serverTimestamp()"
  },
  "terms/term_sess_2032_2033_1": {
    "termId": "term_sess_2032_2033_1",
    "schoolId": "school_abc",
    "sessionId": "sess_2032_2033",
    "name": "1st Term",
    "alias": "term1",
    "sortOrder": 1,
    "isActive": true,
    "createdAt": "serverTimestamp()",
    "updatedAt": "serverTimestamp()"
  },
  "students/std_001": {
    "studentId": "std_001",
    "schoolId": "school_abc",
    "firstName": "Ada",
    "lastName": "Okafor",
    "gender": "female",
    "status": "active",
    "isDeleted": false,
    "createdAt": "serverTimestamp()",
    "updatedAt": "serverTimestamp()"
  },
  "enrollments/enr_001": {
    "enrollmentId": "enr_001",
    "schoolId": "school_abc",
    "studentId": "std_001",
    "classId": "jss1",
    "sessionId": "sess_2032_2033",
    "createdAt": "serverTimestamp()",
    "updatedAt": "serverTimestamp()"
  },
  "scores/scr_001": {
    "scoreId": "scr_001",
    "schoolId": "school_abc",
    "enrollmentId": "enr_001",
    "studentId": "std_001",
    "classId": "jss1",
    "sessionId": "sess_2032_2033",
    "termId": "term_sess_2032_2033_1",
    "subjectId": "math",
    "score": 78,
    "createdAt": "serverTimestamp()",
    "updatedAt": "serverTimestamp()"
  }
}
```

## Query Discipline

All application queries must include:
- `schoolId`
- session scope (`sessionId`)
- term scope (`termId`) for score/result operations

If `sessionId` is missing in client calls, resolve from `settings/{schoolId}.activeSessionId`.
