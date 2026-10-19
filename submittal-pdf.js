// Submittal Package PDF Generator
// Creates cover sheet, TOC, dividers, and merges content PDFs

import { fetchSubmittalFile } from "./lib/api.js";

// We'll use pdf-lib for PDF manipulation
// Make sure to add: npm install pdf-lib
// Or include via CDN in HTML: https://unpkg.com/pdf-lib/dist/pdf-lib.min.js

// Helper to clean placeholder text
function cleanField(value) {
  if (!value) return null;
  if (value.toLowerCase().includes("click to add")) return null;
  return value.trim();
}

// Helper to check if file is a PDF
function isPDFFile(filename) {
  return filename.toLowerCase().endsWith(".pdf");
}

// File extensions that can be converted to PDF server-side
const CONVERTIBLE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".rtf",
  ".txt",
  ".odt",
  ".xls",
  ".xlsx",
  ".ods",
  ".csv",
  ".ppt",
  ".pptx",
  ".odp",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".tif",
  ".tiff",
  ".bmp",
]);

function canConvertToPDF(filename) {
  const ext = "." + filename.toLowerCase().split(".").pop();
  return CONVERTIBLE_EXTENSIONS.has(ext);
}

export async function generateSubmittalPackagePDF(options) {
  const { projectName, companyName, companyLogoUrl, logoOmitted, items, generatedDate,
    onWarning = (message) => globalThis.alert?.(message) } =
    options;

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Add submittal items and attachments before combining the package.");
  }
  for (const item of items) {
    const files = item.submittal_package_files;
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("Every submittal item needs an attachment before the package can be complete.");
    }
    for (const file of files) {
      if (typeof file.file_name !== "string" || !file.r2_key ||
          (!isPDFFile(file.file_name) && !canConvertToPDF(file.file_name))) {
        throw new Error(`Attachment ${file.file_name || "(unnamed)"} cannot be included. Upload a PDF or supported document before combining.`);
      }
    }
  }
  // Logos are not linked submittal items. Never fetch them through that protected
  // route, or send a bearer token to an arbitrary profile-provided URL.
  if (companyLogoUrl || logoOmitted) {
    onWarning("Company logo omitted: secure logo downloads are not supported yet. All submittal attachments are still required.");
  }

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

    // Clean fields - filter out placeholder text
    const section = cleanField(item.spec_section);
    const desc = cleanField(item.description) || "Untitled";
    const mfr = cleanField(item.manufacturer);

    // Submittal number
    tocPage.drawText(num, {
      x: 72,
      y: tocY,
      size: 11,
      font: helveticaBold,
      color: primaryColor,
    });

    // Section (only show if it has a real value)
    if (section) {
      tocPage.drawText(section, {
        x: 110,
        y: tocY,
        size: 11,
        font: helvetica,
        color: textColor,
      });
    }

    // Description (truncate if too long)
    const maxDescLength = 45;
    let displayText =
      desc.length > maxDescLength
        ? desc.substring(0, maxDescLength) + "..."
        : desc;

    // Add manufacturer if present
    if (mfr) {
      const mfrSuffix = ` (${mfr})`;
      if (displayText.length + mfrSuffix.length > 55) {
        displayText = displayText.substring(0, 55 - mfrSuffix.length) + "...";
      }
      displayText += mfrSuffix;
    }

    tocPage.drawText(displayText, {
      x: section ? 200 : 110, // Shift left if no section
      y: tocY,
      size: 11,
      font: helvetica,
      color: textColor,
    });

    // File count (right-aligned)
    const fileCount = item.submittal_package_files?.length || 0;
    const fileText = `${fileCount} file${fileCount !== 1 ? "s" : ""}`;
    const fileTextWidth = helvetica.widthOfTextAtSize(fileText, 10);
    tocPage.drawText(fileText, {
      x: pageWidth - 72 - fileTextWidth,
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

    // Clean fields - filter out placeholder text
    const specSection = cleanField(item.spec_section);
    const description = cleanField(item.description) || "Untitled";
    const manufacturer = cleanField(item.manufacturer);

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

    // Spec section (only if it has a real value)
    if (specSection) {
      const sectionText = `Section ${specSection}`;
      dividerPage.drawText(sectionText, {
        x: (pageWidth - helvetica.widthOfTextAtSize(sectionText, 14)) / 2,
        y: pageHeight / 2 + 20,
        size: 14,
        font: helvetica,
        color: mutedColor,
      });
    }

    // Description
    dividerPage.drawText(description, {
      x: (pageWidth - helveticaBold.widthOfTextAtSize(description, 18)) / 2,
      y: pageHeight / 2 - 20,
      size: 18,
      font: helveticaBold,
      color: textColor,
    });

    // Manufacturer (only if it has a real value)
    if (manufacturer) {
      dividerPage.drawText(manufacturer, {
        x: (pageWidth - helvetica.widthOfTextAtSize(manufacturer, 14)) / 2,
        y: pageHeight / 2 - 50,
        size: 14,
        font: helvetica,
        color: mutedColor,
      });
    }

    // Every attachment must load and merge successfully before save/completion.
    for (const file of item.submittal_package_files) {
      try {
        const response = await fetchSubmittalFile(file.r2_key, {
          convertToPdf: !isPDFFile(file.file_name),
        });
        const fileBytes = await response.arrayBuffer();
        const externalPdf = await PDFDocument.load(fileBytes);
        const indices = externalPdf.getPageIndices();
        if (indices.length === 0) throw new Error("The attachment PDF is empty.");
        const copiedPages = await pdfDoc.copyPages(externalPdf, indices);
        if (copiedPages.length !== indices.length) throw new Error("Attachment pages were missing.");
        copiedPages.forEach((page) => pdfDoc.addPage(page));
      } catch (error) {
        throw new Error(`Could not include attachment "${file.file_name}". The package was not completed. ${error.message || "Please retry."}`);
      }
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
