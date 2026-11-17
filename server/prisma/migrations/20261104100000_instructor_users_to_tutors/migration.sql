DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "role" = 'INSTRUCTOR'::"Role"
      AND "organizationId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot migrate Instructor accounts without an organization';
  END IF;
END $$;

INSERT INTO "TutorProfile" ("id", "organizationId", "userId", "tutorId", "joiningDate", "createdAt")
SELECT
  'legacy-tutor-' || md5("User"."id"),
  "User"."organizationId",
  "User"."id",
  'TUT-' || upper(md5("User"."id")),
  "User"."createdAt",
  CURRENT_TIMESTAMP
FROM "User"
WHERE "User"."role" = 'INSTRUCTOR'::"Role"
  AND "User"."organizationId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "TutorProfile"
    WHERE "TutorProfile"."userId" = "User"."id"
  );

UPDATE "AccountApproval"
SET
  "status" = 'APPROVED',
  "rejectionReason" = NULL,
  "approvedAt" = COALESCE("approvedAt", "createdAt")
WHERE "userId" IN (
  SELECT "id"
  FROM "User"
  WHERE "role" = 'INSTRUCTOR'::"Role"
);

UPDATE "User"
SET
  "role" = 'TUTOR'::"Role",
  "status" = 'APPROVED',
  "rejectionReason" = NULL,
  "approvedAt" = COALESCE("approvedAt", "createdAt"),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "role" = 'INSTRUCTOR'::"Role";
