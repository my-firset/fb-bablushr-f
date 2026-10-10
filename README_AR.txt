v16.5.22 — إصلاح طرد user_not_found تحت الضغط
==============================================
السيرفر:
- check.php: فشل قراءة users.json → 503 storage_unavailable (ليس user_not_found)
- قفل users موجود في bootstrap (lockdir + bak + رفض المسح)

الإضافة:
- user_not_found / 503 لم تعد hardFail
- lp_verifyRemoteAccess يبقي الجلسة عند فشل تخزين مؤقت

ارفع: api/check.php + includes/bootstrap.php + الإضافة
لا تمسح data/
ثبّت الإضافة 16.5.22 بعد حذف القديمة
