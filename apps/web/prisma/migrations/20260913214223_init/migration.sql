-- CreateTable
CREATE TABLE "pdf_records" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "qrPath" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_records_pkey" PRIMARY KEY ("id")
);
