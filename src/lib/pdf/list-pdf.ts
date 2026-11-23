/**
 * Eenvoudige A4-PDF voor keukenlijsten (werklijst, bestellijst).
 * Te openen en te printen op elke printer, ook vanaf een stickerapparaat
 * (dat in Chrome altijd naar de Argox print).
 *
 * jsPDF wordt pas geladen als je op "PDF" klikt.
 */

export interface PdfSection {
  heading: string;
  /** Kleine regel onder de kop (bv. "3/8 besteld"). */
  note?: string;
  columns: string[];
  rows: string[][];
  /** Eerste kolom is een afvinkvakje; `checked` per rij. */
  checkbox?: boolean;
  checked?: boolean[];
  /** Kolommen rechts uitlijnen (index). */
  alignRight?: number[];
}

export async function downloadListPdf(opts: {
  fileName: string;
  title: string;
  subtitle?: string;
  sections: PdfSection[];
  footer?: string;
}) {
  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 12;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(opts.title, margin, y + 4);
  y += 9;
  if (opts.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(opts.subtitle, margin, y);
    y += 6;
  }

  for (const sec of opts.sections) {
    if (y > 270) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(sec.heading, margin, y + 4);
    if (sec.note) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(sec.note, 210 - margin, y + 4, { align: "right" });
    }
    y += 6;
    const columns = sec.checkbox ? ["", ...sec.columns] : sec.columns;
    const body = sec.rows.map((r) => (sec.checkbox ? ["", ...r] : r));
    const shift = sec.checkbox ? 1 : 0;
    const columnStyles: Record<number, { halign?: "right"; cellWidth?: number }> = {};
    if (sec.checkbox) columnStyles[0] = { cellWidth: 8 };
    for (const i of sec.alignRight ?? []) columnStyles[i + shift] = { halign: "right" };
    autoTable(doc, {
      startY: y,
      head: [columns],
      body,
      margin: { left: margin, right: margin },
      styles: { font: "helvetica", fontSize: 9, cellPadding: 1.6, valign: "middle" },
      headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      columnStyles,
      didDrawCell: (data) => {
        if (!sec.checkbox || data.section !== "body" || data.column.index !== 0) return;
        const s = 3.6;
        const x = data.cell.x + (data.cell.width - s) / 2;
        const yy = data.cell.y + (data.cell.height - s) / 2;
        doc.setDrawColor(60);
        doc.rect(x, yy, s, s);
        if (sec.checked?.[data.row.index]) {
          doc.line(x + 0.7, yy + 1.9, x + 1.5, yy + 2.9);
          doc.line(x + 1.5, yy + 2.9, x + 3, yy + 0.8);
        }
      },
    });
    // @ts-expect-error lastAutoTable wordt door jspdf-autotable toegevoegd
    y = (doc.lastAutoTable?.finalY ?? y) + 6;
  }

  if (opts.footer) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (y > 285) {
      doc.addPage();
      y = margin;
    }
    doc.text(opts.footer, margin, y);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Culilogic · ${new Date().toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })} · pagina ${i} van ${pages}`,
      105,
      292,
      { align: "center" },
    );
    doc.setTextColor(0);
  }
  doc.save(opts.fileName);
}

export const pdfFileName = (base: string) =>
  `${base.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "lijst"}.pdf`;
