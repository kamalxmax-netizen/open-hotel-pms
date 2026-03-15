import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">ไม่มีสิทธิ์เข้าถึง</h1>
        <p className="text-sm text-slate-500 mb-6">
          คุณไม่มีสิทธิ์เข้าถึงหน้านี้ กรุณาติดต่อ Admin เพื่อขอสิทธิ์เพิ่มเติม
        </p>
        <Link
          href="/pms"
          className="inline-flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          กลับหน้าหลัก
        </Link>
      </div>
    </div>
  );
}
