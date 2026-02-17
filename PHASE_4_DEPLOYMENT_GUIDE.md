# Phase 4: Deployment & Testing Guide

## 🚀 Quick Start Checklist

- [ ] Deploy Firebase Realtime Database Rules
- [ ] Verify app compiles without errors
- [ ] Test admin signup → create school flow
- [ ] Test dashboard loads with school data
- [ ] Test score recording and saving
- [ ] Test result preview and PDF generation
- [ ] Verify teacher access code system
- [ ] Test multi-school data isolation
- [ ] Performance check and optimization

---

## 📋 Part 1: Deploy Firebase Rules

### Step 1: Open Firebase Console
1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Select your "Resulta" project
3. Navigate to **Realtime Database** from the left sidebar

### Step 2: Access Rules Tab
1. Click on the **Rules** tab at the top
2. You should see the current rules in an editor

### Step 3: Replace with New Rules
1. **Copy** all content from [firebase_rules.json](firebase_rules.json)
2. **Delete** all existing rules in the editor
3. **Paste** the new rules from firebase_rules.json
4. The rules should look like:
   ```json
   {
     "rules": {
       "schools": {
         "$schoolId": {
           ".read": "root.child('users')...",
           ".write": "root.child('users')...",
           ...
         }
       }
     }
   }
   ```

### Step 4: Publish Rules
1. Click **Publish** button
2. Confirm the deployment
3. Wait for status to show "✅ Last published rules" with timestamp
4. Rules are now live!

### Step 5: Verify Rules Are Active
- You should see: **"✅ Last Published [timestamp]"** at the top
- If you see red warnings, check the JSON syntax and fix before publishing

---

## ✅ Part 2: Verify Compilation

### Run Development Server
```bash
# In terminal at project root:
npm run dev
```

### Expected Output:
```
> vite

  VITE v4.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help

# Should compile without errors - green checkmark in terminal
```

### If Errors Appear:
1. Check error messages carefully
2. Most likely causes:
   - Missing import statements
   - Async/await misuse
   - Typos in function names
3. All Phase 3 updates should have zero errors currently

---

## 🧪 Part 3: Testing Checklist

### Test 1: Admin Signup & School Creation
**Objective:** Verify complete onboarding flow works with Firebase

**Steps:**
1. Open http://localhost:5173/
2. Click "Sign up"
3. Enter email: `admin@testschool.com`
4. Enter password: `Test123456`
5. Confirm password: `Test123456`
6. Click "Sign Up"
7. Check email verification (look for Firebase Auth email or use test email)
8. After verification, visit Welcome page
9. Complete onboarding
10. Create school with name: "Test School 1"
11. Fill in all details (address, email, phone, motto)
12. Click "Create School"

**Expected Results:**
- ✅ User created in Firebase Auth
- ✅ User document created in Firestore with schoolId and role
- ✅ School data saved in Realtime Database at `schools/test-school-1/profile`
- ✅ Admin passcode generated and hashed
- ✅ Redirected to school dashboard
- ✅ No localStorage being used (except for sessionStorage which expires on tab close)

**Verification:**
- In Firebase Console → Realtime Database, check:
  - `schools/test-school-1/profile/` exists with school data
  - School name, address, email, phone, motto all present

---

### Test 2: School Dashboard
**Objective:** Verify dashboard loads with Firebase data

**Steps:**
1. Already logged in from Test 1
2. View school dashboard
3. Should show school name and logo
4. Statistics (students, classes) should load
5. Buttons should be clickable: "Go to Class", "Record Result", "Admin"

**Expected Results:**
- ✅ School logo displays (if provided)
- ✅ School name displays: "Test School 1"
- ✅ Statistics load correctly
- ✅ All buttons functional
- ✅ Data loads from Firebase Realtime Database

**Verification:**
- Network tab shows requests to Firebase
- No localStorage data shown in DevTools

---

### Test 3: Admin Settings (Classes & Subjects)
**Objective:** Verify admin can configure school settings

**Steps:**
1. From school dashboard, click "Admin"
2. Go to "Classes" tab
3. Add a class: "JSS 1"
4. Go to "Subjects" tab
5. Select "Junior" level
6. Add subject: "Mathematics"
7. Save settings

**Expected Results:**
- ✅ Classes saved to sessionStorage (temporary, for UI)
- ✅ Subjects saved to sessionStorage
- ✅ Data persists during session
- ✅ Settings can be edited and updated

**Verification:**
- DevTools → Application → Session Storage shows classes/subjects
- Realtime Database shows settings saved

---

### Test 4: Record Scores
**Objective:** Verify score recording works with Firebase

**Steps:**
1. From dashboard, click "Go to Class"
2. Select class: "JSS 1"
3. Click "Search" or select a class
4. Click the class to open
5. Go to "Record Result"
6. Select class, subject, term, session
7. Enter scores for students:
   - Test 1: 15
   - Test 2: 16
   - Exam: 45
8. Scores should auto-save

**Expected Results:**
- ✅ Scores saved to Firebase in `schools/test-school-1/scores/{classId}/{subjectId}/{studentId}`
- ✅ After 1 second of inactivity, scores auto-save
- ✅ Refreshing page reloads scores from Firebase
- ✅ Scores persist across sessions

**Verification:**
- In Firebase Console → Realtime Database:
  - Navigate to `schools/test-school-1/scores/`
  - Should see structure: `jss1/mathematics/{studentId}/test1: 15`

---

### Test 5: Preview Result
**Objective:** Verify result calculation and preview

**Steps:**
1. From Record Dashboard, click "Preview Result"
2. Should show calculated results
3. Check grade calculation (score 76 = grade A)
4. Click "Download PDF"
5. PDF should generate with school info

**Expected Results:**
- ✅ Results compile with correct grades
- ✅ School info displays in PDF
- ✅ Student scores show correctly
- ✅ PDF downloads successfully
- ✅ All calculations are accurate

**Verification:**
- PDF contains school name, address, contact info
- Student scores and calculated grades are correct
- No errors in console

---

### Test 6: Multi-School Data Isolation
**Objective:** Verify schools can't access each other's data

**Steps:**
1. Create a **second admin account**:
   - Email: `admin2@testschool2.com`
   - Password: `Test123456`
2. Create a **second school**:
   - Name: "Test School 2"
3. In Firebase Console Realtime Database, verify:
   - Each school has separate data path
   - No mixing of data between schools

**Expected Results:**
- ✅ Two separate school entries in Realtime Database
- ✅ Each admin only sees their own school data
- ✅ No cross-access possible (enforced by Firebase Rules)
- ✅ Firebase Rules prevent one admin from accessing another school's data

**Verification:**
- Admin 1 logs in → sees only Test School 1 data
- Admin 2 logs in → sees only Test School 2 data
- In Realtime Database:
  - `schools/test-school-1/` contains only School 1 data
  - `schools/test-school-2/` contains only School 2 data
- Try to manually access another school's data → Firebase Rules reject it

---

### Test 7: Teacher Access Codes
**Objective:** Verify teacher code system works

**Steps:**
1. From Admin Settings, go to "Passwords" tab
2. Generate class access code for "JSS 1"
3. Code should display (6-digit number)
4. Copy and note the code
5. Store it (only shown once, hashed in database)
6. Try to reset code → old code becomes invalid
7. New code generates and displays

**Expected Results:**
- ✅ Unique 6-digit codes generate for each class
- ✅ Codes are SHA-256 hashed in database
- ✅ Plain code shown only once to admin
- ✅ Code reset deactivates old code
- ✅ Teachers can use codes to access classes

**Verification:**
- In Firebase → Realtime Database:
  - `schools/test-school-1/accessCodes/classTeacherCodes/`
  - Code hashes stored (not plain codes)
  - Hash format: 64-character SHA-256 string

---

### Test 8: Logout & Data Persistence
**Objective:** Verify proper cleanup and data persistence

**Steps:**
1. From any page, click "Logout"
2. Should be redirected to login
3. Log back in with same admin account
4. School data should still be there
5. Previously recorded scores should still exist
6. No stale data should remain

**Expected Results:**
- ✅ Logout clears sessionStorage and Firebase session
- ✅ No private data stored in localStorage
- ✅ Re-login retrieves data from Firebase
- ✅ All data persists correctly
- ✅ Proper cleanup on logout

**Verification:**
- After logout, sessionStorage is empty
- After re-login, data reloads from Firebase
- Previously saved scores are still there

---

## 🔧 Part 4: Debugging & Troubleshooting

### Common Issues & Solutions

**Issue: "Permission denied" in Firebase Console**
- **Cause:** Firebase Rules not properly deployed
- **Solution:** 
  1. Go to Firebase Rules tab
  2. Verify rules syntax is valid JSON
  3. Click "Publish" again
  4. Wait for confirmation message

**Issue: Scores not saving**
- **Cause:** schoolId not being passed correctly
- **Solution:**
  1. Check browser console for errors
  2. Verify userData.schoolId is set in Firestore
  3. Check that Firebase Rules allow write access

**Issue: School data showing blank**
- **Cause:** Async loading not complete
- **Solution:**
  1. Check for loading state UI
  2. Wait for loading spinner to complete
  3. Check network tab for failed requests
  4. Verify Firestore has user document with schoolId

**Issue: Multiple schools seeing same data**
- **Cause:** Firebase Rules not enforcing isolation
- **Solution:**
  1. Check firebase_rules.json was properly deployed
  2. Verify `.read` and `.write` rules check schoolId
  3. Clear browser cache and test again
  4. Check Firebase Rules simulator

### Browser Console Debugging
1. Open **DevTools** (F12)
2. Go to **Console** tab
3. Check for error messages
4. Look for Firebase auth/database errors
5. Most errors will be helpful in identifying issues

### Firebase Rules Simulator
To test rules without running the app:
1. Firebase Console → Realtime Database → Rules
2. Click "**Simulator**" button
3. Test read/write operations
4. Verify rules are working as expected

---

## ✨ Part 5: Performance Optimization

### Caching Strategy
- **sessionStorage:** Temporary UI state (expires on tab close)
- **Firestore:** Persistent user metadata
- **Realtime Database:** School data (profiles, students, scores, results)

### Load Times
- Initial load: 2-3 seconds (fetching user data + school data)
- Score save: <1 second (auto-save with debounce)
- Page navigation: Instant (cached data)

### Network Requests
- Signup/Login: 2 requests (Firebase Auth + Firestore user doc)
- Dashboard load: 2-3 requests (Firestore user data + Realtime Database school data)
- Score save: 1 request per batch (debounced every 1 second)

---

## 📝 Sign-Off Checklist

Before declaring Phase 4 complete, verify:

- [ ] Firebase Realtime Database Rules deployed successfully
- [ ] App compiles without errors (npm run dev shows no errors)
- [ ] Test 1 passes: Signup → School Creation
- [ ] Test 2 passes: Dashboard loads with correct data
- [ ] Test 3 passes: Admin settings work
- [ ] Test 4 passes: Scores save to Firebase
- [ ] Test 5 passes: Result preview and PDF work
- [ ] Test 6 passes: Multi-school data isolation verified
- [ ] Test 7 passes: Teacher access codes work
- [ ] Test 8 passes: Logout and re-login maintain data
- [ ] No localStorage being used (except for temporary role storage)
- [ ] All data persists appropriately
- [ ] No console errors during any test
- [ ] Firebase Rules enforce proper access control

---

## 🎉 Deployment Complete!

Once all tests pass:
1. App is production-ready
2. Multi-school support is fully functional
3. Security is enforced via Firebase Rules
4. Data isolation is guaranteed
5. All localStorage has been replaced with Firebase

### Next Steps:
- Monitor application for any issues
- Perform user acceptance testing with real users
- Optimize based on real-world usage patterns
- Plan for scaling to multiple institutions

---

**Status:** Phase 4 Ready to Execute
**Start Date:** February 12, 2026
**Estimated Duration:** 2-3 hours (comprehensive testing)

