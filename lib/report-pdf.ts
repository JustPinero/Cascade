import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  SingleProjectReport,
  CrossProjectReport,
} from "./report-generator";

const COLORS = {
  bg: [10, 14, 20] as [number, number, number],
  cyan: [65, 166, 181] as [number, number, number],
  text: [197, 204, 216] as [number, number, number],
  textBright: [228, 232, 238] as [number, number, number],
  danger: [240, 83, 95] as [number, number, number],
  amber: [224, 175, 104] as [number, number, number],
};

function addHeader(doc: jsPDF, title: string, subtitle: string) {
  // Header bar
  doc.setFillColor(...COLORS.bg);
  doc.rect(0, 0, 210, 30, "F");
  doc.setFillColor(...COLORS.cyan);
  doc.rect(0, 28, 210, 1, "F");

  doc.setTextColor(...COLORS.textBright);
  doc.setFontSize(18);
  doc.text(title, 14, 15);

  doc.setTextColor(...COLORS.text);
  doc.setFontSize(9);
  doc.text(subtitle, 14, 23);
}

function addFooter(doc: jsPDF, generatedAt: string) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...COLORS.cyan);
    doc.rect(0, 287, 210, 0.5, "F");
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(7);
    doc.text(
      `Cascade Nerve Center | Generated ${generatedAt.split("T")[0]} | Page ${i}/${pageCount}`,
      14,
      293
    );
  }
}

export function singleReportToPdf(report: SingleProjectReport): Buffer {
  const doc = new jsPDF();

  addHeader(
    doc,
    report.projectName,
    `${report.status} | ${report.health} | ${report.currentPhase}`
  );

  let y = 38;

  // Audit History
  if (report.audits.length > 0) {
    doc.setTextColor(...COLORS.cyan);
    doc.setFontSize(11);
    doc.text("Audit History", 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["Type", "Grade", "Date"]],
      body: report.audits.map((a) => [
        a.type,
        a.grade || "N/A",
        a.date.split("T")[0],
      ]),
      theme: "grid",
      styles: { fontSize: 8, textColor: COLORS.text, fillColor: COLORS.bg },
      headStyles: { fillColor: COLORS.cyan, textColor: [255, 255, 255] },
    });

    y = ((doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 10;
  }

  // Open Debt
  doc.setTextColor(...COLORS.cyan);
  doc.setFontSize(11);
  doc.text("Open Debt", 14, y);
  y += 6;

  if (report.openDebt.length === 0) {
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(8);
    doc.text("No open debt", 14, y);
    y += 8;
  } else {
    for (const item of report.openDebt) {
      doc.setTextColor(...COLORS.amber);
      doc.setFontSize(8);
      doc.text(`- ${item}`, 14, y);
      y += 5;
    }
    y += 5;
  }

  // Activity Timeline
  if (report.timeline.length > 0) {
    doc.setTextColor(...COLORS.cyan);
    doc.setFontSize(11);
    doc.text("Activity Timeline", 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["Event", "Summary", "Date"]],
      body: report.timeline.slice(0, 15).map((e) => [
        e.event,
        e.summary.slice(0, 60),
        e.date.split("T")[0],
      ]),
      theme: "grid",
      styles: { fontSize: 7, textColor: COLORS.text, fillColor: COLORS.bg },
      headStyles: { fillColor: COLORS.cyan, textColor: [255, 255, 255] },
    });
  }

  addFooter(doc, report.generatedAt);
  return Buffer.from(doc.output("arraybuffer"));
}

export function crossReportToPdf(report: CrossProjectReport): Buffer {
  const doc = new jsPDF();

  addHeader(
    doc,
    "Cross-Project Summary",
    `${report.projects.length} projects | ${report.totalLessons} lessons`
  );

  let y = 38;

  // Project Overview
  doc.setTextColor(...COLORS.cyan);
  doc.setFontSize(11);
  doc.text("Project Overview", 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [["Project", "Status", "Health", "Phase"]],
    body: report.projects.map((p) => [p.name, p.status, p.health, p.phase]),
    theme: "grid",
    styles: { fontSize: 8, textColor: COLORS.text, fillColor: COLORS.bg },
    headStyles: { fillColor: COLORS.cyan, textColor: [255, 255, 255] },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Knowledge Base
  doc.setTextColor(...COLORS.cyan);
  doc.setFontSize(11);
  doc.text(`Knowledge Base (${report.totalLessons} lessons)`, 14, y);
  y += 6;

  for (const [cat, count] of Object.entries(report.lessonsByCategory)) {
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(8);
    doc.text(`${cat}: ${count}`, 14, y);
    y += 4;
  }
  y += 5;

  // Active Blockers
  if (report.activeBlockers.length > 0) {
    doc.setTextColor(...COLORS.danger);
    doc.setFontSize(11);
    doc.text("Active Blockers", 14, y);
    y += 6;

    for (const b of report.activeBlockers) {
      doc.setTextColor(...COLORS.text);
      doc.setFontSize(8);
      doc.text(`${b.project}: ${b.details.slice(0, 80)}`, 14, y);
      y += 4;
    }
  }

  addFooter(doc, report.generatedAt);
  return Buffer.from(doc.output("arraybuffer"));
}

export function reportToPdf(
  report: SingleProjectReport | CrossProjectReport
): Buffer {
  if (report.type === "single") {
    return singleReportToPdf(report);
  }
  return crossReportToPdf(report);
}
