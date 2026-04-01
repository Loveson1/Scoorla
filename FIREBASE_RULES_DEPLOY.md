# Firebase Rules Deployment - Quick Reference

## Copy This Content to Firebase Console

**Location:** Firebase Console → Realtime Database → Rules Tab

**Step 1:** Select All Current Rules
- Click in the Rules Editor
- Press `Ctrl+A` to select all
- Press `Delete` to clear

**Step 2:** Paste New Rules
Copy the content below and paste into the Rules Editor:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid && (!data.exists() || (newData.child('schoolId').val() == data.child('schoolId').val() && newData.child('role').val() == data.child('role').val()))"
      }
    },
    "schools": {
      "$schoolId": {
        ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
        ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
        "profile": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        },
        "classes": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        },
        "subjects": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        },
        "students": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          "$studentId": {
            ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
            ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin' && (newData.exists() || !root.child('indexes').child('studentEnrollments').child($schoolId).child($studentId).exists())",
            "status": {
              ".validate": "newData.isString() && (newData.val() == 'active' || newData.val() == 'inactive' || newData.val() == 'graduated' || newData.val() == 'transferred' || newData.val() == 'withdrawn' || newData.val() == 'archived')"
            },
            "isDeleted": {
              ".validate": "newData.isBoolean()"
            },
            "deletedAt": {
              ".validate": "newData.val() == null || newData.isNumber() || newData.isString()"
            },
            "createdAt": {
              ".validate": "newData.isNumber() || newData.isString()"
            },
            "updatedAt": {
              ".validate": "newData.isNumber() || newData.isString()"
            }
          }
        },
        "sessions": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        },
        "terms": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        },
        "enrollments": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        },
        "scores": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        },
        "results": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        },
        "accessCodes": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        },
        "settings": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        }
      }
    },
    "indexes": {
      "sessionEnrollments": {
        "$schoolId": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        }
      },
      "classSessionEnrollments": {
        "$schoolId": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        }
      },
      "studentEnrollments": {
        "$schoolId": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        }
      },
      "termScores": {
        "$schoolId": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        }
      },
      "enrollmentTermScores": {
        "$schoolId": {
          ".read": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('schoolId').val() == $schoolId && root.child('users').child(auth.uid).child('role').val() == 'admin'"
        }
      },
      "sessionSchools": {
        "$sessionId": {
          ".read": "auth != null && data.val() == root.child('users').child(auth.uid).child('schoolId').val() && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() == 'admin' && (newData.val() == root.child('users').child(auth.uid).child('schoolId').val() || !newData.exists())"
        }
      },
      "enrollmentSchools": {
        "$enrollmentId": {
          ".read": "auth != null && data.val() == root.child('users').child(auth.uid).child('schoolId').val() && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() == 'admin' && (newData.val() == root.child('users').child(auth.uid).child('schoolId').val() || !newData.exists())"
        }
      },
      "scoreSchools": {
        "$scoreId": {
          ".read": "auth != null && data.val() == root.child('users').child(auth.uid).child('schoolId').val() && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() == 'admin' && (newData.val() == root.child('users').child(auth.uid).child('schoolId').val() || !newData.exists())"
        }
      },
      "scoreMeta": {
        "$scoreId": {
          ".read": "auth != null && data.child('schoolId').val() == root.child('users').child(auth.uid).child('schoolId').val() && root.child('users').child(auth.uid).child('role').val() == 'admin'",
          ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() == 'admin' && (!newData.exists() || newData.child('schoolId').val() == root.child('users').child(auth.uid).child('schoolId').val())"
        }
      }
    }
  }
}
```

**Step 3:** Click "Publish"
- Button is in the top right of the Rules Editor
- Wait for confirmation: "✅ Published [timestamp]"

**Step 4:** Verify Deployment
- Close and reopen Rules tab
- Rules should still be visible
- Status should show "✅ Last Published [time]"

---

## Validate Rules with Simulator

**Before testing in app, test the rules:**

1. Click **"Simulator"** button in Rules tab
2. Test operation: **Read**
3. Path: `schools/test-school-1/profile`
4. Auth token: Create a test token
5. Should show: ✅ **Allowed** (if user has correct schoolId)

---

## What These Rules Do

### School-Level Access
- Only admins of a school can read/write all school data
- Verified by: `schoolId` in user document matches `$schoolId` in path
- Role checked: `role == 'admin'`

### Class/Subject/Student Data
- Only school admins can read/write
- Student lifecycle fields are validated (`status`, `isDeleted`, timestamps)
- Student hard-delete is blocked if enrollment history exists (`indexes/studentEnrollments`)

### Scores
- Only admins can read/write

### Results
- Only admins can read/write results
- No student or teacher access

### Access Codes
- Only visible to admins (hashes, not plain codes)
- Uses secure SHA-256 hashing (computed in app, only hashes stored)

### Settings
- Only admins can read/write

---

## Troubleshooting Rules

**If you see "Permission denied" errors:**

1. Check the Rules are published (status shows ✅)
2. Use Rules Simulator to test your specific case
3. Verify user document in Firestore has:
   - `schoolId` field matching the path accessing
   - `role` field set to `admin`
4. Check that `auth.uid` is authenticated (user logged in)

**Common mistakes:**
- Rules not published (still in editor, not saved)
- User document doesn't have `schoolId` or `role` fields
- schoolId mismatch between user doc and attempted path
- User not authenticated (no auth.uid)

---

## After Deployment

1. ✅ Rules deployed to Firebase
2. ✅ Ready to test the application
3. ✅ Follow testing steps in PHASE_4_DEPLOYMENT_GUIDE.md
4. ✅ Run `npm run dev` to start app
5. ✅ Execute all 8 test scenarios



