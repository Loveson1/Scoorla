# Scoorla

## Platform Super Admin Bootstrap

To create the first platform super admin user:

1. Create the Firebase Authentication user normally.
2. In Firestore, create a document at `platformUsers/{uid}` where `{uid}` is that auth user's UID.
3. Set the document fields:
   - `role: "super_admin"`
   - `email: "<the user's email>"`
   - `createdAt: <timestamp>`

After that, the account can sign in and access `/platform`.

## Platform Search Index

Platform school search now uses a Firestore-backed `searchIndex` field on each `schools/{schoolId}`
document.

- New or updated school records populate `searchIndex` automatically.
- Legacy school records created before this change may need one backfill pass.
- A super admin can run the one-time backfill from `/platform` using the
  `Backfill Legacy Search Index` action on the platform dashboard.

After updating `firestore.indexes.json`, deploy the indexes with:

```bash
firebase deploy --only firestore:indexes
```



















