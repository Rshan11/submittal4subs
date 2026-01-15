// Submittal Package PDF Generator
// Creates cover sheet, TOC, dividers, and merges content PDFs

import { API_BASE_URL } from "./lib/api.js";

// We'll use pdf-lib for PDF manipulation
// Make sure to add: npm install pdf-lib
// Or include via CDN in HTML: https://unpkg.com/pdf-lib/dist/pdf-lib.min.js

export async function generateSubmittalPackagePDF(options) {
  const { projectName, companyName, companyLogoUrl, items, generatedDate } =
    options;

  // Dynamically import pdf-lib (works with bundler or CDN)
  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

  // Create a new PDF document
  const pdfDoc = await PDFDocument.create();
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Page dimensions (Letter size)
  const pageWidth = 612;
  const pageHeight = 792;

  // Colors
  const primaryColor = rgb(21 / 255, 84 / 255, 161 / 255); // PM4Subs blue
  const textColor = rgb(31 / 255, 41 / 255, 55 / 255);
  const mutedColor = rgb(107 / 255, 114 / 255, 128 / 255);

  // ============================================
  // COVER SHEET
  // ============================================
  const coverPage = pdfDoc.addPage([pageWidth, pageHeight]);

  // Company logo placeholder (top center)
  if (companyLogoUrl) {
    try {
      // Fetch and embed logo
      const logoResponse = await fetch(companyLogoUrl);
      const logoBytes = await logoResponse.arrayBuffer();
      const logoImage = await pdfDoc
        .embedPng(logoBytes)
        .catch(() => pdfDoc.embedJpg(logoBytes));

      const logoMaxWidth = 200;
      const logoMaxHeight = 80;
      const logoScale = Math.min(
        logoMaxWidth / logoImage.width,
        logoMaxHeight / logoImage.height,
      );

      coverPage.drawImage(logoImage, {
        x: (pageWidth - logoImage.width * logoScale) / 2,
        y: pageHeight - 120,
        width: logoImage.width * logoScale,
        height: logoImage.height * logoScale,
      });
    } catch (err) {
      console.warn("[PDF] Could not embed logo:", err);
    }
  }

  // Title
  const title = "SUBMITTAL PACKAGE";
  coverPage.drawText(title, {
    x: (pageWidth - helveticaBold.widthOfTextAtSize(title, 28)) / 2,
    y: pageHeight - 200,
    size: 28,
    font: helveticaBold,
    color: primaryColor,
  });

  // Project name
  coverPage.drawText(projectName, {
    x: (pageWidth - helveticaBold.widthOfTextAtSize(projectName, 20)) / 2,
    y: pageHeight - 250,
    size: 20,
    font: helveticaBold,
    color: textColor,
  });

  // Company name
  coverPage.drawText(companyName, {
    x: (pageWidth - helvetica.widthOfTextAtSize(companyName, 14)) / 2,
    y: pageHeight - 290,
    size: 14,
    font: helvetica,
    color: mutedColor,
  });

  // Date
  const dateStr = new Date(generatedDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  coverPage.drawText(dateStr, {
    x: (pageWidth - helvetica.widthOfTextAtSize(dateStr, 12)) / 2,
    y: pageHeight - 320,
    size: 12,
    font: helvetica,
    color: mutedColor,
  });

  // Submittal count
  const countText = `${items.length} Submittal${items.length !== 1 ? "s" : ""} Included`;
  coverPage.drawText(countText, {
    x: (pageWidth - helvetica.widthOfTextAtSize(countText, 12)) / 2,
    y: pageHeight - 350,
    size: 12,
    font: helvetica,
    color: mutedColor,
  });

  // Decorative line
  coverPage.drawRectangle({
    x: 100,
    y: pageHeight - 380,
    width: pageWidth - 200,
    height: 2,
    color: primaryColor,
  });

  // ============================================
  // TABLE OF CONTENTS
  // ============================================
  const tocPage = pdfDoc.addPage([pageWidth, pageHeight]);

  tocPage.drawText("TABLE OF CONTENTS", {
    x: 72,
    y: pageHeight - 72,
    size: 18,
    font: helveticaBold,
    color: primaryColor,
  });

  let tocY = pageHeight - 120;
  const tocLineHeight = 24;

  items.forEach((item, index) => {
    const num = String(index + 1).padStart(3, "0");
    const section = item.spec_section || "—";
    const desc = item.description || "Untitled";
    const mfr = item.manufacturer ? ` (${item.manufacturer})` : "";

    // Submittal number
    tocPage.drawText(num, {
      x: 72,
      y: tocY,
      size: 11,
      font: helveticaBold,
      color: primaryColor,
    });

    // Section
    tocPage.drawText(section, {
      x: 110,
      y: tocY,
      size: 11,
      font: helvetica,
      color: textColor,
    });

    // Description (truncate if too long)
    const maxDescLength = 50;
    const truncatedDesc =
      desc.length > maxDescLength
        ? desc.substring(0, maxDescLength) + "..."
        : desc;

    tocPage.drawText(truncatedDesc + mfr, {
      x: 200,
      y: tocY,
      size: 11,
      font: helvetica,
      color: textColor,
    });

    // File count
    const fileCount = item.submittal_package_files?.length || 0;
    const fileText = `${fileCount} file${fileCount !== 1 ? "s" : ""}`;
    tocPage.drawText(fileText, {
      x: pageWidth - 100,
      y: tocY,
      size: 10,
      font: helvetica,
      color: mutedColor,
    });

    tocY -= tocLineHeight;

    // Handle page overflow
    if (tocY < 72) {
      // Would need to add another TOC page for very long lists
      // For MVP, we'll just stop
      return;
    }
  });

  // ============================================
  // DIVIDER PAGES + CONTENT
  // ============================================
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const num = String(i + 1).padStart(3, "0");

    // --- DIVIDER PAGE ---
    const dividerPage = pdfDoc.addPage([pageWidth, pageHeight]);

    // Large submittal number
    const bigNum = `SUBMITTAL #${num}`;
    dividerPage.drawText(bigNum, {
      x: (pageWidth - helveticaBold.widthOfTextAtSize(bigNum, 36)) / 2,
      y: pageHeight / 2 + 60,
      size: 36,
      font: helveticaBold,
      color: primaryColor,
    });

    // Spec section
    if (item.spec_section) {
      const sectionText = `Section ${item.spec_section}`;
      dividerPage.drawText(sectionText, {
        x: (pageWidth - helvetica.widthOfTextAtSize(sectionText, 14)) / 2,
        y: pageHeight / 2 + 20,
        size: 14,
        font: helvetica,
        color: mutedColor,
      });
    }

    // Description
    const descText = item.description || "Untitled";
    dividerPage.drawText(descText, {
      x: (pageWidth - helveticaBold.widthOfTextAtSize(descText, 18)) / 2,
      y: pageHeight / 2 - 20,
      size: 18,
      font: helveticaBold,
      color: textColor,
    });

    // Manufacturer
    if (item.manufacturer) {
      const mfrText = item.manufacturer;
      dividerPage.drawText(mfrText, {
        x: (pageWidth - helvetica.widthOfTextAtSize(mfrText, 14)) / 2,
        y: pageHeight / 2 - 50,
        size: 14,
        font: helvetica,
        color: mutedColor,
      });
    }

    // --- CONTENT PAGES (merge PDFs) ---
    const files = item.submittal_package_files || [];

    for (const file of files) {
      try {
        // Fetch the PDF file from R2 via Python service
        const fileUrl = `${API_BASE_URL}/submittal/file/${file.r2_key}`;
        const response = await fetch(fileUrl);

        if (!response.ok) {
          console.warn(
            `[PDF] Could not download file ${file.file_name}: ${response.status}`,
          );
          continue;
        }

        // Load the PDF
        const fileBytes = await response.arrayBuffer();
        const externalPdf = await PDFDocument.load(fileBytes);

        // Copy all pages from the external PDF
        const copiedPages = await pdfDoc.copyPages(
          externalPdf,
          externalPdf.getPageIndices(),
        );

        copiedPages.forEach((page) => {
          pdfDoc.addPage(page);
        });

        console.log(
          `[PDF] Added ${copiedPages.length} pages from ${file.file_name}`,
        );
      } catch (err) {
        console.warn(`[PDF] Error processing file ${file.file_name}:`, err);

        // Add a placeholder page for failed files
        const errorPage = pdfDoc.addPage([pageWidth, pageHeight]);
        errorPage.drawText("File could not be loaded", {
          x: 72,
          y: pageHeight / 2,
          size: 14,
          font: helvetica,
          color: rgb(0.8, 0.2, 0.2),
        });
        errorPage.drawText(file.file_name, {
          x: 72,
          y: pageHeight / 2 - 24,
          size: 12,
          font: helvetica,
          color: mutedColor,
        });
      }
    }

    // If no files, add a placeholder page
    if (files.length === 0) {
      const placeholderPage = pdfDoc.addPage([pageWidth, pageHeight]);
      placeholderPage.drawText("No documents attached", {
        x:
          (pageWidth -
            helvetica.widthOfTextAtSize("No documents attached", 14)) /
          2,
        y: pageHeight / 2,
        size: 14,
        font: helvetica,
        color: mutedColor,
      });
    }
  }

  // ============================================
  // SAVE AND RETURN
  // ============================================
  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}

// ============================================
// HELPER: Generate just a cover sheet (for preview)
// ============================================
export async function generateCoverSheetPreview(options) {
  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

  const pdfDoc = await PDFDocument.create();
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageWidth = 612;
  const pageHeight = 792;
  const primaryColor = rgb(21 / 255, 84 / 255, 161 / 255);
  const textColor = rgb(31 / 255, 41 / 255, 55 / 255);

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  page.drawText("SUBMITTAL PACKAGE", {
    x:
      (pageWidth - helveticaBold.widthOfTextAtSize("SUBMITTAL PACKAGE", 28)) /
      2,
    y: pageHeight - 200,
    size: 28,
    font: helveticaBold,
    color: primaryColor,
  });

  page.drawText(options.projectName || "Project Name", {
    x:
      (pageWidth -
        helveticaBold.widthOfTextAtSize(
          options.projectName || "Project Name",
          20,
        )) /
      2,
    y: pageHeight - 250,
    size: 20,
    font: helveticaBold,
    color: textColor,
  });

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}
