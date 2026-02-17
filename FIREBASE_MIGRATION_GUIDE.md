# Scoorla Firebase Migration Guide

## Overview
This document outlines the migration from localStorage-based storage to Firebase Realtime Database for production-ready multi-school support.

## New Architecture

### Core Services Created

1. **firebaseDatabase.js** - All Realtime Database operations
   - School management
   - Classes & Subjects
   - Students & Scores
   - Results compilation
   - Access code storage

2. **adminAuth.js** - Admin authentication via Firebase Auth
   - Email/password registration
   - Secure login
   - Password reset via email
   - Admin verification

3. **teacherCodes.js** - Teacher access code management
   - Code generation (6-digit random)
   - SHA-256 hashing
   - Code verification
   - Secure NONCE comparison

4. **userSession.js** - Session management
   - User initialization
   - Session state (sessionStorage)
   - Persistent user data (Firestore)
   - Selected class/subject/role

5. **firebase_rules.json** - Security rules
   - School data isolation
   - Role-based access control
   - Admin-only operations

## Database Structure

```
schools/
  {schoolId}/
    profile/            - School info (name, logo, address)
    classes/            - Class definitions
    subjects/           - Subject definitions
    students/           - Student records
    scores/             - Student performance data
    results/            - Compiled result sheets
    accessCodes/        - Teacher access codes (hashed)
    settings/           - School-specific settings
```

## Migration Steps

### Phase 1: Update Core Utilities

Replace all localStorage calls with Firebase equivalents:

#### authUtils.js Changes
```javascript
// OLD
localStorage.setItem(`selectedRole_${userId}`, roleId);

// NEW
import { setSelectedRole } from './userSession';
setSelectedRole(userId, roleId);
```

#### school-data.js Changes
```javascript
// OLD
localStorage.setItem('schoolData_' + userId, JSON.stringify(form));

// NEW
import { setSchoolProfile } from './firebaseDatabase';
await setSchoolProfile(schoolId, form);
```

### Phase 2: Update Components

Key component changes needed:

#### Admin Login
- Use `adminAuth.js` instead of localStorage
- No passcode needed - Firebase Auth handles security
- Email/password verification

#### Create School
- Use `firebaseDatabase.setSchoolProfile()`
- Generate and hash teacher codes with `teacherCodes.js`
- Store to Firebase

#### View Results
- Load from `firebaseDatabase.getResult()`
- Real-time updates via `firebaseDatabase.subscribeToPath()`

### Phase 3: Data Migration

For existing localStorage data, create migration script:

```javascript
// 1. Read all localStorage data
const schoolData = JSON.parse(localStorage.getItem('schoolData_' + userId));

// 2. Transfer to Firebase
await setSchoolProfile(schoolId, {
  name: schoolData.name,
  logo: schoolData.logo,
  address: schoolData.address,
  // ... other fields
});

// 3. Verify in Firebase
const firebaseData = await getSchoolProfile(schoolId);
console.assert(firebaseData.name === schoolData.name);

// 4. Clear localStorage
localStorage.removeItem('schoolData_' + userId);
```

## Security Implementation

### Admin Access
- Firebase Authentication (email/password)
- Role stored in Firestore
- No additional passcode needed

### Teacher Access
- 6-digit code generated per class/subject
- Code hashed before storage (SHA-256)
- Verification uses secure comparison
- Old codes deactivated when reset

### Data Isolation
- Firebase Rules enforce schoolId matching
- Teachers access only their class/subject
- Students have no direct database access
- Admins have full school access

## Testing Checklist

- [ ] Admin can register and login
- [ ] Admin can create school
- [ ] Admin can create classes
- [ ] Admin can create subjects
- [ ] Admin can add students
- [ ] Admin can generate teacher codes
- [ ] Class teacher can verify access with code
- [ ] Subject teacher can verify access with code
- [ ] Teacher can enter scores
- [ ] Admin can view and compile results
- [ ] Data persists across page refresh
- [ ] No data leaks between schools
- [ ] Access denied for unauthorized users
- [ ] Codes properly deactivated when reset

## Deployment Steps

1. **Update Firebase Rules**
   - Go to Firebase Console
   - Realtime Database → Rules
   - Paste contents of `firebase_rules.json`
   - Deploy

2. **Deploy Code**
   - All new utilities ready
   - All components updated
   - No localStorage calls remaining

3. **Migrate Data** (if applicable)
   - Run migration script
   - Verify all data transferred
   - Test all functionality

4. **Monitor**
   - Check Firebase usage
   - Monitor for errors
   - Verify performance

## Key Differences from Old System

| Feature | Old (localStorage) | New (Firebase) |
|---------|---|---|
| Persistence | Browser only | Cloud (persistent) |
| Multi-device | ❌ No | ✅ Yes |
| Multi-school | Manual isolation | Built-in isolation |
| Security | No built-in | Firebase Rules |
| Real-time sync | ❌ No | ✅ Listeners available |
| Offline support | ✅ Yes (localStorage) | Requires Firestore SDK |
| Scalability | Limited (2-5MB) | Unlimited |

## Environment Variables

No new env vars needed - Firebase config already in `src/firebase.js`

## Common Issues & Solutions

**Issue**: "Permission denied" errors
- Solution: Verify user has correct role in Firestore
- Check Firebase Rules applied correctly

**Issue**: Data not persisting
- Solution: Ensure `await` on all Firebase calls
- Check network in browser DevTools

**Issue**: Code verification always fails
- Solution: Ensure hashing is consistent
- Verify stored hash format (hex string)

## Rollback Plan

If critical issues occur:
1. Pause new user signups
2. Keep both systems running temporarily
3. Revert authentication to old system
4. Fix issues in staging environment
5. Redeploy with fixes

## Support & Monitoring

- Monitor Firebase Console
- Set up error tracking (Sentry, etc.)
- Regular backups of Realtime Database
- Security audits monthly

## Next Steps

1. ✅ Create all utility files
2. ⏳ Update all components to use utilities
3. ⏳ Test complete flow
4. ⏳ Deploy Firebase Rules
5. ⏳ Migrate existing data
6. ⏳ Production launch

---

**Version**: 1.0
**Last Updated**: February 2026
**Status**: Implementation in progress
