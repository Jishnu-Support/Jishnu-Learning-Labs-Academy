ALTER TABLE "Note"
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE TABLE "NoteView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NoteView_organizationId_noteId_createdAt_idx"
ON "NoteView"("organizationId", "noteId", "createdAt");

CREATE INDEX "NoteView_organizationId_userId_createdAt_idx"
ON "NoteView"("organizationId", "userId", "createdAt");

ALTER TABLE "NoteView"
ADD CONSTRAINT "NoteView_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoteView"
ADD CONSTRAINT "NoteView_noteId_fkey"
FOREIGN KEY ("noteId") REFERENCES "Note"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoteView"
ADD CONSTRAINT "NoteView_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
