// Mock Data for Phase 50 Mobile Group OCR
// To be removed once Agent B endpoints are live.

export function mockGroupOcrSessions() {
  return {
    success: true,
    business_date: "2026-03-28",
    groups: [
      {
        booking_group_id: "mock-group-1",
        group_code: "GRP-260328-0001",
        group_name: "Wang Family Reunion",
        total_rooms: 4,
        scanned_count: 2,
        rooms: [
          { reservation_id: "res-1", room_number: "201", guest_name: "JOHN SMITH" },
          { reservation_id: "res-2", room_number: "202", guest_name: "MARIA GARCIA" },
          { reservation_id: "res-3", room_number: "203", guest_name: "LI WEI" },
          { reservation_id: "res-4", room_number: "204", guest_name: "CHEN YOU" },
        ],
      },
      {
        booking_group_id: "mock-group-2",
        group_code: "GRP-260328-0002",
        group_name: "Acme Corp Retreat",
        total_rooms: 12,
        scanned_count: 0,
        rooms: [
          { reservation_id: "res-5", room_number: "301", guest_name: "DAVID LEE" },
        ],
      }
    ],
  };
}

export function mockGroupOcrPool(groupId: string) {
  return {
    success: true,
    group_id: groupId || "mock-group-1",
    group_name: "Wang Family Reunion",
    total_scans: 3,
    pool: [
      {
        scan_id: "scan-1",
        pool_status: "ready" as const,
        guest_profile_id: "profile-1",
        display_name: "JOHN SMITH",
        nationality_code: "GBR",
        passport_no: "AB1234567",
        gender: "M",
        source: "passport_ocr",
        scan_order: Date.now() - 5000,
        created_at: new Date(Date.now() - 5000).toISOString(),
      },
      {
        scan_id: "scan-2",
        pool_status: "ocr_failed" as const,
        guest_profile_id: null,
        display_name: null,
        image_path: "groups/mock/failed.jpg",
        source: "passport_ocr",
        scan_order: Date.now(),
        created_at: new Date().toISOString(),
      },
      {
        scan_id: "scan-3",
        pool_status: "ready" as const,
        guest_profile_id: "profile-3",
        display_name: "MARIA GARCIA",
        nationality_code: "ESP",
        passport_no: "ES9876543",
        gender: "F",
        source: "passport_ocr",
        scan_order: Date.now() - 2000,
        created_at: new Date(Date.now() - 2000).toISOString(),
      }
    ],
  };
}

export async function mockGroupOcrScanSuccess(forceFail = false) {
  // Simulate network delay
  await new Promise(res => setTimeout(res, 1500));
  
  if (forceFail) {
    return {
      success: true,
      scan_id: `scan-${Date.now()}`,
      ocr_success: false,
      pool_status: "ocr_failed",
      entry: null,
      warnings: ["MRZ not detected. Photo saved for manual entry."]
    };
  }

  // Sometimes return a partial match to test amber states
  const isPartial = Math.random() > 0.7;

  return {
    success: true,
    scan_id: `scan-${Date.now()}`,
    ocr_success: true,
    pool_status: "ready",
    entry: {
      guest_profile_id: `profile-${Date.now()}`,
      display_name: isPartial ? "DOORTJE DE VRIES" : "ANNA MULLER",
      first_name: isPartial ? "DOORTJE" : "ANNA",
      last_name: isPartial ? "DE VRIES" : "MULLER",
      nationality_code: isPartial ? null : "DEU",
      passport_no: "NZ1234567",
      gender: "F",
      dob: "1990-05-20",
      source: "passport_ocr",
      scan_order: Date.now(),
    },
    warnings: isPartial ? ["Nationality missing from OCR."] : [],
  };
}

export async function mockImportToWizard(payload: any) {
  await new Promise(res => setTimeout(res, 800));
  return {
    success: true,
    imported_count: payload.scan_ids?.length || 0,
    skipped_count: 0,
    skipped_reasons: []
  };
}

export async function mockRetryOcr(payload: any) {
  await new Promise(res => setTimeout(res, 800));
  return mockGroupOcrScanSuccess(false);
}
