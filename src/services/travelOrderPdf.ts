import { Platform, Alert } from 'react-native';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import {
  GOLDILOCKS_LOGO_BASE64,
  CHAWNAH_FOODS_LOGO_BASE64,
  CAKE_OCCASIONS_LOGO_BASE64,
  FRESH_BERRY_LOGO_BASE64,
  CHI_LOGO_BASE64,
} from '../assets/companyLogosBase64';
import { fetchTravelOrderDetails, type TravelOrderDetailsData } from './travelOrder';
import { formatUnifiedRequestCode } from '../components/EsarfDetailsView';
import type { MyRequest } from './requests';
import type { PendingApproval, ApprovedApproval } from './approvals';
import type { EmployeeProfileSummary } from '../types/domain';

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  const globalBuf = (globalThis as any).Buffer;
  if (globalBuf) {
    return new Uint8Array(globalBuf.from(base64, 'base64'));
  }
  throw new Error('Base64 decoder is not available in current environment.');
}

function formatMDY(dateStr?: string | null): string {
  if (!dateStr) return '';
  const clean = dateStr.trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) return clean;
  const ymdMatch = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
  }
  const d = new Date(clean);
  if (!isNaN(d.getTime())) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const y = d.getFullYear();
    return `${m}/${day}/${y}`;
  }
  return clean;
}

function formatDisplayTime(timeStr?: string | null): string {
  if (!timeStr) return '';
  const clean = timeStr.trim();
  const ampmMatch = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampmMatch) {
    return `${ampmMatch[1].padStart(2, '0')}:${ampmMatch[2]} ${ampmMatch[3].toUpperCase()}`;
  }
  const parts = clean.split(':');
  if (parts.length >= 2) {
    const h = parseInt(parts[0], 10);
    const m = parts[1].slice(0, 2);
    if (!isNaN(h)) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      const dispHour = h % 12 || 12;
      return `${String(dispHour).padStart(2, '0')}:${m} ${ampm}`;
    }
  }
  return clean;
}

function formatCurrencyAmount(amount?: number | null): string {
  if (amount == null || isNaN(amount) || amount === 0) return '-';
  return Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function wrapText(
  text: string,
  font: any,
  size: number,
  maxWidth: number,
): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, size);
    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function clampText(
  text: string,
  font: any,
  size: number,
  maxWidth: number,
): string {
  if (!text) return '';
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let clamped = text;
  while (clamped.length > 0 && font.widthOfTextAtSize(`${clamped}...`, size) > maxWidth) {
    clamped = clamped.slice(0, -1);
  }
  return `${clamped}...`;
}

export type GenerateTravelOrderPdfOptions = {
  item: MyRequest | PendingApproval | ApprovedApproval;
  profile?: EmployeeProfileSummary | null;
  sequence?: number;
  details?: TravelOrderDetailsData | null;
};

/**
 * Builds an official Travel Order PDF document following the exact arrangement,
 * colors, tables, checkboxes, and company logos from the official Travel Order Form template,
 * while dynamically computing positions and wrapping text to prevent overlaps.
 */
export async function buildOfficialTravelOrderPdf(
  options: GenerateTravelOrderPdfOptions,
): Promise<{ pdfBytes: Uint8Array; base64: string; fileName: string; documentCode: string }> {
  const { item, profile, sequence = 1 } = options;

  // 1. Ensure details are fully loaded
  const details = options.details || (await fetchTravelOrderDetails(item, profile));
  const documentCode = formatUnifiedRequestCode(item, sequence);
  const fileName = `Travel-Order-${documentCode.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

  // 2. Initialize PDF Document (US Letter: 612 x 792 pt)
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);

  // Fonts
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Template exact colors
  const yellowHeader = rgb(1, 0.92, 0.0); // Vibrant yellow matching template
  const black = rgb(0.06, 0.06, 0.06);
  const grayText = rgb(0.32, 0.35, 0.40);
  const lightGrayBorder = rgb(0.70, 0.74, 0.80);
  const redAccent = rgb(0.85, 0.15, 0.15);
  const tableHeaderBg = rgb(0.93, 0.95, 0.98);
  const white = rgb(1, 1, 1);

  const marginX = 36;
  const contentWidth = 540;

  // 3. Embed all 5 company logos from assets/company logos/
  const goldilocksImg = await pdfDoc.embedPng(decodeBase64ToUint8Array(GOLDILOCKS_LOGO_BASE64));
  const chawnahImg = await pdfDoc.embedPng(decodeBase64ToUint8Array(CHAWNAH_FOODS_LOGO_BASE64));
  const cakeImg = await pdfDoc.embedPng(decodeBase64ToUint8Array(CAKE_OCCASIONS_LOGO_BASE64));
  const freshBerryImg = await pdfDoc.embedPng(decodeBase64ToUint8Array(FRESH_BERRY_LOGO_BASE64));
  const chiImg = await pdfDoc.embedPng(decodeBase64ToUint8Array(CHI_LOGO_BASE64));

  // ── TOP HEADER ────────────────────────────────────────────────────
  // Goldilocks Logo on Top Left
  const gWidth = 145;
  const gHeight = gWidth * (goldilocksImg.height / goldilocksImg.width);
  page.drawImage(goldilocksImg, {
    x: marginX,
    y: 772 - gHeight,
    width: gWidth,
    height: gHeight,
  });

  // Row of 4 company logos underneath Goldilocks logo
  const logoRowY = 708;
  // 1. Chawnah Foods
  const cWidth = 48;
  const cHeight = cWidth * (chawnahImg.height / chawnahImg.width);
  page.drawImage(chawnahImg, {
    x: marginX,
    y: logoRowY - cHeight / 2,
    width: cWidth,
    height: cHeight,
  });

  // 2. Cakes & Occasions
  const coWidth = 52;
  const coHeight = coWidth * (cakeImg.height / cakeImg.width);
  page.drawImage(cakeImg, {
    x: marginX + 54,
    y: logoRowY - coHeight / 2,
    width: coWidth,
    height: coHeight,
  });

  // 3. Fresh Berry
  const fbWidth = 50;
  const fbHeight = fbWidth * (freshBerryImg.height / freshBerryImg.width);
  page.drawImage(freshBerryImg, {
    x: marginX + 114,
    y: logoRowY - fbHeight / 2,
    width: fbWidth,
    height: fbHeight,
  });

  // 4. Cake Haven / CHI
  const chiWidth = 48;
  const chiHeight = chiWidth * (chiImg.height / chiImg.width);
  page.drawImage(chiImg, {
    x: marginX + 172,
    y: logoRowY - chiHeight / 2,
    width: chiWidth,
    height: chiHeight,
  });

  // PRE-TRAVEL APPROVAL REQUIRED badge on Top Right
  const badgeW = 162;
  const badgeH = 17;
  const badgeX = marginX + contentWidth - badgeW;
  const badgeY = 746;
  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeW,
    height: badgeH,
    color: white,
    borderColor: redAccent,
    borderWidth: 1,
  });
  const badgeText = 'PRE-TRAVEL APPROVAL REQUIRED';
  const badgeTextW = fontBold.widthOfTextAtSize(badgeText, 8);
  page.drawText(badgeText, {
    x: badgeX + (badgeW - badgeTextW) / 2,
    y: badgeY + 4.5,
    size: 8,
    font: fontBold,
    color: redAccent,
  });

  // Centered Title: OFFICIAL TRAVEL ORDER
  const title = 'OFFICIAL TRAVEL ORDER';
  const titleW = fontBold.widthOfTextAtSize(title, 14);
  page.drawText(title, {
    x: marginX + (contentWidth - titleW) / 2,
    y: 686,
    size: 14,
    font: fontBold,
    color: black,
  });

  // Box below Title: Travel Order No & Date of Request
  const topBoxY = 658;
  const topBoxH = 20;
  page.drawRectangle({
    x: marginX,
    y: topBoxY,
    width: contentWidth,
    height: topBoxH,
    color: white,
    borderColor: lightGrayBorder,
    borderWidth: 0.8,
  });

  // Vertical divider in top box
  page.drawLine({
    start: { x: marginX + 270, y: topBoxY },
    end: { x: marginX + 270, y: topBoxY + topBoxH },
    thickness: 0.8,
    color: lightGrayBorder,
  });

  // Left: Travel Order No
  page.drawText('Travel Order No:', { x: marginX + 8, y: topBoxY + 5.5, size: 8.5, font: fontReg, color: black });
  page.drawText(documentCode, { x: marginX + 85, y: topBoxY + 5.5, size: 8.5, font: fontBold, color: black });

  // Right: Date of Request
  const requestDateRaw = item.submitted_at || (item as any).created_at || item.date_from;
  const requestDateFormatted = formatMDY(requestDateRaw) || '11/03/2026';
  page.drawText('Date of Request:', { x: marginX + 278, y: topBoxY + 5.5, size: 8.5, font: fontReg, color: black });
  page.drawText(requestDateFormatted, { x: marginX + 355, y: topBoxY + 5.5, size: 8.5, font: fontBold, color: black });

  // Yellow Header Bar Helper
  function drawYellowBar(titleText: string, y: number) {
    page.drawRectangle({
      x: marginX,
      y,
      width: contentWidth,
      height: 15,
      color: yellowHeader,
    });
    page.drawText(titleText, {
      x: marginX + 6,
      y: y + 3.5,
      size: 8.5,
      font: fontBold,
      color: black,
    });
  }

  // Checkbox Helper
  function drawCheckbox(x: number, y: number, checked: boolean, label?: string, font = fontReg, size = 8) {
    page.drawRectangle({
      x,
      y,
      width: 8,
      height: 8,
      color: white,
      borderColor: black,
      borderWidth: 0.8,
    });
    if (checked) {
      page.drawText('X', {
        x: x + 1.2,
        y: y + 1.2,
        size: 7,
        font: fontBold,
        color: black,
      });
    }
    if (label) {
      page.drawText(label, {
        x: x + 12,
        y: y + 1,
        size,
        font,
        color: black,
      });
    }
  }

  // ── 1. EMPLOYEE PROFILE & LOGISTICS CLASS ─────────────────────────
  drawYellowBar('1. EMPLOYEE PROFILE & LOGISTICS CLASS', 636);

  const sec1Y = 562;
  const sec1H = 72; // Generous 72 pt height for 2 distinct checkbox lines
  page.drawRectangle({
    x: marginX,
    y: sec1Y,
    width: contentWidth,
    height: sec1H,
    color: white,
    borderColor: lightGrayBorder,
    borderWidth: 0.8,
  });

  // Dividers
  page.drawLine({
    start: { x: marginX, y: sec1Y + 50 },
    end: { x: marginX + contentWidth, y: sec1Y + 50 },
    thickness: 0.6,
    color: lightGrayBorder,
  });
  page.drawLine({
    start: { x: marginX, y: sec1Y + 20 },
    end: { x: marginX + contentWidth, y: sec1Y + 20 },
    thickness: 0.6,
    color: lightGrayBorder,
  });
  page.drawLine({
    start: { x: marginX + 270, y: sec1Y + 50 },
    end: { x: marginX + 270, y: sec1Y + sec1H },
    thickness: 0.6,
    color: lightGrayBorder,
  });
  page.drawLine({
    start: { x: marginX + 270, y: sec1Y },
    end: { x: marginX + 270, y: sec1Y + 20 },
    thickness: 0.6,
    color: lightGrayBorder,
  });

  const requesterName =
    details.requesterName || (item as any).requester_name || profile?.fullName || 'Requester';
  const employeeId =
    details.employeeNo || (item as any).requester_employee_no || profile?.employeeNo || '-';
  const departmentName = (
    details.departmentName ||
    (item as any).department_name ||
    profile?.departmentName ||
    profile?.storeName ||
    ''
  ).toLowerCase();

  // Row 1: Left - Employee Name
  page.drawText('Employee Name:', { x: marginX + 6, y: sec1Y + 57, size: 8, font: fontReg, color: black });
  page.drawText(clampText(requesterName, fontBold, 8.5, 180), {
    x: marginX + 80,
    y: sec1Y + 57,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawLine({
    start: { x: marginX + 78, y: sec1Y + 54 },
    end: { x: marginX + 264, y: sec1Y + 54 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // Row 1: Right - Employee ID
  page.drawText('Employee ID:', { x: marginX + 276, y: sec1Y + 57, size: 8, font: fontReg, color: black });
  page.drawText(clampText(employeeId, fontReg, 8.5, 180), {
    x: marginX + 342,
    y: sec1Y + 57,
    size: 8.5,
    font: fontReg,
    color: black,
  });
  page.drawLine({
    start: { x: marginX + 340, y: sec1Y + 54 },
    end: { x: marginX + contentWidth - 8, y: sec1Y + 54 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // Row 2: Department Checkboxes
  const isLogistics = departmentName.includes('logistics') || departmentName.includes('delivery');
  const isMaintenance =
    departmentName.includes('maintenance') ||
    departmentName.includes('tech') ||
    departmentName.includes('engineering');
  const isAuditOps =
    departmentName.includes('audit') ||
    departmentName.includes('operation') ||
    departmentName.includes('store');
  const isOfficeAdmin = !isLogistics && !isMaintenance && !isAuditOps;

  page.drawText('Department:', { x: marginX + 6, y: sec1Y + 35, size: 8, font: fontReg, color: black });
  drawCheckbox(marginX + 78, sec1Y + 35, isOfficeAdmin, 'Office / Admin');
  drawCheckbox(marginX + 158, sec1Y + 35, isLogistics, 'Logistics / Delivery');
  drawCheckbox(marginX + 255, sec1Y + 35, isMaintenance, 'Store Maintenance & Tech');
  drawCheckbox(marginX + 78, sec1Y + 23, isAuditOps, 'Audit / Operations');

  // Row 3: Left - Home Branch / Base
  const homeBranch = details.homeBranch || profile?.storeName || profile?.departmentName || 'Burgos HQ';
  page.drawText('Home Branch / Base:', { x: marginX + 6, y: sec1Y + 6, size: 7.5, font: fontReg, color: black });
  page.drawText(clampText(homeBranch, fontReg, 8, 165), {
    x: marginX + 96,
    y: sec1Y + 6,
    size: 8,
    font: fontReg,
    color: black,
  });
  page.drawLine({
    start: { x: marginX + 94, y: sec1Y + 4 },
    end: { x: marginX + 264, y: sec1Y + 4 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // Row 3: Right - Position / Title
  const positionTitle = details.positionTitle || (item as any).position_name || profile?.positionName || 'Staff';
  page.drawText('Position / Title:', { x: marginX + 276, y: sec1Y + 6, size: 7.5, font: fontReg, color: black });
  page.drawText(clampText(positionTitle, fontBold, 8, 180), {
    x: marginX + 344,
    y: sec1Y + 6,
    size: 8,
    font: fontBold,
    color: black,
  });
  page.drawLine({
    start: { x: marginX + 342, y: sec1Y + 4 },
    end: { x: marginX + contentWidth - 8, y: sec1Y + 4 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // ── 2. TRAVEL ITINERARY & SPECIFIC WORK INTENT ─────────────────────
  drawYellowBar('2. TRAVEL ITINERARY & SPECIFIC WORK INTENT', 544);

  const sec2Y = 410;
  const sec2H = 132;
  page.drawRectangle({
    x: marginX,
    y: sec2Y,
    width: contentWidth,
    height: sec2H,
    color: white,
    borderColor: lightGrayBorder,
    borderWidth: 0.8,
  });

  // Dividers
  page.drawLine({
    start: { x: marginX, y: sec2Y + 110 },
    end: { x: marginX + contentWidth, y: sec2Y + 110 },
    thickness: 0.6,
    color: lightGrayBorder,
  });
  page.drawLine({
    start: { x: marginX, y: sec2Y + 88 },
    end: { x: marginX + contentWidth, y: sec2Y + 88 },
    thickness: 0.6,
    color: lightGrayBorder,
  });
  page.drawLine({
    start: { x: marginX + 270, y: sec2Y + 88 },
    end: { x: marginX + 270, y: sec2Y + 110 },
    thickness: 0.6,
    color: lightGrayBorder,
  });
  page.drawLine({
    start: { x: marginX, y: sec2Y + 62 },
    end: { x: marginX + contentWidth, y: sec2Y + 62 },
    thickness: 0.6,
    color: lightGrayBorder,
  });
  page.drawLine({
    start: { x: marginX + 110, y: sec2Y },
    end: { x: marginX + 110, y: sec2Y + 88 },
    thickness: 0.6,
    color: lightGrayBorder,
  });

  // Destination Store(s)
  const destStores =
    details.destinationsText ||
    (details.destinationStores && details.destinationStores.length > 0
      ? details.destinationStores.join(', ')
      : 'Goldilocks Store');

  page.drawText('Destination Store(s):', { x: marginX + 6, y: sec2Y + 117, size: 8, font: fontReg, color: black });
  page.drawText(clampText(destStores, fontBold, 8.5, contentWidth - 120), {
    x: marginX + 104,
    y: sec2Y + 117,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawLine({
    start: { x: marginX + 102, y: sec2Y + 114 },
    end: { x: marginX + contentWidth - 8, y: sec2Y + 114 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // Departure Date / Time
  const depDate = formatMDY(details.departureDate || item.date_from);
  const depTime = formatDisplayTime(details.departureTime || item.time_from);
  const depDisp = depTime ? `${depDate} (${depTime})` : depDate || '-';

  page.drawText('Departure Date/ Time:', { x: marginX + 6, y: sec2Y + 95, size: 8, font: fontReg, color: black });
  page.drawText(clampText(depDisp, fontBold, 8.5, 160), {
    x: marginX + 104,
    y: sec2Y + 95,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawLine({
    start: { x: marginX + 102, y: sec2Y + 92 },
    end: { x: marginX + 264, y: sec2Y + 92 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // Return Date / Time
  const retDate = formatMDY(details.returnDate || item.date_to || details.departureDate || item.date_from);
  const retTime = formatDisplayTime(details.returnTime || item.time_to);
  const retDisp = retTime ? `${retDate} (${retTime})` : retDate || '-';

  page.drawText('Return Date/Time:', { x: marginX + 276, y: sec2Y + 95, size: 8, font: fontReg, color: black });
  page.drawText(clampText(retDisp, fontBold, 8.5, 175), {
    x: marginX + 358,
    y: sec2Y + 95,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawLine({
    start: { x: marginX + 356, y: sec2Y + 92 },
    end: { x: marginX + contentWidth - 8, y: sec2Y + 92 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // Specific Mode of Transport
  const transportModeNorm = (details.transportMode || '').toLowerCase();
  const isCompanyVehicle = transportModeNorm.includes('company vehicle');
  const isPublicUtility =
    transportModeNorm.includes('public utility') ||
    transportModeNorm.includes('bus') ||
    transportModeNorm.includes('van') ||
    (!isCompanyVehicle && !transportModeNorm.includes('personal'));
  const isPersonalVehicle =
    transportModeNorm.includes('personal') || transportModeNorm.includes('fuel');

  page.drawText('Specific Mode of', { x: marginX + 6, y: sec2Y + 77, size: 7.5, font: fontReg, color: black });
  page.drawText('Transport:', { x: marginX + 6, y: sec2Y + 68, size: 7.5, font: fontReg, color: black });

  const plateStr = details.plateNo ? details.plateNo : '_________________';
  drawCheckbox(marginX + 118, sec2Y + 76, isCompanyVehicle, `Company Vehicle (Plate No: ${plateStr})`);
  drawCheckbox(marginX + 338, sec2Y + 76, isPublicUtility, 'Public Utility Transport (Bus/Van)');
  drawCheckbox(marginX + 118, sec2Y + 66, isPersonalVehicle, 'Personal Vehicle (Approved Fuel Matrix)');

  // Purpose of Travel
  const purposeNorm = (details.purposeOfTravel || '').toLowerCase();
  const isRoutineAudit = purposeNorm.includes('routine') || purposeNorm.includes('audit');
  const isEmergencyRepair =
    purposeNorm.includes('emergency') ||
    purposeNorm.includes('cold chain') ||
    purposeNorm.includes('repair');
  const isSupplyTransfer =
    purposeNorm.includes('supply') ||
    purposeNorm.includes('stock') ||
    purposeNorm.includes('transfer');
  const isOthers = !isRoutineAudit && !isEmergencyRepair && !isSupplyTransfer;

  page.drawText('Purpose of Travel:', { x: marginX + 6, y: sec2Y + 48, size: 7.5, font: fontReg, color: black });
  page.drawText('(Be concise & specific)', { x: marginX + 6, y: sec2Y + 38, size: 6.8, font: fontItalic, color: grayText });

  drawCheckbox(marginX + 118, sec2Y + 48, isRoutineAudit, 'Routine Store Audit');
  drawCheckbox(marginX + 218, sec2Y + 48, isEmergencyRepair, 'Emergency Equipment / Cold Chain Repair');
  drawCheckbox(marginX + 400, sec2Y + 48, isSupplyTransfer, 'Inter-branch Supply / Stock Transfer');

  drawCheckbox(marginX + 118, sec2Y + 34, isOthers, 'Others (Specify detailed operational tasks):');

  // Detailed Tasks Text - cleanly placed on the next line without any overlap
  const detailedTasks =
    details.purposeDetails ||
    details.purposeOfTravel ||
    (item.reason
      ? item.reason.replace(/^(?:Destination|Purpose|Transport|Budget):[^\n|]+\|?/gi, '').trim()
      : '') ||
    'Standard official branch support and operations visit.';

  page.drawText(clampText(detailedTasks, fontReg, 7.8, contentWidth - 128), {
    x: marginX + 118,
    y: sec2Y + 18,
    size: 7.8,
    font: fontReg,
    color: black,
  });
  page.drawLine({
    start: { x: marginX + 116, y: sec2Y + 14 },
    end: { x: marginX + contentWidth - 8, y: sec2Y + 14 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // ── 3. FINANCIAL AUTHORIZATION & PER DIEM ALLOWANCES ───────────────
  drawYellowBar('3. FINANCIAL AUTHORIZATION & PER DIEM ALLOWANCES', 388);

  const sec3Y = 282;
  const sec3H = 104;
  page.drawRectangle({
    x: marginX,
    y: sec3Y,
    width: contentWidth,
    height: sec3H,
    color: white,
    borderColor: lightGrayBorder,
    borderWidth: 0.8,
  });

  const cW1 = 180;
  const cW2 = 130;
  const cW3 = 230;

  // Header row
  page.drawRectangle({
    x: marginX,
    y: sec3Y + 84,
    width: contentWidth,
    height: 20,
    color: tableHeaderBg,
    borderColor: lightGrayBorder,
    borderWidth: 0.6,
  });
  page.drawText('Expense Classification', { x: marginX + 35, y: sec3Y + 90, size: 8, font: fontBold, color: black });
  page.drawText('Pre-Authorized Budget / Limit', { x: marginX + cW1 + 8, y: sec3Y + 90, size: 8, font: fontBold, color: black });
  page.drawText('Accounting Fund Source & Control Codes', { x: marginX + cW1 + cW2 + 20, y: sec3Y + 90, size: 8, font: fontBold, color: black });

  // Column vertical lines
  page.drawLine({
    start: { x: marginX + cW1, y: sec3Y },
    end: { x: marginX + cW1, y: sec3Y + sec3H },
    thickness: 0.6,
    color: lightGrayBorder,
  });
  page.drawLine({
    start: { x: marginX + cW1 + cW2, y: sec3Y },
    end: { x: marginX + cW1 + cW2, y: sec3Y + sec3H },
    thickness: 0.6,
    color: lightGrayBorder,
  });

  // Row dividers
  page.drawLine({
    start: { x: marginX, y: sec3Y + 56 },
    end: { x: marginX + cW1 + cW2, y: sec3Y + 56 },
    thickness: 0.6,
    color: lightGrayBorder,
  });
  page.drawLine({
    start: { x: marginX, y: sec3Y + 28 },
    end: { x: marginX + cW1 + cW2, y: sec3Y + 28 },
    thickness: 0.6,
    color: lightGrayBorder,
  });

  // Col 1 & 2: Row 1
  page.drawText('1. Transportation Costs (Fuel, Tolls,', { x: marginX + 6, y: sec3Y + 70, size: 7.5, font: fontReg, color: black });
  page.drawText('Commuter Fares)', { x: marginX + 6, y: sec3Y + 61, size: 7.5, font: fontReg, color: black });
  page.drawText('P', { x: marginX + cW1 + 10, y: sec3Y + 66, size: 8, font: fontReg, color: black });
  page.drawText(formatCurrencyAmount(details.transportBudget), { x: marginX + cW1 + 22, y: sec3Y + 66, size: 8.5, font: fontBold, color: black });
  page.drawLine({
    start: { x: marginX + cW1 + 20, y: sec3Y + 63 },
    end: { x: marginX + cW1 + cW2 - 10, y: sec3Y + 63 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // Col 1 & 2: Row 2
  page.drawText('2. Meal / Per Diem Allowance (Standard Food', { x: marginX + 6, y: sec3Y + 42, size: 7.5, font: fontReg, color: black });
  page.drawText('Rate)', { x: marginX + 6, y: sec3Y + 33, size: 7.5, font: fontReg, color: black });
  page.drawText('P', { x: marginX + cW1 + 10, y: sec3Y + 38, size: 8, font: fontReg, color: black });
  page.drawText(formatCurrencyAmount(details.mealBudget), { x: marginX + cW1 + 22, y: sec3Y + 38, size: 8.5, font: fontBold, color: black });
  page.drawLine({
    start: { x: marginX + cW1 + 20, y: sec3Y + 35 },
    end: { x: marginX + cW1 + cW2 - 10, y: sec3Y + 35 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // Col 1 & 2: Row 3
  page.drawText('3. Emergency Out-of-Pocket Expense', { x: marginX + 6, y: sec3Y + 15, size: 7.5, font: fontReg, color: black });
  page.drawText('(Capped Parts/Tools)', { x: marginX + 6, y: sec3Y + 6, size: 7.5, font: fontReg, color: black });
  page.drawText('P', { x: marginX + cW1 + 10, y: sec3Y + 10, size: 8, font: fontReg, color: black });
  page.drawText(formatCurrencyAmount(details.emergencyBudget), { x: marginX + cW1 + 22, y: sec3Y + 10, size: 8.5, font: fontReg, color: black });
  page.drawLine({
    start: { x: marginX + cW1 + 20, y: sec3Y + 7 },
    end: { x: marginX + cW1 + cW2 - 10, y: sec3Y + 7 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // Col 3: Cost Center Code & Charge to Store
  const col3X = marginX + cW1 + cW2 + 10;
  const costCenterCode = details.costCenterCode || '000000';
  page.drawText('Cost Center Code:', { x: col3X, y: sec3Y + 48, size: 8, font: fontReg, color: black });
  page.drawText(costCenterCode, { x: col3X + 78, y: sec3Y + 48, size: 8.5, font: fontBold, color: black });
  page.drawLine({
    start: { x: col3X + 76, y: sec3Y + 45 },
    end: { x: marginX + contentWidth - 10, y: sec3Y + 45 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  const chargeStore = details.chargeToStore || homeBranch || 'Goldilocks Store';
  page.drawText('Charge to Store / Branch:', { x: col3X, y: sec3Y + 22, size: 8, font: fontReg, color: black });
  page.drawText(clampText(chargeStore, fontBold, 8.5, 120), {
    x: col3X + 106,
    y: sec3Y + 22,
    size: 8.5,
    font: fontBold,
    color: black,
  });
  page.drawLine({
    start: { x: col3X + 104, y: sec3Y + 19 },
    end: { x: marginX + contentWidth - 10, y: sec3Y + 19 },
    thickness: 0.5,
    color: lightGrayBorder,
  });

  // ── 4. INTERNAL CONTROL & STATUTORY SIGNATURES ─────────────────────
  drawYellowBar('4. INTERNAL CONTROL & STATUTORY SIGNATURES', 260);

  const sigY = 188;
  const colW = contentWidth / 3; // 180 pt each

  // Resolve approver data
  let approver1Name = '';
  let approver1Status = '';
  let approver2Name = '';
  let approver2Status = '';
  let approver2Date = '';

  const summary = (item as any).approval_summary;
  if (Array.isArray(summary) && summary.length > 0) {
    const sorted = [...summary].sort(
      (a, b) => (a.step_order || a.level || 0) - (b.step_order || b.level || 0),
    );
    if (sorted[0]) {
      approver1Name = sorted[0].approver_name || '';
      approver1Status = sorted[0].status || '';
    }
    if (sorted[1]) {
      approver2Name = sorted[1].approver_name || '';
      approver2Status = sorted[1].status || '';
      approver2Date = formatMDY(sorted[1].acted_at);
    }
  }

  const rawStatus = (item.status || (item as any).request_status || '').toLowerCase();
  const isApproved =
    rawStatus === 'approved' || rawStatus === 'final_approved' || rawStatus === 'validated';
  const isRejected = rawStatus === 'rejected' || rawStatus === 'denied';

  if (isApproved) {
    if (!approver1Status) approver1Status = 'approved';
    if (!approver2Status) approver2Status = 'approved';
    if (!approver2Date) {
      approver2Date = formatMDY((item as any).final_approved_at || (item as any).acted_at || requestDateRaw);
    }
  } else if (isRejected) {
    if (!approver1Status && !approver2Status) approver1Status = 'rejected';
  }

  // Col 1: Employee
  const s1X = marginX;
  page.drawText(clampText(requesterName, fontBold, 8, colW - 20), {
    x: s1X + 18,
    y: sigY + 54,
    size: 8,
    font: fontBold,
    color: black,
  });
  page.drawLine({
    start: { x: s1X + 12, y: sigY + 48 },
    end: { x: s1X + colW - 16, y: sigY + 48 },
    thickness: 0.8,
    color: black,
  });
  page.drawText('Employee Signature', { x: s1X + 46, y: sigY + 36, size: 7.5, font: fontReg, color: black });
  page.drawText(`Date:  ${requestDateFormatted}`, { x: s1X + 40, y: sigY + 24, size: 7.5, font: fontReg, color: black });

  // Col 2: Immediate Supervisor / Store Mgr.
  const s2X = marginX + colW;
  page.drawText(clampText(approver1Name, fontBold, 8, colW - 20), {
    x: s2X + 18,
    y: sigY + 54,
    size: 8,
    font: fontBold,
    color: black,
  });
  page.drawLine({
    start: { x: s2X + 12, y: sigY + 48 },
    end: { x: s2X + colW - 16, y: sigY + 48 },
    thickness: 0.8,
    color: black,
  });
  page.drawText('Immediate Supervisor / Store Mgr.', { x: s2X + 24, y: sigY + 36, size: 7.5, font: fontReg, color: black });

  const s1IsApproved = (approver1Status || '').toLowerCase().includes('approved');
  const s1IsDenied = (approver1Status || '').toLowerCase().includes('rejected') || (approver1Status || '').toLowerCase().includes('denied');
  const s1AppCheck = s1IsApproved ? 'X' : ' ';
  const s1DenCheck = s1IsDenied ? 'X' : ' ';
  page.drawText(`Status: [ ${s1AppCheck} ] Approved   [ ${s1DenCheck} ] Denied`, {
    x: s2X + 26,
    y: sigY + 24,
    size: 7.5,
    font: fontBold,
    color: black,
  });

  // Col 3: Operations Director / Gen. Manager
  const s3X = marginX + colW * 2;
  page.drawText(clampText(approver2Name, fontBold, 7.5, colW - 16), {
    x: s3X + 6,
    y: sigY + 54,
    size: 7.5,
    font: fontBold,
    color: black,
  });
  page.drawLine({
    start: { x: s3X + 12, y: sigY + 48 },
    end: { x: s3X + colW - 16, y: sigY + 48 },
    thickness: 0.8,
    color: black,
  });
  page.drawText('Operations Director / Gen. Manager', { x: s3X + 20, y: sigY + 36, size: 7.5, font: fontReg, color: black });

  const s2StatusText = approver2Date ? `Approval (${approver2Date})` : 'Approval';
  page.drawText(s2StatusText, { x: s3X + 50, y: sigY + 24, size: 7.5, font: fontReg, color: black });

  // ── 5. LABOR ALIGNMENT & CORPORATE POLICY DISCLOSURE ──────────────
  const disclY = 168;
  page.drawText('LABOR ALIGNMENT & CORPORATE POLICY DISCLOSURE:', {
    x: marginX,
    y: disclY,
    size: 7,
    font: fontBold,
    color: redAccent,
  });

  const p1 =
    '1. This Travel Order constitutes a legal, direct operational directive from management. Hours clocked during field assignments shall be recognized and computed strictly in line with statutory Wage and Hour Laws. Maintenance and logistics staff must report actual time worked using decentralized tools or authenticated manually via destination store signatures to prevent unrecorded overtime.';
  const p2 =
    "2. Liquidation Obligation: All pre-authorized cash advances and field expenses must be fully supported by official receipts (OR) and submitted to the Finance Department within three (3) working days upon return to base. Failure to liquidate or clear accountability balances will authorize the company to automatically withhold the unliquidated amount from the employee's next payroll cycle under applicable wage deduction guidelines.";
  const p3 =
    '3. Deviation from the pre-approved route or itinerary without a documented operational emergency will void this travel order and may trigger disciplinary sanctions under the corporate Code of Conduct for breach of operational safety rules.';

  let curY = disclY - 10;
  for (const p of [p1, p2, p3]) {
    const lines = wrapText(p, fontReg, 6.2, contentWidth);
    for (const line of lines) {
      page.drawText(line, { x: marginX, y: curY, size: 6.2, font: fontReg, color: grayText });
      curY -= 8;
    }
    curY -= 3;
  }

  // Footer: Form_Travel-Order-Form
  page.drawText('Form_Travel-Order-Form', {
    x: marginX + contentWidth - 85,
    y: curY - 2,
    size: 6.5,
    font: fontItalic,
    color: grayText,
  });

  // 4. Save and return bytes + base64
  const pdfBytes = await pdfDoc.save();
  const base64 = await pdfDoc.saveAsBase64({ dataUri: false });

  return { pdfBytes, base64, fileName, documentCode };
}

/**
 * Downloads or shares the Official Travel Order PDF file
 * seamlessly across Web (browser download) and Mobile (Expo sharing / save).
 */
export async function downloadOfficialTravelOrderPdf(
  options: GenerateTravelOrderPdfOptions,
): Promise<{ success: boolean; fileName: string }> {
  try {
    const { pdfBytes, base64, fileName, documentCode } = await buildOfficialTravelOrderPdf(options);

    // 1. Web Platform: Standard browser download
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return { success: true, fileName };
    }

    // 2. Native Mobile Platform (Android / iOS): Write file and open Share / Save sheet
    const targetDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!targetDir) {
      throw new Error('Local file storage is not accessible on this device.');
    }

    const fileUri = `${targetDir}${fileName}`;
    await FileSystem.writeAsStringAsync(fileUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/pdf',
        dialogTitle: `Official Travel Order (${documentCode})`,
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('Travel Order PDF Saved', `The official travel order PDF was saved to: ${fileUri}`);
    }

    return { success: true, fileName };
  } catch (error) {
    console.error('[downloadOfficialTravelOrderPdf] Failed to generate/download travel order:', error);
    const msg = error instanceof Error ? error.message : 'Unable to generate Travel Order PDF.';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(`Download Error: ${msg}`);
    } else {
      Alert.alert('Download Error', msg);
    }
    return { success: false, fileName: '' };
  }
}
