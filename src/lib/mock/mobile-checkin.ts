// src/lib/mock/mobile-checkin.ts

const MOCK_DELAY_MS = 800;

export async function mockDueToday() {
  await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
  return {
    success: true,
    data: {
      business_date: "2026-04-01",
      rooms: [
        {
          reservation_id: "res-draft-1",
          room_number: "302",
          guest_name: "John Dupont",
          source: "walkin",
          checkin_date: "2026-04-01",
          checkout_date: "2026-04-03",
          nights: 2,
          total_price: 1980,
          status: "draft_checkin", // Partially checked in
          has_passport_scan: true,
          profile_complete: false
        },
        {
          reservation_id: "res-auth-2",
          room_number: "244",
          guest_name: "Somchai Saetang",
          source: "direct",
          checkin_date: "2026-04-01",
          checkout_date: "2026-04-02",
          nights: 1,
          total_price: 1200,
          status: "confirmed",
          has_passport_scan: false,
          profile_complete: true
        },
        {
          reservation_id: "res-auth-3",
          room_number: "346",
          guest_name: "MARIE DUPONT", // Deliberately matching OCR test payload
          source: "ota",
          checkin_date: "2026-04-01",
          checkout_date: "2026-04-04",
          nights: 3,
          total_price: 4500,
          status: "confirmed",
          has_passport_scan: false,
          profile_complete: false
        }
      ]
    }
  };
}

export async function mockScanPassport() {
  await new Promise(r => setTimeout(r, MOCK_DELAY_MS * 2));
  return {
    success: true,
    data: {
      scan_id: "scan-999",
      image_path: "mock-passport-photos/demo.jpg",
      parsed: {
        passportNumber: "AB1234567",
        firstName: "MARIE",
        familyName: "DUPONT",
        nationality: "FRA",
        dateOfBirth: "1990-05-15",
        gender: "F",
        confidence: 96
      },
      warnings: []
    }
  };
}

export async function mockMatchBooking(ocrName: string) {
  await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
  
  // Pretend "MARIE DUPONT" is a high match for our test data
  const isMatch = ocrName.toLowerCase().includes("marie");
  
  if (isMatch) {
    return {
      success: true,
      data: {
        matches: [
          { reservation_id: "res-auth-3", guest_name: "MARIE DUPONT", room_number: "346", confidence: 92 },
          { reservation_id: "res-draft-1", guest_name: "John Dupont", room_number: "302", confidence: 45 }
        ],
        best_match: { reservation_id: "res-auth-3", confidence: 92 },
        auto_matched: true
      }
    };
  } else {
    // Failing match
    return {
      success: true,
      data: {
        matches: [],
        best_match: null,
        auto_matched: false
      }
    };
  }
}

export async function mockConfirmCheckin(payload: any) {
  await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
  
  const isComplete = payload.guest_info && payload.guest_info.passport_no && payload.guest_info.nationality;
  
  if (payload.force_draft || !isComplete) {
    return {
      success: true,
      data: {
        reservation_id: payload.reservation_id,
        status: "draft_checkin",
        is_draft: true,
        profile_complete: false,
        missing_fields: ["nationality", "date_of_birth"]
      }
    };
  }
  
  return {
    success: true,
    data: {
      reservation_id: payload.reservation_id,
      status: "checked_in",
      is_draft: false,
      profile_complete: true,
      missing_fields: []
    }
  };
}

export async function mockPassportPhoto(scanId: string) {
  await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
  
  if (scanId === "error-pdpa") {
    // Simulate PDPA rejection after Night Audit
    return {
      success: false,
      error: "403 Forbidden: ไม่สามารถดูได้หลัง Night Audit"
    };
  }

  return {
    success: true,
    data: {
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/French_passport_%282013%29.jpg/640px-French_passport_%282013%29.jpg",
      ocr_parsed: {
        passportNumber: "AB1234567",
        firstName: "MARIE",
        familyName: "DUPONT",
        nationality: "FRA",
        dateOfBirth: "1990-05-15",
        gender: "F",
        mrzLine1: "P<FRADUPONT<<MARIE<<<<<<<<<<<<<<<<<<<<<<<<<<",
        mrzLine2: "1234567897FRA9005151F3001010<<<<<<<<<<<<<<02"
      },
      created_at: new Date().toISOString()
    }
  };
}

