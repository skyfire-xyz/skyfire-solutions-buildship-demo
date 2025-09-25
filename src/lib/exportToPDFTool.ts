import { jsonSchema } from "ai";
import jsPDF from "jspdf";
import fs from 'fs/promises';
import path from 'path';

export const exportToPdfTool = {
    "export-text-to-pdf": {
      description: "Exports text content to a PDF file and saves it to the app directory.",
      parameters: jsonSchema({
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text content to export to PDF",
          },
          filename: {
            type: "string",
            description: "The filename for the PDF (without .pdf extension)",
            default: "export"
          },
          fontSize: {
            type: "number",
            description: "Font size for the text",
            default: 12
          },
          pageMargin: {
            type: "number",
            description: "Page margin in mm",
            default: 20
          }
        },
        required: ["text", "filename", "fontSize", "pageMargin"],
        additionalProperties: false,
      }),
      execute: async ({ text, filename = "export", fontSize = 12, pageMargin = 20 }: {
        text: string;
        filename?: string;
        fontSize?: number;
        pageMargin?: number;
      }) => {
        try {
          // Create new PDF document
          const doc = new jsPDF();

          // Set font size
          doc.setFontSize(fontSize);

          // Split text into lines that fit within page width
          const pageWidth = doc.internal.pageSize.getWidth();
          const textWidth = pageWidth - (2 * pageMargin);
          const lines = doc.splitTextToSize(text, textWidth);

          // Add text to PDF with word wrapping and page breaks
          let currentY = pageMargin;
          const lineHeight = fontSize * 0.35; // Approximate line height based on font size
          const pageHeight = doc.internal.pageSize.getHeight();

          lines.forEach((line: string) => {
            if (currentY + lineHeight > pageHeight - pageMargin) {
              doc.addPage();
              currentY = pageMargin;
            }
            doc.text(line, pageMargin, currentY);
            currentY += lineHeight;
          });

          // Generate PDF as base64 string
          const pdfBase64 = doc.output('datauristring');

          let savedPath = null;

          // Always save to file system
          try {
            // Get the PDF as a buffer
            const pdfBuffer = doc.output('arraybuffer');

            // Define the save path - same directory as actions.tsx (src/app/)
            const appDir = path.join(process.cwd(), 'src', 'app');
            const fullPath = path.join(appDir, `${filename}.pdf`);

            // Ensure the directory exists
            await fs.mkdir(appDir, { recursive: true });

            // Write the PDF file
            await fs.writeFile(fullPath, Buffer.from(pdfBuffer));
            savedPath = fullPath;

            console.log(`📄 PDF saved to: ${fullPath}`);
          } catch (fileError) {
            console.error("Error saving PDF to file:", fileError);
            // Continue execution even if file save fails
          }

          return {
            content: [
              {
                type: "text",
                text: `PDF successfully created with filename: ${filename}.pdf${savedPath ? ` and saved to: ${savedPath}` : ''}`,
              },
            ],
            metadata: {
              filename: `${filename}.pdf`,
              base64Data: pdfBase64,
              pageCount: doc.getNumberOfPages(),
              textLength: text.length,
              savedPath: savedPath,
              savedToFile: savedPath !== null
            }
          };
        } catch (error) {
          console.error("Error creating PDF:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error creating PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ],
          };
        }
      },
    },
  };
