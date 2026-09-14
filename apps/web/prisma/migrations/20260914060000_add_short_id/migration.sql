-- AddColumn (nullable first, so existing rows can be backfilled)
ALTER TABLE "pdf_records" ADD COLUMN "shortId" TEXT;

-- Backfill: give any pre-existing row an opaque short id.
UPDATE "pdf_records"
SET "shortId" = substr(md5(random()::text || "id"), 1, 10)
WHERE "shortId" IS NULL;

-- Enforce NOT NULL + uniqueness now that every row has a value.
ALTER TABLE "pdf_records" ALTER COLUMN "shortId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "pdf_records_shortId_key" ON "pdf_records"("shortId");
