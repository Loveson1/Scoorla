# Firestore Migration Cleanup Notes (Step 1)

This repository now contains the Firestore foundation files for the migration:

- `firestore.rules` (school-scoped, role-aware access with archived session write guards)
- `firestore.indexes.json` (composite indexes for session/term/enrollment/score queries)
- `firebase.json` (Firestore deployment mapping for rules + indexes)
- `FIRESTORE_SCHEMA.md` (target collection model + sample documents)
- `src/utils/firestoreService.js` (Step 1/2 foundation service with Firestore-first APIs)

## What is intentionally NOT removed yet

To avoid breaking production flow during phased migration, Realtime Database code remains for now:

- `src/utils/firebaseDatabase.js`
- Realtime imports/usages in existing components and helpers
- `firebase_rules.json`

## Step 2 and Step 3 cleanup targets

1. Replace all `firebase/database` reads/writes with `src/utils/firestoreService.js`.
2. Move session/term state reads to Firestore `settings/{schoolId}`.
3. Migrate enrollment-based class/student/score reads to Firestore queries.
4. After full switch-over, remove:
   - `src/utils/firebaseDatabase.js`
   - `firebase_rules.json`
   - any `getDatabase` usage from `src/firebase.js`
5. Keep historical safety:
   - archived sessions remain read-only
   - no hard deletion of students with academic records

## Deployment note

Deploy Firestore rules and indexes only when Step 2 wiring is ready in the app runtime.  
Until then, treat these files as migration-ready configuration artifacts.
